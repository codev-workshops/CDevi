# Contract: `@cdevi/design-system` public React API

**Feature**: 002-adopt-design-system | **Version**: 1.1.0

Every component: is exported from `src/index.ts`; forwards `className` and unknown props to its root element; forwards `ref` to the root DOM node when one exists; renders only `cd-*` classes defined in `css/components.css`; has a gallery entry showing every variant in light and dark; has `<Name>.test.tsx` running axe and the keyboard behaviour listed below. `style` is **not** an accepted prop anywhere; the only dynamic values are the custom-property props listed for `Meter`, `Bars`, `Stepper`.

States legend: **H** hover, **A** active, **F** focus-visible, **S** selected/current, **D** disabled, **L** loading, **E** empty, **X** error.

## Shell

| Component | Root / role | Key props | States | Keyboard | ARIA |
|-----------|-------------|-----------|--------|----------|------|
| `ThemeProvider` | none (sets `data-theme` on `<html>` or given element) | `theme: 'light' \| 'dark' \| 'system'`, `target?` | — | — | — |
| `AppShell` | `<div class="cd-root cd-app">` | `variant: 'framed' \| 'full'` (default `full`), `side`, `panel?`, `children` | — | — | landmark roles supplied by children |
| `Side` | `<aside class="cd-side">` | `brand`, `children`, `footer?` | — | — | `aria-label="Primary"` |
| `Brand` | `<div class="cd-brand">` | `mark`, `name`, `wordmark?` | — | — | wordmark `lang="si"` |
| `Nav` / `NavGroup` / `NavItem` | `<nav>` / `<div class="cd-grp">` / `<a class="cd-nav-item">` | `NavItem`: `href`, `active?`, `count?`, `icon?` | H F S | Tab, Enter | `aria-current="page"` when active; count has `aria-label="n pending"` |
| `Main` | `<main class="cd-main">` | — | — | — | — |
| `Panel` / `PanelBlock` | `<aside class="cd-panel">` / `<section class="cd-blk">` | `PanelBlock.title` | — | — | `aria-labelledby` heading |
| `Topbar` | `<div class="cd-topbar">` | `title`, `actions?` | — | — | `<h1>` |
| `Crumbs` | `<nav class="cd-crumbs">` | `items: {label, href?}[]` | H F | Tab | `aria-label="Breadcrumb"`, last item `aria-current="page"` |
| `PageMeta` | `<div class="cd-page-meta">` | `children` (inline items separated by `·`) | — | — | `<ul role="list">` with visually hidden separators |
| `ActionBar` | `<div class="cd-actions">` | `align: 'start' \| 'end'`, `help?` | — | — | — |

## Primitives

| Component | Root / role | Key props | States | Keyboard | ARIA |
|-----------|-------------|-----------|--------|----------|------|
| `Button` | `<button type="button">` or `<a>` when `href` | `variant: 'primary' \| 'saffron' \| 'ghost' \| 'danger'`, `size: 'md' \| 'sm'`, `disabled`, `loading` | H A F D L | Enter/Space | `aria-disabled` on link variant; `aria-busy` when loading |
| `Pill` | `<span class="cd-pill">` | `variant: PillVariant`, `pulse?` (only `run`), `children` | — | — | text is the name; dot `aria-hidden` |
| `StatePill` | `Pill` | `state: WorkflowState` (maps via `stateToPill`) | — | — | word from mapping |
| `RiskBadge` | `<span class="cd-risk">` | `level: RiskLevel` | — | — | word "`<level> risk`" |
| `RuntimeGlyph` | `<span class="cd-rt">` | `kind: 'cloud' \| 'laptop'`, `label?` | — | — | svg `aria-hidden`, text label required |
| `KeyFingerprint` | `<code class="cd-key">` | `children` | — | — | `aria-label="key ending in …"` |
| `Mono` | `<code class="cd-mono">` | — | — | — | — |

## Containers and lists

| Component | Root / role | Key props | States | Keyboard | ARIA |
|-----------|-------------|-----------|--------|----------|------|
| `Card` | `<div class="cd-card">` | `as?` | — | — | — |
| `List` | `<div class="cd-list" role="list">` | `empty?: ReactNode` | E | — | — |
| `ListRow` | `<div class="cd-row" role="listitem">` | `title`, `trailing?`, `ask?`, `meta?`, `gate?`, `href?` | H F | Tab (when `href`) | `gate` rows add `aria-describedby` ask |
| `Tabs` / `Tab` / `TabPanel` | `<div role="tablist">` / `<button role="tab">` / `<div role="tabpanel">` | `Tabs.value`, `onChange`; `Tab.value`, `count?` | H F S D | ←/→ Home/End roving focus; Enter/Space | `aria-selected`, `aria-controls`, `tabIndex` roving |
| `KeyValue` | `<dl class="cd-kv">` | `items: {term, detail}[]` | — | — | — |
| `Table` | `<table class="cd-table">` | `caption`, `columns`, `rows` | E | — | `<caption>` (visually hidden allowed), `scope="col"` |
| `Stat` / `StatGrid` | `<div class="cd-stat">` / `<div class="cd-stat-grid">` | `value`, `label`; `columns: 2 \| 3 \| 4` | — | — | value/label grouped in one `<p>` |
| `Meter` | `<div role="meter" class="cd-meter">` | `value`, `max`, `label`, `warn?` | — | — | `aria-valuenow/min/max`, `aria-label`; width via `--cd-meter-value` |
| `Bars` | `<div class="cd-bars" role="img">` | `values: {value, local?}[]`, `label` | — | — | `aria-label` summarises; each bar height via `--cd-bar-value` |

