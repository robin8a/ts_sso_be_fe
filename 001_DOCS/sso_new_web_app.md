# How to implement TerraSacha SSO in a new web application

Audience: a developer who owns a NEW, independent web app (own GitHub repo, Amplify Gen 2 backend + frontend).
Scope: web apps only. Mobile (`ts-datum`) is out of scope; it has its own `tsdatum://` URLs in the catalog and is integrated separately.

Sources this guide was checked against: `sso-backend/amplify/auth/{role-catalog,app-clients,resource,client-attributes,validation-chain}.ts`, `pre-token-generation/handler.ts`, `amplify/backend.ts`, `sso-frontend/src/{main,applications}.ts`, `sso-frontend/amplify.yml`, and specs `_000_INCEPTION/00_Specs_Documents/01-08`. Spec-vs-code differences are called out as **Discrepancy** notes and collected in the appendix.

Placeholders used below: `<appID>`, `<role>`, `<sso-user-pool-id>`, `<sso-identity-pool-id>`, `<sso-auth-role-arn>`, `<sso-unauth-role-arn>`, `<app-client-id>`, `<cognito-domain>`, `<region>`, `<parent-domain>`.

---

## 1. Overview and prerequisites

### What the SSO provides

`sso-backend` owns, once, for every TerraSacha app:

| Item | Where |
| --- | --- |
| ONE shared Cognito user pool (email login, Hosted UI) | `auth/resource.ts` |
| Custom attribute `custom:tsRoles` (String, 0..2048) | `auth/resource.ts` |
| One Cognito group per catalogued role | `groups: roleParameters()` in `resource.ts` |
| Pre-token-generation trigger, **V2_0**, writes `custom:tsRoles` to ID **and** access token | `pre-token-generation/handler.ts`, promoted to V2_0 in `backend.ts` |
| One app client per application (name = app key, Authorization Code + PKCE, no secret, scopes `openid email profile`) | `auth/app-clients.ts` + loop in `backend.ts` |
| ONE Cognito domain (sandbox: prefix domain; deployed: custom domain) | `backend.ts` |
| Pool on the `ESSENTIALS` tier (needed so the access token carries the claim) | `backend.ts` |

### What your new app must NOT do

- Do not call `defineAuth` or create a user pool.
- Do not add a pre-token trigger.
- Do not build a username/password form. Hosted UI is the only login surface.
- Do not use another app's client ID or register your URLs on another app's client.
- Do not write `custom:tsRoles` from the client (app clients cannot write it).
- Do not authorize from roles that do not start with `ts-<appID>-`.
- Do not put an `amplify/` directory in the frontend repo.

### Prerequisites

- Access to the `sso-backend` repo and permission to deploy it (or a running sandbox).
- Node.js 18+ (the SSO repos are developed on Node 22).
- AWS credentials for the target account.
- Your app = two repos: `ts-<appID>-backend` (Amplify Gen 2, `amplify/` only) and `ts-<appID>-frontend` (UI + `aws-amplify` v6, no `amplify/`).

---

## 2. Naming standard

Defined in `role-catalog.ts`:

```typescript
export const APP_KEY_PATTERN = /^ts-[a-z][A-Za-z0-9]*$/;
export const ROLE_PARAMETER_PATTERN = /^ts-[a-z][A-Za-z0-9]*-[a-z][A-Za-z0-9]*$/;
```

| Thing | Format | Regex | Example |
| --- | --- | --- | --- |
| Application key = app client name | `ts-<appID>` | `APP_KEY_PATTERN` | `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones` |
| Role parameter = Cognito group name | `ts-<appID>-<role>` | `ROLE_PARAMETER_PATTERN` | `ts-oraculo-administrators` |
| `appID`, `role` segment | lower-case first letter, then letters/digits, **no hyphen** | `[a-z][A-Za-z0-9]*` | `legalDocs`, `administrators` |

Rules:

