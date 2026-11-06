/**
 * Per-application app-client configuration (Task 6, Requirements 1.3, 3.1,
 * 5.4, 6.4).
 *
 * `buildAppClientConfigs()` is a PURE, catalog-driven builder: it maps over
 * `amplify/auth/role-catalog.ts` APPLICATIONS and returns one plain config
 * object per catalogued application (ts-oraculo, ts-legalDocs, ts-dataDrones
 * [web] and ts-datum [mobile]). It does NOT import CDK, so `backend.ts` can feed
 * each config into an L1 `CfnUserPoolClient` while the rules below stay unit
 * testable without a CloudFormation synth (06_Testing_Strategy.md "App-client
 * settings inspection").
 *
 * The application list is never hard-coded here — it is whatever the catalog
 * lists, so adding an application is a new catalog row and this builder (and the
 * loop / outputs map in `backend.ts`) pick it up automatically.
 *
 * Per application the config pins:
 *   - clientName = the application key (Requirement 3.1).
 *   - Authorization Code + PKCE: allowedOAuthFlows ['code'],
 *     allowedOAuthFlowsUserPoolClient true, scopes openid/email/profile, and no
 *     generated secret (public PKCE client — no secret to reuse across apps,
 *     Requirement 1.3 / 6.4).
 *   - callbackUrls / logoutUrls are ONLY that application's URLs, taken straight
 *     from its `ApplicationRecord`, so a URL on one client never appears on
 *     another (per-app isolation, Requirement 5.4 / 6.4). ts-datum carries its
 *     own mobile `tsdatum://` URLs.
 *   - readAttributes include `custom:tsRoles`, writeAttributes exclude it — the
 *     same read/write split as the default client (Requirement 4.1 / 6.4), so no
 *     client lets an end user self-write the role attribute.
 *   - preventUserExistenceErrors ENABLED (Requirement 6.4) and token revocation
 *     on for global sign-out (Requirement 6.3).
 */

import {
  APPLICATIONS,
  type ApplicationRecord,
  type ClientKind,
} from './role-catalog';
import {
  clientReadAttributes,
  clientWriteAttributes,
} from './client-attributes';

/**
 * OAuth flows for every app client: Authorization Code only (Requirement 1.3 /
 * 6.4). No implicit flow — the PKCE code flow is the only one allowed.
 */
export const APP_CLIENT_OAUTH_FLOWS = ['code'] as const;

/**
 * OAuth scopes for every app client: the standard OIDC identity scopes
 * (Requirement 1.3). `openid` enables OIDC, `email`/`profile` back the identity
 * attributes the frontend reads.
 */
export const APP_CLIENT_OAUTH_SCOPES = ['openid', 'email', 'profile'] as const;

/**
 * Identity providers for every app client: Cognito itself only. Federated
 * providers are not part of the initial catalog.
 */
export const APP_CLIENT_IDENTITY_PROVIDERS = ['COGNITO'] as const;

/**
 * Hosted UI user-existence error prevention, ENABLED on every client so sign-in
 * failures don't leak whether an account exists (Requirement 6.4).
 */
export const APP_CLIENT_PREVENT_USER_EXISTENCE_ERRORS = 'ENABLED' as const;

/**
 * A pure, CDK-free description of one application's Cognito app client. Fields
 * mirror exactly what `backend.ts` destructures and maps onto the L1
 * `CfnUserPoolClient` (it maps `callbackUrls`/`logoutUrls` onto the CDK L1
 * spellings `callbackUrLs`/`logoutUrLs`).
 */
