# Research: Adopt the CDevi Design System

**Feature**: 002-adopt-design-system | **Date**: 2026-09-11

All Technical Context items were resolvable from the source folder, the constitution and the current toolchain; no `NEEDS CLARIFICATION` remained after Phase 0 of `/speckit-specify`. This document records each technology decision, its rationale and the alternatives rejected, plus the measurements that drive the repair work.

## R1. Monorepo tooling — pnpm workspaces, no Turborepo yet

- **Decision**: pnpm 10 workspaces (`pnpm-workspace.yaml` with `packages/*` and `apps/*`), root scripts fan out with `pnpm -r`. Install pnpm via `npm i -g pnpm` (Node 26 no longer bundles Corepack). No Turborepo in this feature.
- **Rationale**: `docs/architecture.md` already names pnpm; strict node_modules isolation prevents an app from accidentally importing the package's dev dependencies; a single package does not benefit from a task graph and Constitution I forbids unjustified abstractions. Turborepo is added when `apps/web` lands.
- **Alternatives**: npm workspaces (zero install but hoists everything, weaker isolation); Nx (heavier, opinionated generators not needed).

## R2. Token pipeline — custom generator script, not Style Dictionary

- **Decision**: `packages/design-system/scripts/build-tokens.mjs` (Node ESM, no dependencies) reads `tokens/tokens.json`, validates it against `contracts/tokens.schema.json` (using Ajv only at build time), and writes `css/tokens.css` (`:root`, `[data-theme="dark"]`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`) and `tailwind/preset.js`. `scripts/build-css.mjs` concatenates `tokens.css + fonts.css + base.css + components.css` into `cdevi.css`. Both outputs carry a `GENERATED` header; a Vitest test rebuilds to a temp dir and diffs against the committed files.
- **Rationale**: The token file uses a non-standard `$extensions["cdevi.dark"]` for dark values and needs three output blocks; Style Dictionary would need a custom transform group and two custom formats for ~the same code volume plus a dependency. The generator is ~120 lines and fully owned.
- **Alternatives**: Style Dictionary 5 (DTCG-aware, but dark-mode via extensions still custom; rejected on dependency weight); Tokens Studio transformer (Figma-oriented; no Figma in this workflow).

## R3. Semantic token additions

- **Decision**: Add to `tokens.json`: `color.code-read/write/ok/err/dim`, `shadow.1`, `radius.md`/`radius.lg` remain but the CSS variable names stay `--r`/`--r-lg` for backwards compatibility (an `alias` field maps token path → CSS variable name when they differ). Add `semantic.state.{queued,running,waiting,waiting-for-human,blocked,failed,retrying,completed,cancelled}` and `semantic.risk.{low,medium,high,critical}` as references (`{color.*}`) so they resolve to existing hues (Phase 0 decision Q5).
- **Rationale**: Completes FR-008 without renaming any public CSS variable (which would be a major version).
- **Alternatives**: Rename `--r` → `--radius-md` (breaking; deferred to a future 2.0 with a migration note).

## R4. Contrast measurements and repairs

Measured with the WCAG 2.x relative-luminance formula (to be confirmed by the automated check in `tokens/pairs.json`):

| Pair | Current | Ratio | AA (4.5:1) | Repair |
|------|---------|-------|------------|--------|
| `ink-3` #7C8494 on `surface` #FFFFFF | body/meta text 11.5–12.5px | **3.76** | FAIL | `ink-3` → **#656D7D** (5.2 on surface, 4.73 on canvas) |
| `ink-3` #7C8494 on `canvas` #F3F4F6 | nav group labels, help text | **3.41** | FAIL | same |
| `green` #1E7F5C on `green-soft` #DFF3EA | `cd-pill.cd-done` 11.5px | **4.27** | FAIL | `green` → **#1A6E50** (5.35 on green-soft, 6.2 on surface) |
| `indigo` #2F4FD6 on `indigo-soft` #E6EBFB | `cd-pill.cd-run` | 5.5 | pass | none |
| `red` #B23A48 on `red-soft` #F9E3E6 | `cd-pill.cd-fail` | 4.78 | pass | none |
| `saffron-ink` #8A4F0B on `saffron-soft` #FBEFDF | `cd-pill.cd-wait`, decision card | 5.78 | pass | none |
| `ink-3` dark #8790A0 on `surface` dark #171B23 | | 5.36 | pass | none |
| `saffron` #C9791B as white-text button background | `cd-btn.cd-saffron` 13px 600 | ~3.4 | FAIL | saffron button text → `saffron-ink`-on-`saffron-soft` is *not* acceptable for the primary action; instead darken button fill to **`saffron-ink`-adjacent #A8620F** for the `cd-btn.cd-saffron` background only (new token `saffron-strong`, ~4.6 on white text). Pills keep `saffron`/`saffron-soft`. |
| `cd-key` `ink-2` on `canvas` | | 7.3 | pass | none |

- **Decision**: Change three token values (`ink-3`, `green`, add `saffron-strong`), leave hue identity intact so the brand reads the same. `pairs.json` lists every pair the components use; the check fails on any pair below 4.5:1 (3:1 for pairs flagged `large: true`).
- **Alternatives**: Restrict `ink-3` to ≥18.66px text by lint (rejected: it is used for meta text everywhere; a value change is smaller); keep saffron button and enlarge text (rejected: 13px → 18.66px breaks density).

## R5. Fonts — Fontsource packages, latin subsets

- **Decision**: Depend on `@fontsource/instrument-sans` (400/500/600/700 + 400 italic), `@fontsource/jetbrains-mono` (400/500), `@fontsource/noto-sans-sinhala` (600). `css/fonts.css` imports only the needed weight/subset files (`latin` for the two Latin faces, `sinhala` for Noto). Included in `cdevi.css`. Budget ≤ 200 KB woff2, measured by `tools/check-size.mjs`.
- **Rationale**: OFL-licensed, versioned, self-hosted through node_modules, no manual file management; FR-005 zero third-party requests.
- **Alternatives**: Committing woff2 files (works but untracked provenance/updates); Google Fonts CDN (rejected by Phase 0 Q3); variable-font `@fontsource-variable/*` (smaller for many weights but Noto Sinhala variable not available; mixed approach adds complexity).

## R6. React component library — TypeScript source shipped, Vite library build for consumers

- **Decision**: `src/` in TypeScript, React 19, function components with `forwardRef` where a DOM node is exposed. Package `exports` point at `dist/` (built by Vite library mode, `react`/`react-dom` externalized, `.d.ts` via `vite-plugin-dts`) and at the CSS/tokens/preset files. Components render the existing `cd-` classes; no CSS-in-JS.
- **Rationale**: Phase 0 Q2. Rendering the classes keeps a single styling layer (the CSS file) usable by non-React surfaces; a build gives consumers stable JS without needing the package's TS config.
- **Alternatives**: Shipping raw TS (simplest but couples consumers to our tsconfig); CSS Modules (would fork styling into two layers); Tailwind-only components (weakest guardrails, Phase 0 rejected).

## R7. Interactive semantics per component

- **Decision**:
  - `Button` → `<button type="button">` (or `<a>` when `href` given); `disabled` uses the attribute and `aria-disabled` for link-buttons.
  - `Tabs` → `role="tablist"`/`role="tab"` with roving `tabIndex`, arrow-key navigation, `aria-selected`; `TabPanel` with `role="tabpanel"`.
  - `Nav` items → `<a>` with `aria-current="page"` for active.
  - `Segmented` → `role="radiogroup"` of `<button role="radio" aria-checked>` with arrow keys.
  - `Chips` (selectable) → `<button aria-pressed>`; `Chips` (static) → `<span>`.
  - `OptionRow` → real `<input type="radio">` visually hidden + label; keyboard native.
  - `GateCheck` box → non-interactive `role="img"` with `aria-label` of the state ("passed", "waiting", "failed", "overridden") unless `onToggle` supplied, then `<input type="checkbox">`.
  - `Pill` → `<span>` with visible text (the state word is the accessible name); running dot is `aria-hidden`.
  - `Meter` → `<div role="meter" aria-valuenow/min/max aria-label>`; width via CSS custom property `--cd-meter-value` set from props (the single allow-listed inline mechanism).
  - Focus: keep `:focus-visible` outline 2px indigo; add `:hover`/`:active` background shifts using existing `surface-2`/`canvas` tokens.
- **Rationale**: FR-004; jsx-a11y and axe will fail otherwise.

## R8. Full-viewport shell and breakpoints

- **Decision**: `AppShell` gets `variant="framed" | "full"`. `full` removes border/radius/min-height, uses `min-height:100dvh`, sidebar 240px at ≥1200px, collapses to icon rail 56px between 768–1199px (labels via tooltip/`aria-label`), and becomes a top bar with a disclosure menu (`<details>`/button + `aria-expanded`) below 768px. Right panel stacks below main under 960px (existing behaviour kept).
- **Rationale**: FR-006 and Constitution III viewport checks; `specs/001` targets desktop first, but a defined narrow behaviour prevents ad-hoc CSS in apps.
- **Alternatives**: Desktop-only with a "not supported" notice (rejected by Constitution III).

## R9. Lint stack

- **Decision**: ESLint 9 flat config at root: `@eslint/js` recommended, `typescript-eslint` recommended-type-checked, `eslint-plugin-react` + `react-hooks`, `eslint-plugin-jsx-a11y` strict. Design-system rules for `apps/**` and `tools/lint-fixtures/**`: `react/forbid-dom-props` `{ forbid: [{ propName: 'style', message: 'Use design-system props; dynamic values go through data-* or CSS custom properties (see DESIGN.md §6).' }] }`; `jsx-a11y/no-static-element-interactions`, `jsx-a11y/click-events-have-key-events`, `jsx-a11y/control-has-associated-label` as errors. Stylelint 17 with `stylelint-declaration-strict-value` for `color`, `background*`, `border*-color`, `fill`, `stroke`, `font-size`, `font-family`, `border-radius`, `box-shadow`, `margin*`, `padding*`, `gap` requiring `var()` (packages/design-system/css exempt via `overrides`). Prettier for formatting.
- **Rationale**: FR-021–FR-023 with off-the-shelf rules; messages customised to name the alternative (FR-026).
- **Alternatives**: Biome (fast, but no jsx-a11y parity yet and no Stylelint equivalent for strict values); custom ESLint plugin (more control, more maintenance — only the class-prefix check needs custom code and that is a script, not a plugin).

## R10. Class-prefix check

- **Decision**: `tools/check-class-prefix.mjs` builds the set of defined classes by regex-scanning `packages/design-system/css/*.css` for `\.cd-[a-z0-9-]+`, then scans `apps/**/*.{tsx,ts,html,css}` and `tools/lint-fixtures/**` for `cd-[a-z0-9-]+` string occurrences and fails on any not in the set, printing file:line and the three closest defined names. Runs as `pnpm check:classes`; unit-tested via the fixture.
- **Rationale**: FR-024; no existing lint rule does this.

## R11. Accessibility and visual testing

- **Decision**: Vitest 4 + `@testing-library/react` + `axe-core` (`vitest-axe` matchers) for every component in both themes. Playwright: `gallery.spec.ts` visits each gallery entry in light and dark at 1280×800, runs `@axe-core/playwright`, and `toHaveScreenshot` with `reducedMotion: 'reduce'` and `animations: 'disabled'`; `reference-screens.spec.ts` does the same for the ten static screens at 1280×900. Baselines committed; `maxDiffPixelRatio: 0.001`. Chromium only in CI (fonts self-hosted so rendering is stable on `ubuntu-latest`).
- **Rationale**: FR-025; deterministic per Constitution II.
- **Alternatives**: Storybook + Chromatic (hosted, cost, heavier than a Vite page for 40 components); Percy (hosted).

## R12. Governance artifacts

- **Decision**:
  - Constitution 1.0.0 → **1.1.0**: Principle III gains two bullets (design-system tokens/components mandatory; new patterns added to the package first, with gallery entry + a11y contract + changelog). Sync Impact Report updated, ratified date preserved, last-amended 2026-09-11.
  - `plan-template.md`: new `## Design System Compliance` section (components used / proposed / a11y verification) placed before Complexity Tracking.
  - `tasks-template.md`: new note under Format explaining the "add a design-system component" task shape (component + test + gallery entry + DESIGN.md row + CHANGELOG line in one task).
  - `AGENTS.md` at root: build/lint/test commands, "UI work" section linking DESIGN.md, gallery command, mappings, checks.
  - `.devin/skills/cdevi-design-system/SKILL.md`: description tuned to trigger on UI/component/screen/style tasks; body = component catalogue table, mapping tables, pre-commit checklist, what to do when a pattern is missing.
  - `packages/design-system/DESIGN.md`: normative rules (MUST/MUST NOT), five core rules with do/don't, per-component a11y contract table, allow-listed dynamic-value mechanism, glossary mapping `specs/001` concepts.
- **Rationale**: FR-016–FR-019; puts the same rule set in every place an agent reads.

## R13. Reference screens and the old gallery

- **Decision**: Move `demo/*.html` + `demo.css` to `packages/design-system/reference-screens/`, prepend a banner comment and add `README.md` stating they are pattern references only; update `<link>` paths; replace Google Fonts `<link>` with `../css/cdevi.css` (which now includes fonts); replace `<span class="cd-btn">` with `<button>` and tabs with `<button role="tab">` so page-level axe passes. Retire `docs/index.html` static gallery once the React gallery has an entry per component (tracked as a task; no two galleries).
- **Rationale**: FR-001, Phase 0 Q1; Constitution I "obsolete code must not be left behind".

## R14. Architecture document rewrite

- **Decision**: Rewrite `docs/architecture.md` for CDevi: keep §1 one-paragraph shape, service map reduced to what `specs/001` implies (web, api, agent-orchestrator worker, integration worker) with the "runtime is replaceable" boundary from the UI spec §44; keep outbox/NOTIFY event bus, RLS tenancy (single org now, `organization_id` on every row), one `checkPermission` per agent tool call → policy engine; repository layout with `packages/design-system` replacing `packages/ui`; remove workbook/DuckDB/query-worker/Stripe/credits; spec-ownership table rebuilt from `specs/001` + `specs/002`; future services list rewritten (multi-org, realtime co-editing, sandbox fleet).
- **Rationale**: FR-027, Phase 0 Q4.

## Dependency version policy

All dependencies pinned to versions published ≥ 7 days before 2026-09-11 (checked with `npm view <pkg> time`); exact versions recorded in `package.json` files and locked by `pnpm-lock.yaml`.
