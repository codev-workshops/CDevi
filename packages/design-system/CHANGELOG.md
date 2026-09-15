# Changelog

Tokens, CSS variable names, `cd-` class names, component names and props are the public API. Additive
changes bump the minor version; renames or removals bump the major version and carry a migration note.

## 1.4.0 — 2026-09-15

### Added

- `RequirementStatePill` (`state: RequirementState`) and the normative `requirementStateToPill` mapping plus
  `REQUIREMENT_STATES` / `RequirementState` in `src/tokens.ts`: the eight specs/001 FR-009 requirement lifecycle
  states as a word in a pill (Draft / Ready → neutral, Analyzing / In Implementation → run with pulse,
  Needs Clarification → needs-you, Approved / Completed → done, Rejected → fail). Requirement states are not
  workflow states, so `StatePill` stays typed on `WorkflowState`. Reuses the existing `.cd-pill` variant classes; no
  new CSS. Gallery entry `RequirementStatePill`, DESIGN.md §3/§4/§5 rows.

### Fixed

- `Button` no longer drops an explicit `aria-disabled` on `<button>` (it was overwritten by the `loading` flag), so an
  action a role/state does not allow can stay focusable with `aria-describedby` pointing at the reason.

## 1.3.0 — 2026-09-14

### Added

- `OptionGroup` (`legend`, `error` slots): a real `<fieldset>`/`<legend>` around `OptionRow`s so a set of radios has
  one accessible group name (rejection target, suggested clarification answers — specs/001 US2). CSS: `.cd-optgroup`.
- `AuditEvent.risk` is optional (`RiskLevel | null`): the Risk column renders an em dash when the audited target has
  no risk level (a clarification answer, specs/001 US2 scenario 3). Events with a level render `RiskBadge` as before.

## 1.2.0 — 2026-09-14

### Added

- `Notice` (`tone="info" | "error"`, `action` slot): inline message for load errors with a retry, session notices
  and demonstration-data banners. `info` renders `role="status"`, `error` renders `role="alert"`. Contrast pairs
  `ink/indigo-soft` and `ink/red-soft` added to `tokens/pairs.json`.
- `List loading` prop: `aria-busy` plus three `.cd-row.cd-skeleton` placeholders when there are no rows yet, so a
  loading list is never read as empty (specs/003 FR-025). Skeleton animation is disabled under reduced motion.
- `FocusLayout` (`brand` slot): `<main class="cd-root cd-focus">` with one centred card, for sign-in.
- CSS: `.cd-notice*`, `.cd-row.cd-skeleton`, `.cd-root.cd-focus`, `.cd-focus-brand`, `.cd-focus-card`.

### Fixed

- `List` renders `role="group"` (instead of no role) when it has no rows, so an `aria-label` on an empty or
  loading list is permitted (axe `aria-prohibited-attr`).
- `body` loses its default margin when a `.cd-root.cd-full` shell or `.cd-root.cd-focus` layout is its direct child,
  so the application fills the viewport edge to edge.
- `ListRow` derives its `aria-describedby` id from `useId()` instead of a module counter, so server-rendered
  gate rows hydrate without attribute mismatches.
- Icon-rail navigation links (768–1199px) keep a 32px minimum target even without an icon (WCAG 2.5.8 target size,
  found by the specs/003 viewport matrix).

## 1.1.0 — 2026-09-11

### Added

- React component library (`src/`, built to `dist/`) covering every CSS component, each with a typed API, an
  accessibility contract and tests (behaviour + axe): shell (`AppShell`, `Side`, `Brand`, `Nav*`, `Main`, `Panel`,
  `PanelBlock`, `Topbar`, `Crumbs`), primitives (`Button`, `Pill`, `RuntimeGlyph`, `KeyFingerprint`, `Mono`),
  containers (`Card`, `List`, `ListRow`, `Tabs`, `KeyValue`, `Table`, `Stat`, `Meter`, `Bars`), forms (`Field`,
  `Input`, `TextArea`, `Select`, `Segmented`, `Chip(s)`, `OptionRow`, `Help`), agent surfaces (`Message`, `ToolLog`,
  `DecisionCard`, `GateCheck`, `GateList`, `Diff`, `Stepper`, `Terminal`), `ThemeProvider`/`useTheme`.
- Control-plane vocabulary: `StatePill` (nine `specs/001` workflow states via `stateToPill`), `RiskBadge`
  (`riskToVariant`), `FindingRow`, `AuditTable`/`AuditRow`, `ActionBar`, `PageMeta`, `StatGrid`; mapping tables and
  `severityToPill`, `blockingToPill`, `policyOutcomeToPill` exported from `src/tokens.ts`.
