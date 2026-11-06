# Branded TerraSacha application launcher grid

The change adds a static, framework-free "Aplicaciones" launcher to the SSO frontend: a branded header plus a 3x3 grid rendered into `#app`. Four catalogued apps (Oráculo, Legal Docs, Data Drones, Datum) render as active `<a>` tiles that navigate to their launch URL in the same tab; the remaining five cells are muted, `aria-disabled` "Próximamente / Coming soon" placeholders. The app list is duplicated from the backend `role-catalog.ts` into a typed frontend module with a keep-in-sync comment, icons are inline SVGs, and styling uses the terrasacha.com earthy/olive palette with the Jost font. The launcher mounts independently of Amplify, so the grid shows whether or not `amplify_outputs.json` exists.

Watch for: the favicon is a byte-for-byte copy of the full logo SVG rather than a favicon-optimized mark (confirmed — 15,325 bytes each); minor, non-blocking. Everything else in the spec is satisfied.

**Verdict**: APPROVED

## High-level view

The launcher is intentionally dependency-free. `app-launcher.ts` builds HTML strings and mounts them into `#app`; no React/Vue/Svelte was added, and icons are hand-written inline SVGs inheriting `currentColor`. All interpolated catalog strings pass through an `escapeHtml` helper, so the string-templated HTML is not an injection vector for the static catalog.

The app catalog lives in `applications.ts` as a typed `readonly LauncherApp[]` with `appKey`, `displayName`, `description`, `redirectUrl`, and `kind`. It is a deliberate hand-maintained duplicate of the backend `sso-backend/amplify/auth/role-catalog.ts`, called out in a prominent source-of-truth comment. The four appKeys and the datum mobile scheme match the backend catalog exactly; the web redirect targets point at each app's home (`localhost:3000/3001/3002`), which lines up with the backend's per-app `logoutUrls` / app home rather than the `/api/auth/callback` entries.

Redirect behavior is consistent for web and mobile: active tiles are real `<a href>` controls, and a click handler calls `preventDefault()` then `window.location.assign(data-redirect)` so same-tab navigation and the `tsdatum://` custom scheme go through one path. Placeholders are plain `aria-disabled` divs with no handlers and no `href`, so they are neither focusable nor actionable.

Brand and accessibility land on spec: cream gradient background, olive `#44482c` body text (~8.4:1 on cream, clears WCAG AA), pale-gold tile borders, green hover/focus accents, Jost loaded via a Google Fonts `<link>`, favicon link present, and semantic `main/header/section/footer/h1` with logo alt text and visible `focus-visible` rings on active tiles. Amplify's dynamic-import + try/catch is untouched and the launcher mounts unconditionally.

<details>
<summary>Issues (1)</summary>

1. **Favicon is the full logo** — `public/favicon.svg` is an exact copy of `public/brand/terrasacha-logo.svg` (same 15,325 bytes). Works, but a detailed logo renders poorly at 16px; consider a simplified mark. Non-blocking.

</details>

<details>
<summary>Details</summary>

### Framework-free rendering and injection posture

`mountAppLauncher()` finds `#app`, assigns `innerHTML` from `renderLauncher()`, then wires a `click` listener on every `.tile--active`. No UI framework is imported — `main.ts` pulls in only `aws-amplify`, the stylesheet, and the launcher module (confirmed). Icons are inline `<svg>` strings keyed by appKey, each with `aria-hidden="true"` and `stroke="currentColor"` so the CSS brand-green flows through, and they are visually distinct per app (eye/orb, document, quadcopter, phone).

Every catalog string that reaches the markup — `redirectUrl`, `displayName`, `description` — is run through `escapeHtml` for both text and attribute positions (confirmed). The catalog is static and developer-controlled, so this is belt-and-suspenders rather than a live XSS boundary, but it means adding a future entry with special characters won't break the markup.

### Catalog duplication vs. the backend source of truth

`applications.ts` carries the required typed shape and a header comment naming `sso-backend/amplify/auth/role-catalog.ts` as authoritative, with an explicit instruction to hand-sync. Checked against that backend file: the four `appKey` values (`ts-oraculo`, `ts-legalDocs`, `ts-dataDrones`, `ts-datum`), catalog order, and the datum `clientKind: 'mobile'` / `tsdatum://auth/callback` scheme all match. The web `redirectUrl`s (`localhost:3000/3001/3002/`) correspond to the backend `logoutUrls` (the app home), not the `/api/auth/callback` entries — the right choice for a launcher that drops users at each app's front door rather than its OAuth callback.

### Redirect wiring for web and mobile

```
active <a href + data-redirect>
      └── click → preventDefault() → window.location.assign(data-redirect)
                                     (same tab; handles tsdatum:// too)
placeholder <div aria-disabled>  — no href, no handler, not focusable
```

Active tiles keep a real `href` in addition to `data-redirect`, so keyboard Enter/Space and middle/cmd-click still behave like a normal link, while the handler guarantees the custom-scheme and same-tab path. The handler reads `data-redirect` and no-ops if absent, so a malformed tile fails closed rather than navigating somewhere unexpected.

### Grid shape and placeholders

`GRID_CELLS = 9` with `Math.max(0, 9 - APPLICATIONS.length)` yields exactly five placeholders for the current four apps, and the count self-adjusts if the catalog grows (a fifth app would render four placeholders). Datum's tile carries the `Mobile` badge via the `kind === 'mobile'` branch. Placeholders render as `aria-disabled` divs with muted/dashed styling and 0.6 opacity, carry no `href` or listener, and so are correctly removed from the tab order.

### Amplify independence

`main.ts` keeps the original `configureAmplify()` with its dynamic `import('../amplify_outputs.json')` and try/catch, and calls `mountAppLauncher()` unconditionally without awaiting config, so the grid renders regardless of whether `amplify_outputs.json` exists. No Cognito Hosted UI flow was introduced, matching the stated scope.

### Verification evidence

The coder's `verification.md` reports `npm run build` (`tsc --noEmit && vite build`) passing with zero type errors under strict TS, and documents grepping the built `dist/` JS/CSS for the four redirect targets, `location.assign`, the grid/placeholder markers, and the brand tokens. Live `vite preview` was blocked in the tool runner, so runtime behavior was inferred from built artifacts rather than observed in a browser — a reasonable fallback given the constraint. Per instructions I did not re-run the build or preview; I spot-checked the two cross-project claims (backend catalog values and the presence of the brand/favicon assets), both of which hold.

</details>

<details>
<summary>File map</summary>

- `src/applications.ts` — new typed `LauncherApp[]` catalog, duplicated from backend with source-of-truth comment.
- `src/app-launcher.ts` — new; renders header + 3x3 grid into `#app`, inline SVG icons, click→`window.location.assign` wiring, HTML escaping.
- `src/styles.css` — new; brand palette, Jost, responsive 3/2/1 grid, hover + `focus-visible` rings.
- `src/main.ts` — additive import + `mountAppLauncher()` call; Amplify configure untouched.
- `index.html` — favicon link, Jost Google Fonts link, title.
- `public/brand/terrasacha-logo.svg`, `public/favicon.svg` — brand assets (favicon is a copy of the logo).
- `.agents/tasks/verification.md` — coder's verification note.

Full diff: `git diff 8573734 aae8202`.

</details>
