/**
 * Role parameter validation chain — the single parser for the
 * `ts-<appID>-<role>` standard (see 03_Validation_Chain.md).
 *
 * This module is the only place that validates application keys, role
 * parameters, and the `custom:tsRoles` claim. It is consumed by:
 *   - the SSO backend strict assignment (Task 7) and the pre-token filter
 *     (Task 5), both of which run under `amplify/` in `sso-backend`;
 *   - each application frontend (Task 9), which runs the authorize mode and
 *     does NOT import any `amplify/` tree.
 *
 * To stay portable it holds NO amplify-runtime dependencies: pure TypeScript
 * functions plus the catalog from `./role-catalog`. The catalog
 * (`amplify/auth/role-catalog.ts`) is the single source of truth; this module
 * never hard-codes application keys or role parameters.
 *
 * Requirements covered:
 *   - 3.4 names that omit the `ts-<appID>` prefix, add extra hyphens, or use
 *         another separator (e.g. `legalDocs-administrators`) are rejected;
 *         strict mode creates no client, group, or claim for them.
 *   - 5.1 application `ts-<appID>` authorizes using only tokens prefixed with
 *         `ts-<appID>-`.
 *   - 5.2 roles for other applications stay in the claim but do not grant
 *         access in the caller.
 *   - 5.3 an authenticated user with no catalog role for the caller is denied
 *         application access (noRole / UNAUTHORIZED_APP) while the SSO session
 *         is kept.
 */

import {
  ROLE_PARAMETER_PATTERN,
  isKnownApplication,
  isCatalogRole,
  findRole,
} from './role-catalog';

/** The maximum length of the `custom:tsRoles` claim (Requirement 4.1). */
export const CLAIM_MAX_LENGTH = 2048;

/** An application key: `ts-` followed by an appID. */
export type ApplicationKey = `ts-${string}`;

/** A parsed, catalogued role parameter `ts-<appID>-<role>`. */
export interface RoleParameter {
  raw: string;
  appKey: ApplicationKey;
  appID: string;
  role: string;
}

/**
 * A validation issue. `roleParameter` throws one of these in strict mode; the
 * `claim` decision collects them in its `malformed` status.
 */
export interface ValidationIssue {
  code:
    | 'ROLE_MALFORMED'
    | 'ROLE_UNKNOWN_APP'
    | 'ROLE_NOT_IN_CATALOG'
    | 'CLAIM_MALFORMED'
    | 'CLAIM_TOO_LONG';
  token?: string;
}

/**
 * The result of authorizing a claim for a caller application.
 *   - `authorized`: one or more catalog roles scoped to the caller.
 *   - `noRole`: a well-formed (or missing) claim with no role for the caller.
 *     The SSO session is kept; only application access is denied.
 *   - `malformed`: the claim could not be parsed; access is denied.
 */
export type AuthorizationDecision =
  | { status: 'authorized'; roles: RoleParameter[] }
  | { status: 'noRole'; reason: 'CLAIM_MISSING' | 'UNAUTHORIZED_APP' }
  | { status: 'malformed'; issues: ValidationIssue[] };

/** A token dropped by the pattern+catalog filter, with the reason logged. */
export interface DroppedToken {
  token: string;
  code: 'ROLE_MALFORMED' | 'ROLE_UNKNOWN_APP' | 'ROLE_NOT_IN_CATALOG';
}

/** The result of the reusable pattern+catalog filter. */
export interface FilterResult {
  matches: RoleParameter[];
  dropped: DroppedToken[];
}

/**
 * A validation issue that is also a throwable `Error`, so strict assignment can
 * `throw` it (Requirement 3.4) while callers can still read `code`/`token`.
 */
export class ValidationError extends Error implements ValidationIssue {
  readonly code: ValidationIssue['code'];
  readonly token?: string;

  constructor(code: ValidationIssue['code'], token?: string) {
    super(token === undefined ? code : `${code}: ${token}`);
    this.name = 'ValidationError';
    this.code = code;
    this.token = token;
  }
}

