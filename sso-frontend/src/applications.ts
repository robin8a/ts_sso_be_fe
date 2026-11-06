/**
 * TerraSacha application catalog for the launcher UI.
 *
 * SOURCE OF TRUTH: the backend catalog at
 * `sso-backend/amplify/auth/role-catalog.ts` (the `APPLICATIONS` array) is the
 * authoritative list of catalogued applications. This module intentionally
 * DUPLICATES the relevant fields for the frontend instead of importing across
 * projects. If the backend catalog changes (apps added/removed, keys renamed,
 * redirect targets changed), this list MUST be kept in sync by hand.
 */

/** How an application signs in / is launched. Mirrors backend `ClientKind`. */
export type AppKind = 'web' | 'mobile';

/** A launchable TerraSacha application tile. */
export interface LauncherApp {
  /** Backend application key, e.g. `ts-oraculo`. */
  appKey: string;
  /** Human-facing display name. */
  displayName: string;
  /** One short line describing the application. */
  description: string;
  /** Where clicking the tile navigates the browser. */
  redirectUrl: string;
  /** 'web' opens a URL in the same tab; 'mobile' uses a custom scheme. */
  kind: AppKind;
}

/**
 * The four catalogued applications, in backend catalog order. Redirect targets
 * are the per-app launch URLs (web localhost ports / the datum mobile scheme).
 */
export const APPLICATIONS: readonly LauncherApp[] = [
  {
    appKey: 'ts-oraculo',
    displayName: 'Oráculo',
    description: 'AI insights & oracles',
    redirectUrl: 'http://localhost:3000/',
    kind: 'web',
  },
  {
    appKey: 'ts-legalDocs',
    displayName: 'Legal Docs',
    description: 'Legal document management',
    redirectUrl: 'http://localhost:3001/',
    kind: 'web',
  },
  {
    appKey: 'ts-dataDrones',
    displayName: 'Data Drones',
    description: 'Drone data capture',
    redirectUrl: 'http://localhost:3002/',
    kind: 'web',
  },
  {
    appKey: 'ts-datum',
    displayName: 'Datum',
    description: 'Mobile data companion',
    redirectUrl: 'tsdatum://auth/callback',
    kind: 'mobile',
  },
] as const;