- A role splits on `-` into exactly three segments: `ts`, `appID`, `role`.
- `legalDocs-administrators` is **not** valid (missing `ts-`). `ts-legal-docs` is not valid (hyphen in appID). `ts-Oraculo` is not valid (upper-case first letter).
- A well-formed string is still ignored unless it is in `APPLICATIONS` / `ROLE_CATALOG` (catalog is the allow-list).
- Currently catalogued: apps `ts-oraculo`, `ts-legalDocs`, `ts-dataDrones` (web), `ts-datum` (mobile); roles `ts-oraculo-administrators`, `ts-legalDocs-administrators`. `ts-dataDrones` and `ts-datum` have no role yet.

New example used below: app `ts-reports` with role `ts-reports-administrators`.

---

## 3. Step A: register the app in `sso-backend`

Single source of truth: `sso-backend/amplify/auth/role-catalog.ts`. Edit only this file for registration.

### A1. Add the application

Add a row to `APPLICATIONS`. URLs are per app and must never repeat on another app's row.

```typescript
{
  appKey: 'ts-reports',
  appID: 'reports',
  clientKind: 'web',
  callbackUrls: [
    'http://localhost:3003/api/auth/callback',      // local
    'https://reports.<parent-domain>/api/auth/callback', // deployed
  ],
  logoutUrls: [
    'http://localhost:3003/',
    'https://reports.<parent-domain>/',
  ],
},
```

- Pick a free local port. In the catalog today: 3000 (`ts-oraculo`), 3001 (`ts-legalDocs`), 3002 (`ts-dataDrones`). Use 3003+ so URLs stay unique.
- The existing rows use the callback path `/api/auth/callback` and logout `/`. Cognito matches redirect URLs **exactly** (scheme, host, port, path, trailing slash). Whatever you register is what your frontend must send as `redirectSignIn` / `redirectSignOut`.
- Deployed URLs must be `https` (except `localhost`).

### A2. Add roles

Add rows to `ROLE_CATALOG`. New roles are catalog rows, never free-form group names.

```typescript
{
  roleParameter: 'ts-reports-administrators',
  appKey: 'ts-reports',
  appID: 'reports',
  role: 'administrators',
},
```

`appKey`/`appID` must match the application row; `roleParameter` must match `ROLE_PARAMETER_PATTERN`.

### A3. What changes automatically

| Change | Done by |
| --- | --- |
| Cognito group `ts-reports-administrators` | `groups: roleParameters()` in `resource.ts` |
| App client named `ts-reports` (code flow + PKCE, no secret, only the URLs from A1, `custom:tsRoles` readable and not writable, user-existence errors prevented, token revocation on) | `buildAppClientConfigs()` loop in `backend.ts` |
| Client ID published at `custom.appClients['ts-reports'].userPoolClientId` in the SSO outputs | `backend.addOutput` in `backend.ts` |
| Trigger accepts the new role in the claim | handler reads the same catalog |
| Claim ordering | catalog order (`roleParameters()`) |

Not automatic:

- **Duplicate list in `sso-frontend/src/applications.ts`** (launcher tiles). Update it by hand if you want a tile; it is not read by the backend.
- **Assigning users to the group.** No role-assignment API exists in `sso-backend` yet (see appendix). Today, add users to the group in the Cognito console/CLI.
- The roles claim is built from Cognito **groups** at token issue, so a user must be in the group and sign in again to see a new role.

### A4. Redeploy

Do not run these from the new app; run them in `sso-backend`.

```bash
cd sso-backend
npm run typecheck                    # catalog and tests compile
# sandbox
export TS_SSO_DOMAIN_PREFIX=terrasacha-sso-<initials>   # optional unique prefix
npx ampx sandbox --outputs-out-dir ../sso-frontend/
# deployed: push to the branch connected to the sso-backend Amplify app
```

Adding an app client is an in-place change; the sandbox redeploys on file save (takes minutes).

### A5. Get the new app client ID

