# Tasks: Adopt the CDevi Design System as the Governed UI Foundation

**Input**: Design documents from `/specs/002-adopt-design-system/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (tokens.schema.json, components.md, state-risk-mapping.md, checks.md), quickstart.md

**Tests**: Included. The constitution (Principle II) requires failing-then-passing tests for every behaviour change and a regression test before each bug fix, so test tasks precede their implementation tasks within each story.

**Organization**: Grouped by user story. Story phases are ordered by **dependency**, not by the P-number alone: US3 (import/repair) is the foundation everything else builds on; US1 (agent conforms) is verified last because it consumes the outputs of US2, US5 and US6. Each phase is still independently testable per its Independent Test.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US7 from spec.md
- Paths are repository-relative. `DS` = `packages/design-system`

## Path Conventions

- Monorepo: root tooling (`package.json`, `eslint.config.js`, `.stylelintrc.json`, `tools/`), package at `packages/design-system`, future apps at `apps/*`
- Source folder to import from: `/Users/praveen/Downloads/cdevi-design-system` (exclude `.DS_Store`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the monorepo and the conventions the constitution requires for a first stack (build, lint, test, CI).

- [X] T001 Install pnpm globally (`npm i -g pnpm@10`) and create `.nvmrc` containing `26` at repo root
- [X] T002 Create root `package.json` (private, `"packageManager": "pnpm@10.x"`, scripts: `build`, `lint`, `lint:css`, `typecheck`, `test`, `test:visual`, `check:tokens`, `check:contrast`, `check:classes`, `check:size`, `check`) and `pnpm-workspace.yaml` with `packages/*` and `apps/*`
- [X] T003 [P] Create `tsconfig.base.json` (strict, `moduleResolution: bundler`, `jsx: react-jsx`, `noUncheckedIndexedAccess`) at repo root
- [X] T004 [P] Create `.prettierrc.json` (single quotes, 100 cols, trailing commas) and `.prettierignore` (dist, generated css, screenshots) at repo root
- [X] T005 [P] Extend `.gitignore` with `node_modules/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `*.tsbuildinfo`
- [X] T006 Create `packages/design-system/package.json` (`@cdevi/design-system` v1.0.0 for now, `type: module`, exports map from contracts/components.md, scripts: `build:tokens`, `build:css`, `build`, `gallery`, `test`, `test:visual`) and `packages/design-system/tsconfig.json` extending the base
- [X] T007 Add root dev dependencies pinned to versions ≥7 days old: `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `stylelint`, `stylelint-declaration-strict-value`, `prettier`, `vitest`, `@vitest/coverage-v8`; run `pnpm i` and commit `pnpm-lock.yaml`
- [X] T008 Add `packages/design-system` dependencies: `react`, `react-dom` (peer + dev), `@types/react`, `@types/react-dom`, `vite`, `@vitejs/plugin-react`, `vite-plugin-dts`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `axe-core`, `vitest-axe`, `@playwright/test`, `@axe-core/playwright`, `ajv`, `@fontsource/instrument-sans`, `@fontsource/jetbrains-mono`, `@fontsource/noto-sans-sinhala`
- [X] T009 Create `.github/workflows/ci.yml` with jobs `lint`, `unit`, `build`, `visual` per contracts/checks.md (Node from `.nvmrc`, `pnpm/action-setup`, `--frozen-lockfile`, Playwright browser cache, `visual` needs `build`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Import the raw design system and stand up the test harness so every story can add failing tests.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T010 Copy `css/`, `tokens/`, `tailwind/`, `README.md`, `CHANGELOG.md` from `/Users/praveen/Downloads/cdevi-design-system` into `packages/design-system/` (exclude `.DS_Store`, `package.json`, `docs/`, `demo/`); verify with `git status` that only expected files were added
- [X] T011 Move `demo/*.html` and `demo/demo.css` to `packages/design-system/reference-screens/` and write `packages/design-system/reference-screens/README.md` stating they are pattern references only and do not define CDevi screens or navigation (FR-001)
- [X] T012 Copy `docs/index.html` to `packages/design-system/legacy-gallery.html` temporarily (retired in T088 once the React gallery covers every component)
- [X] T013 Create `packages/design-system/vitest.config.ts` (jsdom, `setupFiles: src/test/setup.ts`, include `src/**/*.test.{ts,tsx}` and `tests/unit/**/*.test.ts`) and `packages/design-system/src/test/setup.ts` (jest-dom + vitest-axe matchers) and `packages/design-system/src/test/render.tsx` (renders under `.cd-root` with `data-theme` param)
- [X] T014 [P] Create `packages/design-system/vite.config.ts` (library mode entry `src/index.ts`, externals `react`, `react-dom`, `react/jsx-runtime`, `vite-plugin-dts`; `publicDir: reference-screens` for the gallery server) and `packages/design-system/playwright.config.ts` (Chromium, 1280×800, `reducedMotion: 'reduce'`, `webServer` = gallery preview, snapshot dir `tests/visual/__screenshots__`)
- [X] T015 [P] Create root `eslint.config.js` flat config: `@eslint/js` recommended, `typescript-eslint` recommended-type-checked, `react` + `react-hooks`, `jsx-a11y` strict; design-system block for `apps/**` and `tools/lint-fixtures/**` with `react/forbid-dom-props` (`style`, message "DR-07: use component props or a `--cd-*` custom-property prop, see packages/design-system/DESIGN.md §6"), `jsx-a11y/no-static-element-interactions`, `jsx-a11y/click-events-have-key-events`, `jsx-a11y/control-has-associated-label` as errors; override allowing `style` only in `packages/design-system/src/**`; ignore `dist/`, `reference-screens/`, `legacy-gallery.html`
- [X] T016 [P] Create root `.stylelintrc.json` with `stylelint-declaration-strict-value` for `color`, `/^background/`, `/^border(-.*)?-color$/`, `fill`, `stroke`, `font-size`, `font-family`, `border-radius`, `box-shadow`, `/^margin/`, `/^padding/`, `gap` (`ignoreValues: ['transparent','inherit','currentColor','0','none','auto']`, message "DR-06: use a token from css/tokens.css"); `overrides` exempting `packages/design-system/css/**` and `reference-screens/**`
- [X] T017 Run `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`, `pnpm test` at root and confirm all exit 0 on the empty harness (baseline green)

**Checkpoint**: Raw system imported; harness green; stories can begin.

---

## Phase 3: User Story 3 — Imported, repaired and accessible package (Priority: P1)

**Goal**: Fix known defects, reach WCAG 2.2 AA, self-host fonts, wrap every component in React, build the gallery.

**Independent Test**: quickstart.md §1 — gallery shows every component in both themes, table styled, contrast check green, keyboard walkthrough passes, no third-party requests.

### Tests for User Story 3 (write first, confirm they FAIL)

- [X] T018 [P] [US3] Regression test `packages/design-system/tests/unit/css-classes.test.ts`: parse `css/components.css`, assert a rule for `table.cd-table` exists and none for `cd-cd-table` (fails on imported CSS)
- [X] T019 [P] [US3] Test `packages/design-system/tests/unit/fonts.test.ts`: `css/fonts.css` exists, imports only `@fontsource/*` files for weights listed in research R5, and `css/cdevi.css` contains no `fonts.googleapis.com`
- [X] T020 [P] [US3] Test `packages/design-system/tests/unit/exports.test.ts`: every component name in contracts/components.md is exported from `src/index.ts` (list hard-coded from the contract)
- [X] T021 [P] [US3] Component a11y test scaffold `packages/design-system/src/test/a11y.ts`: helper `expectAccessible(ui, {theme})` running axe with WCAG 2.2 AA tags in light and dark; used by every `*.test.tsx`

### Implementation for User Story 3

- [X] T022 [US3] Fix `table.cd-cd-table` → `table.cd-table` in `packages/design-system/css/components.css`; bump `packages/design-system/package.json` to 1.0.1 and add the CHANGELOG entry (T018 goes green)
- [X] T023 [US3] Create `packages/design-system/css/fonts.css` importing `@fontsource/instrument-sans` 400/500/600/700 + 400-italic latin, `@fontsource/jetbrains-mono` 400/500 latin, `@fontsource/noto-sans-sinhala` 600 sinhala; create `packages/design-system/scripts/build-css.mjs` concatenating `tokens.css + fonts.css + base.css + components.css` → `css/cdevi.css` with a `GENERATED` header; wire `build:css` script (T019 green)
- [X] T024 [US3] Add interactive states to `packages/design-system/css/components.css`: `:hover`/`:active` for `.cd-btn` variants (surface-2/canvas shifts), `.cd-nav a`, `.cd-tabs [role=tab]`, `.cd-seg [role=radio]`, `.cd-chip`, `.cd-opt`; `[aria-selected=true]`/`[aria-current]`/`[aria-pressed=true]`/`[aria-checked=true]` selectors alongside existing `.cd-is-active`; `:disabled,[aria-disabled=true]` styles; keep `:focus-visible` outline
- [X] T025 [US3] Add `.cd-app.cd-full` full-viewport variant and breakpoints to `packages/design-system/css/components.css` per research R8 (no border/radius, `min-height:100dvh`, 240px side ≥1200px, 56px icon rail 768–1199px, top bar + disclosure <768px; panel stacks <960px)
- [X] T026 [US3] Create `packages/design-system/src/index.ts`, `packages/design-system/src/components/ThemeProvider/ThemeProvider.tsx` (+ test) per contracts/components.md
- [X] T027 [P] [US3] Implement `Button` in `packages/design-system/src/components/Button/Button.tsx` + `Button.test.tsx` (button/anchor rendering, variants, sizes, disabled, loading `aria-busy`, axe, Enter/Space)
- [X] T028 [P] [US3] Implement `Pill`, `RuntimeGlyph`, `KeyFingerprint`, `Mono` in `packages/design-system/src/components/{Pill,RuntimeGlyph,KeyFingerprint,Mono}/` + tests (dot `aria-hidden`, label required on glyph)
- [X] T029 [P] [US3] Implement `Card`, `List`, `ListRow` in `packages/design-system/src/components/{Card,List,ListRow}/` + tests (`role=list/listitem`, `empty` state, `gate` row `aria-describedby`)
- [X] T030 [P] [US3] Implement `Tabs`, `Tab`, `TabPanel` in `packages/design-system/src/components/Tabs/` + test (roving tabIndex, ←/→/Home/End, `aria-selected`, `aria-controls`, axe)
- [X] T031 [P] [US3] Implement `KeyValue`, `Table`, `Stat`, `StatGrid`, `Meter`, `Bars` in `packages/design-system/src/components/{KeyValue,Table,Stat,StatGrid,Meter,Bars}/` + tests (`Table` caption + `scope=col`; `Meter` `role=meter` + `--cd-meter-value`; `Bars` `role=img` + `--cd-bar-value`)
- [X] T032 [P] [US3] Implement `Field`, `Input`, `TextArea`, `Select`, `Segmented`, `Chip`, `Chips`, `OptionRow`, `Help` in `packages/design-system/src/components/{Field,Input,Segmented,Chips,OptionRow,Help}/` + tests (`aria-describedby`, `aria-invalid`, radiogroup arrows, `aria-pressed`, real radio input)
- [X] T033 [P] [US3] Implement `Message`, `ToolLog`, `ToolLine`, `DecisionCard`, `GateCheck`, `GateList`, `Diff`, `DiffFile`, `DiffLine`, `Stepper`, `Step`, `Terminal`, `TermLine` in `packages/design-system/src/components/{Message,ToolLog,DecisionCard,GateCheck,Diff,Stepper,Terminal}/` + tests (summary variant labelled "not evidence"; override never green — assert class ≠ `cd-ok`; `aria-current=step`)
- [X] T034 [US3] Implement `AppShell`, `Side`, `Brand`, `Nav`, `NavGroup`, `NavItem`, `Main`, `Panel`, `PanelBlock`, `Topbar`, `Crumbs` in `packages/design-system/src/components/AppShell/` + tests (`variant` framed/full, landmarks, `aria-current=page`, breadcrumb nav) — depends on T025
- [X] T035 [US3] Export everything from `packages/design-system/src/index.ts` (T020 green) and run `pnpm -F @cdevi/design-system build` to produce `dist/` with `.d.ts`
- [X] T036 [US3] Create gallery app `packages/design-system/gallery/index.html`, `gallery/main.tsx` (theme toggle, entry list, per-entry usage snippet + a11y notes from contracts/components.md) and `gallery/entries/*.tsx` — one entry per component showing every variant/state; wire `gallery` and `gallery:build` scripts
- [X] T037 [US3] Update `packages/design-system/reference-screens/*.html`: point `<link>` to `../css/cdevi.css`, remove Google Fonts `<link>`s, replace `<span class="cd-btn">` with `<button type="button">`, tabs with `<button role="tab">`, nav active with `aria-current="page"`; add banner comment "Pattern reference — not a CDevi screen"
- [X] T038 [US3] Update `packages/design-system/README.md` (install from workspace, React usage, CSS-only usage, fonts self-hosted, gallery command) and `CHANGELOG.md` 1.1.0 "Added" entries for React components, fonts, interactive states, full shell

**Checkpoint**: Gallery runs, every component exported and axe-clean, table fixed, fonts self-hosted.

---

## Phase 4: User Story 4 — Tokens are the single source of truth (Priority: P2)

**Goal**: Generate `tokens.css` and `tailwind/preset.js` from `tokens.json`; complete the token set; catch drift.

**Independent Test**: quickstart.md §2 — change one token, regenerate, both outputs change; revert generated files, drift check fails.

### Tests for User Story 4

- [X] T039 [P] [US4] Test `packages/design-system/tests/unit/tokens.test.ts`: (a) `tokens.json` validates against `specs/002-adopt-design-system/contracts/tokens.schema.json` via Ajv; (b) every `--var` referenced in `css/components.css`/`base.css` is defined by a token; (c) rebuilding to a temp dir yields byte-identical `tokens.css`, `cdevi.css`, `preset.js`; (d) build completes in <1000 ms
- [X] T040 [P] [US4] Test `packages/design-system/tests/unit/contrast.test.ts`: for each pair in `tokens/pairs.json`, compute WCAG contrast in light and dark; assert ≥4.5 (≥3.0 when `large`); message includes pair, theme, ratio, threshold and "DR-06: adjust the token value in tokens.json"
- [X] T041 [P] [US4] Test `packages/design-system/tests/unit/preset.test.ts`: preset `theme.colors` keys ⊆ token colour names (no Tailwind defaults such as `blue`, `gray`), `theme` used (not `extend`), every colour value is `var(--…)`

### Implementation for User Story 4

- [X] T042 [US4] Extend `packages/design-system/tokens/tokens.json`: add `color.code-read/code-write/code-ok/code-err/code-dim`, `color.saffron-strong` (#A8620F light / #C9791B dark), `shadow.1`, `$extensions["cdevi.cssVar"]` for `radius.md→--r`, `radius.lg→--r-lg`, `font.ui→--ui`, `font.mono→--mono`, `font.sinhala→--sinhala`; change `color.ink-3` to #656D7D (light) and `color.green` to #1A6E50 (light) per research R4; add `$description` to all `semantic.*`; add `semantic.state.*` (9) and `semantic.risk.*` (4) references per contracts/state-risk-mapping.md; bump `version` to 1.1.0
- [X] T043 [US4] Create `packages/design-system/tokens/pairs.json` listing every fg/bg pair used by components (pill variants, buttons incl. `saffron-strong`+white, `ink-3` on `surface`/`surface-2`/`canvas`, `cd-key`, `code-*` on `code-bg`, decision card, risk badges) with `where` and `large` flags
- [X] T044 [US4] Write `packages/design-system/scripts/build-tokens.mjs`: load + Ajv-validate `tokens.json`, resolve references, emit `css/tokens.css` (`:root`, `[data-theme="dark"]`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, `GENERATED` header) and `tailwind/preset.js` (`theme` replaces `colors`/`fontFamily`/`borderRadius`/`fontSize`/`spacing` with `var()` references; `GENERATED` header); also emit `src/tokens.generated.ts` exporting `cssVar` map; wire `build:tokens` script and make `build` run `build:tokens && build:css && vite build`
- [X] T045 [US4] Run `pnpm -F @cdevi/design-system build:tokens`, commit generated files; confirm T039–T041 green and existing component tests still pass with the new `ink-3`/`green` values; update `CHANGELOG.md` 1.1.0 "Changed" (visual change: ink-3, green) and "Added" (semantic tokens, saffron-strong)
- [X] T046 [US4] Wire root scripts `check:tokens` and `check:contrast` to run the two test files by name (`vitest run tokens contrast`)

**Checkpoint**: Generated files match source; contrast green in both themes; preset token-only.

---

## Phase 5: User Story 5 — The design system speaks the product's vocabulary (Priority: P2)

**Goal**: Map the nine workflow states and four risk levels; add finding, audit, action bar, page meta, stat grid components.

**Independent Test**: quickstart.md §3 — mapping tests pass; gallery StatePill/RiskBadge entries show every value with its word; `BLOCKED` ≠ `FAILED`; `CRITICAL` not styled as fail.

### Tests for User Story 5

- [X] T047 [P] [US5] Test `packages/design-system/src/tokens.test.ts`: `stateToPill` is total over all 9 `WorkflowState`s; `riskToVariant` over 4 levels; `BLOCKED.variant !== FAILED.variant`; `WAITING_FOR_HUMAN.variant === 'needs-you'`; `RUNNING`/`RETRYING` pulse true, others false; every `word` non-empty; `CANCELLED` word "cancelled"
- [X] T048 [P] [US5] Test `packages/design-system/src/components/Pill/StatePill.test.tsx`: renders each state; class sets per contracts/state-risk-mapping.md; accessible name equals the word; `blocked` has red border computed style vs `fail` none; axe both themes
- [X] T049 [P] [US5] Test `packages/design-system/src/components/RiskBadge/RiskBadge.test.tsx`: class sets per contract; `critical` class set disjoint from `{cd-fail, cd-blocked}`; HIGH/CRITICAL font-weight 700; every name ends with "risk"; axe
- [X] T050 [P] [US5] Tests for `FindingRow`, `AuditRow`, `ActionBar`, `PageMeta`, `StatGrid` in their component folders (severity/blocking words as pills per contract; audit slots present; action bar align; page meta list semantics; grid columns) with axe

### Implementation for User Story 5

- [X] T051 [US5] Create `packages/design-system/src/tokens.ts` exporting `WorkflowState`, `PillVariant`, `RiskLevel`, `stateToPill`, `riskToVariant` per contracts/components.md and contracts/state-risk-mapping.md; re-export `cssVar` from `tokens.generated.ts` (T047 green)
- [X] T052 [US5] Add CSS to `packages/design-system/css/components.css`: `.cd-pill.cd-needs-you` (saffron fill, white text, 700), `.cd-pill.cd-blocked` (red-soft bg, red text, red border, glyph via `::before` aria-hidden), `.cd-pill.cd-cancelled` (line-through), `.cd-risk` + `.cd-risk-{low,medium,high,critical}` per contract, `.cd-finding`, `.cd-audit`, `.cd-actions`, `.cd-page-meta`, `.cd-stat-grid` (2/3/4 columns via `data-columns`); add new pairs to `tokens/pairs.json`
- [X] T053 [P] [US5] Implement `StatePill` in `packages/design-system/src/components/Pill/StatePill.tsx` (T048 green)
- [X] T054 [P] [US5] Implement `RiskBadge` in `packages/design-system/src/components/RiskBadge/RiskBadge.tsx` (T049 green)
- [X] T055 [P] [US5] Implement `FindingRow` in `packages/design-system/src/components/FindingRow/FindingRow.tsx` and `AuditRow`/`AuditTable` in `packages/design-system/src/components/AuditRow/AuditRow.tsx` (T050 green)
- [X] T056 [P] [US5] Implement `ActionBar`, `PageMeta`, `StatGrid` in `packages/design-system/src/components/AppShell/ActionBar.tsx`, `PageMeta.tsx`, `packages/design-system/src/components/Stat/StatGrid.tsx` (T050 green)
- [X] T057 [US5] Add gallery entries `packages/design-system/gallery/entries/{StatePill,RiskBadge,FindingRow,AuditRow,ActionBar,PageMeta,StatGrid}.tsx` showing every value; export new components from `src/index.ts`; extend T020 list
- [X] T058 [US5] Replace inline `style=""` usage in `packages/design-system/reference-screens/*.html` for action bars, page meta lines and 4-column stat grids with the new classes; add to `CHANGELOG.md` 1.1.0 "Added"

**Checkpoint**: All 9 states and 4 levels demonstrable; product-vocabulary components exist.

---

## Phase 6: User Story 2 — Contributors are blocked from bypassing the design system (Priority: P1)

**Goal**: Class-prefix scanner, size budget, violation fixtures proving every check fires, CI wiring.

**Independent Test**: quickstart.md §4 — `pnpm test -- fixtures` passes (each fixture triggers its rule); manual copy of a fixture into `apps/scratch` fails `pnpm lint`.

### Tests for User Story 2

- [X] T059 [P] [US2] Create fixtures in `tools/lint-fixtures/`: `raw-color.css` (`color:#123456; padding:13px`), `inline-style.tsx` (`<div style={{color:'red'}}/>`), `div-onclick.tsx` (`<div onClick={f}/>`), `icon-no-label.tsx` (`<button><svg/></button>`), `unknown-cd-class.tsx` (`className="cd-pill cd-sparkle"`), and `README.md` explaining they must fail
- [X] T060 [P] [US2] Test `tools/lint-fixtures/fixtures.test.ts` (root Vitest project): run ESLint API on each `.tsx` fixture asserting expected rule ids (`react/forbid-dom-props`, `jsx-a11y/no-static-element-interactions` + `jsx-a11y/click-events-have-key-events`, `jsx-a11y/control-has-associated-label`); run Stylelint API on `raw-color.css` asserting `scale-unlimited/declaration-strict-value` twice; run `tools/check-class-prefix.mjs` on `unknown-cd-class.tsx` asserting exit 1 and output mentions `cd-sparkle` and a suggestion; generate a temp drifted `tokens.css` and a temp `pairs.json` with a failing pair and assert the drift and contrast checks fail
- [X] T061 [P] [US2] Test `tools/check-size.test.ts`: script exits 0 for current files and exits 1 with byte counts when given a budget of 1

### Implementation for User Story 2

- [X] T062 [US2] Write `tools/check-class-prefix.mjs`: collect `\.cd-[a-z0-9-]+` from `packages/design-system/css/*.css`; scan `apps/**/*.{ts,tsx,html,css}`, `packages/design-system/src/**/*.tsx`, and paths passed as args for `\bcd-[a-z0-9-]+`; honour `// cd-classes-ignore-file`; on unknown class print `file:line  cd-x  →  did you mean cd-a, cd-b, cd-c?  (DR-09: add it to components.css with a gallery entry, or use an existing class)` and exit 1
- [X] T063 [P] [US2] Write `tools/check-size.mjs`: sum bytes of `packages/design-system/css/cdevi.css` (budget 40 960) and of the woff2 files referenced by `css/fonts.css` resolved from `node_modules` (budget 204 800); print measured vs budget; exit 1 over budget; accept `--css-budget`/`--font-budget` flags for the test
- [X] T064 [US2] Create root `vitest.workspace.ts` (or root `vitest.config.ts` with `projects`) so `pnpm test` runs both `packages/design-system` and `tools/**/*.test.ts`; wire `check:classes` and `check:size` root scripts; make `check` = `lint && lint:css && typecheck && check:classes && test && check:size`
- [X] T065 [US2] Run `pnpm check` at root; fix any real violations surfaced in `packages/design-system/src` (fixtures excluded from lint globs but included by the fixture test); confirm T059–T061 green
- [X] T066 [US2] Finalise `.github/workflows/ci.yml`: `lint` job runs lint, lint:css, typecheck, check:classes; `unit` runs test + check:size; `build` runs build; `visual` installs Chromium and runs test:visual; add `concurrency` and `timeout-minutes` (lint/unit 10, visual 15); document in `AGENTS.md` (T074) that all four are required checks on `develop` and `main`