export interface AppClientConfig {
  /**
   * Stable CloudFormation logical id for this application's client construct,
   * derived from the application key (chars restricted to [A-Za-z0-9]). Unique
   * across the catalog because application keys are unique.
   */
  logicalId: string;
  /** The owning application key (e.g. `ts-oraculo`), used for the outputs map. */
  appKey: string;
  /** How this application signs in; `ts-datum` is `mobile`. */
  clientKind: ClientKind;
  /** App client name — equals the application key (Requirement 3.1). */
  clientName: string;
  /** Public PKCE client: no secret is generated, so none is reused (Req 6.4). */
  generateSecret: boolean;
  /** Authorization Code flow only (Requirement 1.3 / 6.4). */
  allowedOAuthFlows: string[];
  /** Enable the pool-client OAuth flags so the flows above apply. */
  allowedOAuthFlowsUserPoolClient: boolean;
  /** Scopes openid/email/profile (Requirement 1.3). */
  allowedOAuthScopes: string[];
  /** ONLY this application's callback URLs (per-app isolation, Req 5.4 / 6.4). */
  callbackUrls: string[];
  /** ONLY this application's logout URLs (per-app isolation, Req 5.4 / 6.4). */
  logoutUrls: string[];
  /** Readable attributes — include `custom:tsRoles` (Requirement 4.1). */
  readAttributes: string[];
  /** Writable attributes — exclude `custom:tsRoles` (Requirement 4.1 / 6.4). */
  writeAttributes: string[];
  /** Prevent user-existence errors on the Hosted UI (Requirement 6.4). */
  preventUserExistenceErrors: string;
  /** Supported identity providers — Cognito only. */
  supportedIdentityProviders: string[];
  /** Enable token revocation so global sign-out works (Requirement 6.3). */
  enableTokenRevocation: boolean;
}

/**
 * Upper-case the first character of a non-empty string. Used to PascalCase the
 * segments of an application key when forming a CloudFormation logical id.
 */
function capitalize(segment: string): string {
  if (segment.length === 0) {
    return segment;
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * Derive a stable, valid CloudFormation logical id from an application key.
 *
 * CFN logical ids must be alphanumeric ([A-Za-z0-9]); the `ts-<appID>` key has a
 * `-`, so split on non-alphanumeric characters, PascalCase each segment, and
 * prefix with `AppClient`. e.g. `ts-oraculo` -> `AppClientTsOraculo`. The result
 * is deterministic per key and unique across the catalog because keys are unique.
 */
export function appClientLogicalId(appKey: string): string {
  const pascal = appKey
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map(capitalize)
    .join('');
  return `AppClient${pascal}`;
}

/**
 * Build the pure config for a single catalogued application. Callback/logout
 * URLs come ONLY from this application's `ApplicationRecord`, so no URL is
 * shared across clients. The read/write attribute split is reused from
 * `client-attributes.ts` so it stays identical to the default client.
 */
export function buildAppClientConfig(app: ApplicationRecord): AppClientConfig {
  return {
    logicalId: appClientLogicalId(app.appKey),
    appKey: app.appKey,
    clientKind: app.clientKind,
    clientName: app.appKey,
    generateSecret: false,
    allowedOAuthFlows: [...APP_CLIENT_OAUTH_FLOWS],
    allowedOAuthFlowsUserPoolClient: true,
    allowedOAuthScopes: [...APP_CLIENT_OAUTH_SCOPES],
    // Only this application's URLs — copied so callers cannot mutate the catalog.
    callbackUrls: [...app.callbackUrls],
    logoutUrls: [...app.logoutUrls],
    readAttributes: clientReadAttributes(),
    writeAttributes: clientWriteAttributes(),
    preventUserExistenceErrors: APP_CLIENT_PREVENT_USER_EXISTENCE_ERRORS,
    supportedIdentityProviders: [...APP_CLIENT_IDENTITY_PROVIDERS],
    enableTokenRevocation: true,
  };
}

/**
 * Build one config per catalogued application, in catalog order. Catalog-driven:
 * the list is `APPLICATIONS` from `role-catalog.ts`, never hard-coded here.
 */
export function buildAppClientConfigs(): AppClientConfig[] {
  return APPLICATIONS.map((app) => buildAppClientConfig(app));
}