From the SSO outputs file (`amplify_outputs.json` written next to `sso-frontend`, or generated for the deployed backend):

```bash
# from sso-frontend/ (sandbox) , or after: npx ampx generate outputs --app-id <SSO_BACKEND_APP_ID> --branch main
node -e "const o=require('./amplify_outputs.json');console.log(o.custom.appClients['ts-reports'].userPoolClientId)"
```

Also copy from the same file (all values are shared by every app):

| Value | Key in SSO `amplify_outputs.json` |
| --- | --- |
| `<sso-user-pool-id>` | `auth.user_pool_id` |
| `<sso-identity-pool-id>` | `auth.identity_pool_id` |
| `<region>` | `auth.aws_region` |
| `<cognito-domain>` | `auth.oauth.domain` |
| `<app-client-id>` | `custom.appClients['ts-reports'].userPoolClientId` |

> Do NOT use `auth.user_pool_client_id` from the SSO outputs. That is the SSO default/sandbox client (callback `http://localhost:3000/api/auth/callback`), not your app's client.

`<sso-auth-role-arn>` and `<sso-unauth-role-arn>` are **not** in `amplify_outputs.json`. Get them from the SSO backend's identity pool roles (AWS console: Cognito > Identity pools > the SSO pool > User access, or `aws cognito-identity get-identity-pool-roles --identity-pool-id <sso-identity-pool-id>`).

---

## 4. Step B: new app backend (`ts-<appID>-backend`)

`amplify/auth/resource.ts`:

```typescript
import { referenceAuth } from '@aws-amplify/backend';

export const auth = referenceAuth({
  userPoolId: process.env.SSO_USER_POOL_ID!,
  identityPoolId: process.env.SSO_IDENTITY_POOL_ID!,
  authRoleArn: process.env.SSO_AUTH_ROLE_ARN!,
  unauthRoleArn: process.env.SSO_UNAUTH_ROLE_ARN!,
  userPoolClientId: process.env.SSO_APP_CLIENT_ID!,
});
```

Literal strings (`'<sso-user-pool-id>'`, ...) also work, and this is how the design spec shows it. None of these IDs are secrets, but they are account-specific, so the env var form keeps them out of git.

`amplify/backend.ts`:

```typescript
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
// import { data } from './data/resource';

defineBackend({ auth /*, data */ });
```

Where to set the env vars:

- Sandbox: export them in the shell before `npx ampx sandbox`.
- Deployed: Amplify console > your backend app > Hosting > Environment variables (per branch). Use the same names. (Amplify Gen 2 reads `process.env` at synth time in the backend build.)

Your app's data schemas, functions, and storage stay in this repo. Do not add anything to `sso-backend` for them.

Verify after the first deploy: the generated outputs must have `auth.user_pool_id` equal to the SSO pool and `auth.user_pool_client_id` equal to your `<app-client-id>`. Otherwise it is `OUTPUTS_POOL_MISMATCH` / `OUTPUTS_CLIENT_MISSING` territory (section 9).

---

## 5. Step C: new app frontend (`ts-<appID>-frontend`)

```bash
npm add aws-amplify          # v6; pin the exact version you test with
```

The frontend gets `amplify_outputs.json` from **its own** backend (never from `sso-backend`):

- sandbox: `npx ampx sandbox --outputs-out-dir ../ts-reports-frontend/` (run in the app backend)
- deployed: `npx ampx generate outputs --app-id <APP_BACKEND_APP_ID> --branch main` in `amplify.yml` (section 8)
- git-ignore `amplify_outputs.json`; never hand-edit it.

### C1. Configure Amplify