**Checkpoint**: Every rule category demonstrably fails on its fixture and passes on the package.

---

## Phase 7: User Story 6 — Governance makes the design system mandatory (Priority: P2)

**Goal**: DESIGN.md, constitution 1.1.0, template updates, AGENTS.md, skill.

**Independent Test**: quickstart.md §6 — documents exist and cross-link; `/speckit-analyze` reports no constitution violations.

### Tests for User Story 6

- [X] T067 [P] [US6] Test `tools/governance.test.ts`: constitution contains `**Version**: 1.1.0`, Principle III contains "design system" MUST lines, `**Ratified**: 2026-09-11` unchanged; `plan-template.md` contains `## Design System Compliance`; `tasks-template.md` contains "design-system component" pattern; `AGENTS.md` and `.devin/skills/cdevi-design-system/SKILL.md` both contain `packages/design-system/DESIGN.md`; `DESIGN.md` contains `DR-01`…`DR-10` and the 9 state + 4 risk rows

### Implementation for User Story 6

- [X] T068 [US6] Write `packages/design-system/DESIGN.md`: §1 purpose; §2 rules DR-01…DR-10 as MUST/MUST NOT with do/don't snippets for DR-01–05; §3 component catalogue table (from contracts/components.md) with a11y contract per component; §4 state and risk mapping tables (from contracts/state-risk-mapping.md); §5 glossary mapping specs/001 concepts; §6 allow-listed dynamic-value mechanism (`--cd-*` props); §7 third-party widget policy; §8 adding a component (steps + checklist); §9 versioning; §10 enforcement table (from contracts/checks.md)
- [X] T069 [US6] Amend `.specify/memory/constitution.md` to 1.1.0: add to Principle III "User interfaces MUST be built from `@cdevi/design-system` tokens and components; application code MUST NOT declare colours, typography, spacing or radii outside tokens" and "A new visual pattern MUST be added to the design-system package (component, gallery entry, accessibility contract, changelog) before it is consumed by an application"; update Sync Impact Report comment (1.0.0 → 1.1.0, modified principle III, templates touched), set Last Amended 2026-09-11, keep Ratified
- [X] T070 [P] [US6] Add `## Design System Compliance` section to `.specify/templates/plan-template.md` (components used / components proposed / accessibility verification / budgets for UI paths) before Complexity Tracking
- [X] T071 [P] [US6] Add to `.specify/templates/tasks-template.md` under Format a "Design-system component task" pattern: one task = component + test + gallery entry + DESIGN.md row + CHANGELOG line, placed before any task that consumes it; also replace the "Tests are OPTIONAL" note with "Tests are REQUIRED for every behaviour change (Constitution Principle II)"
- [X] T072 [P] [US6] Update `specs/002-adopt-design-system/spec.md` and `specs/001-sdlc-control-plane-mvp/spec.md` Assumptions to name `@cdevi/design-system` as the UI foundation and reference the state/risk mapping contract
- [X] T073 [US6] Create `.devin/skills/cdevi-design-system/SKILL.md` with frontmatter `name`, `description` ("Use when implementing, styling or reviewing any UI, screen, component, page or CSS in CDevi…"), body: where the rules live, component catalogue quick table, state/risk mapping tables, "when a pattern is missing" procedure, pre-commit checklist (`pnpm check`, gallery entry, changelog), link to DESIGN.md
- [X] T074 [US6] Create root `AGENTS.md`: repo purpose, toolchain (Node 26, pnpm), commands (`pnpm i`, `pnpm check`, `pnpm build`, `pnpm test:visual`, gallery), Spec Kit workflow pointers, "UI work" section (read DESIGN.md first, use components, mappings, never inline styles, add pattern to package first), required CI checks list
- [X] T075 [US6] Run T067 and `/speckit-analyze` on feature 002; resolve any reported inconsistency