/**
 * Parse a token that already matches `ROLE_PARAMETER_PATTERN` into its parts.
 * Because neither `appID` nor `role` may contain `-`, a matching string splits
 * on `-` into exactly three segments: `ts`, appID, role.
 */
function parseMatchedRole(raw: string): RoleParameter {
  const [, appID, role] = raw.split('-');
  return {
    raw,
    appKey: `ts-${appID}`,
    appID,
    role,
  };
}

/**
 * Classify a single token against the pattern and the catalog. Returns a parsed
 * `RoleParameter` when it is a catalogued role, or a `DroppedToken` with the
 * reason. Shared by strict assignment and the authorize/pre-token filter so the
 * three behaviors stay in one place.
 */
function classifyToken(token: string): RoleParameter | DroppedToken {
  if (!ROLE_PARAMETER_PATTERN.test(token)) {
    return { token, code: 'ROLE_MALFORMED' };
  }
  const parsed = parseMatchedRole(token);
  if (!isKnownApplication(parsed.appKey)) {
    return { token, code: 'ROLE_UNKNOWN_APP' };
  }
  if (!isCatalogRole(token)) {
    return { token, code: 'ROLE_NOT_IN_CATALOG' };
  }
  return parsed;
}

/** Type guard: a classified token that was dropped. */
function isDropped(result: RoleParameter | DroppedToken): result is DroppedToken {
  return (result as DroppedToken).code !== undefined;
}

/**
 * Reusable pattern+catalog filter (chain steps 4 and 5). Keeps catalogued role
 * parameters and reports every dropped token with its reason. This is the ONLY
 * sub-behavior the pre-token trigger (Task 5) needs: it filters a group list
 * and never rejects the login. It performs no scope, uniqueness, or length
 * check, so it can be reused by both the trigger and `claim`.
 *
 * @param tokens role parameters (e.g. Cognito group names) to filter.
 * @param log optional sink invoked once per dropped token.
 */
export function filterCatalogRoles(
  tokens: readonly string[],
  log?: (dropped: DroppedToken) => void,
): FilterResult {
  const matches: RoleParameter[] = [];
  const dropped: DroppedToken[] = [];
  for (const token of tokens) {
    const result = classifyToken(token);
    if (isDropped(result)) {
      dropped.push(result);
      log?.(result);
    } else {
      matches.push(result);
    }
  }
  return { matches, dropped };
}

/**
 * Validate an application key: `^ts-[a-z][A-Za-z0-9]*$` and a catalog entry.
 * Throws a `ValidationError` on failure (used by strict callers).
 */
export function applicationKey(value: string): ApplicationKey {
  if (typeof value !== 'string' || !isKnownApplication(value)) {
    throw new ValidationError('ROLE_UNKNOWN_APP', typeof value === 'string' ? value : undefined);
  }
  return value as ApplicationKey;
}

/**
 * Strict assignment of one role (chain: required → pattern → segments →
 * knownApplication → catalogRole → accept). Throws a `ValidationError` on the
 * first failing step; the strict operation rejects the whole assignment.
 * Requirement 3.4.
 */
export function roleParameter(value: string): RoleParameter {
  // required
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('ROLE_MALFORMED', typeof value === 'string' ? value : undefined);
  }
  // pattern (+ segments: a match splits on '-' into exactly ts, appID, role)
  if (!ROLE_PARAMETER_PATTERN.test(value)) {
    throw new ValidationError('ROLE_MALFORMED', value);
  }
  const parsed = parseMatchedRole(value);
  // knownApplication
  if (!isKnownApplication(parsed.appKey)) {
    throw new ValidationError('ROLE_UNKNOWN_APP', value);
  }
  // catalogRole
  if (!isCatalogRole(value)) {
    throw new ValidationError('ROLE_NOT_IN_CATALOG', value);
  }
  // accept — return the catalogued parsed role (preserves catalog casing).
  const entry = findRole(value)!;
  return {
    raw: entry.roleParameter,
    appKey: entry.appKey as ApplicationKey,
    appID: entry.appID,
    role: entry.role,
  };
}