```typescript
// src/amplify.ts
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';

const APP_URL = window.location.origin; // must equal a registered URL base (see A1)
const SSO_USER_POOL_ID = import.meta.env.VITE_SSO_USER_POOL_ID as string;

export function configureAmplify(): void {
  // Fail closed (OUTPUTS_POOL_MISMATCH / OUTPUTS_CLIENT_MISSING): do not start Hosted UI.
  if (outputs.auth.user_pool_id !== SSO_USER_POOL_ID || !outputs.auth.user_pool_client_id) {
    throw new Error('This application is not configured.');
  }

  Amplify.configure({
    ...outputs,
    auth: {
      ...outputs.auth,
      // Ensure Hosted UI settings exist and match the URLs registered in role-catalog.ts.
      oauth: {
        ...(outputs.auth as { oauth?: object }).oauth,
        domain: '<cognito-domain>',
        scopes: ['openid', 'email', 'profile'],
        redirect_sign_in_uri: [`${APP_URL}/api/auth/callback`],
        redirect_sign_out_uri: [`${APP_URL}/`],
        response_type: 'code',
      },
    },
  });
}
```

`<cognito-domain>` has no scheme, for example `<prefix>.auth.<region>.amazoncognito.com` in sandbox or `auth.<parent-domain>` when deployed. The key names above (`domain`, `scopes`, `redirect_sign_in_uri`, `redirect_sign_out_uri`, `response_type`) are the ones present in the SSO backend's own generated `amplify_outputs.json` `auth.oauth`.

> **Not verified**: whether `referenceAuth` outputs include an `auth.oauth` block. The `sso-backend` outputs do (`defineAuth` + `externalProviders`); the spec (04_Data_Models.md) asserts the app outputs carry `auth.oauth.domain` too. The explicit override above is safe either way, so keep it unless you have confirmed your generated file contains correct values.

> **Discrepancy**: `main.ts` in `sso-frontend` imports the outputs with a dynamic `import()` (file is git-ignored, may be missing at build time). The static `import outputs from '../amplify_outputs.json'` above (as in 08_Web_SSO_Integration.md) fails the build when the file is absent, which is also the desired "stop" behavior. `sso-frontend/amplify_outputs.d.ts` exists to type the file; add an equivalent in your repo if TypeScript cannot resolve the JSON.

### C2. Sign in (Hosted UI, Authorization Code + PKCE)

```typescript
import { getCurrentUser, signInWithRedirect } from 'aws-amplify/auth';

export async function ensureSession(): Promise<void> {
  try {
    await getCurrentUser();
  } catch {
    // UserUnAuthenticatedException => start Hosted UI (not a hard error)
    await signInWithRedirect();
  }
}
```

`signInWithRedirect()` without `provider` opens the Cognito Hosted UI. There is no local username form.

### C3. Callback handling

The redirect lands on the registered callback path (`/api/auth/callback` by the catalog convention). Amplify v6 completes the code exchange automatically when `Amplify.configure` runs on that page load and the URL contains `code` and `state`. So that route only needs to load the app (it must exist as a real page in an SPA: configure a rewrite to `index.html`), then forward the user:

```typescript
import { Hub } from 'aws-amplify/utils';

Hub.listen('auth', ({ payload }) => {
  switch (payload.event) {
    case 'signInWithRedirect':
      window.location.replace('/');              // leave the callback URL
      break;
    case 'signInWithRedirect_failure':
      console.error('SSO_REDIRECT_FAILED', payload.data);
      // show: "Sign-in could not be completed."
      break;
  }
});
```

Register the `Hub` listener before/at startup, right after `configureAmplify()`.

### C4. Read the session

```typescript
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';

const { username } = await getCurrentUser();
const { tokens } = await fetchAuthSession();          // tokens?.idToken, tokens?.accessToken
const rolesClaim = tokens?.idToken?.payload['custom:tsRoles']; // string | undefined (JWTPayload value)
```

### C5. Sign out

```typescript
import { signOut } from 'aws-amplify/auth';

export async function endSession(): Promise<void> {
  try {
    await signOut({ global: true });   // clears shared Cognito cookie, revokes refresh tokens
  } catch (e) {
    // GLOBAL_SIGNOUT_FAILED: keep the local session, show "Sign-out could not be completed."
    console.error('GLOBAL_SIGNOUT_FAILED', e);
  }
}
```