**Checkpoint**: Every governance surface points at DESIGN.md; constitution 1.1.0 in force.

---

## Phase 8: User Story 1 — An AI agent builds a conforming screen without being told (Priority: P1)

**Goal**: Prove the codification works end to end with a real agent trial; capture evidence.

**Independent Test**: quickstart.md §5 — agent implements the Approval Center list in a scratch branch with no design-system instruction; `pnpm check` passes first run in ≥4/5 trials.

### Tests for User Story 1

- [X] T076 [US1] Create `apps/web-scratch/` minimal Vite React app (`package.json`, `tsconfig.json`, `src/main.tsx`, imports `@cdevi/design-system/css`) so the agent has a target that is covered by the `apps/**` lint globs; add to workspace
- [X] T077 [US1] Write `specs/002-adopt-design-system/evidence/agent-trials.md` template: trial number, prompt used (exact), branch, whether AGENTS.md/skill was read, `pnpm check` result, violations (if any), notes

### Implementation for User Story 1

- [X] T078 [US1] Run trial 1: in branch `trial/us1-1`, prompt an agent "Implement the Approval Center list from specs/001-sdlc-control-plane-mvp/spec.md (User Story 2) as a component in apps/web-scratch/src/ApprovalCenter.tsx with sample data"; run `pnpm check`; record in `evidence/agent-trials.md`
- [X] T079 [US1] Run trials 2–5 the same way in `trial/us1-2`…`trial/us1-5` (vary wording slightly); record results
- [X] T080 [US1] If <4/5 pass: analyse failures, strengthen the weakest surface (skill description triggers, AGENTS.md placement, lint message wording, missing component), then re-run failed trials; record iteration in `evidence/agent-trials.md`
- [X] T081 [US1] Delete trial branches; keep `apps/web-scratch` only if `specs/001` planning wants it, otherwise remove it and the workspace entry (record decision in evidence file)

