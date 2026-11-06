import { Amplify } from 'aws-amplify';
import './styles.css';
import { mountAppLauncher } from './app-launcher';

/**
 * TerraSacha SSO frontend entry point.
 *
 * This repository is UI only and has NO `amplify/` directory. It receives
 * `amplify_outputs.json` from the paired `sso-backend`:
 *   - sandbox:  npx ampx sandbox --outputs-out-dir ../sso-frontend/   (run in sso-backend)
 *   - deployed: preBuild runs `npx ampx generate outputs --app-id <sso-backend-app-id>`
 *
 * The generated file is git-ignored and is not the source of truth in git, so it
 * is loaded dynamically at runtime. The full Hosted UI session (getCurrentUser /
 * signInWithRedirect / signOut) and per-app authorization are built in Task 9.
 */
async function configureAmplify(): Promise<void> {
  try {
    // Computed specifier + @vite-ignore so the bundler does not statically
    // require the generated file at build time. In sandbox/deployed builds the
    // file is produced (ampx sandbox / ampx generate outputs) before this runs.
    const outputsPath = '../amplify_outputs.json';
    const module = await import(/* @vite-ignore */ outputsPath);
    Amplify.configure(module.default);
  } catch {
    // amplify_outputs.json has not been generated yet. Run the sandbox in
    // sso-backend (or `ampx generate outputs` in the deployed build) first.
    console.warn(
      'amplify_outputs.json not found. Generate it from sso-backend before starting Hosted UI.',
    );
  }
}

// Configure Amplify (best-effort) and render the launcher independently. The
// launcher must appear even when amplify_outputs.json is absent, so its mount
// does not await / depend on configureAmplify() succeeding.
void configureAmplify();
mountAppLauncher();
