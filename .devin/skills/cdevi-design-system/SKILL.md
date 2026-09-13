---
name: cdevi-design-system
description: Use when implementing, styling, reviewing or planning ANY user interface in CDevi — screens, pages, components, React/TSX, CSS, Tailwind, layouts, colours, states, pills, badges, forms, tables, dashboards, approval or review views. Loads the normative design rules, component catalogue and the workflow-state / risk-level mappings so the result passes `pnpm check` first time.
---

# CDevi design system — how to build UI here

Read `packages/design-system/DESIGN.md` before writing UI. It is normative; this skill is the short version.

## The five rules you will be checked against

1. **DR-01** State is always a word in a pill → `StatePill` / `Pill`. Never colour or icon alone.
2. **DR-02** Saffron = "a person is needed" and the **one** primary action per screen (`Button variant="saffron"`). Nothing else is saffron.
3. **DR-03** Agent claims (`Message`) and platform evidence (`GateCheck` with `source`) are visually separate. Agent summaries use `Message variant="summary"`.
4. **DR-04** Overrides use `GateCheck state="override"` (saffron). Never green.
5. **DR-05** No sticky/fixed headers; layout is `AppShell` → `Side` / `Main` / `Panel`.

Plus the mechanical ones CI enforces: **DR-06** tokens only (`var(--…)`), **DR-07** no `style={}` (dynamic values via component props / `--cd-*`), **DR-08** real `<button>`/`<a>`/inputs with names and visible focus, **DR-09** any `cd-` class must exist in the package — add the component to the package first, **DR-10** semver + CHANGELOG.

## Import and compose — never hand-write markup

```tsx
import '@cdevi/design-system/css';
import {
  AppShell,
  Side,
  Brand,
  NavItem,
  Main,
  Panel,
  PanelBlock,
  Topbar,
  PageMeta,
  List,
  ListRow,
  StatePill,
  RiskBadge,
  DecisionCard,
  Button,
  GateList,
  GateCheck,
  Message,
  FindingRow,
  AuditTable,
  Tabs,
  Tab,
  TabPanel,
  Field,
  Input,
  Segmented,
  Card,
  KeyValue,
  StatGrid,
  Stat,
  ThemeProvider,
} from '@cdevi/design-system';
```

Catalogue (full contracts in DESIGN.md §3): shell `AppShell Side Brand Nav NavGroup NavItem Main Panel PanelBlock Topbar Crumbs PageMeta ActionBar ThemeProvider` · primitives `Button Pill StatePill RiskBadge RuntimeGlyph KeyFingerprint Mono` · containers `Card List ListRow Tabs Tab TabPanel KeyValue Table Stat StatGrid Meter Bars` · forms `Field Input TextArea Select Segmented Chip Chips OptionRow Help` · agent surfaces `Message ToolLog ToolLine DecisionCard GateCheck GateList Diff DiffFile DiffLine Stepper Step Terminal TermLine FindingRow AuditRow AuditTable`.

## Vocabulary mappings (specs/001 → component)

Workflow states → `<StatePill state=… />` (word shown): `QUEUED` queued · `RUNNING` running · `RETRYING` retrying · `WAITING` waiting · `WAITING_FOR_HUMAN` **needs you** (never hidden) · `BLOCKED` **blocked** (never hidden, ≠ failed) · `FAILED` failed · `COMPLETED` completed · `CANCELLED` cancelled (struck through).

Risk levels → `<RiskBadge level=… />`: `LOW` low risk · `MEDIUM` medium risk · `HIGH` high risk (prominent) · `CRITICAL` critical risk (prominent, saffron-strong + red border — not the failed look).

Approval → `DecisionCard tone="needs-you"` + one saffron `Button`. Clarification → `DecisionCard` + `OptionRow`s. Evidence → `GateList`/`GateCheck` with `source`. Review finding → `FindingRow` (severity CRITICAL/HIGH/MEDIUM/LOW/INFO, blocking BLOCKING/NON-BLOCKING/SUGGESTION). Audit event → `AuditTable`. Policy outcome → `policyOutcomeToPill`. Dashboard numbers → `StatGrid`/`Stat`. Pending counts → `NavItem count`.

## When a pattern is missing

Do **not** style it locally. Follow DESIGN.md §8: CSS (tokens only) → component + test → export → gallery entry (+ `tests/visual/entries.ts`) → DESIGN.md §3 row → CHANGELOG + version bump → then consume it. Record it under "Components proposed" in the plan.

## Before you finish

```bash
pnpm check          # lint (DR-06/07/08), typecheck, cd- class scan, unit + axe, token drift, contrast, size
pnpm test:visual    # page-level axe + screenshots (update baselines only for intentional visual changes)
pnpm -F @cdevi/design-system gallery   # look at it
```

Checklist: every state is a word · exactly one saffron button per screen · no `style=` · no literal colours/px · every clickable is a button/link/input with a name · new pattern landed in the package with gallery + CHANGELOG · `WAITING_FOR_HUMAN`/`BLOCKED` are visible, never collapsed.
