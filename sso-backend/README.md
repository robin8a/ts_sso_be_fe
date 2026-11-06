# sso-backend

Central TerraSacha SSO backend (Amplify Gen 2). This repository **owns the one shared
Cognito user pool**, its groups, the pre-token generation trigger, the per-application
app clients, and the single Cognito domain. It has **no frontend UI** — the SSO UI lives
in the separate `sso-frontend` repository.

Applications (`ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, `ts-datum`) do **not** create
a user pool; their backends call `referenceAuth` against this pool.

## Layout

```text
amplify/
  auth/
    resource.ts                     defineAuth: email login, Hosted UI OAuth, custom:tsRoles, groups, trigger
    role-catalog.ts                 single source of application keys & role parameters (Task 2)
    pre-token-generation/
      resource.ts                   V2 trigger function definition
      handler.ts                    claim builder (Task 5)
  data/
    resource.ts                     SSO data schemas
  backend.ts                        defineBackend + Cognito domain via CDK escape hatch
package.json
tsconfig.json
```

This repository intentionally has **no `src/` UI**.

## Prerequisites

- Node.js 18+ (developed on Node 22)
- AWS credentials configured for the target account
- An Amplify Gen 2 toolchain (installed as dev dependencies)

## Local development (sandbox)

The sandbox starts here in the backend and writes `amplify_outputs.json` into the
paired frontend repository:

```bash
# optionally pick a globally-unique Cognito prefix domain for your sandbox
export TS_SSO_DOMAIN_PREFIX=terrasacha-sso-<your-initials>

npx ampx sandbox --outputs-out-dir ../sso-frontend/
# or: npm run sandbox
```

The sandbox attaches a Cognito **prefix domain** (`*.auth.<region>.amazoncognito.com`).
Prefix domains are sandbox-only. Silent SSO is not treated as satisfied on a prefix
domain outside sandbox, because the session cookie is third-party to the apps.

## Deployed (shared) environments

Deployed environments attach **one custom domain** on the same parent domain as the
web apps (for example `auth.<parent-domain>`), so the Hosted UI cookie is first-party
during the OAuth redirect. See the commented `customDomain` form in `amplify/backend.ts`.

## Type-check

```bash
npm run typecheck
```

## GitHub repository (remote) — manual step

This directory is scaffolded locally. The SSO project is **two GitHub repositories**
(`sso-backend` and `sso-frontend`). Creating the remotes requires GitHub credentials
and was not performed automatically. To publish:

```bash
# from this sso-backend/ directory
git init
git add .
git commit -m "Scaffold SSO backend (Amplify Gen 2)"

# create the remote (requires GitHub auth), e.g. with the GitHub CLI:
#   gh repo create <org>/sso-backend --private --source=. --remote=origin --push
# or add an existing empty remote:
#   git remote add origin git@github.com:<org>/sso-backend.git
#   git branch -M main
#   git push -u origin main
```

Repeat the equivalent steps in `sso-frontend/` for its own remote.
