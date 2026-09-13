# CDevi (සීදේවි) design system

`@cdevi/design-system` — design tokens, plain CSS and accessible React components for the CDevi SDLC Control Plane. Every class is prefixed `cd-`; every text/background pair meets WCAG 2.2 AA in light and dark; fonts are self-hosted. **The rules are in [`DESIGN.md`](DESIGN.md)** — read it before building UI. This README covers installation and layout.

## Contents

```
tokens/tokens.json      SOURCE OF TRUTH (W3C design-token format + cdevi.dark / cdevi.cssVar extensions)
tokens/pairs.json       text/background pairs verified for contrast in both themes
scripts/                build-tokens.mjs (tokens → css/tokens.css, tailwind/preset.cjs, src/tokens.generated.ts), build-css.mjs, color.mjs
css/tokens.css          GENERATED custom properties (light, dark via [data-theme] or prefers-color-scheme)
css/fonts.css           self-hosted fonts via @fontsource (Instrument Sans, JetBrains Mono, Noto Sans Sinhala)
css/base.css            scoped reset and typography under .cd-root
css/components.css      all components
css/cdevi.css           GENERATED bundle of the four files above — include this one
tailwind/preset.cjs     GENERATED Tailwind preset; `theme` REPLACES defaults so only token utilities exist
src/                    React components (one folder per group), tokens.ts (state/risk mappings), tests
gallery/                Vite app: every component in both themes with usage and accessibility notes
reference-screens/      static full-page pattern references (not CDevi screens — see its README)
tests/visual/           Playwright: page-level axe + screenshot baselines for gallery and reference screens
DESIGN.md               normative rules DR-01…DR-10, component contracts, vocabulary mappings
```

## Install (workspace)

The package is consumed from the pnpm workspace; it is not published.

```ts
// apps/web
import '@cdevi/design-system/css';
import { AppShell, Side, Main, StatePill, Button } from '@cdevi/design-system';
```

```json
// apps/web/package.json
{ "dependencies": { "@cdevi/design-system": "workspace:*" } }
```

Wrap the app in `<ThemeProvider theme="system">` (or put `class="cd-root"` on `<body>` and `data-theme` on `<html>` for non-React pages).

Subpath exports: `.` (components), `./css` (bundle), `./css/tokens`, `./css/fonts`, `./tokens.json`, `./tailwind/preset`.

**Tailwind** (layout utilities only — component appearance comes from this package):

```js
// tailwind.config.cjs
module.exports = {
  presets: [require('@cdevi/design-system/tailwind/preset')],
  content: ['./src/**/*.tsx'],
};
```

## Develop

```bash
pnpm -F @cdevi/design-system gallery          # http://127.0.0.1:5173/gallery/  (reference screens at /reference-screens/)
pnpm -F @cdevi/design-system build:tokens     # after editing tokens/tokens.json — never edit generated files
pnpm -F @cdevi/design-system build            # tokens → css bundle → dist/
pnpm -F @cdevi/design-system test             # component tests (behaviour + axe), token drift, contrast, exports, gallery coverage
pnpm test:visual                              # from the repo root; `-- --update-snapshots` after an intentional visual change
```

Adding a component: `DESIGN.md` §8.

## Fonts

Instrument Sans (UI), JetBrains Mono (paths, fingerprints, logs), Noto Sans Sinhala (wordmark), loaded from `@fontsource/*` packages through `css/fonts.css`. No third-party requests at runtime; fallback stacks are in the tokens. First-load budget: stylesheet ≤ 40 KB, fonts ≤ 200 KB (`pnpm check:size`).

## Dark mode

Follows `prefers-color-scheme` by default. Force with `<html data-theme="dark">` / `"light"` or `ThemeProvider`.

## Versioning

Tokens, CSS variable names, `cd-` class names, component names and props are the public API. Additive → minor; rename/remove → major with a migration note in `CHANGELOG.md`. Token value changes are minor and noted as visual changes.