After sign-out Cognito redirects to `redirect_sign_out_uri`, which must be one of the app client's logout URLs (A1). Global sign-out ends the silent session for **all** TerraSacha web apps.

---

## 6. Step D: authorization (roles)

### The claim

- Name: `custom:tsRoles`. Space-separated role parameters, e.g. `ts-reports-administrators ts-oraculo-administrators`.
- Built by the pre-token trigger from the user's **current Cognito groups** at each token issue (it overwrites any stored attribute value), filtered by the catalog, ordered by catalog order. Present on ID and access token (access token requires the pool's ESSENTIALS tier, set in `backend.ts`).
- Omitted entirely if the user has no catalogued group, or if it would exceed 2048 characters (never truncated).
- The trigger never blocks login.

### Strict vs authorize (from 03_Validation_Chain.md / `validation-chain.ts`)

| Mode | Where it runs | Behavior |
| --- | --- | --- |
| `strict` | `sso-backend` only (role assignment, catalog writes) | Any invalid token rejects the whole operation (`ROLE_MALFORMED`, `ROLE_UNKNOWN_APP`, `ROLE_NOT_IN_CATALOG`). |
| `authorize` | **Your frontend**, with caller key `ts-<appID>` | Malformed claim => deny. Roles for other apps stay in the claim but are ignored locally. Well-formed tokens not in the catalog are dropped. |

Authorize decision order (`claim()` in `validation-chain.ts`):

1. missing/empty claim => `noRole` / `CLAIM_MISSING`
2. longer than 2048 => `malformed` / `CLAIM_TOO_LONG`
3. leading/trailing space or empty token (double space) => `malformed`
4. any token failing `ROLE_PARAMETER_PATTERN` => `malformed`
5. duplicate token => `malformed`
6. drop non-catalog tokens
7. keep tokens whose app key == caller
8. at least one => `authorized`; none => `noRole` / `UNAUTHORIZED_APP`

Only roles prefixed `ts-<appID>-` count for your app. `ts-oraculo-administrators` never authorizes `ts-reports`.

Frontends cannot import `sso-backend/amplify/...`. Copy the logic you need (guard below). The catalog check in step 6 needs your own app's role list; the example uses a local allow-list of **your app's** roles. Keep it in sync with `ROLE_CATALOG`.

### Guard example

```typescript
import { fetchAuthSession } from 'aws-amplify/auth';

const APP_KEY = 'ts-reports';
const APP_ROLES = ['ts-reports-administrators'] as const; // mirror of ROLE_CATALOG rows for this app
const ROLE_PATTERN = /^ts-[a-z][A-Za-z0-9]*-[a-z][A-Za-z0-9]*$/;
const MAX_LEN = 2048;

export type Access =
  | { ok: true; roles: string[] }
  | { ok: false; reason: 'CLAIM_MISSING' | 'UNAUTHORIZED_APP' | 'CLAIM_MALFORMED' };

export function authorize(claim: unknown): Access {
  if (claim === undefined || claim === null || claim === '') {
    return { ok: false, reason: 'CLAIM_MISSING' };
  }
  if (typeof claim !== 'string' || claim.length > MAX_LEN) {
    return { ok: false, reason: 'CLAIM_MALFORMED' };
  }
  const tokens = claim.split(' ');               // single-space split; empty token => malformed
  if (
    tokens.some((t) => t.length === 0 || !ROLE_PATTERN.test(t)) ||
    new Set(tokens).size !== tokens.length
  ) {
    return { ok: false, reason: 'CLAIM_MALFORMED' };
  }
  const roles = tokens.filter(
    (t) => t.startsWith(`${APP_KEY}-`) && (APP_ROLES as readonly string[]).includes(t),
  );
  return roles.length > 0 ? { ok: true, roles } : { ok: false, reason: 'UNAUTHORIZED_APP' };
}

export async function requireAccess(): Promise<Access> {
  const { tokens } = await fetchAuthSession();
  return authorize(tokens?.idToken?.payload['custom:tsRoles']);
}
```

