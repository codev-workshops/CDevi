# CDevi Design System — normative rules

**Package**: `@cdevi/design-system` · **Version**: 1.1.0 · **Governs**: every user interface in this repository (Constitution Principle III).

This document is the single normative description of how CDevi looks and behaves. `README.md` explains installation; the gallery (`pnpm -F @cdevi/design-system gallery`) shows every component; `specs/002-adopt-design-system/contracts/` holds the machine-checked contracts this document mirrors. Where they disagree, fix them in one commit — the tests in `tools/governance.test.ts` and `tests/unit/` will tell you.

Words: **MUST** / **MUST NOT** are requirements enforced by a check (§10) or by review; **SHOULD** is strong guidance.

## 1. Purpose

CDevi is a control center for supervising autonomous engineering agents, not a chat application. The interface must let a person answer, at a glance: what is the agent doing, why, what changed, what evidence supports it, what failed, what needs my approval, and what happens next. Every rule below serves one of those questions.

## 2. Rules

### DR-01 — State is always a word in a pill

Every run, stage, workflow, requirement or gate state MUST be rendered as a visible word inside `Pill` (or `StatePill` for workflow states). Colour and icons MAY reinforce the word but MUST NOT replace it.

```tsx
// Do
<StatePill state="WAITING_FOR_HUMAN" />          // → "needs you", saffron
<Pill variant="done">verified</Pill>

// Don't
<span className="dot dot-green" title="verified" />   // colour-only, no word
```

### DR-02 — Saffron means "a person is needed", and there is one primary action per screen

The saffron family (`--saffron`, `--saffron-soft`, `--saffron-ink`, `--saffron-strong`) MUST be used only for: states that need a human (`WAITING_FOR_HUMAN`, `Needs Clarification`, `BLOCKING`, `approval required`), gate rows carrying a question, decision cards with tone `needs-you`, the `HIGH`/`CRITICAL` risk badges, and **exactly one** `Button variant="saffron"` per screen — the action that resolves what needs the person. Any other emphasis MUST use ink or indigo.

```tsx
// Do — one saffron button, it is the resolving action
<ActionBar><Button variant="ghost">Request changes</Button><Button variant="saffron">Approve and merge</Button></ActionBar>

// Don't — saffron as decoration or on two competing actions
<Button variant="saffron">Export CSV</Button> … <Button variant="saffron">Approve</Button>
```

### DR-03 — Agent claims and platform evidence are visually separate

What an agent _says_ MUST be rendered with `Message` (prose in a card). What the platform _verified_ MUST be rendered with `GateCheck` rows that carry a `source`. An agent's own summary of its work MUST use `Message variant="summary"`, which labels it "not evidence". Evidence MUST NOT be rendered inside a `Message`, and a `Message` MUST NOT be styled green.

```tsx
// Do
<GateList><GateCheck state="ok" label="CI passed · 4 checks" source="github_checks · high" /></GateList>
<Message who="Summary from the agent" variant="summary">Moved sessions to Redis…</Message>

// Don't
<Message who="Agent" className="green">All tests pass ✓</Message>     // a claim styled as evidence
```

### DR-04 — Overrides are never rendered as verified

A gate that a person overrode MUST use `GateCheck state="override"` (saffron, "!" glyph, accessible name "overridden") and MUST show who overrode it and why. It MUST NOT use the `ok` state or any green token.

```tsx
// Do
<GateCheck state="override" label='Spec analyzed · overridden by Kasun: "agreed in standup"' source="override:kasun" />

// Don't
<GateCheck state="ok" label="Spec analyzed (override)" />
```

### DR-05 — No sticky headers; the shell scrolls with the page

Application layout MUST use `AppShell` (`variant="full"`) with `Side`, `Main` and optional `Panel`. Nothing in `Main` or `Panel` MAY be `position: sticky` or `fixed`. The sidebar alone may stick at desktop widths (handled by the shell). Progress is shown by structured checklists (`Stepper`, `GateList`), never by a persistent "AI is thinking…" bar.

### DR-06 — Colours, typography, spacing, radii and shadows come from tokens

Application CSS and components MUST reference `var(--…)` custom properties from `css/tokens.css` (generated from `tokens/tokens.json`). Literal hex/rgb/hsl colours, pixel font sizes, radii, shadows, margins, paddings and gaps MUST NOT appear outside `packages/design-system/css`. Need a new value? Add a token (§8). _Enforced by_ CHK-LINT-CSS, CHK-CONTRAST, CHK-TOKENS-DRIFT.

### DR-07 — No inline styles

`style={…}` MUST NOT be used in application code. Dynamic values MUST go through component props that set a `--cd-*` custom property (§6) or through `data-*` attributes with CSS. _Enforced by_ CHK-LINT-TS (`react/forbid-dom-props`).

