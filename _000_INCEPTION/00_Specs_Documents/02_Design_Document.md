# TerraSacha SSO - Design

## Overview

The SSO project is two GitHub repositories. Its backend owns the Cognito user pool. Its frontend is only the SSO UI. Web SSO uses the Hosted UI session cookie on a shared Cognito domain. Roles are Cognito groups named `ts-<appID>-<role>` and are published in the custom parameter `custom:tsRoles`.

`ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum` are independent projects. Each one has its own backend repository and its own frontend repository, with the same Gen 2 split. `ts-datum` is the mobile client (appMovil). An application backend references the shared pool. It does not create one. An application frontend receives `amplify_outputs.json` from its own backend.

Naming, the validation chain, data models, errors, and tests are specified in the sibling documents. This document defines the runtime architecture.

## Repository layout

Each project is the same shape. Only the SSO backend calls `defineAuth`.

```text
<project>-backend/                  own GitHub repository
  amplify/
    auth/                           defineAuth (SSO) or referenceAuth (application)
    data/                           that project's data schemas
    backend.ts
  package.json

<project>-frontend/                 own GitHub repository
  src/                              UI only (web or mobile)
  amplify_outputs.json              generated from this project's backend
  package.json                      no amplify/ directory
```

| Project | Backend repository | Frontend repository | Auth |
| --- | --- | --- | --- |
| SSO (this project) | `sso-backend` | `sso-frontend` | `defineAuth`, owns the user pool |
| `ts-oraculo` | `ts-oraculo-backend` | `ts-oraculo-frontend` | `referenceAuth` |
| `ts-legalDocs` | `ts-legalDocs-backend` | `ts-legalDocs-frontend` | `referenceAuth` |
| `ts-dataDrones` | `ts-dataDrones-backend` | `ts-dataDrones-frontend` | `referenceAuth` |
| `ts-datum` | `ts-datum-backend` | `ts-datum-frontend` | `referenceAuth`, mobile UI |

A new application adds a new pair of repositories. It does not add a second user pool, and its frontend does not build against the SSO backend App ID.

## Architecture

```text
sso-backend                         owns the user pool, groups, trigger, app clients
    |  sandbox --outputs-out-dir
    v
sso-frontend                        SSO UI only

sso-backend custom.appClients
    |  user pool id + that app's client id
    v
ts-oraculo-backend                  referenceAuth, own data and functions
    |  ampx generate outputs --app-id <ts-oraculo backend app id>
    v
ts-oraculo-frontend                 Amplify.configure(its own outputs)

ts-legalDocs, ts-dataDrones, and ts-datum use the same pair shape.
All frontends sign in through one Hosted UI domain (auth.<parent-domain>)
with Authorization Code + PKCE. Tokens carry custom:tsRoles.
```

Deployed web SSO uses a custom domain on the same parent domain as the web apps, so the Hosted UI cookie is first-party during the redirect. A Cognito prefix domain is sandbox-only. Tokens stay in Amplify storage per origin. Silent sign-in happens when the next app redirects to the shared domain and Cognito still has the session cookie.

Separate app clients are required. One shared client with many callback URLs is not used, so each application can limit its own redirect URLs and attribute permissions. The SSO backend creates those clients. `referenceAuth` in each application backend pins that application's client, so the frontend outputs from that backend already contain the right `user_pool_client_id`.

## Naming

| Kind | Form | Examples |
| --- | --- | --- |
| Application key and app client name | `ts-<appID>` | `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, `ts-datum` |
| Role parameter and Cognito group | `ts-<appID>-<role>` | `ts-oraculo-administrators`, `ts-legalDocs-administrators` |
| Custom parameter | `custom:tsRoles` | `ts-oraculo-administrators ts-legalDocs-administrators` |

`appID` and `role` match `[a-z][A-Za-z0-9]*`. A role parameter splits into exactly three segments. `legalDocs-administrators` is invalid; the catalog value is `ts-legalDocs-administrators`.

`amplify/auth/role-catalog.ts` is the only list of application keys and role parameters. User-pool groups and the pre-token trigger both read that module.

## Components and interfaces

### Central auth resource

`amplify/auth/resource.ts` defines the pool. The dedicated app clients in the next section are what applications use.

```typescript
import { defineAuth } from '@aws-amplify/backend';
import { preTokenGeneration } from './pre-token-generation/resource';
import { roleParameters } from './role-catalog';

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      callbackUrls: ['http://localhost:3000/api/auth/callback'],
      logoutUrls: ['http://localhost:3000/'],
    },
  },
  userAttributes: {
    'custom:tsRoles': {
      dataType: 'String',
      mutable: true,
      minLen: 0,
      maxLen: 2048,
    },
  },
  groups: roleParameters(),
  triggers: {
    preTokenGeneration,
  },
});
```

The localhost URLs belong to the sandbox client that Amplify generates from `defineAuth`. Applications sign in with the dedicated clients from the next section, each with its own URLs. `roleParameters()` returns the catalog in catalog order, which today is `ts-oraculo-administrators` and `ts-legalDocs-administrators`.

`mutable: true` allows the admin assignment API to change the attribute. Each app client's writeable attributes omit `custom:tsRoles`. Readable attributes include it.

### Cognito domain

`amplify/backend.ts` attaches the domain with a CDK escape hatch:

```typescript
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';

const backend = defineBackend({ auth });
const userPool = backend.auth.resources.userPool;

