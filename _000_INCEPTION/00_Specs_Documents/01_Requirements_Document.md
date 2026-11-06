# TerraSacha SSO - Requirements

## Introduction

TerraSacha uses one Amazon Cognito user pool as the single sign-on (SSO) authority for every application. Web applications sign in with the Cognito Hosted UI (Managed Login) over OAuth 2.0 Authorization Code with PKCE. A session cookie on the shared Cognito domain lets a user who already signed in to one application open another without typing credentials again.

Every project follows the Amplify Gen 2 split: its own GitHub backend repository and its own GitHub frontend repository. The SSO project owns the shared user pool. `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum` are independent projects. Each of those backends references the shared pool and does not create another one. Each frontend receives `amplify_outputs.json` only from its paired backend.

Roles travel as a Cognito custom parameter. The custom attribute and token claim `custom:tsRoles` holds a space-separated list of role parameters. Each role parameter, and the Cognito group of the same name, uses this form:

```text
<ts>-<appID>-<role>
```

`ts` is the fixed organization prefix. `appID` and `role` are camelCase identifiers and do not contain hyphens, because the hyphen is the only delimiter.

| Input | Standard name | Meaning |
| --- | --- | --- |
| `ts-oraculo-administrators` | `ts-oraculo-administrators` | Role `administrators` in application `ts-oraculo` |
| `ts-legalDocs` | `ts-legalDocs` | Application key |
| `legalDocs-administrators` | `ts-legalDocs-administrators` | Same role, with the required `ts-<appID>` prefix |
| `ts-dataDrones` | `ts-dataDrones` | Application key |
| `ts-datum` (appMovil) | `ts-datum` | Application key for the mobile client |

Application key pattern: `^ts-[a-z][A-Za-z0-9]*$`

Role parameter pattern: `^ts-[a-z][A-Za-z0-9]*-[a-z][A-Za-z0-9]*$`

Initial application catalog:

| Application key | appID | Client |
| --- | --- | --- |
| `ts-oraculo` | `oraculo` | Web |
| `ts-legalDocs` | `legalDocs` | Web |
| `ts-dataDrones` | `dataDrones` | Web |
| `ts-datum` | `datum` | Mobile (appMovil) |

Initial role catalog:

| Role parameter | Application key | Role |
| --- | --- | --- |
| `ts-oraculo-administrators` | `ts-oraculo` | `administrators` |
| `ts-legalDocs-administrators` | `ts-legalDocs` | `administrators` |

`ts-dataDrones` and `ts-datum` are registered applications. They receive roles only after a `ts-<appID>-<role>` entry is added to the catalog. The suffix `administrators` means full administration of that application.

## Requirements

### Requirement 1

**User Story:** As a TerraSacha user, I want to sign in once and open any registered application, so that I do not enter credentials in each application.

#### Acceptance Criteria

1. WHEN a user signs in from any registered application THEN the system SHALL authenticate against one shared Cognito user pool through Hosted UI using Authorization Code grant with PKCE.
2. WHEN a web user already has a valid session cookie on the shared Cognito domain AND opens another registered web application THEN the system SHALL finish the OAuth redirect and issue tokens without asking for credentials again.
3. WHEN an application configures Amplify Auth THEN it SHALL use the shared user pool id, the shared Cognito domain, scopes `openid`, `email`, and `profile`, and response type `code`.
4. WHEN an application starts a login THEN it SHALL call `signInWithRedirect` and SHALL NOT collect username or password in its own form.

### Requirement 2

**User Story:** As a platform operator, I want one Cognito domain for every application, so that the SSO session cookie has a single host.

#### Acceptance Criteria

1. WHEN the central auth backend is deployed to a shared environment THEN the system SHALL attach one custom Cognito domain on the same parent domain as the web applications.
2. WHEN a custom domain is not configured (sandbox) THEN the system SHALL attach one Cognito prefix domain and every client SHALL use that same domain.
3. WHEN two web applications complete SSO THEN both SHALL redirect to that same Cognito domain.
4. IF a prefix domain on `amazoncognito.com` is used outside sandbox THEN silent SSO SHALL NOT be treated as satisfied, because the session cookie is third-party to the applications.

### Requirement 3

**User Story:** As a platform operator, I want application and role names to follow `<ts>-<appID>-<role>`, so that every client, group, and claim uses the same identifier.

#### Acceptance Criteria

