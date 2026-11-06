# sso-frontend

TerraSacha SSO frontend. **UI only** — this repository has **no `amplify/` directory**
and does **not** create a user pool. It receives `amplify_outputs.json` from the paired
`sso-backend`.

## Layout

```text
src/
  main.ts            Amplify.configure(outputs); SSO session UI (full session is Task 9)
index.html
vite.config.ts       dev server on :3000 to match the sandbox callback URLs
tsconfig.json
amplify.yml          Amplify Hosting build: generate outputs from sso-backend, then build
package.json         NO amplify/ directory by design
```

`amplify_outputs.json` is generated (git-ignored) and loaded dynamically at runtime.

## Where outputs come from

- **Sandbox:** run the sandbox in `sso-backend`, which writes outputs here:
  ```bash
  # in ../sso-backend
  npx ampx sandbox --outputs-out-dir ../sso-frontend/
  ```
- **Deployed:** `amplify.yml` preBuild runs
  `npx ampx generate outputs --app-id <sso-backend-app-id> --branch main` before compile.
  This frontend uses the **sso-backend** App ID (application frontends use their own
  backend App ID, never the SSO one).

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

The dev server port (3000) matches the sandbox client's registered callback
(`http://localhost:3000/api/auth/callback`) and logout (`http://localhost:3000/`) URLs.

## GitHub repository (remote) — manual step

The SSO project is **two GitHub repositories** (`sso-backend` and `sso-frontend`).
Creating the remote requires GitHub credentials and was not performed automatically:

```bash
git init
git add .
git commit -m "Scaffold SSO frontend (UI only, no amplify/)"
# gh repo create <org>/sso-frontend --private --source=. --remote=origin --push
```
