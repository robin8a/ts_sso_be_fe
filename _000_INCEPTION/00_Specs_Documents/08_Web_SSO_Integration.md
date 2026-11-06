# Integrate a Web Project with TerraSacha SSO

This guide is for a web project that is not the SSO project. It covers `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, and any later web application that follows the same names. It does not cover `ts-datum` or any other mobile client.

The web project stays an independent Gen 2 pair of GitHub repositories. It does not copy the SSO backend and it does not create a user pool. Sign-in is the shared Cognito Hosted UI. Roles arrive in the token claim `custom:tsRoles`.

The examples below use `ts-oraculo`. Replace the application key, repository names, and URLs for the project you are connecting.

## What each side owns

| SSO project (`sso-backend`) | Web project |
| --- | --- |
| The user pool, the Cognito domain, the groups, and the pre-token trigger | Its own data schemas and Lambda functions |
| One app client per application key | `referenceAuth` pointed at the shared pool and at its own client id |
| Catalog of application keys and role parameters | A frontend with no `amplify/` directory |
| Assignment of roles to users | Sign-in, sign-out, and the authorize check for its own application key |

## 1. Name the application

The application key is `ts-<appID>`. `appID` matches `[a-z][A-Za-z0-9]*` and contains no hyphen.

| Project | Application key | Example role |
| --- | --- | --- |
| Oraculo | `ts-oraculo` | `ts-oraculo-administrators` |
| LegalDocs | `ts-legalDocs` | `ts-legalDocs-administrators` |
| DataDrones | `ts-dataDrones` | Add `ts-dataDrones-<role>` to the catalog before assigning it |

`legalDocs-administrators` is not a role. The catalog value is `ts-legalDocs-administrators`.

Repositories for the web project:

| Repository | Contents |
| --- | --- |
| `ts-oraculo-backend` | `amplify/auth`, `amplify/data`, `amplify/backend.ts`. No UI. |
| `ts-oraculo-frontend` | Web UI and `aws-amplify`. No `amplify/` directory. |

## 2. Register with the SSO backend

Send these values to the SSO project before the first sandbox of the web backend:

| Value | Example for Oraculo |
| --- | --- |
| Application key | `ts-oraculo` |
| Callback URLs | The web origin for each environment, including local, such as `http://localhost:3000/` and `https://oraculo.<parent-domain>/` |
| Logout URLs | The matching logout URLs, such as `http://localhost:3000/logout` and `https://oraculo.<parent-domain>/logout` |
| Role parameters | `ts-oraculo-administrators`, plus any other `ts-oraculo-<role>` this app will assign |

The SSO backend then:

1. Adds the application key and the role parameters to `amplify/auth/role-catalog.ts`.
2. Creates one Cognito group per role parameter.
3. Creates one app client named `ts-oraculo`, with Authorization Code and PKCE, scopes `openid`, `email`, and `profile`, and only the URLs from the table above.
4. Leaves `custom:tsRoles` readable on that client and not writable.
5. Publishes the client id on the SSO outputs:

```typescript
custom.appClients['ts-oraculo'].userPoolClientId
```

The SSO backend also gives the web team the shared user pool id, identity pool id, authenticated role ARN, unauthenticated role ARN, region, and Cognito domain. Those values come from the deployed SSO backend. A prefix domain is for sandbox only. A deployed web app uses the custom domain `auth.<parent-domain>` so the SSO cookie is on the same parent domain as the web apps.

Do not register another application's callback URL on this client.

## 3. Backend repository

Create the backend repository with no frontend files:

```bash
mkdir ts-oraculo-backend && cd ts-oraculo-backend
npm init -y
npm create amplify@latest
```

Replace generated auth with `referenceAuth`. Do not call `defineAuth`. Do not add a pre-token trigger. The trigger already runs on the shared pool and writes `custom:tsRoles`.

```typescript
import { referenceAuth } from '@aws-amplify/backend';

export const auth = referenceAuth({
  userPoolId: '<sso-user-pool-id>',
  identityPoolId: '<sso-identity-pool-id>',
  authRoleArn: '<sso-authenticated-role-arn>',
  unauthRoleArn: '<sso-unauthenticated-role-arn>',
  userPoolClientId: '<ts-oraculo client id>',
});
```

`userPoolClientId` is the `ts-oraculo` entry from `custom.appClients`. Data schemas and functions for Oraculo stay in this repository, under `amplify/data` and the rest of `amplify/`. They are not added to `sso-backend`.

If this web project already has an Amplify backend that created its own user pool, delete that auth definition and the extra pool's client configuration, then use the block above. Users and roles live only in the SSO pool.

