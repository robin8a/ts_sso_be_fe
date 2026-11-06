import { userInfo } from 'node:os';
import { defineBackend } from '@aws-amplify/backend';
import { aws_cognito as cognito } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import {
  TS_ROLES_ATTRIBUTE,
  defaultClientReadAttributes,
  defaultClientWriteAttributes,
} from './auth/client-attributes';
import { buildAppClientConfigs } from './auth/app-clients';

/**
 * TerraSacha SSO backend.
 *
 * Uses the one Cognito domain Amplify creates for Hosted UI (Requirement 6.1).
 * A user pool accepts a single domain, so this file sets that domain's prefix
 * instead of calling addDomain again. There is one domain for the pool:
 *
 *   - Sandbox (no custom domain): a Cognito prefix domain on amazoncognito.com.
 *     Prefix domains are sandbox-only; silent SSO is not treated as satisfied on
 *     a prefix domain outside sandbox (Requirement 2.2 / 2.4).
 *   - Deployed shared environments: a custom domain on the same parent domain as
 *     the web apps, so the Hosted UI cookie is first-party (Requirement 2.1).
 *
 * The sandbox prefix is read from TS_SSO_DOMAIN_PREFIX (falls back to a default)
 * so each developer's sandbox can use a unique, globally-available prefix.
 */
const backend = defineBackend({
  auth,
  data,
});

const userPool = backend.auth.resources.userPool;

/**
 * Attribute permissions on the DEFAULT app client (Requirement 4.1,
 * 04_Data_Models.md attribute rules).
 *
 * `defineAuth` generates one sandbox/default app client. The custom attribute is
 * declared `mutable: true` at the pool level so the admin assignment operation
 * (Task 7, `AdminUpdateUserAttributes`) can write it. Pool-level mutability does
 * NOT by itself stop a signed-in end user from self-writing the attribute: that
 * is governed per app client by its write attributes. Amplify's generated client
 * would otherwise expose `custom:tsRoles` as writable.
 *
 * So this escape hatch pins the default client's attribute permissions via the
 * L1 `CfnUserPoolClient`:
 *   - readAttributes  includes `custom:tsRoles`  -> app clients can read the role.
 *   - writeAttributes omits   `custom:tsRoles`  -> end users cannot self-write it
 *     (an end-user `UpdateUserAttributes` of `custom:tsRoles` is rejected -
 *     06_Testing_Strategy.md negative test `ROLE_NOT_WRITABLE`).
 *
 * The per-application app clients (Task 6) are created with the same read/write
 * split; this block enforces it for the default client that ships with
 * `defineAuth` so there is no client anywhere that lets an end user write roles.
 */
const defaultClient = backend.auth.resources.cfnResources.cfnUserPoolClient;
defaultClient.readAttributes = defaultClientReadAttributes();
defaultClient.writeAttributes = defaultClientWriteAttributes();

// Guard the split so a future edit cannot silently make the role attribute
// end-user-writable: read must include the attribute, write must exclude it.
if (!defaultClient.readAttributes.includes(TS_ROLES_ATTRIBUTE)) {
  throw new Error(
    `default app client readAttributes must include ${TS_ROLES_ATTRIBUTE}`,
  );
}
if (defaultClient.writeAttributes.includes(TS_ROLES_ATTRIBUTE)) {
  throw new Error(
    `default app client writeAttributes must NOT include ${TS_ROLES_ATTRIBUTE}`,
  );
}