## Forms

| Component | Root / role | Key props | States | Keyboard | ARIA |
|-----------|-------------|-----------|--------|----------|------|
| `Field` | `<div class="cd-field">` | `label`, `hint?`, `help?`, `error?`, `htmlFor` | X | — | `aria-describedby` hint/help/error |
| `Input` / `TextArea` / `Select` | native inputs with `cd-input` | `invalid?` | H F D X | native | `aria-invalid` |
| `Segmented` | `<div role="radiogroup" class="cd-seg">` | `options`, `value`, `onChange`, `label` | H F S D | ←/→ move & select | `<button role="radio" aria-checked>` |
| `Chip` / `Chips` | `<button aria-pressed>` (selectable) or `<span>` | `selected?`, `onToggle?` | H F S D | Enter/Space | `aria-pressed` |
| `OptionRow` | `<label class="cd-opt">` wrapping `<input type="radio">` | `name`, `value`, `checked`, `recommended?` | H F S D | native radio | visually-hidden input, visible faux radio `aria-hidden` |
| `Help` | `<p class="cd-help">` | — | — | — | — |

## Agent surfaces

| Component | Root / role | Key props | States | Keyboard | ARIA |
|-----------|-------------|-----------|--------|----------|------|
| `Message` | `<article class="cd-msg">` | `who`, `when`, `variant: 'agent' \| 'user' \| 'summary'` (summary = dashed, labelled "not evidence") | — | — | `aria-label="<who>, <when>"` |
| `ToolLog` / `ToolLine` | `<pre class="cd-tools">` / `<span>` | `kind: 'read' \| 'write' \| 'ok' \| 'error' \| 'dim'` | — | — | `aria-label="Tool activity"` |
| `DecisionCard` | `<section class="cd-decision">` | `title`, `badge?`, `description`, `actions`, `tone: 'needs-you' \| 'neutral'` | — | — | `aria-labelledby` title; `role="region"` |
| `GateCheck` / `GateList` | `<div class="cd-check">` | `state: 'pending' \| 'ok' \| 'wait' \| 'bad' \| 'override'`, `label`, `source?`, `onToggle?` | H F S D (when toggleable) | Space (toggle) | box `role="img" aria-label` or `<input type="checkbox">`; `override` never uses green |
| `Diff` / `DiffFile` / `DiffLine` | `<div class="cd-diff">` | `kind: 'add' \| 'del' \| 'ctx'` | — | — | `<pre>`, lines `+`/`-` visible |
| `Stepper` / `Step` | `<ol class="cd-stepper">` | `state: 'done' \| 'current' \| 'todo'`, `title`, `detail?` | S | — | `aria-current="step"` |
| `Terminal` | `<pre class="cd-term">` | `children` with `TermLine kind` | — | — | `aria-label` |
| `FindingRow` | `<article class="cd-finding">` | `severity: CRITICAL..INFO`, `blocking: BLOCKING \| NON-BLOCKING \| SUGGESTION`, `title`, `impact`, `evidence: {label, href}`, `fix`, `actions` | H F | Tab through actions | severity/blocking as words in pills; `aria-labelledby` |
| `AuditRow` | `<div class="cd-audit" role="row">` inside `AuditTable` | `time`, `actor`, `action`, `target`, `workflow`, `policy`, `risk: RiskLevel`, `result` | — | — | grid semantics via `Table` |

## Exports from `src/tokens.ts`

```ts
export type WorkflowState = 'QUEUED' | 'RUNNING' | 'WAITING' | 'WAITING_FOR_HUMAN' | 'BLOCKED' | 'FAILED' | 'RETRYING' | 'COMPLETED' | 'CANCELLED';
export type PillVariant = 'neutral' | 'run' | 'wait' | 'needs-you' | 'blocked' | 'fail' | 'done';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const stateToPill: Record<WorkflowState, { variant: PillVariant; word: string; pulse: boolean }>;
export const riskToVariant: Record<RiskLevel, { variant: Lowercase<RiskLevel>; word: string }>;
export const cssVar: Record<TokenName, `--${string}`>; // generated from tokens.json
```

## Package `exports`

```json
{
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./css": "./css/cdevi.css",
  "./css/tokens": "./css/tokens.css",
  "./css/fonts": "./css/fonts.css",
  "./tokens.json": "./tokens/tokens.json",
  "./tailwind/preset": "./tailwind/preset.js"
}
```

## Versioning contract

- Adding a component, prop, variant or token → minor.
- Renaming/removing any export, prop, `cd-` class or CSS variable → major + `CHANGELOG.md` migration note.
- Changing a token *value* → minor, noted as "visual change" (baselines updated intentionally).
