# Data Model: Adopt the CDevi Design System

**Feature**: 002-adopt-design-system | **Date**: 2026-09-11

There is no runtime database. The "data" are repository artifacts with schemas and invariants that tests enforce. Each entity lists its fields, rules, and the check that guards it (see [contracts/checks.md](contracts/checks.md)).

## 1. Design Token (`tokens/tokens.json`)

Source of truth. DTCG format with a CDevi dark-mode extension.

| Field | Type | Rules |
|-------|------|-------|
| path | dotted string (`color.saffron`, `space.4`, `semantic.state.blocked`) | Unique; lowercase kebab segments |
| `$type` | `color` \| `fontFamily` \| `dimension` \| `shadow` | Required on leaf tokens except references |
| `$value` | string / string[] / `{token.path}` reference | References must resolve to a leaf of the same `$type` |
| `$extensions["cdevi.dark"]` | same shape as `$value` | Optional; only for `color`; when absent, dark value = light value |
| `$extensions["cdevi.cssVar"]` | string | Optional override of the generated CSS variable name (used for `--r`, `--r-lg`, `--ui`, `--mono`, `--sinhala`) |
| `$description` | string | Required for every `semantic.*` token (states intended meaning) |

**Derived names**: CSS variable = `--` + path segments after the group joined with `-` (e.g. `color.saffron-soft` → `--saffron-soft`; `space.4` → `--space-4`; `text.2xl` → `--text-2xl`) unless `cdevi.cssVar` overrides. Tailwind key = same segments as nested object.

**Invariants** (guarded by `tokens.schema.json` + `tokens.test.ts`):
- Every token present in `css/tokens.css` today exists in the source (no stylesheet-only tokens).
- Generated `tokens.css` and `tailwind/preset.js` are byte-identical to a fresh build (drift check).
- Every `semantic.state.*` (9) and `semantic.risk.*` (4) exists and references a `color.*` leaf.

## 2. Contrast Pair (`tokens/pairs.json`)

| Field | Type | Rules |
|-------|------|-------|
| `fg` | token path | Must be a `color` token |
| `bg` | token path | Must be a `color` token |
| `where` | string | Component/selector using the pair |
| `large` | boolean (default false) | `true` only when text ≥ 24px or ≥ 18.66px bold, or the pair is a UI boundary (3:1 threshold) |

**Invariant**: for both themes, contrast(fg, bg) ≥ 4.5 (or ≥ 3.0 when `large`). Guarded by `contrast.test.ts`.

## 3. Component (`src/components/<Name>/`)

| Field | Type | Rules |
|-------|------|-------|
| name | PascalCase | Exported from `src/index.ts` |
| rendered classes | `cd-*` from `components.css` | Every class the component emits must exist in the CSS (guarded by class-prefix check run over `src/`) |
| props | typed interface | `className` and `...rest` forwarded to the root element; no `style` prop except through documented custom-property props |
| states | subset of {default, hover, active, focus-visible, selected/current, disabled, loading, empty, error} | Declared in `contracts/components.md`; interactive components must declare hover, active, focus-visible, disabled |
| a11y contract | role, name source, keyboard behaviour, ARIA states | Declared in `contracts/components.md` and `DESIGN.md`; verified by `<Name>.test.tsx` (axe + keyboard) |
| gallery entry | `gallery/entries/<Name>.tsx` | Required; renders every variant in light and dark; included in visual + axe Playwright runs |
| changelog | line in `CHANGELOG.md` | Required for add/change/remove |

**Relationships**: Component → uses Tokens (via CSS); Component → has 1 Gallery Entry; Component → 0..n Variants; `Pill` and `RiskBadge` → consume State Mapping.

## 4. State Mapping (`src/tokens.ts`, mirrored in `contracts/state-risk-mapping.md`)

```
WorkflowState = QUEUED | RUNNING | WAITING | WAITING_FOR_HUMAN | BLOCKED | FAILED | RETRYING | COMPLETED | CANCELLED
PillVariant   = neutral | run | wait | needs-you | blocked | fail | done
RiskLevel     = LOW | MEDIUM | HIGH | CRITICAL
RiskVariant   = low | medium | high | critical
```

