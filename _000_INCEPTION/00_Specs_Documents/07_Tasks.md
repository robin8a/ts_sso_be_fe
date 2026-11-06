# TerraSacha SSO - Implementation Plan

- [x] 1. Create the SSO project as two GitHub repositories
  - Scaffold `sso-backend` with `npm init` and `npm create amplify@latest`, with no frontend UI
  - Add `amplify/auth/resource.ts` with `defineAuth`, email login, and Hosted UI OAuth settings
  - Add `amplify/data` for SSO data schemas and `amplify/backend.ts` for the Cognito domain
  - Scaffold `sso-frontend` with no `amplify/` directory, and point the sandbox at it with `npx ampx sandbox --outputs-out-dir`
  - Use a prefix domain for sandbox and a custom domain on the parent domain for deployed environments
  - _Requirements: 1.1, 1.3, 2.1, 2.2, 6.1, 7.1_

- [x] 2. Add the application and role catalog
  - Create `amplify/auth/role-catalog.ts` as the only source of application keys and role parameters
  - Register `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum` (`datum` as mobile / appMovil)
  - Register `ts-oraculo-administrators` and `ts-legalDocs-administrators`
  - Export patterns `^ts-[a-z][A-Za-z0-9]*$` and `^ts-[a-z][A-Za-z0-9]*-[a-z][A-Za-z0-9]*$`
  - _Requirements: 3.1, 3.2, 3.3, 5.4_

- [x] 3. Implement the validation chain
  - Implement strict `roleParameter` checks and authorize-mode `claim` checks from `03_Validation_Chain.md`
  - Reject non-standard names such as `legalDocs-administrators`
  - Scope authorized roles to the caller application key
  - Write unit tests for the catalog examples, cross-app claims, duplicates, and the 2048-character limit
  - _Requirements: 3.4, 5.1, 5.2, 5.3_

- [x] 4. Define the custom role parameter and groups
  - Add user-pool attribute `custom:tsRoles` (string, max 2048, not writable by app clients, readable by app clients)
  - Create one Cognito group per catalog role parameter, using the catalog module for the group list
  - _Requirements: 4.1, 4.2, 6.1_

- [x] 5. Issue `custom:tsRoles` from group membership
  - Add a pre-token generation trigger at version V2_0
  - Overwrite `custom:tsRoles` on the ID token and the access token from catalog groups only
  - Omit the claim when the user has no catalog role, and do not fail login for a stray group name
  - Enable access-token customization on each app client
  - Write component tests for the claim builder
  - _Requirements: 4.3, 4.4, 5.1_

- [x] 6. Create one app client per application
  - Add a CDK client named with the application key for `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum`
  - Configure Authorization Code with PKCE, scopes `openid`, `email`, and `profile`, and that client's callback and logout URLs only
  - Keep `custom:tsRoles` readable and not writable
  - Turn on prevented user-existence errors
  - _Requirements: 1.3, 3.1, 5.4, 6.4_

- [ ] 7. Implement admin role assignment
  - Assign and remove roles only through a central admin operation that runs the strict chain
  - Update group membership and rewrite `custom:tsRoles` from the user's current catalog groups in the same operation
  - Retry a failed attribute write from current groups without using the stored attribute as the source of truth
  - _Requirements: 3.4, 4.2_

- [ ] 8. Create each application as its own Gen 2 project
  - Add a backend and a frontend GitHub repository for `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and `ts-datum`
  - In each application backend, call `referenceAuth` with the SSO user pool, identity pool, role ARNs, and that application's client id from `custom.appClients`
  - Do not call `defineAuth` and do not add a pre-token trigger in an application backend
  - Point each backend sandbox at its own frontend with `npx ampx sandbox --outputs-out-dir`
  - In each frontend build, run `npx ampx generate outputs` with that application's backend App ID, then `Amplify.configure` the generated file
  - _Requirements: 6.2, 7.2, 7.3, 7.4, 7.5_

- [ ] 9. Build the frontend session in each frontend repository
  - On load, call `getCurrentUser` and otherwise `signInWithRedirect`
  - Do not add a local username and password form, and do not create a user pool from the frontend
  - Sign out with `signOut({ global: true })`, and keep local tokens if global sign-out fails
  - Read `custom:tsRoles` and run the authorize chain for this application's key
  - Stop with `OUTPUTS_MISSING`, `OUTPUTS_CLIENT_MISSING`, or `OUTPUTS_POOL_MISMATCH` when the generated file is absent, has no client id, or names a different user pool
  - _Requirements: 1.1, 1.2, 1.4, 5.4, 6.3, 7.5_

- [ ] 10. Verify SSO and authorization end to end
  - Sandbox: PKCE login, claim contents, per-app allow and deny, rejected callback URLs
  - Confirm each application frontend was generated from its own backend App ID, shares the SSO user pool id and domain, and uses its own client id
  - Custom domain: second web app signs in without a second password prompt
  - Global sign-out forces the next app through Hosted UI and the old refresh token cannot renew
  - Mobile client with no `ts-datum-<role>` receives `noRole` while web roles remain in the claim
  - A failed `ampx generate outputs` does not deploy the frontend
  - _Requirements: 1.2, 2.3, 2.4, 5.3, 5.4, 6.3, 7.4_
