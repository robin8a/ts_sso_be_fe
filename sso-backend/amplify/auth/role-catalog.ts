/**
 * Application and role catalog — the single source of truth.
 *
 * `amplify/auth/role-catalog.ts` is the only list of application keys and role
 * parameters for the TerraSacha SSO backend. User-pool groups
 * (`defineAuth({ groups })` in `resource.ts`), the pre-token trigger (Task 5),
 * and the strict/authorize validation chain (Task 3) all read this module so
 * there is exactly one place that defines what exists.
 *
 * Naming standard (see 02_Design_Document.md and 03_Validation_Chain.md):
 *   - Application key / app client name: `ts-<appID>`         e.g. `ts-oraculo`
 *   - Role parameter / Cognito group:   `ts-<appID>-<role>`   e.g. `ts-oraculo-administrators`
 * where `appID` and `role` match `[a-z][A-Za-z0-9]*`.
 *
 * Requirements covered:
 *   - 3.1 application key matches APP_KEY_PATTERN; app client name equals the key.
 *   - 3.2 role parameter matches ROLE_PARAMETER_PATTERN and splits on '-' into
 *         exactly three segments: `ts`, appID, role.
 *   - 3.3 initial catalog contains ts-oraculo, ts-legalDocs, ts-dataDrones,
 *         ts-datum, plus roles ts-oraculo-administrators and ts-legalDocs-administrators.
 *   - 5.4 ts-datum reuses the same claim rules with its own mobile callback URLs
 *         and only ts-datum- prefixed roles (none catalogued initially).
 */

/** How an application's dedicated app client signs in. `ts-datum` is mobile. */
export type ClientKind = 'web' | 'mobile';

/**
 * A catalogued application. `appKey` is the app client name. `callbackUrls` and
 * `logoutUrls` are client configuration, not part of the role name. Values here
 * are sandbox/localhost placeholders where concrete deployed URLs are not yet
 * known; each client limits its OWN redirect URLs, so no callback/logout URL is
 * shared across applications (per-app isolation, Requirement 5.4 / 6.4 — the web
 * sandbox placeholders use distinct ports 3000/3001/3002 so a URL registered on
 * one client never appears on another; `ts-datum` uses its own mobile scheme).
 */
export interface ApplicationRecord {
  appKey: string;
  appID: string;
  clientKind: ClientKind;
  callbackUrls: string[];
  logoutUrls: string[];
}

/**
 * A catalogued role parameter. The full `roleParameter` string is the Cognito
 * group name. `appKey` is the owning application; `role` is the suffix.
 */
export interface RoleCatalogEntry {
  roleParameter: string;
  appKey: string;
  appID: string;
  role: string;
}

/**
 * Application key grammar: `ts-` followed by a lower-case-led alphanumeric appID.
 * Requirement 3.1. Anchored so the whole string must match.
 */
export const APP_KEY_PATTERN = /^ts-[a-z][A-Za-z0-9]*$/;

/**
 * Role parameter grammar: `ts-<appID>-<role>`, each of appID and role a
 * lower-case-led alphanumeric segment. Requirement 3.2. Anchored, and because
 * neither segment may contain `-`, a match splits on `-` into exactly three
 * parts: `ts`, appID, role.
 */
export const ROLE_PARAMETER_PATTERN = /^ts-[a-z][A-Za-z0-9]*-[a-z][A-Za-z0-9]*$/;

/**
 * Initial applications (Requirement 3.3). Order is the catalog order used for
 * stable listings. `ts-dataDrones` and `ts-datum` have no initial role.
 * `ts-datum` is the mobile client (appMovil) and carries its own mobile URLs.
 */
export const APPLICATIONS: readonly ApplicationRecord[] = [
  {
    appKey: 'ts-oraculo',
    appID: 'oraculo',
    clientKind: 'web',
    callbackUrls: ['http://localhost:3000/api/auth/callback'],
    logoutUrls: ['http://localhost:3000/'],
  },
  {
    appKey: 'ts-legalDocs',
    appID: 'legalDocs',
    clientKind: 'web',
    callbackUrls: ['http://localhost:3001/api/auth/callback'],
    logoutUrls: ['http://localhost:3001/'],
  },
  {
    appKey: 'ts-dataDrones',
    appID: 'dataDrones',
    clientKind: 'web',
    callbackUrls: ['http://localhost:3002/api/auth/callback'],
    logoutUrls: ['http://localhost:3002/'],
  },
  {
    appKey: 'ts-datum',
    appID: 'datum',
    clientKind: 'mobile',
    callbackUrls: ['tsdatum://auth/callback'],
    logoutUrls: ['tsdatum://auth/logout'],
  },
] as const;

/**
 * Initial role parameters (Requirement 3.3), in catalog order. `administrators`
 * means full administration of the application in `appKey`. New roles are new
 * rows here, never a free-form group name.
 */
export const ROLE_CATALOG: readonly RoleCatalogEntry[] = [
  {
    roleParameter: 'ts-oraculo-administrators',
    appKey: 'ts-oraculo',
    appID: 'oraculo',
    role: 'administrators',
  },
  {
    roleParameter: 'ts-legalDocs-administrators',
    appKey: 'ts-legalDocs',
    appID: 'legalDocs',
    role: 'administrators',
  },
] as const;

/**
 * Catalog role parameters in catalog order, used to create one Cognito group
 * per role via `defineAuth({ groups })` and consumed by the pre-token trigger
 * (Task 4/5). Stable order keeps the claim string deterministic.
 *
 * Today this is `['ts-oraculo-administrators', 'ts-legalDocs-administrators']`.
 */
export function roleParameters(): string[] {
  return ROLE_CATALOG.map((entry) => entry.roleParameter);
}

/** All catalogued application keys, in catalog order (e.g. for app clients). */
export function applicationKeys(): string[] {
  return APPLICATIONS.map((app) => app.appKey);
}

/** Look up an application record by its key, or `undefined` if not catalogued. */
export function findApplication(appKey: string): ApplicationRecord | undefined {
  return APPLICATIONS.find((app) => app.appKey === appKey);
}

/** Look up a role catalog entry by its full parameter, or `undefined`. */
export function findRole(roleParameter: string): RoleCatalogEntry | undefined {
  return ROLE_CATALOG.find((entry) => entry.roleParameter === roleParameter);
}

/** True when `appKey` is a catalogued application (Requirement 3.1 lookup). */
export function isKnownApplication(appKey: string): boolean {
  return findApplication(appKey) !== undefined;
}

/** True when `roleParameter` is a catalogued role (Requirement 3.2/3.3 lookup). */
export function isCatalogRole(roleParameter: string): boolean {
  return findRole(roleParameter) !== undefined;
}
