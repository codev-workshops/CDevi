# Contract: Design-system enforcement checks

**Feature**: 002-adopt-design-system. All checks are root `pnpm` scripts, run by `pnpm check` locally and as **required** jobs in `.github/workflows/ci.yml`. Every failure message names the violated rule (DR-nn from `DESIGN.md`) and the sanctioned alternative.

| ID | Command | Tool | Scope | Fails when | Message must include | CI job |
|----|---------|------|-------|------------|----------------------|--------|
| CHK-TOKENS-DRIFT | `pnpm check:tokens` | `tokens.test.ts` (Vitest) rebuilds to tmp and diffs | `packages/design-system/{css/tokens.css,css/cdevi.css,tailwind/preset.js}` | committed generated file ≠ fresh build; `tokens.json` fails schema; a CSS variable in `components.css` has no token | differing variable names; "run `pnpm -F @cdevi/design-system build:tokens` and commit" | `unit` |
| CHK-CONTRAST | `pnpm check:contrast` | `contrast.test.ts` | `tokens/pairs.json` × {light, dark} | any pair < 4.5:1 (or < 3:1 when `large`) | pair, theme, ratio, threshold, "DR-06: adjust the token value in tokens.json, not the component" | `unit` |
| CHK-LINT-TS | `pnpm lint` | ESLint 9 flat config | `apps/**`, `packages/**/src/**`, `tools/**` (fixtures excluded) | `react/forbid-dom-props[style]`, `jsx-a11y/*` strict errors, TS rules | rule id + custom message ("DR-07: use component props or a `--cd-*` custom-property prop, see DESIGN.md §6") | `lint` |
| CHK-LINT-CSS | `pnpm lint:css` | Stylelint 17 + `stylelint-declaration-strict-value` | `apps/**/*.css`, `packages/**/src/**/*.css` (package `css/` exempt) | literal colour/size/radius/shadow/spacing value instead of `var(--…)` | property, value, "DR-06: use a token from css/tokens.css" | `lint` |
| CHK-CLASS-PREFIX | `pnpm check:classes` | `tools/check-class-prefix.mjs` | `apps/**`, `packages/design-system/src/**`, fixtures | `cd-*` class not defined in `packages/design-system/css/*.css` | file:line, class, 3 nearest defined classes, "DR-09: add the class to components.css with a gallery entry, or use an existing one" | `lint` |
| CHK-TYPES | `pnpm typecheck` | `tsc --noEmit -p` each package | all TS | type error | tsc output | `lint` |
| CHK-UNIT-A11Y | `pnpm test` | Vitest + Testing Library + axe-core | `packages/design-system/src/**/*.test.tsx` | axe violation (WCAG 2.2 AA tags) in any component/variant/theme; keyboard expectation fails; mapping invariants fail | axe rule id, node, help URL | `unit` |
| CHK-FIXTURES | `pnpm test` (included) | `tools/lint-fixtures/fixtures.test.ts` | `tools/lint-fixtures/**` | any fixture does **not** produce its expected error (the guardrail itself regressed) | fixture file, expected rule id | `unit` |
| CHK-SIZE | `pnpm check:size` | `tools/check-size.mjs` | `css/cdevi.css`, woff2 files referenced by `css/fonts.css` | CSS > 40 960 bytes or fonts > 204 800 bytes | measured bytes vs budget, "Principle IV budget in specs/002 plan.md" | `unit` |
| CHK-VISUAL | `pnpm test:visual` | Playwright (Chromium) | gallery entries × {light, dark}; 10 reference screens × {light, dark} | screenshot diff > 0.1% pixels vs committed baseline; page-level axe violation | diff image path, "update baselines intentionally with `pnpm test:visual -- --update-snapshots` and describe the visual change in CHANGELOG" | `visual` |
| CHK-BUILD | `pnpm build` | Vite library build + token/css build | package | build error; `dist/` missing exports declared in `package.json` | build output | `build` |

## Allow-list (the only sanctioned exceptions)

| Exception | Mechanism | Where documented |
|-----------|-----------|------------------|
| Dynamic meter width / bar height / stepper progress | Component prop → `--cd-meter-value`, `--cd-bar-value` custom properties set on the element (via `style={{['--cd-meter-value']: …}}` **inside the package only**) | DESIGN.md §6, `react/forbid-dom-props` override for `packages/design-system/src/**` |
| Third-party embedded widget internals | Wrapper component in the package themes it via tokens; widget's own classes exempt from CHK-CLASS-PREFIX by a `// cd-classes-ignore-file` pragma; **not** exempt from axe | DESIGN.md §7 |
| Reference screens (static HTML) | Exempt from ESLint/Stylelint (not app code); **subject to** CHK-VISUAL and page-level axe | reference-screens/README.md |

## Local workflow

```
pnpm i
pnpm check        # = lint + lint:css + typecheck + check:classes + test (incl. tokens, contrast, fixtures) + check:size
pnpm test:visual  # requires `pnpm exec playwright install chromium` once
pnpm -F @cdevi/design-system gallery   # Vite dev server for the gallery
```

## CI workflow (`.github/workflows/ci.yml`)

Jobs: `lint` (CHK-LINT-TS, CHK-LINT-CSS, CHK-CLASS-PREFIX, CHK-TYPES), `unit` (CHK-UNIT-A11Y, CHK-FIXTURES, CHK-TOKENS-DRIFT, CHK-CONTRAST, CHK-SIZE), `build` (CHK-BUILD), `visual` (CHK-VISUAL, needs `build`, caches Playwright browsers). All four are required status checks for merge into `develop`/`main`. Node from `.nvmrc`; pnpm via `pnpm/action-setup`; `--frozen-lockfile`.