/**
 * Pre-token trigger version + access-token customization (Task 5,
 * Requirements 4.3 / 4.4 / 5.1, 02_Design_Document.md "Pre-token trigger").
 *
 * `defineAuth({ triggers: { preTokenGeneration } })` wires the function as the
 * LEGACY pre-token trigger (`LambdaConfig.PreTokenGeneration`), which is trigger
 * version V1_0. V1 can only customize the ID token. To overwrite
 * `custom:tsRoles` on BOTH the ID token and the ACCESS token the trigger must
 * run at version V2_0, configured through `LambdaConfig.PreTokenGenerationConfig`
 * with `LambdaVersion = 'V2_0'`.
 *
 * Amplify Gen 2 does not expose the trigger version on `defineAuth`. CDK only
 * accepts V2_0 on `UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG`, and the
 * Lambda lives in a nested stack, so the function object must be passed to
 * `addTrigger`. Copying a resolved ARN onto `lambdaConfig` turns that
 * cross-stack reference into a GetAtt of a resource that is not in the auth
 * template.
 *
 * `defineAuth` already registered the same function as the legacy
 * `preTokenGeneration` trigger. This adds `preTokenGenerationConfig` at V2_0
 * with that same function, which is what CloudFormation requires.
 */
const cfnUserPool = backend.auth.resources.cfnResources.cfnUserPool;
const preTokenFunction = cfnUserPool.stack.node.root.node.findAll().find(
  (construct): construct is IFunction =>
    construct.node.id === 'pre-token-generation-lambda' &&
    'functionArn' in construct,
);
if (!preTokenFunction) {
  throw new Error(
    'expected a pre-token generation Lambda ARN from defineAuth to promote to V2_0',
  );
}
(userPool as cognito.UserPool).addTrigger(
  cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
  preTokenFunction,
  cognito.LambdaVersion.V2_0,
);

/**
 * Access-token claims customization is NOT a per-client boolean in Cognito; it
 * is gated by the user pool FEATURE PLAN. A V2 pre-token trigger can only set
 * claims on the ACCESS token when the pool is on the ESSENTIALS or PLUS plan.
 * On the default LITE plan Cognito silently ignores `accessTokenGeneration`
 * overrides (the ID-token claim still works).
 *
 * This raises the pool to ESSENTIALS so the V2 trigger's access-token
 * `custom:tsRoles` override takes effect on every app client of this pool
 * (default client here; per-application clients in Task 6 share the same pool
 * and therefore the same plan).
 *
 * DEPLOYMENT PREREQUISITE: ESSENTIALS is a paid Cognito tier. The account/region
 * must allow it; if a deployment must stay on LITE, the access-token claim will
 * be absent (the ID-token claim is unaffected) and downstream access checks that
 * read the access token must fall back to the ID token.
 */
cfnUserPool.userPoolTier = 'ESSENTIALS';

const generatedDomain = userPool.node.children.find((child) =>
  child.node.id.endsWith('UserPoolDomain'),
);
if (!generatedDomain) {
  throw new Error(
    `expected Amplify to create the Hosted UI domain from externalProviders (children: ${userPool.node.children.map((child) => child.node.id).join(', ')})`,
  );
}
const cfnDomain = generatedDomain.node.findChild('Resource') as cognito.CfnUserPoolDomain;
cfnDomain.domain = cognitoDomainPrefix();

/**
 * One app client per catalogued application (Task 6, Requirements 1.3, 3.1,
 * 5.4, 6.4).
 *
 * The client list is DRIVEN BY THE CATALOG: `buildAppClientConfigs()` maps over
 * `amplify/auth/role-catalog.ts` APPLICATIONS (ts-oraculo, ts-legalDocs,
 * ts-dataDrones [web] and ts-datum [mobile]) and returns one pure config per
 * application. Nothing here hard-codes the application list — adding an
 * application is a new catalog row and this loop and the outputs map below pick
 * it up automatically.
 *
 * Each config becomes an L1 `CfnUserPoolClient` on the SSO user pool (placed in
 * the auth stack, the same stack the default-client escape hatch above reaches
 * through `backend.auth.resources`). Per client:
 *   - clientName = the application key (Requirement 3.1).
 *   - Authorization Code + PKCE: allowedOAuthFlows ['code'],
 *     allowedOAuthFlowsUserPoolClient true, scopes openid/email/profile, and no
 *     generated secret (public PKCE client, no reused secret — Requirement 1.3 /
 *     6.4).
 *   - callbackUrls / logoutUrls are ONLY that application's URLs, so a URL on
 *     one client never appears on another (per-app isolation — Requirement 5.4 /
 *     6.4, `CALLBACK_NOT_ALLOWED`). ts-datum carries its own mobile URLs.
 *   - readAttributes include `custom:tsRoles`, writeAttributes exclude it, the
 *     same split as the default client (Requirement 4.1 / 6.4).
 *   - preventUserExistenceErrors ENABLED (Requirement 6.4) and token revocation
 *     on for global sign-out (Requirement 6.3).
 *
 * `appClientOutputs` is built in the SAME loop so the published outputs map
 * stays catalog-driven: `custom.appClients[appKey].userPoolClientId` is the
 * ref/attrClientId of that application's client, which the application backends
 * (Task 8) read for `referenceAuth`.
 */
