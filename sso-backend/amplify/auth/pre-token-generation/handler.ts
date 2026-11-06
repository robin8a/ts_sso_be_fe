import type {
  PreTokenGenerationV2TriggerHandler,
  PreTokenGenerationV2TriggerEvent,
} from 'aws-lambda';
import { filterCatalogRoles, CLAIM_MAX_LENGTH } from '../validation-chain';
import { roleParameters } from '../role-catalog';
import { TS_ROLES_ATTRIBUTE } from '../client-attributes';

/**
 * Pre-token generation (V2) handler — the real `custom:tsRoles` claim builder.
 *
 * Cognito groups are the source of truth at token issue (02_Design_Document.md,
 * "Pre-token trigger"). The stored `custom:tsRoles` attribute can lag a group
 * change, so this trigger OVERWRITES the claim from the user's current groups.
 * The token can therefore never carry a stale value.
 *
 * Behavior (Requirements 4.3, 4.4, 5.1):
 *   - Read the user's Cognito groups from the V2 event
 *     (`request.groupConfiguration.groupsToOverride`).
 *   - Filter them through the shared pattern+catalog filter
 *     (`filterCatalogRoles`), then order the matches by CATALOG order
 *     (`roleParameters()`), so the same membership always yields the same
 *     string regardless of the order Cognito lists the groups.
 *   - Join the catalog matches with a single space, no leading/trailing space.
 *   - Write that string to `custom:tsRoles` on BOTH the ID token and the access
 *     token via `claimsAndScopeOverrideDetails` (trigger version V2_0, which is
 *     what lets a trigger customize the access token).
 *   - OMIT the claim entirely when the filtered list is empty (Requirement 4.4),
 *     and also when the built string would exceed 2048 characters
 *     (`CLAIM_TOO_LONG`, 05_Error_Handling.md) — never truncate.
 *   - A stray (non-catalog) group is dropped and logged; login never fails.
 *
 * Logging (05_Error_Handling.md): log `code`, `appKey`, and the Cognito
 * `username` for each dropped group and for an over-length claim. The full claim
 * is only logged in the sandbox. Tokens, codes, and the PKCE verifier are never
 * logged (none are available to this trigger anyway).
 */

/** The outcome of building the claim from a user's groups. */
export interface ClaimResult {
  /** The `custom:tsRoles` value, or `undefined` when the claim is omitted. */
  claim: string | undefined;
}

/** A structured log line for a dropped group or an omitted over-length claim. */
export interface ClaimLogEntry {
  code: 'ROLE_MALFORMED' | 'ROLE_UNKNOWN_APP' | 'ROLE_NOT_IN_CATALOG' | 'CLAIM_TOO_LONG';
  /** Owning application key of the token, when one can be derived. */
  appKey?: string;
  /** The rejected raw group name (operator-facing); omitted for CLAIM_TOO_LONG. */
  token?: string;
}

/**
 * True only inside an Amplify sandbox. The full claim string is logged only in
 * the sandbox; deployed environments never log it (05_Error_Handling.md).
 */
function isSandbox(): boolean {
  // Amplify sets AWS_BRANCH only for pipeline deployments; sandbox has none.
  // Treat an explicit sandbox identifier as the sandbox signal.
  return process.env.AWS_BRANCH === undefined;
}

/**
 * Derive the owning application key (`ts-<appID>`) of a catalog group name for
 * logging. Safe for any input: returns `undefined` when the shape is unexpected.
 */
function appKeyOf(group: string): string | undefined {
  const parts = group.split('-');
  return parts.length >= 2 && parts[0] === 'ts' ? `ts-${parts[1]}` : undefined;
}

/**
 * Pure claim builder — unit-testable without a Lambda event.
 *
 * Filters `groups` to catalog roles, orders them by catalog order
 * (`roleParameters()`), and joins with a single space. Returns `undefined` when
 * nothing matches or when the joined string would exceed `CLAIM_MAX_LENGTH`
 * (the claim is omitted, not truncated). Every dropped group and any
 * over-length omission is reported to `log`.
 *
 * @param groups the user's Cognito group names (any order, possibly stray).
 * @param log optional sink, one entry per dropped group / over-length omission.
 */
export function claimFromGroups(
  groups: readonly string[],
  log?: (entry: ClaimLogEntry) => void,
): string | undefined {
  // Steps 4 & 5 of the chain only: pattern + catalog filter, never rejects.
  // Each drop is logged with its code and the owning app key (operator-facing).
  const { matches } = filterCatalogRoles(groups, (dropped) => {
    log?.({ code: dropped.code, appKey: appKeyOf(dropped.token), token: dropped.token });
  });

  if (matches.length === 0) {
    // No catalog role -> omit the claim (Requirement 4.4).
    return undefined;
  }

  // Order by CATALOG order so the same membership is always the same string,
  // independent of the order Cognito returned the groups.
  const held = new Set(matches.map((role) => role.raw));
  const ordered = roleParameters().filter((role) => held.has(role));
  const value = ordered.join(' ');

  // A claim that would exceed 2048 chars is OMITTED (never truncated) and
  // logged as CLAIM_TOO_LONG. The user still signs in and gets UNAUTHORIZED_APP
  // downstream until an operator shortens the set (05_Error_Handling.md).
  if (value.length > CLAIM_MAX_LENGTH) {
    log?.({ code: 'CLAIM_TOO_LONG' });
    return undefined;
  }

  return value;
}

/**
 * Read the user's group membership from a V2 pre-token event. For the
 * pre-token V2 trigger the user's Cognito groups are provided in
 * `request.groupConfiguration.groupsToOverride`.
 */
function groupsFromEvent(event: PreTokenGenerationV2TriggerEvent): string[] {
  return event.request.groupConfiguration?.groupsToOverride ?? [];
}

export const handler: PreTokenGenerationV2TriggerHandler = async (event) => {
  const username = event.userName;
  const sandbox = isSandbox();

  const claim = claimFromGroups(groupsFromEvent(event), (entry) => {
    // Log code + appKey + username; include the raw group only for operator
    // drop reasons, and the full claim is never logged here regardless of env.
    const line: Record<string, unknown> = { code: entry.code, username };
    if (entry.appKey !== undefined) line.appKey = entry.appKey;
    if (entry.token !== undefined) line.group = entry.token;
    // eslint-disable-next-line no-console
    console.warn('pre-token custom:tsRoles', line);
  });

  // Build the claim overrides. When the claim is omitted we set NOTHING for
  // `custom:tsRoles` on either token (Requirement 4.4 / CLAIM_TOO_LONG).
  if (claim !== undefined) {
    const claimsToAddOrOverride = { [TS_ROLES_ATTRIBUTE]: claim };
    event.response.claimsAndScopeOverrideDetails = {
      idTokenGeneration: { claimsToAddOrOverride },
      // Access-token customization requires the user pool feature plan to be
      // Essentials or Plus (set via userPoolTier in backend.ts). On the default
      // Lite plan Cognito ignores access-token claim overrides.
      accessTokenGeneration: { claimsToAddOrOverride },
    };
    if (sandbox) {
      // eslint-disable-next-line no-console
      console.debug('pre-token custom:tsRoles issued', { username, claim });
    }
  }

  return event;
};