userPool.addDomain('TerraSachaSsoDomain', {
  cognitoDomain: {
    domainPrefix: '<sandbox-prefix>',
  },
});
```

Deployed environments use the custom-domain form of `addDomain` with `auth.<parent-domain>` instead of `cognitoDomain`. There is still one domain for the pool.

### App clients

For each catalog application the CDK adds one client:

| Setting | Value |
| --- | --- |
| Client name | Application key, for example `ts-oraculo` |
| OAuth flow | Authorization code grant, PKCE |
| Scopes | `openid`, `email`, `profile` |
| Callback and logout URLs | That application only |
| Read attributes | Email, profile, `custom:tsRoles` |
| Write attributes | Must not include `custom:tsRoles` |
| Access token customization | Enabled so the V2 trigger can set `custom:tsRoles` |

`ts-datum` uses mobile callback and logout URLs on its own client. It uses the same pool, domain, and claim.

### Pre-token trigger

Cognito groups are the source of truth at token issue. The stored attribute can lag a group change; the trigger overwrites the claim from groups so the token cannot.

```typescript
function claimFromGroups(groups: readonly string[], catalog: readonly string[]): string | undefined {
  const held = new Set(groups);
  const roles = catalog.filter((role) => held.has(role));
  return roles.length > 0 ? roles.join(' ') : undefined;
}
```

`catalog` is already limited to valid role parameters, in catalog order, so the claim string is stable for the same membership.

The trigger writes that string to `custom:tsRoles` on the ID token and the access token (`claimsToAddOrOverride`, trigger version V2_0). It omits the claim when the filtered list is empty. Groups outside the catalog are logged and dropped. Login still succeeds.

### Role assignment

An admin operation in the central backend is the only writer:

1. Validate the role parameter with the strict validation chain.
2. Add or remove the matching Cognito group.
3. Rebuild the user's catalog role list from current groups.
4. `AdminUpdateUserAttributes` sets `custom:tsRoles` to that list, or clears it when the list is empty.

The next token still passes through the trigger, which recomputes the claim from groups.

### Outputs link

`referenceAuth` lives in the application backend, not in the frontend. The SSO backend publishes the values those backends pass in:

```typescript
backend.addOutput({
  custom: {
    appClients: {
      'ts-oraculo': { userPoolClientId: '<oraculo-client-id>' },
      'ts-legalDocs': { userPoolClientId: '<legalDocs-client-id>' },
      'ts-dataDrones': { userPoolClientId: '<dataDrones-client-id>' },
      'ts-datum': { userPoolClientId: '<datum-client-id>' },
    },
  },
});
```

An application backend binds the shared pool and does not create one:

```typescript
import { referenceAuth } from '@aws-amplify/backend';

export const auth = referenceAuth({
  userPoolId: '<sso-user-pool-id>',
  identityPoolId: '<sso-identity-pool-id>',
  authRoleArn: '<sso-authenticated-role-arn>',
  unauthRoleArn: '<sso-unauthenticated-role-arn>',
  userPoolClientId: '<client-id-for-this-appKey>',
});
```

`userPoolClientId` is `custom.appClients[<appKey>].userPoolClientId` from the SSO backend outputs. The pre-token trigger stays on the SSO user pool. Application backends do not add a second trigger.

Local development starts in that project's backend and writes into that project's frontend:

```bash
npx ampx sandbox --outputs-out-dir ../path-to-your-frontend-repo/
```

Amplify Hosting deploys that project's backend first and records its App ID. That project's frontend build downloads those outputs before compile. The App ID is the paired backend, not the SSO backend. The PDF example uses branch `main`:

```yaml
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
        - npx ampx generate outputs --app-id <YOUR_BACKEND_APP_ID> --branch main
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

`ts-datum-frontend` uses the same command with the `ts-datum-backend` App ID. `amplify_outputs.json` is generated. It is not edited by hand and it is not the source of truth in git.

The frontend configures Amplify from its own generated file:

```typescript
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);
```

That file's `auth.user_pool_id` is the shared pool, and `auth.user_pool_client_id` is the client `referenceAuth` bound for this application. Callback and logout URLs in the file must already be registered on that client. The mobile client uses its registered app URLs. If the user pool id is not the SSO pool, or the client id is missing, the frontend stops and does not start Hosted UI.

### Frontend session

```typescript
import { getCurrentUser, signInWithRedirect, signOut } from 'aws-amplify/auth';

export async function ensureSession(): Promise<void> {
  try {
    await getCurrentUser();
  } catch {
    await signInWithRedirect();
  }
}

export function endSession(): void {
  void signOut({ global: true });
}
```

On load, the app calls `getCurrentUser`. If no local user exists, it starts Hosted UI. Cognito signs the user in without a password prompt when the domain cookie is still valid. Global sign-out clears that cookie and revokes refresh tokens for every client, including `ts-datum`.

### Per-app authorization

After the tokens arrive, the application runs the claim validation chain in `03_Validation_Chain.md` with its own application key. It enters the app only when the decision is `authorized`. Roles for other applications stay available for display or for a future app switcher and are not treated as local permissions.

The suffix `administrators` is the shared administrator role for the application named in the parameter. Other suffixes are defined by that application and must be catalog entries before assignment.

## Related documents

- `03_Validation_Chain.md` — strict assignment checks and per-app claim checks
- `04_Data_Models.md` — catalog, clients, and token shapes
- `05_Error_Handling.md` — failure codes and user-facing behavior
- `06_Testing_Strategy.md` — SSO, claim, and naming tests
- `07_Tasks.md` — implementation plan
- `08_Web_SSO_Integration.md` — how a web project connects. Mobile clients are not in that guide.
