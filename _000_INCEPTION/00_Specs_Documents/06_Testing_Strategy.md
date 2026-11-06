# Testing Strategy

Tests prove three behaviors: one Cognito pool signs every application in, role names follow `<ts>-<appID>-<role>`, and `custom:tsRoles` authorizes only the calling application.

## Unit tests

Role grammar, in `03_Validation_Chain.md`:

- Accept `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum` as application keys.
- Accept `ts-oraculo-administrators` and `ts-legalDocs-administrators` as role parameters.
- Reject `legalDocs-administrators`, `ts-legal-docs-administrators`, `ts-Oraculo-administrators`, empty strings, and values with extra hyphens.
- Reject a well-formed role whose application or full parameter is not in the catalog (`ts-dataDrones-administrators`, `ts-datum-administrators` until those rows exist).
- Strict mode rejects the whole assignment on the first issue.
- Authorize mode for caller `ts-oraculo`:
  - `ts-oraculo-administrators ts-legalDocs-administrators` returns only the oraculo role.
  - `ts-legalDocs-administrators` returns `noRole`.
  - A duplicate token, a double space, or a 2049-character string returns `malformed`.
- Claim builder joins catalog matches with one space, uses catalog order, omits the claim when no group matches, and drops groups that fail the pattern or the catalog.

## Component tests

- Pre-token handler: given groups `ts-oraculo-administrators` and `ts-legalDocs-administrators`, both tokens receive `custom:tsRoles` with those values. A non-catalog group is absent from the claim and present in the log as `ROLE_NOT_IN_CATALOG`.
- Assignment service: a valid role adds the group and writes the same string to the attribute. `legalDocs-administrators` creates neither. A failed attribute write is retried from current groups and does not leave a new group without a logged error.
- App-client settings inspection: each client name equals its application key, write attributes exclude `custom:tsRoles`, read attributes include it, and callback URLs of `ts-oraculo` do not appear on the `ts-legalDocs` client.
- `ts-datum` client exists with `clientKind: mobile` and its own callback URLs.

## Integration tests

Sandbox uses the shared prefix domain. Deployed verification of silent SSO uses the custom domain on the parent domain. A prefix domain outside sandbox does not pass the silent-SSO criterion.

1. Sign in to `ts-oraculo` through Hosted UI with Authorization Code and PKCE. Confirm the ID token and access token contain `custom:tsRoles` and that the app authorizes `ts-oraculo-administrators`.
2. Open `ts-legalDocs` in the same browser. Confirm the second Hosted UI redirect does not prompt for credentials when the custom-domain cookie is present, and that this app authorizes only `ts-legalDocs-administrators`.
3. Open `ts-dataDrones` with the same user. Confirm sign-in succeeds and the app shows no access (`UNAUTHORIZED_APP` or `CLAIM_MISSING`), without clearing the SSO session.
4. Call `signOut({ global: true })` from `ts-oraculo`. Confirm the next visit to `ts-legalDocs` requires Hosted UI again and the revoked refresh token cannot be renewed.
5. Assign no `ts-datum-<role>`. Sign in on the mobile client with the same pool. Confirm the token claim still lists the web roles and the mobile authorizer returns `noRole`.

Application-backend tests assert `referenceAuth` receives the SSO user pool id, identity pool id, both role ARNs, and `custom.appClients[appKey].userPoolClientId`. They assert the application backend does not call `defineAuth`.

Frontend tests use the `amplify_outputs.json` generated from that application's backend. `Amplify.configure` receives the shared user pool id, the shared domain, scopes `openid`, `email`, and `profile`, and response type `code`. `auth.user_pool_client_id` equals that application's published client id.

## Repository split

- `sso-backend` contains `amplify/auth`, `amplify/data`, and `amplify/backend.ts`, and it contains no UI project. `sso-frontend` has no `amplify/` directory.
- Each application is two GitHub repositories. Its backend has its own `amplify/` tree and uses `referenceAuth`. Its frontend has no `amplify/` directory.
- `npx ampx sandbox --outputs-out-dir` is run in a project's backend and writes `amplify_outputs.json` only into that project's frontend.
- Each frontend `amplify.yml` preBuild runs `npx ampx generate outputs --app-id <that project's backend App ID> --branch <that backend branch>`. `ts-datum-frontend` uses the `ts-datum-backend` App ID, not the SSO App ID.
- Outputs whose user pool id is not the SSO pool fail closed (`OUTPUTS_POOL_MISMATCH`).
- A missing client id fails closed (`OUTPUTS_CLIENT_MISSING`).
- A failed `ampx generate outputs` fails that frontend's build (`OUTPUTS_GENERATE_FAILED`).

## Negative tests

- End-user attribute update of `custom:tsRoles` is rejected (`ROLE_NOT_WRITABLE`).
- A callback URL registered only on `ts-oraculo` fails on the `ts-legalDocs` client (`CALLBACK_NOT_ALLOWED`).
- Global sign-out failure leaves local tokens in place.
- Token issue with a group list whose catalog claim would exceed 2048 characters omits `custom:tsRoles` and logs `CLAIM_TOO_LONG`.
- Hosted UI user-existence errors do not distinguish an unknown email from a bad password.

## What is not a unit test

Silent cookie SSO depends on the browser and the custom domain. Unit tests cover the claim and the authorizer. One browser pass on the custom domain covers requirement 1 criterion 2 and requirement 2. Sandbox automation covers redirect, PKCE, and claim contents with an explicit login when third-party cookies block the prefix domain.