### DR-08 — Interactive elements are semantic and keyboard-operable

Clickable things MUST be `<button>`, `<a href>`, `<input>`, or a component from this package that renders one. `<div onClick>` and `<span onClick>` MUST NOT be used. Icon-only controls MUST have an accessible name. Focus MUST remain visible (`:focus-visible` outline is provided; do not remove it). Every component in §3 lists its keyboard behaviour. _Enforced by_ CHK-LINT-TS (`jsx-a11y/*`), CHK-UNIT-A11Y, CHK-VISUAL (page-level axe).

### DR-09 — New patterns go into the package first

If a screen needs a visual pattern that does not exist here, it MUST be added to `@cdevi/design-system` (component + test + gallery entry + row in §3 + CHANGELOG line) **before** any application consumes it. A `cd-` class that the package does not define MUST NOT appear in application code. _Enforced by_ CHK-CLASS-PREFIX; the plan template's "Design System Compliance" section records proposed components.

### DR-10 — Versioning is semantic and changelogged

Tokens, CSS variable names, `cd-` class names, component names and props are the public API. Additive changes bump **minor**; renaming or removing any of them bumps **major** and carries a migration note in `CHANGELOG.md`. Changing a token _value_ is minor and MUST be described as a visual change; visual-regression baselines are updated in the same commit.

## 3. Component catalogue and accessibility contracts

Every component: forwards `className` and unknown props to its root; forwards `ref`; renders only `cd-` classes defined in `css/components.css`; has a gallery entry in both themes and a test that runs axe and the keyboard behaviour below. **H** hover, **A** active, **F** focus-visible, **S** selected/current, **D** disabled, **L** loading, **E** empty, **X** error.

| Component                                      | Renders                                                               | Use for                                                                                           | States    | Keyboard / ARIA                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `ThemeProvider` / `useTheme`                   | sets `data-theme`                                                     | light / dark / system                                                                             | —         | —                                                                                                            |
| `AppShell` (`variant="full"\|"framed"`)        | `.cd-root.cd-app` grid                                                | page layout; `full` fills viewport, collapses to icon rail (<1200px) then top bar + menu (<768px) | —         | landmarks from children; menu toggle `aria-expanded`/`aria-controls`                                         |
| `Side`, `Brand`, `NavGroup`, `NavItem`, `Nav`  | `<aside aria-label="Primary">` + `<nav>`                              | primary navigation                                                                                | H F S     | `NavItem` is `<a>`; active → `aria-current="page"`; `count` → `aria-label="n pending"`; wordmark `lang="si"` |
| `Main`, `Panel`, `PanelBlock`                  | `<main>`, `<aside aria-label="Details">`, `<section aria-labelledby>` | content and right rail                                                                            | —         | headings label blocks                                                                                        |
| `Topbar`, `Crumbs`, `PageMeta`, `ActionBar`    | `<h1>` row; `<nav aria-label="Breadcrumb"><ol>`; `<ul>`; actions row  | page header, path, metadata line, end-of-form actions                                             | H F       | last crumb `aria-current="page"`; `ActionBar help` explains disabled primaries                               |
| `Button`                                       | `<button type="button">` or `<a>`                                     | actions; `saffron` only per DR-02                                                                 | H A F D L | Enter/Space; `aria-busy` when loading; disabled links `aria-disabled` + no `href`                            |
| `Pill`, `StatePill`                            | `<span>`                                                              | any state word (DR-01)                                                                            | —         | text is the name; dot `aria-hidden`                                                                          |
| `RiskBadge`                                    | `<span>`                                                              | LOW/MEDIUM/HIGH/CRITICAL                                                                          | —         | word ends in "risk"                                                                                          |
| `RuntimeGlyph`, `KeyFingerprint`, `Mono`       | `<span>`, `<code>`                                                    | runtime, credential tail, identifiers                                                             | —         | svg `aria-hidden` + visible label; key → `aria-label="key ending in …"`                                      |
| `Card`, `List`, `ListRow`                      | `div`, `role=list`, `role=listitem`                                   | surfaces and row lists                                                                            | H F E     | gate row `aria-describedby` its `ask`; title is `<a>` when `href`                                            |
| `Tabs`, `Tab`, `TabPanel`                      | `role=tablist/tab/tabpanel`                                           | switching views                                                                                   | H F S D   | ←/→ Home/End roving focus; `aria-selected`, `aria-controls`; panel focusable                                 |
| `KeyValue`, `Table`, `Stat`, `StatGrid`        | `<dl>`, `<table>` with caption, `<p>`                                 | facts, data, numbers                                                                              | E         | `scope="col"`; caption may be visually hidden                                                                |
| `Meter`, `Bars`                                | `role=meter`, `role=img`                                              | budgets, tiny charts                                                                              | —         | `aria-valuenow/min/max`, `aria-label`; sizes via `--cd-meter-value` / `--cd-bar-value`                       |
| `Field`, `Input`, `TextArea`, `Select`, `Help` | label + control row                                                   | forms                                                                                             | H F D X   | `htmlFor`, `aria-describedby` (help/error), `aria-invalid`, error `role=alert`                               |
| `Segmented`                                    | `role=radiogroup` of `role=radio` buttons                             | mutually exclusive choice                                                                         | H F S D   | ←/→ ↑/↓ move and select; `aria-checked`                                                                      |
| `Chip`, `Chips`                                | `<button aria-pressed>` or `<span>`                                   | toggles / tags                                                                                    | H F S D   | Enter/Space toggle                                                                                           |
| `OptionRow`                                    | `<label>` wrapping `<input type="radio">`                             | answers to a clarification                                                                        | H F S D   | native radio keys; `recommended` marker                                                                      |
| `Message`                                      | `<article aria-label="who, when">`                                    | agent / user prose; `summary` = not evidence (DR-03)                                              | —         | —                                                                                                            |
| `ToolLog`, `ToolLine`                          | `<pre aria-label>`                                                    | compact tool activity                                                                             | —         | —                                                                                                            |
| `DecisionCard`                                 | `<section aria-labelledby>`                                           | approval or clarification in the flow                                                             | —         | `tone="needs-you"` saffron, `neutral` otherwise                                                              |
| `GateCheck`, `GateList`                        | row with `role=img` box or `<input type="checkbox">`                  | evidence (DR-03), overrides (DR-04), acceptance criteria                                          | H F S D   | box name = passed / waiting / failed / overridden / not yet checked; Space toggles when `onToggle`           |
| `Diff`, `DiffFile`, `DiffLine`                 | `<pre aria-label>`                                                    | code changes                                                                                      | —         | `+`/`-` in text                                                                                              |
| `Stepper`, `Step`                              | `<ol>`                                                                | stage progress                                                                                    | S         | `aria-current="step"`; done steps have hidden "(done)"                                                       |
| `Terminal`, `TermLine`                         | `<pre aria-label>`                                                    | CLI output                                                                                        | —         | glyphs are text                                                                                              |
| `FindingRow`                                   | `<article aria-labelledby>`                                           | review finding: severity, blocking, lane, impact, evidence, fix, actions                          | H F       | severity/blocking are `Pill` words                                                                           |
| `AuditTable`, `AuditRow`                       | `Table` / `<tr>`                                                      | audit events: time, actor, action, target, workflow, policy, risk, result                         | —         | risk is a `RiskBadge`                                                                                        |

