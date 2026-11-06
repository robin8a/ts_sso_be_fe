# TerraSacha SSO - Design

## Overview

The central auth project owns one Amplify Gen 2 backend and one Cognito user pool. Every TerraSacha application is a client of that pool. Web SSO uses the Hosted UI session cookie on a shared Cognito domain. Roles are Cognito groups named `ts-<appID>-<role>` and are published in the custom parameter `custom:tsRoles`.

This repository is the central auth owner. `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum` are consumer applications. `ts-datum` is the mobile client (appMovil).

Naming, the validation chain, data models, errors, and tests are specified in the sibling documents. This document defines the runtime architecture.

## Architecture

```text
+-------------------------------------------+
| Cognito Hosted UI domain                  |
| custom: auth.<parent-domain>              |
| sandbox: <prefix>.auth.<region>.amazoncognito.com |
+--------------------+----------------------+
                     | OAuth 2.0 code + PKCE
                     | sets / reads SSO cookie
     +---------------+---------------+----------------+
     |               |               |                |
+----+-----+   +-----+------+  +-----+------+  +------+------+
| ts-oraculo|   | ts-legalDocs| | ts-dataDrones| | ts-datum|
| web client|   | web client  | | web client   | | mobile      |
+-----------+   +-------------+ +--------------+ +-------------+
                     |
                     | ID and access tokens
                     | claim custom:tsRoles
                     v
        +-----------------------------+
        | Pre-token trigger           |
        | groups -> custom:tsRoles    |
        +-----------------------------+
```

Deployed web SSO uses a custom domain on the same parent domain as the web apps, so the Hosted UI cookie is first-party during the redirect. A Cognito prefix domain is sandbox-only. Tokens stay in Amplify storage per origin. Silent sign-in happens when the next app redirects to the shared domain and Cognito still has the session cookie.

Separate app clients are required. One shared client with many callback URLs is not used, so each application can limit its own redirect URLs and attribute permissions.

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

### Consumer binding

Consumer apps do not define a user pool.

Option A, Amplify backend in the consumer, uses `referenceAuth` with the shared user pool id, that app's client id, and the identity-pool identifiers only when the consumer calls AWS with Amplify credentials:

```typescript
import { referenceAuth } from '@aws-amplify/backend';

export const auth = referenceAuth({
  userPoolId: '<region>_<poolId>',
  identityPoolId: '<region>:<identityPoolId>',
  authRoleArn: '<authenticated-role-arn>',
  unauthRoleArn: '<unauthenticated-role-arn>',
  userPoolClientId: '<this-app-client-id>',
});
```

Option B, frontend only, uses `Amplify.configure` with the same pool id, that app's client id, and the shared domain. SSO does not require an identity pool. Apps that only need user tokens use Option B.

```typescript
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: '<region>_<poolId>',
      userPoolClientId: '<this-app-client-id>',
      loginWith: {
        oauth: {
          domain: 'auth.<parent-domain>',
          scopes: ['openid', 'email', 'profile'],
          redirectSignIn: [window.location.origin + '/'],
          redirectSignOut: [window.location.origin + '/logout'],
          responseType: 'code',
        },
      },
    },
  },
});
```

`redirectSignIn` and `redirectSignOut` must already be registered on that app client. The mobile client passes its registered app URLs instead of `window.location`.

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