const authStack = userPool.stack;
const userPoolId = userPool.userPoolId;
const appClientOutputs: Record<string, { userPoolClientId: string }> = {};

for (const config of buildAppClientConfigs()) {
  const client = new cognito.CfnUserPoolClient(authStack, config.logicalId, {
    userPoolId,
    clientName: config.clientName,
    // Public PKCE client: no secret is generated, so none is reused across apps.
    generateSecret: config.generateSecret,
    allowedOAuthFlows: config.allowedOAuthFlows,
    allowedOAuthFlowsUserPoolClient: config.allowedOAuthFlowsUserPoolClient,
    allowedOAuthScopes: config.allowedOAuthScopes,
    // Only this application's URLs — never another application's. (CDK L1
    // spells these `callbackUrLs` / `logoutUrLs`.)
    callbackUrLs: config.callbackUrls,
    logoutUrLs: config.logoutUrls,
    readAttributes: config.readAttributes,
    writeAttributes: config.writeAttributes,
    preventUserExistenceErrors: config.preventUserExistenceErrors,
    supportedIdentityProviders: config.supportedIdentityProviders,
    enableTokenRevocation: config.enableTokenRevocation,
  });

  // Guard the read/write split per application client as well as the default
  // client above: read must include the role attribute, write must exclude it.
  if (!config.readAttributes.includes(TS_ROLES_ATTRIBUTE)) {
    throw new Error(
      `app client ${config.appKey} readAttributes must include ${TS_ROLES_ATTRIBUTE}`,
    );
  }
  if (config.writeAttributes.includes(TS_ROLES_ATTRIBUTE)) {
    throw new Error(
      `app client ${config.appKey} writeAttributes must NOT include ${TS_ROLES_ATTRIBUTE}`,
    );
  }

  appClientOutputs[config.appKey] = {
    userPoolClientId: client.ref,
  };
}

/**
 * Publish the per-application client ids so application backends (Task 8) can
 * read `custom.appClients[<appKey>].userPoolClientId` for `referenceAuth`
 * (04_Data_Models.md "Amplify outputs"). The map is the loop's `appClientOutputs`,
 * so it stays one entry per catalogued application.
 */
backend.addOutput({
  custom: {
    appClients: appClientOutputs,
  },
});

/**
 * Cognito prefix domains are unique across the region. `terrasacha-sso` is
 * already taken, so the sandbox default adds this machine's username.
 * `TS_SSO_DOMAIN_PREFIX` still overrides it. The running sandbox process must
 * be restarted after changing that variable; a file save only picks up this
 * default.
 */
function cognitoDomainPrefix(): string {
  const fromEnv = process.env.TS_SSO_DOMAIN_PREFIX?.trim();
  const raw = fromEnv && fromEnv.length > 0
    ? fromEnv
    : `terrasacha-sso-${userInfo().username}`;
  const prefix = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
  return prefix.replace(/^-+|-+$/g, '') || 'terrasacha-sso';
}

// Deployed environments replace this one prefix domain with a custom domain
// on auth.<parent-domain>. Do not add a second UserPoolDomain.