## 4. Workflow states and risk levels

Source: `specs/001-sdlc-control-plane-mvp/spec.md` FR-002/FR-026 · Contract: `specs/002-adopt-design-system/contracts/state-risk-mapping.md` · Code: `src/tokens.ts` (`stateToPill`, `riskToVariant`).

| Workflow state      | `StatePill` variant          | Word      | Pulse | Prominent              |
| ------------------- | ---------------------------- | --------- | ----- | ---------------------- |
| `QUEUED`            | neutral                      | queued    | no    |                        |
| `RUNNING`           | run                          | running   | yes   |                        |
| `RETRYING`          | run                          | retrying  | yes   |                        |
| `WAITING`           | wait                         | waiting   | no    |                        |
| `WAITING_FOR_HUMAN` | needs-you                    | needs you | no    | **yes — never hidden** |
| `BLOCKED`           | blocked (red border + glyph) | blocked   | no    | **yes — never hidden** |
| `FAILED`            | fail                         | failed    | no    |                        |
| `COMPLETED`         | done                         | completed | no    |                        |
| `CANCELLED`         | neutral, struck through      | cancelled | no    |                        |

| Risk level | `RiskBadge`                                       | Word          | Prominent                     |
| ---------- | ------------------------------------------------- | ------------- | ----------------------------- |
| `LOW`      | canvas / ink-2                                    | low risk      |                               |
| `MEDIUM`   | indigo-soft / indigo                              | medium risk   |                               |
| `HIGH`     | saffron-soft / saffron-ink, bold                  | high risk     | **yes**                       |
| `CRITICAL` | saffron-strong fill, white text, red border, bold | critical risk | **yes** (not the failed look) |

Requirement lifecycle: `Needs Clarification` → needs-you; `Analyzing` / `In Implementation` → run; `Approved` / `Completed` → done; `Rejected` → fail; `Draft` / `Ready` → neutral.
Finding severity: CRITICAL → blocked, HIGH → fail, MEDIUM → wait, LOW/INFO → neutral. Blocking class: BLOCKING → needs-you, otherwise neutral.
Policy outcome (agent decision): allowed → done "allowed"; approval required → needs-you "approval required"; denied → blocked "denied".

