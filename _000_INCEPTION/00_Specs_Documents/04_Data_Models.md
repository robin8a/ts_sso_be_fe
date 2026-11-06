# Data Models

Models for the shared Cognito pool, the application catalog, and the custom role parameter. Names use `<ts>-<appID>` for applications and `<ts>-<appID>-<role>` for roles.

## Catalog

```typescript
interface ApplicationRecord {
  appKey: string;
  appID: string;
  clientKind: 'web' | 'mobile';
  callbackUrls: string[];
  logoutUrls: string[];
}

interface RoleCatalogEntry {
  roleParameter: string;
  appKey: string;
  appID: string;
  role: string;
}
```

Initial applications:

| appKey | appID | clientKind | Notes |
| --- | --- | --- | --- |
| `ts-oraculo` | `oraculo` | `web` | |
| `ts-legalDocs` | `legalDocs` | `web` | |
| `ts-dataDrones` | `dataDrones` | `web` | No initial role |
| `ts-datum` | `datum` | `mobile` | appMovil. No initial role |

Initial roles:

| roleParameter | appKey | role |
| --- | --- | --- |
| `ts-oraculo-administrators` | `ts-oraculo` | `administrators` |
| `ts-legalDocs-administrators` | `ts-legalDocs` | `administrators` |

`administrators` means full administration of the application in `appKey`. Further roles are new catalog rows; they are not created by writing a free-form group name.

Callback and logout URLs are configuration of `ApplicationRecord`, not part of the role name. Each web app supplies its origin callback and logout URL. `ts-datum` supplies its mobile callback and logout URL. Sandbox records may include `http://localhost` URLs for that client only.

## Cognito mapping

| Model | Cognito representation |
| --- | --- |
| `ApplicationRecord.appKey` | App client name |
| `RoleCatalogEntry.roleParameter` | Cognito group name |
| User's catalog roles | Group membership, and custom attribute `custom:tsRoles` |
| Token custom parameter | ID token and access token claim `custom:tsRoles` |

```typescript
interface UserRoleState {
  username: string;
  groups: string[];
  customTsRoles?: string;
}
```

`groups` is the source of truth. `customTsRoles` mirrors the catalog groups as one space-separated string of at most 2048 characters. The pre-token trigger rebuilds the token claim from `groups`, filtered by the role catalog, so a stale attribute cannot grant a role.

Attribute rules:

- Name: `custom:tsRoles`
- Type: string
- Length: 0–2048
- User-writable: no
- Client-readable: yes
- Admin-writable: yes, and only from the role-assignment operation

## Token claim

```typescript
interface TsRoleClaims {
  email?: string;
  'custom:tsRoles'?: string;
}
```

Absent `custom:tsRoles` means the user has no catalog role. An empty string is not written.

Example for a user who administers Oraculo and LegalDocs:

```text
custom:tsRoles = "ts-oraculo-administrators ts-legalDocs-administrators"
```

Order follows the catalog order of the matched groups, not the order Cognito happens to return, so the same membership always produces the same claim string.

## App client

```typescript
interface AppClientRecord {
  appKey: string;
  userPoolId: string;
  userPoolClientId: string;
  domain: string;
  scopes: ['openid', 'email', 'profile'];
  responseType: 'code';
}
```

`userPoolId` and `domain` are identical for every record. `userPoolClientId` is unique per `appKey`. The SSO backend creates the client. The application backend passes that id to `referenceAuth`. The application frontend reads it from its own generated outputs.

## Independent projects

```typescript
interface IndependentProject {
  name: string;
  backendRepository: string;
  frontendRepository: string;
  ownsUserPool: boolean;
  appKey?: string;
}
```

| name | backendRepository | frontendRepository | ownsUserPool | appKey |
| --- | --- | --- | --- | --- |
| SSO | `sso-backend` | `sso-frontend` | yes | |
| Oraculo | `ts-oraculo-backend` | `ts-oraculo-frontend` | no | `ts-oraculo` |
| LegalDocs | `ts-legalDocs-backend` | `ts-legalDocs-frontend` | no | `ts-legalDocs` |
| DataDrones | `ts-dataDrones-backend` | `ts-dataDrones-frontend` | no | `ts-dataDrones` |
| Datum | `ts-datum-backend` | `ts-datum-frontend` | no | `ts-datum` |

Each row is two GitHub repositories. `frontendRepository` has no `amplify/` directory. Its Amplify App ID is not stored here; the frontend build receives the App ID of `backendRepository` only.

## Amplify outputs

```typescript
interface AmplifyOutputs {
  auth: {
    user_pool_id: string;
    user_pool_client_id: string;
    aws_region: string;
    oauth: {
      domain: string;
      scopes: string[];
      redirect_sign_in_uri: string[];
      redirect_sign_out_uri: string[];
      response_type: 'code';
    };
  };
  custom: {
    appClients: Record<string, { userPoolClientId: string }>;
  };
}
```

`custom.appClients` is published by `sso-backend` only. Application backends copy the entry for their `appKey` into `referenceAuth`. They do not copy another application's client id.

An application frontend's generated file uses the same `auth` shape. After `referenceAuth`, `auth.user_pool_id` is the SSO pool and `auth.user_pool_client_id` is that application's client. The application frontend does not read `custom.appClients` and does not call the SSO backend App ID. `auth.oauth.domain` is the shared Cognito domain on every project's outputs.

## Authorization result

```typescript
interface AppAuthorization {
  appKey: string;
  status: 'authorized' | 'noRole' | 'malformed';
  reason?: 'CLAIM_MISSING' | 'UNAUTHORIZED_APP';
  roles: string[];
}
```

`roles` lists only `ts-<appID>-<role>` values for `appKey`. For `ts-oraculo` and the example claim above, `roles` is `['ts-oraculo-administrators']` and `status` is `authorized`. For `ts-dataDrones` or `ts-datum` with that same claim, `roles` is `[]`, `status` is `noRole`, and `reason` is `UNAUTHORIZED_APP`. A missing claim uses reason `CLAIM_MISSING`.

## Rejected names

These values are not stored in any model:

| Value | Reason |
| --- | --- |
| `legalDocs-administrators` | Missing `ts-<appID>` form. Use `ts-legalDocs-administrators` |
| `ts-legal-docs-administrators` | Extra hyphen, so the split is not three segments |
| `ts-datum` as a role | Application key, not a role parameter |
| `ts-dataDrones-administrators` until catalogued | Unknown role, even though the pattern matches |