**Checkpoint**: SC-001 evidence recorded.

---

## Phase 9: User Story 7 — The architecture document describes CDevi (Priority: P3)

**Goal**: Rewrite `docs/architecture.md` for CDevi.

**Independent Test**: quickstart.md §7 — grep for unrelated-product terms returns nothing; `packages/design-system` present.

### Tests for User Story 7

- [X] T082 [P] [US7] Test `tools/architecture-doc.test.ts`: `docs/architecture.md` contains none of `workbook|duckdb|query-worker|stripe|credit|checkout|obvious` (case-insensitive) and contains `packages/design-system`, `outbox`, `row-level security`, `checkPermission`

### Implementation for User Story 7

- [X] T083 [US7] Rewrite `docs/architecture.md` per research R14: §1 paragraph; §2 service map (web, api, agent-orchestrator worker, integration worker; runtime boundary from UI spec §44); §3 spec ownership rebuilt from specs/001 + specs/002; §4 sync/async paths for specs/001 journeys (approval resume, clarification, agent run stream, integration webhooks); §5 event bus (outbox + NOTIFY); §6 tenancy (single org now, `organization_id` everywhere, RLS-ready); §7 agent permissions (`checkPermission` → policy engine, risk levels); §8 repository layout with `packages/design-system`; §9 future services (multi-org, realtime co-editing, sandbox fleet) (T082 green)

