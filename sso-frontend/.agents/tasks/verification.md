# Launcher UI — Verification Note

First iteration (no `.agents/tasks/launcher-review.json` present). Implemented the
branded application launcher from scratch.

## Files added / changed
- `src/applications.ts` (new) — typed `LauncherApp[]` catalog (appKey, displayName,
  description, redirectUrl, kind). Duplicated from backend `role-catalog.ts` with a
  "keep in sync" source-of-truth comment.
- `src/app-launcher.ts` (new) — `mountAppLauncher()` renders header + 3x3 grid into
  `#app`; inline line-style SVG icons; active tiles are `<a>` controls that call
  `window.location.assign(redirectUrl)` on click (Enter/Space fire the click);
  placeholders are non-focusable `aria-disabled` divs. HTML is escaped.
- `src/styles.css` (new) — brand palette, Jost font, responsive 3/2/1 column grid,
  hover + visible focus rings.
- `src/main.ts` — additive: imports `./styles.css` + `mountAppLauncher`, calls it
  after `void configureAmplify()`. Amplify dynamic import + try/catch left intact;
  launcher mount does not depend on Amplify config.
- `index.html` — added favicon link, Jost Google Fonts `<link>`, updated title.

## What I ran and the results

### 1. Build (strict TS + vite)
Command: `npm run build` (runs `tsc --noEmit && vite build`), from `sso-frontend/`.
Result: PASS — exit 0, zero type errors/warnings (tsconfig has `strict`,
`noUnusedLocals`, `noUnusedParameters` all true).
Output: `dist/index.html` 0.73 kB, `dist/assets/index-*.css` 3.22 kB,
`dist/assets/index-*.js` 63.15 kB. 602 modules transformed.

### 2. Grid contents (3x3: 4 active + 5 placeholders)
Grepped built JS: found `tile--active` (x2 marker strings), `tile--placeholder`,
`aria-disabled`, and placeholder text `Próximamente` / `Coming soon`.
`GRID_CELLS = 9` minus 4 apps renders 5 placeholders.

### 3. Redirect wiring (inspected built JS bundle)
`grep` of `dist/assets/index-*.js` confirmed all four targets and the navigation call:
- `localhost:3000/`  (ts-oraculo) ✓
- `localhost:3001/`  (ts-legalDocs) ✓
- `localhost:3002/`  (ts-dataDrones) ✓
- `tsdatum://auth/callback`  (ts-datum) ✓
- `location.assign` present ✓
Each active tile carries both `href` and `data-redirect`; the click handler reads
`data-redirect` and calls `window.location.assign(...)` in the same tab.

Note on live preview: `vite preview` could not be launched from the tool runner
(server-start commands are blocked / not allowed to run as long-lived processes).
Verification was therefore done against the built `dist/` artifacts (HTML, JS, CSS)
and the served static assets, which deterministically reflect what the browser runs.

### 4. Brand styling (inspected built CSS)
`grep` of `dist/assets/index-*.css` confirmed: `#44482c` (olive text), `#f7f4ea` /
`#faf9f4` (cream backgrounds), `#70752b` / `#849b50` (greens), `#e8d79a` (gold
accent), `Jost` font-family, `grid-template-columns:repeat(3` (desktop grid), and
`focus-visible` (x3, visible focus rings). Built `dist/index.html` contains the Jost
Google Fonts `<link>`, the favicon link, and the logo is referenced via
`/brand/terrasacha-logo.svg`; `dist/brand/terrasacha-logo.svg` and `dist/favicon.svg`
are copied into the build output. Olive `#44482c` on cream `#f7f4ea` exceeds WCAG AA
for body text (contrast ratio ~8.4:1).

### 5. Amplify config preserved
`src/main.ts` still defines `configureAmplify()` with the dynamic
`import('../amplify_outputs.json')` and its try/catch; `mountAppLauncher()` is called
unconditionally and independently, so the grid renders whether or not
`amplify_outputs.json` exists.