/**
 * Authorize a `custom:tsRoles` claim for a caller application (chain steps 1-8).
 * Never throws for `noRole`; returns a decision instead.
 *
 * @param value the raw claim string (or `undefined`/`null` when absent).
 * @param callerAppKey the caller's application key, e.g. `ts-oraculo`.
 * @param log optional sink for dropped (non-catalog) tokens.
 */
export function claim(
  value: string | null | undefined,
  callerAppKey: ApplicationKey,
  log?: (dropped: DroppedToken) => void,
): AuthorizationDecision {
  // 1. required — missing/blank is noRole (authenticated, not authorized);
  //    a non-string claim is malformed.
  if (value === undefined || value === null) {
    return { status: 'noRole', reason: 'CLAIM_MISSING' };
  }
  if (typeof value !== 'string') {
    return { status: 'malformed', issues: [{ code: 'CLAIM_MALFORMED' }] };
  }
  if (value.length === 0) {
    return { status: 'noRole', reason: 'CLAIM_MISSING' };
  }

  // 2. maxLength — more than 2048 characters is malformed.
  if (value.length > CLAIM_MAX_LENGTH) {
    return { status: 'malformed', issues: [{ code: 'CLAIM_TOO_LONG' }] };
  }

  // 3. split — leading/trailing space or an empty token (double space) is
  //    malformed. Tokens split on a single space.
  if (value.startsWith(' ') || value.endsWith(' ')) {
    return { status: 'malformed', issues: [{ code: 'CLAIM_MALFORMED' }] };
  }
  const tokens = value.split(' ');
  if (tokens.some((token) => token.length === 0)) {
    return { status: 'malformed', issues: [{ code: 'CLAIM_MALFORMED' }] };
  }

  // 4. pattern — any token failing the role expression is malformed.
  const patternIssues: ValidationIssue[] = tokens
    .filter((token) => !ROLE_PARAMETER_PATTERN.test(token))
    .map((token) => ({ code: 'ROLE_MALFORMED', token }));
  if (patternIssues.length > 0) {
    return { status: 'malformed', issues: patternIssues };
  }

  // 6. unique — duplicate tokens are malformed. (Checked on the raw tokens,
  //    before catalog dropping, so a repeated token is always caught.)
  const seen = new Set<string>();
  const duplicateIssues: ValidationIssue[] = [];
  for (const token of tokens) {
    if (seen.has(token)) {
      duplicateIssues.push({ code: 'CLAIM_MALFORMED', token });
    }
    seen.add(token);
  }
  if (duplicateIssues.length > 0) {
    return { status: 'malformed', issues: duplicateIssues };
  }

  // 5. catalog — drop tokens whose app key or full role is not in the catalog;
  //    log each drop. (All tokens already match the pattern at this point.)
  const { matches } = filterCatalogRoles(tokens, log);

  // 7. scope — keep tokens whose app key equals the caller (Requirement 5.1,
  //    5.2: other apps' roles stay in the claim but do not authorize here).
  const scoped = matches.filter((role) => role.appKey === callerAppKey);

  // 8. decide — one or more scoped roles authorizes; zero after a well-formed
  //    claim is noRole / UNAUTHORIZED_APP (Requirement 5.3).
  if (scoped.length > 0) {
    return { status: 'authorized', roles: scoped };
  }
  return { status: 'noRole', reason: 'UNAUTHORIZED_APP' };
}

/**
 * The `RoleValidationChain` interface from 03_Validation_Chain.md, bound to the
 * catalog. Frontends and the backend can import the functions directly or use
 * this object.
 */
export interface RoleValidationChain {
  applicationKey(value: string): ApplicationKey;
  roleParameter(value: string): RoleParameter;
  claim(value: string | null | undefined, callerAppKey: ApplicationKey): AuthorizationDecision;
}

/** The default chain implementation over the catalog. */
export const roleValidationChain: RoleValidationChain = {
  applicationKey,
  roleParameter,
  claim,
};
