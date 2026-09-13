# Implementation Plan: Adopt the CDevi Design System as the Governed UI Foundation

**Branch**: `002-adopt-design-system` (work performed on `develop`) | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-adopt-design-system/spec.md`

## Summary

Import the external `cdevi-design-system` folder into the repository as the workspace package `@cdevi/design-system` (`packages/design-system`), make `tokens/tokens.json` the single source from which `css/tokens.css` and `tailwind/preset.js` are generated, repair the known defects (table class mismatch, sub-AA contrast for `--ink-3` and `--green` on soft surfaces, non-semantic interactive markup, framed-only shell, Google-Fonts dependency), wrap every component in an accessible React component with a typed API, add the control-plane vocabulary (nine workflow states, four risk levels, finding row, audit row, action bar, page meta, stat grid, full-viewport shell), and codify the rules in `DESIGN.md`, the constitution (v1.1.0), the plan/task templates, `AGENTS.md` and an auto-invoked skill. Enforcement is a root lint/test toolchain (ESLint + jsx-a11y, Stylelint strict-value, class-prefix scanner, token-drift check, contrast check, Vitest + axe on the gallery, Playwright visual regression) wired into a GitHub Actions workflow and proven against a violation fixture set. `docs/architecture.md` is rewritten for CDevi.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node.js 26 (repo `.nvmrc` = 26), ES modules throughout

**Primary Dependencies**: pnpm 10 workspaces (no Turborepo yet, see research R1); React 19.x; Vite 8 (gallery dev server, library build); `@fontsource/instrument-sans`, `@fontsource/jetbrains-mono`, `@fontsource/noto-sans-sinhala` (self-hosted fonts); ESLint 9 flat config + `eslint-plugin-jsx-a11y` + `eslint-plugin-react` + `typescript-eslint`; Stylelint 17 + `stylelint-declaration-strict-value`; Prettier 3

**Storage**: N/A (files in repository; tokens in `tokens/tokens.json`; visual baselines committed under `packages/design-system/tests/visual/__screenshots__/`)

**Testing**: Vitest 4 + `@testing-library/react` + `axe-core` (component a11y, state/risk mappings, contrast, token drift, lint-fixture assertions); Playwright 1.5x for gallery + reference-screen visual regression and page-level axe scans; `tsc --noEmit` for types

**Target Platform**: Evergreen desktop browsers (last 2 versions Chrome, Edge, Firefox, Safari); Node 26 for tooling; GitHub Actions `ubuntu-latest` for CI

**Project Type**: Monorepo library package + repository tooling (no application yet; enforcement rules are proven with fixtures and will bind to `apps/*` when they appear)

**Performance Goals**: `css/cdevi.css` ≤ 40 KB uncompressed; font assets ≤ 200 KB total transferred on first load (latin subsets, woff2, weights 400/500/600/700 UI, 400/500 mono, 600 Sinhala); gallery initial render ≤ 2 s on a mid-range laptop (Vite production build, Lighthouse performance ≥ 90); token generation ≤ 1 s; full check suite (lint + unit + a11y) ≤ 90 s on CI excluding browser download; visual-regression job ≤ 5 min

**Constraints**: Zero third-party network requests at runtime (fonts and CSS served from the package); WCAG 2.2 AA contrast for every token pair listed in `tokens/pairs.json`; every interactive component keyboard-operable with visible focus; `prefers-reduced-motion` honoured; class names outside the package may not use the `cd-` prefix unless defined by the package; generated files never hand-edited (drift check); additive changes bump minor, renames/removals bump major with CHANGELOG + migration note

**Scale/Scope**: ~35 existing CSS components → ~40 React components; 10 reference screens; 1 gallery; ~30 tokens + 13 semantic aliases; 7 lint/test checks; 6 governance documents (DESIGN.md, constitution, plan template, tasks template, AGENTS.md, skill); 1 architecture rewrite

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | How this plan complies | Status |
|-----------|-------------|------------------------|--------|
| I. Maintainable Code Quality | Follow conventions; establish them where none exist; pass formatter/linter/types/build; validate external input; update docs with behaviour changes; remove obsolete code | This is the first stack in the repo, so the plan **establishes** conventions: TypeScript strict, ESLint flat config, Prettier, Stylelint, pnpm workspaces, `.nvmrc`. New dependencies are each justified in research.md. Token generator validates `tokens.json` against a schema before emitting. Static `docs/index.html` gallery is **removed** once the React gallery covers every component (no duplicate galleries). CHANGELOG updated in the same change as each behaviour change. | PASS |
| II. Risk-Based, Reliable Testing | Behaviour changes ship with failing-then-passing tests; bug fixes start with a regression test; deterministic, isolated tests; required tests pass before merge; no hidden flakes | Table-class bug (FR-002) gets a regression test first (asserts `.cd-table` rule exists and `.cd-cd-table` does not). Contrast, drift, state/risk mapping, class-prefix and lint-fixture checks are unit tests that fail before their implementation lands. axe checks per component and per gallery page. Visual regression baselines are deterministic (fixed viewport, fonts self-hosted, animations disabled via `reducedMotion: 'reduce'`). All checks are required CI jobs. | PASS |
| III. Consistent and Accessible UX | Reuse components/tokens; define loading/empty/error/disabled states; WCAG 2.2 AA; check viewports; destructive actions confirm | The feature *is* the mechanism for this principle. Every component documents hover/active/focus/selected/disabled states; interactive elements are semantic (`button`, `a`, `[role=tab]`, `input[type=radio]`); contrast check enforces AA; shell defines desktop/tablet/narrow behaviour; reduced-motion honoured. Constitution is amended to make the design system mandatory (FR-017). | PASS |
| IV. Measurable Performance | Numeric budgets with metric, threshold, workload, environment, verification method; bounded operations; measurements exposed | Budgets in Technical Context: CSS ≤ 40 KB (measured by `size-limit`-style script in `check:size`, CI), fonts ≤ 200 KB (same script sums `@fontsource` woff2 files referenced by `fonts.css`), gallery render ≤ 2 s / Lighthouse ≥ 90 (Playwright trace on CI, ubuntu-latest, throttling off), token build ≤ 1 s (timed in the drift test), check suite ≤ 90 s (CI job timeout). No unbounded data operations exist in this feature. | PASS |
| Quality Requirements | Spec + plan identify acceptance criteria, journeys, failure scenarios, conventions, boundaries, UI/a11y criteria, budgets, checks, evidence | Covered by spec.md (criteria/journeys), this plan (conventions, budgets, checks), quickstart.md (evidence). First-stack requirement to "establish reproducible build, lint, test commands and configure CI" is satisfied by Phase 1 setup tasks and `.github/workflows/ci.yml`. | PASS |
| Governance | Constitution amendment via reviewed change; version + dates updated | FR-017 amendment is MINOR (1.0.0 → 1.1.0): adds obligations to Principle III without redefining it. Sync Impact Report comment updated; ratified date preserved; last-amended set. Requires maintainer approval on the PR. | PASS (pending approval) |

**Gate result (pre-research)**: PASS — no violations to justify. Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-adopt-design-system/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions R1–R14
├── data-model.md        # Phase 1 output — tokens, components, mappings, checks
├── quickstart.md        # Phase 1 output — how to verify the feature end to end
├── contracts/
│   ├── tokens.schema.json        # JSON Schema for tokens/tokens.json (source of truth)
│   ├── components.md             # Public React component API + accessibility contract
│   ├── state-risk-mapping.md     # specs/001 workflow states / risk levels → variants
│   └── checks.md                 # Enforcement checks: command, rule, failure message, scope
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
.nvmrc                              # 26
package.json                        # root: workspaces scripts (lint, test, check, build)
pnpm-workspace.yaml                 # packages/*, apps/*
tsconfig.base.json                  # strict shared TS config
eslint.config.js                    # flat config: base + react + jsx-a11y + design-system rules
.stylelintrc.json                   # strict-value rules for app CSS; package exempt via overrides
.prettierrc.json
.github/workflows/ci.yml            # lint, typecheck, unit+a11y, size, visual (Playwright)
AGENTS.md                           # contributor guidance incl. "UI work" section
.devin/skills/cdevi-design-system/SKILL.md   # auto-invoked on UI tasks
.specify/memory/constitution.md     # amended to 1.1.0
.specify/templates/plan-template.md # + Design System Compliance section
.specify/templates/tasks-template.md# + "add a design-system component" task pattern
docs/architecture.md                # rewritten for CDevi
tools/
├── check-class-prefix.mjs          # scans non-package sources for undefined cd- classes
├── check-size.mjs                  # CSS + font byte budgets
└── lint-fixtures/                  # one file per violation category (must FAIL lint)
    ├── raw-color.css
    ├── inline-style.tsx
    ├── div-onclick.tsx
    ├── icon-no-label.tsx
    ├── unknown-cd-class.tsx
    └── README.md
packages/design-system/
├── package.json                    # @cdevi/design-system 1.1.0, exports map
├── README.md                       # updated install/usage
├── CHANGELOG.md                    # 1.0.1 fix, 1.1.0 additions
├── DESIGN.md                       # normative rules (MUST/MUST NOT), glossary, a11y contracts
├── tokens/
│   ├── tokens.json                 # SOURCE OF TRUTH (DTCG + cdevi.dark extension + semantic)
│   └── pairs.json                  # text/background pairs checked for contrast
├── scripts/
│   ├── build-tokens.mjs            # tokens.json → css/tokens.css + tailwind/preset.js
│   └── build-css.mjs               # concatenates css/*.css → css/cdevi.css
├── css/
│   ├── tokens.css                  # GENERATED
│   ├── base.css
│   ├── components.css              # repaired + new components
│   ├── fonts.css                   # @fontsource imports (self-hosted)
│   └── cdevi.css                   # GENERATED bundle
├── tailwind/preset.js              # GENERATED (theme replaces defaults, var() colours)
├── src/
│   ├── index.ts                    # public exports
│   ├── tokens.ts                   # typed token names + state/risk mapping tables
│   ├── components/                 # one folder per component: Name.tsx, Name.test.tsx
│   │   ├── AppShell/ (framed + full-viewport, Side, Nav, Panel, Topbar, Crumbs, PageMeta, ActionBar)
│   │   ├── Button/ Pill/ RiskBadge/ RuntimeGlyph/ KeyFingerprint/
│   │   ├── Card/ List/ ListRow/ Tabs/ Field/ Input/ Segmented/ Chips/
│   │   ├── KeyValue/ Meter/ GateCheck/ Message/ ToolLog/ DecisionCard/ OptionRow/
│   │   ├── Diff/ Stepper/ Stat/ StatGrid/ Bars/ Table/ Terminal/
│   │   ├── FindingRow/ AuditRow/
│   │   └── ThemeProvider/          # data-theme control
│   └── test/ (setup, axe helper, render helper)
├── gallery/                        # Vite React app: every component, both themes, usage + a11y notes
│   ├── index.html
│   ├── main.tsx
│   └── entries/*.tsx
├── reference-screens/              # former demo/*.html, relabelled as pattern references
│   ├── README.md
│   └── *.html, demo.css
├── tests/
│   └── visual/                     # Playwright: gallery + reference screens, light/dark
│       ├── gallery.spec.ts
│       ├── reference-screens.spec.ts
│       └── __screenshots__/
├── vite.config.ts  vitest.config.ts  playwright.config.ts  tsconfig.json
```

**Structure Decision**: Monorepo with `packages/design-system` as the only package in this feature (apps arrive with `specs/001`). Root holds shared tooling so enforcement rules apply to any future `apps/*` without per-app setup. Reference screens stay static HTML (they are references, not code to maintain as React) and are served by Vite `publicDir` for the visual tests. The static `docs/index.html` gallery is retired in favour of the React gallery to avoid two sources of truth.

## Design System Compliance

*(This section is what FR-018 adds to the plan template; filled here for the feature itself.)*

- **Components used**: none consumed by an app yet; the gallery consumes every exported component.
- **Components proposed**: `Pill` variant `blocked`; `RiskBadge`; `FindingRow`; `AuditRow`; `ActionBar`; `PageMeta`; `StatGrid`; `AppShell` `fullViewport` prop; `ThemeProvider`. All added to the package with gallery entries, a11y contracts, and a `1.1.0` changelog entry before any consumer exists.
- **Accessibility verification**: per-component axe in Vitest; page-level axe in Playwright on gallery + reference screens; keyboard walkthrough of Button, Tabs, Nav, Segmented, OptionRow, Chips, DecisionCard documented in quickstart.md; contrast check over `pairs.json`.

## Complexity Tracking

No constitution violations; nothing to justify.

## Post-Design Constitution Re-check

Re-evaluated after Phase 1 artifacts (research.md, data-model.md, contracts/, quickstart.md):

- **I** — Conventions now concrete (contracts/checks.md lists every command); token generator + schema keep generated files honest; no duplicate gallery. PASS.
- **II** — data-model.md lists which test guards each entity/rule; quickstart.md shows the red→green order for the table bug and the fixtures. PASS.
- **III** — contracts/components.md carries an accessibility contract per component and the states list; state-risk-mapping.md guarantees `BLOCKED`/`WAITING_FOR_HUMAN` prominence. PASS.
- **IV** — budgets unchanged and each has a verification command in contracts/checks.md. PASS.

**Gate result (post-design)**: PASS. Ready for `/speckit-tasks`.