Behavior for each denial: show one generic sentence ("You do not have access to this application."), keep the SSO session, do not list the user's other apps, do not call `signOut`. Log `code`, `appKey`, and username, not the full claim (outside sandbox).

Role assignment is not done in your app.

Examples for caller `ts-reports`:

| `custom:tsRoles` | Result |
| --- | --- |
| `ts-reports-administrators` | authorized (`ts-reports-administrators`) |
| `ts-reports-administrators ts-oraculo-administrators` | authorized, ignore the oraculo role |
| `ts-oraculo-administrators` | `UNAUTHORIZED_APP` |
| (absent) | `CLAIM_MISSING` |
| `reports-administrators` | `CLAIM_MALFORMED` |

---

## 7. Silent SSO behavior

- Each app has its own client, origin and token storage. Tokens are per origin; SSO happens at the **Cognito domain**.
- User signs in to app A (Hosted UI sets a session cookie on the Cognito domain). App B calls `signInWithRedirect()`; Cognito still has the cookie, so it redirects straight back with a code and no password prompt.
- `signOut({ global: true })` in any app ends that for all apps.

Domain caveat (`backend.ts`, 01_Requirements 2.x):

| Environment | Cognito domain | Silent SSO |
| --- | --- | --- |
| Sandbox | prefix domain `<prefix>.auth.<region>.amazoncognito.com` (prefix from `TS_SSO_DOMAIN_PREFIX`, default `terrasacha-sso-<os-username>`) | Works for local testing, but it is **not** proof of production behavior (cookie is third-party to your app). Not treated as satisfied. |
| Deployed | one custom domain on the **same parent domain** as the web apps, e.g. `auth.<parent-domain>` | Required for first-party cookie and reliable silent SSO. |

The pool allows a single domain. Moving to a custom domain replaces the prefix domain; every app's `oauth.domain` then changes to the custom domain.

> **Discrepancy**: `sso-backend/README.md` says to see "the commented `customDomain` form in `amplify/backend.ts`". There is no such commented code today; `backend.ts` only has a closing comment that deployed envs replace the prefix with `auth.<parent-domain>`. The custom domain is **not implemented in code yet**.

---

## 8. Local development and deployment

### Local walkthrough

1. In `sso-backend`: register the app (Step A), start the sandbox, wait for "Deployment completed".
   `npx ampx sandbox --outputs-out-dir ../sso-frontend/`
2. Read `<sso-user-pool-id>`, `<sso-identity-pool-id>`, `<cognito-domain>`, `<app-client-id>` from the written `amplify_outputs.json` (A5) and fetch the two role ARNs.
3. In `ts-reports-backend`: set the `SSO_*` env vars, then `npx ampx sandbox --outputs-out-dir ../ts-reports-frontend/`.
4. In `ts-reports-frontend`: run the dev server on the **exact port registered** in A1 (e.g. 3003). With Vite: `vite --port 3003 --strictPort`.
5. Create a user (Hosted UI sign-up or console), add them to `ts-reports-administrators`, sign in again.

Ports:

| Port | Used by |
| --- | --- |
| 3000 | `ts-oraculo` callback; **also** the `sso-frontend` Vite dev server (`vite.config.ts`) |
| 3001 | `ts-legalDocs` |
| 3002 | `ts-dataDrones` |
| 3003+ | new apps |

> **Discrepancy**: `sso-frontend` dev server runs on port 3000, the same port registered for `ts-oraculo`. Do not run both at once.

One backend sandbox per application. Never point two apps at one sandbox's outputs.

### `amplify.yml` for your frontend (deployed)

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
        # App ID of ts-reports-backend, NOT the sso-backend App ID.
        - npx ampx generate outputs --app-id <APP_BACKEND_APP_ID> --branch main
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

