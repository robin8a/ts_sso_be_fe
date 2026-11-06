/**
 * Branded application launcher for the TerraSacha SSO frontend.
 *
 * Renders a 3x3 grid of application tiles into `#app`: the four catalogued
 * applications as active, focusable tiles that redirect to their launch URL,
 * plus "Coming soon" placeholders filling the remaining cells. This module is
 * pure UI scaffolding — it does NOT drive the Cognito Hosted UI sign-in flow
 * and does not depend on Amplify being configured.
 */

import { APPLICATIONS, type LauncherApp } from './applications';

/** Total cells in the 3x3 launcher grid. */
const GRID_CELLS = 9;

/**
 * Inline line-style SVG icons, keyed by application. Each inherits `currentColor`
 * so the tile's brand-green accent flows through via CSS.
 */
const APP_ICONS: Record<string, string> = {
  // Oráculo — an eye/orb for AI insights.
  'ts-oraculo': `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>`,
  // Legal Docs — a document with lines.
  'ts-legalDocs': `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21V3a.5.5 0 0 1 .5-.5Z" />
      <path d="M14 2.5v4h4" />
      <path d="M9 12.5h6M9 16h6" />
    </svg>`,
  // Data Drones — a quadcopter.
  'ts-dataDrones': `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="5" cy="5" r="2.5" />
      <circle cx="19" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M6.8 6.8 10 10m4 0 3.2-3.2M10 14l-3.2 3.2M14 14l3.2 3.2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>`,
  // Datum — a mobile device.
  'ts-datum': `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M10.5 18.5h3" />
    </svg>`,
};

/** Neutral "plus" glyph for the muted placeholder tiles. */
const PLACEHOLDER_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 6v12M6 12h12" />
  </svg>`;

/** Escape a string for safe interpolation into HTML text/attribute contexts. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build the markup for one active (clickable) application tile. */
function renderAppTile(app: LauncherApp): string {
  const icon = APP_ICONS[app.appKey] ?? PLACEHOLDER_ICON;
  const mobileBadge =
    app.kind === 'mobile'
      ? '<span class="tile__badge">Mobile</span>'
      : '';
  return `
    <a class="tile tile--active" href="${escapeHtml(app.redirectUrl)}"
       data-redirect="${escapeHtml(app.redirectUrl)}"
       aria-label="Abrir ${escapeHtml(app.displayName)}">
      <span class="tile__icon">${icon}</span>
      <span class="tile__body">
        <span class="tile__title">${escapeHtml(app.displayName)}${mobileBadge}</span>
        <span class="tile__desc">${escapeHtml(app.description)}</span>
      </span>
    </a>`;
}

/** Build the markup for one muted, non-interactive placeholder tile. */
function renderPlaceholderTile(): string {
  return `
    <div class="tile tile--placeholder" aria-disabled="true">
      <span class="tile__icon">${PLACEHOLDER_ICON}</span>
      <span class="tile__body">
        <span class="tile__title">Próximamente</span>
        <span class="tile__desc">Coming soon</span>
      </span>
    </div>`;
}

/** Assemble the full launcher markup (header + 3x3 grid). */
function renderLauncher(): string {
  const activeTiles = APPLICATIONS.map(renderAppTile).join('');
  const placeholderCount = Math.max(0, GRID_CELLS - APPLICATIONS.length);
  const placeholderTiles = Array.from({ length: placeholderCount }, renderPlaceholderTile).join('');

  return `
    <main class="launcher">
      <header class="launcher__header">
        <img class="launcher__logo" src="/brand/terrasacha-logo.svg"
             alt="TerraSacha — Pioneros del Mañana" />
        <h1 class="launcher__title">Aplicaciones</h1>
        <p class="launcher__subtitle">Pioneros del Mañana</p>
      </header>
      <section class="grid" aria-label="Aplicaciones de TerraSacha">
        ${activeTiles}
        ${placeholderTiles}
      </section>
      <footer class="launcher__footer">
        <span>© ${new Date().getFullYear()} TerraSacha</span>
      </footer>
    </main>`;
}

/** Navigate the browser to an active tile's redirect target, in the same tab. */
function handleTileActivation(event: Event): void {
  const target = event.currentTarget as HTMLElement;
  const redirectUrl = target.dataset['redirect'];
  if (!redirectUrl) {
    return;
  }
  event.preventDefault();
  window.location.assign(redirectUrl);
}

/**
 * Mount the launcher UI into `#app`. Safe to call regardless of whether Amplify
 * has been configured; the grid renders from the static application catalog.
 */
export function mountAppLauncher(): void {
  const root = document.getElementById('app');
  if (!root) {
    console.error('Launcher mount point #app not found.');
    return;
  }

  root.innerHTML = renderLauncher();

  const activeTiles = root.querySelectorAll<HTMLAnchorElement>('.tile--active');
  activeTiles.forEach((tile) => {
    // Intercept so custom schemes (mobile) and same-tab navigation go through
    // window.location.assign consistently. Enter/Space on the <a> fire a click.
    tile.addEventListener('click', handleTileActivation);
  });
}