1. WHEN an application is registered THEN the system SHALL store an application key matching `^ts-[a-z][A-Za-z0-9]*$`, and the Cognito app client name SHALL equal that key.
2. WHEN a role is registered THEN the system SHALL store a role parameter matching `^ts-[a-z][A-Za-z0-9]*-[a-z][A-Za-z0-9]*$` that splits on `-` into exactly `ts`, the application `appID`, and the role suffix.
3. WHEN the initial catalog is loaded THEN it SHALL contain application keys `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum`, plus role parameters `ts-oraculo-administrators` and `ts-legalDocs-administrators`.
4. IF a name omits the application prefix, contains extra hyphens, or uses another separator (for example `legalDocs-administrators`) THEN the system SHALL reject it and SHALL NOT create a client, group, or claim token for it.

### Requirement 4

**User Story:** As an application, I want the user's roles in the Cognito custom parameter `custom:tsRoles`, so that I can authorize from the token without a separate role database.

#### Acceptance Criteria

1. WHEN the user pool is created THEN the system SHALL define custom attribute `custom:tsRoles` (string, maximum 2048 characters), readable by app clients and not writable by the signed-in user.
2. WHEN a role is assigned THEN the system SHALL add the user to a Cognito group whose name equals the role parameter, and SHALL set `custom:tsRoles` to the space-separated list of that user's catalog roles.
3. WHEN tokens are issued THEN a pre-token generation trigger (V2) SHALL overwrite `custom:tsRoles` on the ID token and the access token from the user's Cognito groups that exist in the role catalog, space-separated, with no leading or trailing space.
4. IF the user has no catalog role THEN the trigger SHALL omit `custom:tsRoles`. Group names that are not in the catalog SHALL NOT appear in the claim.

### Requirement 5

**User Story:** As an application owner, I want my application to honor only its own roles, so that a role in another TerraSacha application does not grant access here.

#### Acceptance Criteria

1. WHEN application `ts-<appID>` evaluates `custom:tsRoles` THEN it SHALL authorize using only tokens prefixed with `ts-<appID>-`.
2. WHEN the claim also contains roles for other applications THEN those tokens SHALL stay in the claim and SHALL NOT grant access in the calling application.
3. IF the user is authenticated and has no catalog role for the calling application THEN the system SHALL deny application access and SHALL keep the SSO session.
4. WHEN the caller is `ts-datum` THEN the system SHALL apply the same claim rules, using that mobile client's own callback URLs and only roles prefixed with `ts-datum-`.

### Requirement 6

**User Story:** As a developer of a consumer application, I want the central backend to own the user pool, so that my application joins SSO without creating another pool.

#### Acceptance Criteria

1. WHEN the central backend defines auth THEN it SHALL use Amplify Gen 2 `defineAuth` for email login, the custom attribute, the catalog groups, and the pre-token trigger, and SHALL attach the Cognito domain with a CDK escape hatch.
2. WHEN an application backend connects THEN it SHALL use `referenceAuth` with the shared user pool id, the identity pool id, the auth role ARNs, and the app client id published for its application key, and SHALL NOT call `defineAuth`.
3. WHEN a user signs out from any application THEN the client SHALL call `signOut({ global: true })` so Cognito revokes refresh tokens and clears the shared-domain session.
4. WHEN an app client is created THEN it SHALL register only that application's callback and sign-out URLs, with Authorization Code grant and PKCE, and SHALL NOT reuse another application's client secret.

### Requirement 7

**User Story:** As a team owner, I want each application in its own GitHub repositories with a Gen 2 backend and frontend, so that one team can ship without changing another application's backend or UI.

#### Acceptance Criteria

1. WHEN the SSO project is created THEN it SHALL be two GitHub repositories: a backend with `amplify/auth`, `amplify/data`, and `amplify/backend.ts` and no UI, and a frontend with no `amplify/` directory.
2. WHEN an application is registered THEN it SHALL be an independent pair of GitHub repositories, one backend and one frontend, using that same split. The initial pairs are `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum` (mobile / appMovil).
3. WHEN a developer runs a project locally THEN the sandbox SHALL start in that project's backend repository and SHALL write `amplify_outputs.json` into that project's frontend repository with `npx ampx sandbox --outputs-out-dir`.
4. WHEN a project's frontend is built THEN preBuild SHALL run `npx ampx generate outputs --app-id <that-backend-app-id> --branch <that-backend-branch>` before compile. An application frontend SHALL NOT use the SSO backend App ID.
5. WHEN an application frontend starts THEN it SHALL call `Amplify.configure` on the outputs generated by its own backend. Those outputs SHALL carry the shared user pool id and the client id `referenceAuth` bound for that application.