A failing `ampx generate outputs` must fail the build (`OUTPUTS_GENERATE_FAILED`). Add an SPA rewrite so `/api/auth/callback` serves `index.html`.

### Deployment checklist

- [ ] SSO catalog has the app, roles, and the **deployed** callback/logout URLs; `sso-backend` redeployed.
- [ ] Deployed SSO uses the custom domain `auth.<parent-domain>` (same parent domain as the web apps).
- [ ] App backend deployed with `referenceAuth`; env vars set on the Amplify branch.
- [ ] Frontend `amplify.yml` uses the app backend's App ID.
- [ ] Generated outputs: `auth.user_pool_id` = SSO pool, `auth.user_pool_client_id` = app client.
- [ ] Redirect URIs in code equal the registered URLs exactly.
- [ ] Test users are in the right groups.

---

## 9. Troubleshooting

| Symptom | Code (05_Error_Handling.md) | Likely cause | Fix |
| --- | --- | --- | --- |
| Cognito page: `redirect_mismatch` / "redirect_uri mismatch" | `CALLBACK_NOT_ALLOWED` | `redirectSignIn` is not exactly one of the app client's callback URLs (port, path, trailing slash, http vs https) | Fix `redirect_sign_in_uri` or add the URL to your `APPLICATIONS` row, redeploy `sso-backend`. |
| `invalid_client` / "client does not exist" | `OUTPUTS_CLIENT_MISSING` | Wrong or missing client ID; used `auth.user_pool_client_id` from the SSO outputs; app not in catalog or `sso-backend` not redeployed | Take the ID from `custom.appClients['<appKey>']`; confirm the app is in `APPLICATIONS` and deployed. |
| `OUTPUTS_POOL_MISMATCH` | `OUTPUTS_POOL_MISMATCH` | App backend used `defineAuth`, or `referenceAuth` points at another pool | Use `referenceAuth` with the SSO pool ID. |
| Frontend shows "not configured", no redirect | `OUTPUTS_MISSING` | `amplify_outputs.json` not generated | Run the app backend sandbox with `--outputs-out-dir`, or fix the `ampx generate outputs` step. |
| Signed in, "no access", claim absent | `CLAIM_MISSING` | User is in no catalogued group; token issued before group was added; pool on LITE tier (access token only); claim would exceed 2048 | Add user to `ts-<appID>-<role>` group and sign in again. Check pre-token Lambda logs. |
| Signed in, "no access", claim present | `UNAUTHORIZED_APP` | Claim only has other apps' roles; or role string does not start with `ts-<appID>-` | Assign a `ts-<appID>-<role>` group. |
| Claim denied as malformed | `CLAIM_MALFORMED` | Duplicate or badly spaced tokens, token not matching the pattern, or you edited the claim | Don't transform the claim; check the Lambda output. |
| Role not applied / "wrong prefix" | `ROLE_MALFORMED` / `ROLE_UNKNOWN_APP` / `ROLE_NOT_IN_CATALOG` | Group name like `legalDocs-administrators`, or not in `ROLE_CATALOG` (trigger drops it and logs it) | Use `ts-<appID>-<role>` and add it to `ROLE_CATALOG`. |
| Password prompt on every app | n/a | Sandbox prefix domain (third-party cookie) or each app uses a different domain | Test on the custom domain; all apps must share the one Cognito domain. |
| Domain errors in sandbox (`prefix already taken` / domain in use) | n/a | Prefix is globally unique per region | Set `TS_SSO_DOMAIN_PREFIX` to a unique value, restart the sandbox process. |
| `UserUnAuthenticatedException` from `getCurrentUser` | `SESSION_EXPIRED` | Not signed in | Not an error; call `signInWithRedirect()`. |
| Sign-in fails after code exchange | `SSO_REDIRECT_FAILED` | Wrong `oauth.domain`, scopes, or response type | Compare with section 5 config. |
| Sign-out stays logged in | `GLOBAL_SIGNOUT_FAILED` | Network or token failure | Keep session, show message, retry. |