| WorkflowState | PillVariant | Word shown | Prominence |
|---------------|-------------|------------|------------|
| QUEUED | neutral | queued | low |
| RUNNING | run (pulsing dot) | running | medium |
| RETRYING | run (pulsing dot) | retrying | medium |
| WAITING | wait | waiting | medium |
| WAITING_FOR_HUMAN | needs-you (saffron fill, saffron-ink text, bold) | needs you | **highest** |
| BLOCKED | blocked (red-soft bg, red text, red border, "⛔" glyph aria-hidden) | blocked | **highest** |
| FAILED | fail (red-soft bg, red text, no border) | failed | high |
| COMPLETED | done | completed | low |
| CANCELLED | neutral (strikethrough word) | cancelled | low |

| RiskLevel | RiskVariant | Treatment |
|-----------|-------------|-----------|
| LOW | low | neutral pill, word "low risk" |
| MEDIUM | medium | indigo-soft/indigo, word "medium risk" |
| HIGH | high | saffron-soft/saffron-ink, bold, word "high risk" |
| CRITICAL | critical | saffron fill, white text, red 1px border, bold, word "critical risk" — distinguishable from `fail` (no fill) and `blocked` (red-soft) |

**Invariants** (guarded by `mapping.test.ts`): total function over all 9 states and 4 levels; `BLOCKED` ≠ `FAILED` variant; `WAITING_FOR_HUMAN` uses the needs-you treatment; `CRITICAL` class set ≠ `fail` class set; every rendered word is non-empty and is the accessible name.

## 5. Design Rule (`DESIGN.md`)

| Field | Rules |
|-------|-------|
| id | `DR-nn` |
| statement | MUST / MUST NOT phrasing |
| example | do / don't snippet for the five core rules (DR-01..05) |
| enforced by | check id from `contracts/checks.md`, or "review" |

Core rules: DR-01 state is a word in a pill; DR-02 saffron only for needs-a-person + one primary action per screen; DR-03 agent claims (`Message`) separate from evidence (`GateCheck` + source); DR-04 overrides never green; DR-05 no sticky headers. Additional: DR-06 tokens only; DR-07 no inline styles except custom-property props; DR-08 semantic interactive elements; DR-09 new pattern → package first; DR-10 versioning.

## 6. Design-System Check (`contracts/checks.md`)

| Field | Rules |
|-------|-------|
| id | `CHK-*` |
| command | root `pnpm` script |
| scope | glob(s) it applies to |
| failure message | must name rule + alternative (FR-026) |
| CI job | name in `.github/workflows/ci.yml`; all required |

## 7. Lint Fixture (`tools/lint-fixtures/`)

One file per violation category; `fixtures.test.ts` runs ESLint/Stylelint/class-prefix programmatically and asserts each file produces ≥1 error of the expected rule id. Fixtures are excluded from the normal `pnpm lint` (they are supposed to fail) via a separate config entry.

| File | Expected rule |
|------|---------------|
| `raw-color.css` | `scale-unlimited/declaration-strict-value` |
| `inline-style.tsx` | `react/forbid-dom-props` |
| `div-onclick.tsx` | `jsx-a11y/no-static-element-interactions` + `click-events-have-key-events` |
| `icon-no-label.tsx` | `jsx-a11y/control-has-associated-label` |
| `unknown-cd-class.tsx` | class-prefix check |
| `drift/` (generated by test) | token drift check |
| `bad-pair` (generated by test) | contrast check |

## 8. Version & Changelog Entry

| Version | Contents |
|---------|----------|
| 1.0.1 | Fix: `table.cd-cd-table` → `table.cd-table` |
| 1.1.0 | Add: React components, self-hosted fonts, `blocked` pill, `RiskBadge`, `FindingRow`, `AuditRow`, `ActionBar`, `PageMeta`, `StatGrid`, `AppShell` full variant, `ThemeProvider`, semantic state/risk tokens, `saffron-strong`; Change: `ink-3`, `green` values for AA contrast (visual change, not API change); Deprecate: static `docs/index.html` gallery (removed) |

Rule: additive → minor; rename/remove of a token or class → major + migration note.

## Relationships overview

```
tokens.json ──build──▶ tokens.css ──concat──▶ cdevi.css ◀── fonts.css, base.css, components.css
     │                        └──────▶ tailwind/preset.js
     ├── pairs.json ──▶ contrast check
     └── semantic.state/risk ──▶ src/tokens.ts mapping ──▶ Pill / RiskBadge
components.css ──defines──▶ cd-* classes ──used by──▶ src/components/* ──shown in──▶ gallery/entries/*
                                    └──guards──▶ check-class-prefix (apps/**, fixtures)
DESIGN.md ◀── constitution 1.1.0, plan/tasks templates, AGENTS.md, SKILL.md (all point here)
```