**Checkpoint**: Architecture doc consistent with specs.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T084 [P] Write Playwright `packages/design-system/tests/visual/gallery.spec.ts`: for each gallery entry × theme, `toHaveScreenshot` (`maxDiffPixelRatio: 0.001`) and `@axe-core/playwright` scan with WCAG 2.2 AA tags
- [X] T085 [P] Write `packages/design-system/tests/visual/reference-screens.spec.ts`: each of the 10 reference screens × theme at 1280×900, screenshot + axe
- [X] T086 Generate baselines (`pnpm test:visual -- --update-snapshots`), review them visually, commit `tests/visual/__screenshots__/`
- [X] T091 [P] Write `packages/design-system/tests/visual/perf.spec.ts`: load the built gallery index in Chromium, read `PerformanceNavigationTiming` + LCP via `PerformanceObserver`, assert LCP ≤ 2000 ms (SC-008, Principle IV budget); runs in the `visual` CI job
- [X] T087 Run `pnpm check:size`; if fonts exceed 204 800 bytes drop the italic weight or a mono weight and update research R5 + fonts.css + CHANGELOG
- [X] T088 Delete `packages/design-system/legacy-gallery.html` once T036/T057 cover every component; update README link to the React gallery
- [X] T089 [P] Final `packages/design-system/CHANGELOG.md` pass: 1.0.1 (fix) and 1.1.0 (added/changed/removed) complete; set `package.json` version 1.1.0
- [X] T090 Run full quickstart.md §9 gate (`pnpm check && pnpm build && pnpm test:visual`); commit; open PR against `develop` with the four required checks

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → stories
- **US3 (Phase 3)** first: all other stories consume its package and harness
- **US4 (Phase 4)** after US3 (needs `components.css` finalised for the var-coverage test) — can start T039–T044 in parallel with late US3 tasks
- **US5 (Phase 5)** after US4 (semantic tokens) and US3 (Pill component)
- **US2 (Phase 6)** after US4 (drift/contrast checks exist) and US5 (class list complete); fixtures T059–T061 can be written any time after Phase 2
- **US6 (Phase 7)** after US5 (mapping tables final) and US2 (checks table final); constitution amendment T069 can be drafted earlier
- **US1 (Phase 8)** after US2, US5, US6 (it tests them)
- **US7 (Phase 9)** independent after Phase 2; scheduled late only for focus
- **Polish (Phase 10)** after all stories