- CSS: `.cd-pill.cd-needs-you`, `.cd-pill.cd-blocked`, `.cd-pill.cd-cancelled`, `.cd-risk*`, `.cd-finding*`,
  `.cd-audit*`, `.cd-actions`, `.cd-page-meta`, `.cd-section-label`, `.cd-stat-grid`, `.cd-visually-hidden`,
  `.cd-row.cd-is-selected`, `.cd-list .cd-empty`, `.cd-msg.cd-summary`, `.cd-decision.cd-neutral`.
- Interactive states for every control: `:hover`, `:active`, `:disabled`/`[aria-disabled]`, `[aria-selected]`,
  `[aria-current]`, `[aria-checked]`, `[aria-pressed]`, `[aria-busy]` (+ spinner), native radio/checkbox styling
  inside `.cd-opt` / `.cd-check`.
- Full-viewport shell `.cd-app.cd-full` with breakpoints: 240px sidebar ≥1200px, 56px icon rail 768–1199px, top bar +
  disclosure menu (`.cd-menu-toggle`, `.cd-nav.cd-open`) <768px; panel stacks <960px.
- Tokens: `color.saffron-strong`, `color.line-strong`, `color.code-read/write/ok/err/dim`, `shadow.1`,
  `semantic.state.*` (9) and `semantic.risk.*` (4); `tokens.json` validated against
  `specs/002-adopt-design-system/contracts/tokens.schema.json`.
- Token pipeline: `scripts/build-tokens.mjs` generates `css/tokens.css`, `tailwind/preset.cjs` and
  `src/tokens.generated.ts`; `scripts/build-css.mjs` generates `css/cdevi.css`. Drift is tested.
- `tokens/pairs.json` and an automated WCAG 2.2 AA contrast check over every pair in both themes.
- Self-hosted fonts via `@fontsource/*` (`css/fonts.css`); no third-party requests.
- Gallery (Vite React app) with every component in both themes, usage snippets and accessibility notes; Playwright
  visual + page-level axe baselines for the gallery and the reference screens; LCP budget test.
- `DESIGN.md` normative rules DR-01…DR-10, component catalogue, vocabulary glossary.
- `ListRow trailing` is wrapped in `.cd-trailing` so several pills/badges sit together on the right (found in the
  US1 agent trials, where a `Pill` + `RiskBadge` pair fell into separate grid cells).

### Changed (visual)

- `color.ink-3` #7C8494 → **#656D7D** (light) so tertiary text reaches 4.5:1 on canvas and surface.
- `color.green` #1E7F5C → **#1A6E50** (light) so the done pill reaches 4.5:1 on green-soft.
- `color.code-dim` #6B7280 → **#9AA3B2** for AA on code-bg.
- `.cd-btn.cd-saffron` fill now `--saffron-strong` (white text at AA); `.cd-pill.cd-needs-you` uses the same fill.
- Control borders (`.cd-input`, `.cd-btn.cd-ghost/.cd-danger`, `.cd-seg`, `.cd-chip`, `.cd-opt`, `.cd-check .cd-box`)
  use `--line-strong` (3:1 boundary contrast); decorative borders keep `--line`/`--line-2`.
- Filled controls use `color: var(--surface)` instead of `#fff` so dark mode inverts correctly.
- `demo/` moved to `reference-screens/` and relabelled as pattern references; Google Fonts links removed;
  `<span class="cd-btn">` → `<button>`, tabs → `role="tab"`, segmented → `role="radio"`, active nav →
  `aria-current="page"`.
- `tailwind/preset.js` → `tailwind/preset.cjs` (package is ESM). The subpath export `./tailwind/preset` is unchanged.
- Tailwind preset now uses `theme` (replacing defaults) instead of `extend`, and every value is a `var()` reference.

### Removed

- Static `docs/index.html` gallery — replaced by the React gallery (`pnpm gallery`), which is the single source for
  component examples.

## 1.0.1 — 2026-09-11

### Fixed

- `table.cd-table` rule was written as `table.cd-cd-table`, so the table component was never styled
  (gallery and reference screens use `cd-table`). Regression test: `tests/unit/css-classes.test.ts`.

## 1.0.0 — 2026-09-13

Initial release: tokens, base, components, Tailwind preset, gallery, ten demo pages.