## 4. Frontend repository

Create the web app as its own repository. Install only the Amplify client library:

```bash
npm create vite@latest ts-oraculo-frontend -- --template react-ts
cd ts-oraculo-frontend
npm add aws-amplify
```

The framework can be another web client. The repository still has no `amplify/` directory. `amplify_outputs.json` is generated. Do not commit it as the source of truth and do not hand-edit it.

Configure Amplify from that file:

```typescript
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);
```

After `referenceAuth`, `outputs.auth.user_pool_id` is the SSO pool and `outputs.auth.user_pool_client_id` is the `ts-oraculo` client. Do not read `custom.appClients` in the frontend, and do not point this build at the SSO backend App ID.

Stop before Hosted UI when the file is missing (`OUTPUTS_MISSING`), the client id is missing (`OUTPUTS_CLIENT_MISSING`), or `user_pool_id` is not the SSO pool (`OUTPUTS_POOL_MISMATCH`).

## 5. Local development

From `ts-oraculo-backend`, write outputs into the frontend repository:

```bash
npx ampx sandbox --outputs-out-dir ../ts-oraculo-frontend/
```

The SSO backend must already be deployed with this application's client. The sandbox does not create the user pool. Repeat the command with the other web project's frontend path only when you are running that project's backend. Do not point two applications at one backend sandbox.

## 6. Deploy

Deploy `ts-oraculo-backend` in Amplify and record its App ID. In the Amplify Hosting build for `ts-oraculo-frontend`, download that backend's outputs before compile. The branch is the branch of `ts-oraculo-backend` for this environment:

```yaml
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
        - npx ampx generate outputs --app-id <TS_ORACULO_BACKEND_APP_ID> --branch main
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

`<TS_ORACULO_BACKEND_APP_ID>` is not the SSO App ID. `ts-legalDocs-frontend` uses the LegalDocs backend App ID. `ts-dataDrones-frontend` uses the DataDrones backend App ID. A failed `ampx generate outputs` fails the build (`OUTPUTS_GENERATE_FAILED`).

## 7. Sign in, authorize, and sign out

The web UI does not collect a username or password.

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

`signInWithRedirect` sends the browser to the shared Cognito domain. If the user already signed in to another TerraSacha web app, Cognito still has the session cookie and returns to this app without a password prompt. That check is valid on the custom domain. A sandbox prefix domain on `amazoncognito.com` does not prove silent SSO.

Read `custom:tsRoles` from the ID token and the access token. Run the authorize chain in `03_Validation_Chain.md` with caller `ts-oraculo`.

| Claim | Result in Oraculo |
| --- | --- |
| `ts-oraculo-administrators` | Enter the app as `administrators` |
| `ts-oraculo-administrators ts-legalDocs-administrators` | Enter the app. Ignore the LegalDocs role |
| `ts-legalDocs-administrators` only | `UNAUTHORIZED_APP`. The SSO session stays |
| Claim omitted | `CLAIM_MISSING`. The SSO session stays |

Show one sentence for both denials: "You do not have access to this application." Do not list the other applications in the claim.

`signOut({ global: true })` clears the shared cookie and revokes refresh tokens for every client. If it fails, keep the local session and show "Sign-out could not be completed." Signing out of Oraculo also ends the silent session for LegalDocs and DataDrones.

Role assignment is not done in the web project. An operator assigns `ts-oraculo-administrators` in the SSO backend. The next sign-in picks the group up through the pre-token trigger.

## 8. Confirm the integration

1. `ts-oraculo-backend` has `referenceAuth` and no `defineAuth`.
2. `amplify_outputs.json` in the frontend is produced by the Oraculo backend App ID.
3. `auth.user_pool_id` equals the SSO pool, and `auth.user_pool_client_id` equals `custom.appClients['ts-oraculo']`.
4. A user in `ts-oraculo-administrators` can open the app. A user whose only role is `ts-legalDocs-administrators` reaches Hosted UI and then sees no access, still signed in to SSO.
5. On the custom domain, a user who is already signed in to another web app opens Oraculo without typing a password.
6. Global sign-out from Oraculo forces the next web app through Hosted UI again.

## Do not

- Do not add an `amplify/` backend to the frontend repository.
- Do not call `defineAuth` or create a second user pool.
- Do not put this project's callback URLs on another application's client.
- Do not authorize from a role that does not start with `ts-oraculo-`.
- Do not write `custom:tsRoles` from the client. The app client cannot write that attribute.
- Do not use this guide for `ts-datum` or another mobile client.