## 5. Glossary — specs/001 concept → component

| Concept                     | Component(s)                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Approval request            | `DecisionCard tone="needs-you"` + one `Button variant="saffron"`                                       |
| Clarification question      | `DecisionCard` + `OptionRow`s (or `Input`) + `Button` "Answer"                                         |
| Platform evidence / gate    | `GateList` → `GateCheck` with `source`                                                                 |
| Human override              | `GateCheck state="override"`                                                                           |
| Agent claim / transcript    | `Message` (`agent` / `user`); summary → `variant="summary"`                                            |
| Agent tool activity         | `ToolLog`                                                                                              |
| Agent decision              | `Card` + `KeyValue` (action, reason, confidence) + `Pill` for policy outcome + `GateList` for evidence |
| Artifact                    | `ListRow` in a `List`, or `KeyValue` in a `PanelBlock`                                                 |
| Workflow / stage state      | `StatePill`                                                                                            |
| Stage pipeline              | `Stepper`                                                                                              |
| Risk level                  | `RiskBadge`                                                                                            |
| Review finding              | `FindingRow`                                                                                           |
| Audit event                 | `AuditTable` / `AuditRow`                                                                              |
| Dashboard numbers           | `StatGrid` → `Stat`                                                                                    |
| Pending count in navigation | `NavItem count`                                                                                        |

## 6. Dynamic values — the only allow-listed mechanism

Components that need a runtime dimension expose a prop and set a `--cd-*` custom property on their own element: `Meter` → `--cd-meter-value`, `Bars` → `--cd-bar-value`. Application code MUST use those props, never `style`. If you need a new dynamic value, add a prop + custom property to a component in this package (§8) and list it here.

## 7. Third-party widgets

Wrap the widget in a component inside this package; theme it through tokens; put `// cd-classes-ignore-file` at the top of the wrapper so its internal classes are exempt from CHK-CLASS-PREFIX. It is **not** exempt from axe or visual regression. Record the wrapper in the CHANGELOG.

## 8. Adding or changing a component

1. Add/adjust CSS in `css/components.css` using tokens only; add any new fg/bg pair to `tokens/pairs.json`.
2. Add the React component under `src/components/<Group>/`, export it from `src/index.ts`, and write `<Name>.test.tsx` (behaviour + `expectAccessible`).
3. Add a gallery entry in `gallery/entries.tsx` (both themes render automatically) and its name to `tests/visual/entries.ts`.
4. Add a row to §3 (and §4/§5 if it carries vocabulary) and the component to `specs/002-adopt-design-system/contracts/components.md`.
5. Add a CHANGELOG line and bump the version per DR-10.
6. Run `pnpm check`, then `pnpm test:visual -- --update-snapshots` and review the new baselines.

## 9. Themes and motion

Light is default; dark follows `prefers-color-scheme` unless `data-theme` is set (`ThemeProvider`). Every token has a dark value where it differs. `prefers-reduced-motion` disables the running pulse and all transitions. Fonts are self-hosted (`css/fonts.css`); no third-party requests.

## 10. Enforcement

| Check                        | Command                             | Guards                                                                    |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| CHK-TOKENS-DRIFT             | `pnpm check:tokens`                 | generated files match `tokens.json`; schema; every CSS var has a token    |
| CHK-CONTRAST                 | `pnpm check:contrast`               | every pair in `pairs.json` ≥ 4.5:1 (3:1 large/boundary) in both themes    |
| CHK-LINT-TS                  | `pnpm lint`                         | DR-07, DR-08 (`react/forbid-dom-props`, `jsx-a11y/*`)                     |
| CHK-LINT-CSS                 | `pnpm lint:css`                     | DR-06 (`declaration-strict-value`, shorthand expanded)                    |
| CHK-CLASS-PREFIX             | `pnpm check:classes`                | DR-09 (undefined `cd-` classes)                                           |
| CHK-UNIT-A11Y + CHK-FIXTURES | `pnpm test`                         | component axe + keyboard; fixtures in `tools/lint-fixtures` still fail    |
| CHK-SIZE                     | `pnpm check:size`                   | `cdevi.css` ≤ 40 KB, fonts ≤ 200 KB                                       |
| CHK-VISUAL                   | `pnpm test:visual`                  | page-level axe + screenshots for gallery and reference screens; LCP ≤ 2 s |
| all of the above             | `pnpm check` (+ `pnpm test:visual`) | required CI jobs `lint`, `unit`, `build`, `visual`                        |