---

## 10. Copy-paste checklist

```text
SSO REGISTRATION (sso-backend)
[ ] appID matches [a-z][A-Za-z0-9]*, key = ts-<appID>
[ ] APPLICATIONS row added (local + deployed callbackUrls and logoutUrls, unique port)
[ ] ROLE_CATALOG rows added: ts-<appID>-<role>
[ ] npm run typecheck passes; sso-backend redeployed (sandbox or branch)
[ ] Client ID read from custom.appClients['ts-<appID>'].userPoolClientId
[ ] Pool ID, identity pool ID, role ARNs, region, Cognito domain collected

APP BACKEND (ts-<appID>-backend)
[ ] referenceAuth only (no defineAuth, no pre-token trigger)
[ ] userPoolClientId = this app's client ID
[ ] Env vars set (sandbox shell + Amplify branch)
[ ] Generated outputs: user_pool_id = SSO pool, user_pool_client_id = app client

APP FRONTEND (ts-<appID>-frontend)
[ ] aws-amplify v6; no amplify/ directory; amplify_outputs.json git-ignored
[ ] Amplify.configure with oauth domain, scopes, redirect URIs = registered URLs exactly
[ ] signInWithRedirect when getCurrentUser throws; Hub handles callback
[ ] Roles read from idToken.payload['custom:tsRoles']; only ts-<appID>- roles honored
[ ] Denials show one generic message and keep the SSO session
[ ] signOut({ global: true }); failure keeps the local session
[ ] amplify.yml uses THIS app backend's App ID
[ ] Dev server on registered port

DEPLOY
[ ] Custom Cognito domain on shared parent domain
[ ] Test: user in group enters; user with only other-app roles is denied; second app has no password prompt; global sign-out forces Hosted UI
```

---

## Appendix: spec vs code discrepancies

| # | Spec says | Code / repo says | Impact |
| --- | --- | --- | --- |
| 1 | 08_Web_SSO_Integration.md example callback `http://localhost:3000/` and logout `/logout` | `role-catalog.ts` uses callback `.../api/auth/callback` and logout `.../` | Register and use the catalog convention; redirect URLs match exactly. |
| 2 | Spec: custom domain `auth.<parent-domain>` for deployed; README refers to a commented `customDomain` form | Not in `backend.ts`; only a prefix domain is implemented | Custom domain is future work. |
| 3 | Spec: SSO publishes role ARNs to app teams | Only `custom.appClients` is added via `addOutput`; role ARNs are not in outputs | Fetch ARNs from the identity pool. |
| 4 | Spec: admin role-assignment API (Task 7) | No assignment code in `sso-backend` | Use Cognito console/CLI to add users to groups. |
| 5 | Spec: `custom:tsRoles` readable by clients, authorize runs in app frontends | `validation-chain.ts` lives under `amplify/` and cannot be imported by frontends | Copy the logic (section 6). |
| 6 | Spec: `Amplify.configure(outputs)` is enough after `referenceAuth` | Not verified that `referenceAuth` outputs contain `auth.oauth` | Section 5 sets oauth explicitly. |
| 7 | Spec: frontend uses static JSON import | `sso-frontend/src/main.ts` uses a dynamic import; Hosted UI flow (Task 9) is not implemented there yet | `sso-frontend` is not a working sign-in reference yet. |
| 8 | Specs: ts-dataDrones role "add to the catalog before assigning" | Catalog has no `ts-dataDrones-*` role | No one is authorized in `ts-dataDrones` until added. |
| 9 | Per-app isolation via distinct ports | `sso-frontend` dev server (3000) collides with `ts-oraculo` callback port 3000 | Don't run both locally. |
| 10 | `sso-backend/README.md` layout | Omits `app-clients.ts`, `client-attributes.ts`, `validation-chain.ts` | README is out of date; the code is authoritative. |

Mobile (`ts-datum`) integration is out of scope for this guide.