### Parallel Opportunities

- Phase 1: T003, T004, T005 together
- Phase 2: T014, T015, T016 together
- US3: T018–T021 together; T027–T033 together (7 component groups)
- US4: T039–T041 together
- US5: T047–T050 together; T053–T056 together
- US2: T059–T061 together; T063 with T062
- US6: T070, T071, T072 together after T068
- Polish: T084, T085 together; T089 with T086

### Parallel Example: User Story 3 components

```bash
Task: "Implement Button in packages/design-system/src/components/Button/"
Task: "Implement Pill, RuntimeGlyph, KeyFingerprint, Mono"
Task: "Implement Card, List, ListRow"
Task: "Implement Tabs, Tab, TabPanel"
Task: "Implement KeyValue, Table, Stat, StatGrid, Meter, Bars"
Task: "Implement Field, Input, Segmented, Chips, OptionRow, Help"
Task: "Implement Message, ToolLog, DecisionCard, GateCheck, Diff, Stepper, Terminal"
```

---

## Implementation Strategy

### MVP First (US3 + US4)

1. Phases 1–2, then US3: a repaired, accessible, React-wrapped package with a gallery — already usable by `specs/001`.
2. US4: tokens generated, drift-proof. **Stop and validate** with quickstart §1–§2.

### Incremental Delivery

3. US5 → vocabulary complete; validate §3.
4. US2 → enforcement live; validate §4. CI required checks turned on here.
5. US6 → governance; validate §6.
6. US1 → agent trials; validate §5 (SC-001).
7. US7 → architecture; validate §7.
8. Polish → visual baselines, size budget, legacy gallery removed; §9 gate.

### Notes

- Every bug fix (T022) and behaviour change has a preceding failing test per Constitution II.
- Generated files (`css/tokens.css`, `css/cdevi.css`, `tailwind/preset.js`, `src/tokens.generated.ts`) are committed but never hand-edited; the drift test guards them.
- Commit after each task or logical group; CHANGELOG updated in the same commit as the behaviour change.
