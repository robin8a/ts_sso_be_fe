# Error Handling

Failures fall into three groups: the user can retry sign-in, the user is signed in but not allowed into this application, or an operator sent a non-standard name. User-facing text stays generic. The specific code is logged with the application key and, for operator actions, the rejected string.

## Codes

| Code | When | User sees | System does |
| --- | --- | --- | --- |
| `SSO_REDIRECT_FAILED` | Hosted UI redirect or code exchange fails | "Sign-in could not be completed." | Stay signed out. Log the Cognito error code. |
| `CALLBACK_NOT_ALLOWED` | Redirect URL is not registered on that app client | "Sign-in could not be completed." | Do not store tokens. |
| `SESSION_EXPIRED` | Local tokens are missing or rejected and the domain cookie is gone | Start Hosted UI | Do not present a local username form. |
| `GLOBAL_SIGNOUT_FAILED` | `signOut({ global: true })` fails | "Sign-out could not be completed." | Keep the local session until global sign-out succeeds, so the shared cookie is not left active while this app looks signed out. |
| `CLAIM_MISSING` | Authenticated user has no `custom:tsRoles` | "You do not have access to this application." | SSO session remains. Decision `noRole`. |
| `UNAUTHORIZED_APP` | Claim has no role prefixed with this `ts-<appID>-` | "You do not have access to this application." | SSO session remains. Other apps' roles are unchanged. |
| `CLAIM_MALFORMED` | Claim is not a string, is longer than 2048 characters, is spaced incorrectly, contains a non-matching token, or repeats a token | "You do not have access to this application." | Deny this application. Log `CLAIM_MALFORMED`. Do not grant from a partial parse. |
| `CLAIM_TOO_LONG` | Role list exceeded 2048 characters at assignment or token build | Operator error on assignment. On token issue, omit the claim and log the code. | Do not truncate. Truncation would drop roles silently. |
| `ROLE_MALFORMED` | Strict validation rejected the pattern, including `legalDocs-administrators` | Operator message names the code and the required form `ts-<appID>-<role>` | Do not create a group or write the attribute. |
| `ROLE_UNKNOWN_APP` | Pattern matches but `ts-<appID>` is not a catalog application | Operator message names the application key | Do not create a group. |
| `ROLE_NOT_IN_CATALOG` | Pattern and application match but the role parameter is not catalogued | Operator message names the role parameter | Do not assign. If a stray group is seen at token issue, drop it from `custom:tsRoles` and log the code. |
| `ROLE_NOT_WRITABLE` | A client tries to set `custom:tsRoles` | Hosted UI or API rejects the write | Cognito client write attributes exclude this attribute. |
| `OUTPUTS_MISSING` | The frontend starts without `amplify_outputs.json` | "This application is not configured." | Do not call Hosted UI. |
| `OUTPUTS_CLIENT_MISSING` | This application's outputs have no `user_pool_client_id`, or `sso-backend` has no `custom.appClients` entry for its application key | "This application is not configured." | Do not sign in with another application's client. |
| `OUTPUTS_POOL_MISMATCH` | Generated `auth.user_pool_id` is not the SSO user pool | "This application is not configured." | Do not start Hosted UI. The application backend called `defineAuth` or pointed `referenceAuth` at the wrong pool. |
| `OUTPUTS_GENERATE_FAILED` | `npx ampx generate outputs` fails in that project's frontend build | The build fails | Do not deploy that frontend. |

`CLAIM_MISSING` and `UNAUTHORIZED_APP` share one sentence so the UI does not reveal which other applications the user can open. Logs for `UNAUTHORIZED_APP` include the caller application key, not the full claim, unless the environment is the sandbox.

## Sign-in and sign-out

Hosted UI is the only login surface. A consumer that receives `UserUnAuthenticatedException` from `getCurrentUser` starts `signInWithRedirect`. It does not treat that exception as a hard error.

Cognito user-existence responses on the Hosted UI must not tell the caller whether the email is registered (`preventUserExistenceErrors` on each app client).

Global sign-out is one action. If it fails, the client shows `GLOBAL_SIGNOUT_FAILED` and leaves local tokens in place. Clearing only the local origin would make this application look signed out while the Cognito cookie still opens the others.

`ts-datum` uses the same codes. A bad mobile callback is `CALLBACK_NOT_ALLOWED`. A user with only `ts-oraculo-administrators` who opens the mobile app gets `UNAUTHORIZED_APP`.

A missing or failed `amplify_outputs.json` is a configuration failure, not a failed password. The frontend shows `OUTPUTS_MISSING`, `OUTPUTS_CLIENT_MISSING`, or `OUTPUTS_POOL_MISMATCH` and does not start `signInWithRedirect`. The hosting build stops on `OUTPUTS_GENERATE_FAILED`. The App ID in that build is the paired backend for that project.

## Assignment failures

The admin operation stops on the first strict-chain failure. It does not add the group and then fail the attribute write. If the group update succeeds and the attribute write fails, the operation retries the attribute write from current groups and logs the failure. The next login is still safe because the pre-token trigger reads groups, not the stored attribute.

Token issue never fails because a group name is outside the catalog. The trigger drops that group, logs `ROLE_NOT_IN_CATALOG`, and continues. A claim that would exceed 2048 characters is omitted and logged as `CLAIM_TOO_LONG`; the user can still sign in and then receives `UNAUTHORIZED_APP` until an operator shortens the assignment set.

## Logging

Log `code`, `appKey`, and `username` (the Cognito username, not the role list) for authorization denials. Log the rejected raw string for `ROLE_MALFORMED`, `ROLE_UNKNOWN_APP`, and `ROLE_NOT_IN_CATALOG` on operator actions. Do not log refresh tokens, authorization codes, or the PKCE verifier.
