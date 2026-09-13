# Contract: Workflow state and risk level → design-system treatment

**Feature**: 002-adopt-design-system | Source of vocabulary: `specs/001-sdlc-control-plane-mvp/spec.md` FR-002, FR-026

This table is normative. `src/tokens.ts` implements it; `mapping.test.ts` asserts it; `DESIGN.md` §4 reproduces it; `.devin/skills/cdevi-design-system/SKILL.md` quotes it. Any change here is a change in all five places in one commit.

## Workflow states (FR-002 of specs/001)

| State | `Pill` variant | Class set | Word | Pulse | Semantic token | Must be prominent? |
|-------|----------------|-----------|------|-------|----------------|--------------------|
| `QUEUED` | `neutral` | `cd-pill cd-neutral` | queued | no | `semantic.state.queued` → `color.ink-2` | no |
| `RUNNING` | `run` | `cd-pill cd-run` | running | yes | `semantic.state.running` → `color.indigo` | no |
| `RETRYING` | `run` | `cd-pill cd-run` | retrying | yes | `semantic.state.retrying` → `color.indigo` | no |
| `WAITING` | `wait` | `cd-pill cd-wait` | waiting | no | `semantic.state.waiting` → `color.saffron-ink` | no |
| `WAITING_FOR_HUMAN` | `needs-you` | `cd-pill cd-needs-you` | needs you | no | `semantic.state.waiting-for-human` → `color.saffron` | **yes** — never hidden (specs/001 FR-005) |
| `BLOCKED` | `blocked` | `cd-pill cd-blocked` | blocked | no | `semantic.state.blocked` → `color.red` | **yes** — never hidden (specs/001 FR-005) |
| `FAILED` | `fail` | `cd-pill cd-fail` | failed | no | `semantic.state.failed` → `color.red` | no |
| `COMPLETED` | `done` | `cd-pill cd-done` | completed | no | `semantic.state.completed` → `color.green` | no |
| `CANCELLED` | `neutral` | `cd-pill cd-neutral cd-cancelled` | cancelled | no | `semantic.state.cancelled` → `color.ink-3` | no |

Visual distinctions required by tests:
- `blocked` ≠ `fail`: `blocked` adds `border-color: var(--red)` and a leading glyph (`aria-hidden`); `fail` has no border.
- `needs-you` ≠ `wait`: `needs-you` uses `background: var(--saffron); color: #fff; font-weight: 700`; `wait` keeps `saffron-soft`/`saffron-ink`.
- Reduced motion disables the `run` pulse.

Requirement/other lifecycles (`Draft`, `Analyzing`, `Needs Clarification`, `Ready`, `Approved`, `In Implementation`, `Completed`, `Rejected`) reuse: `Needs Clarification` → `needs-you`; `Analyzing`/`In Implementation` → `run`; `Approved`/`Completed` → `done`; `Rejected` → `fail`; `Draft`/`Ready` → `neutral`. Recorded in `DESIGN.md` glossary; not enforced by test beyond type coverage.

## Risk levels (FR-026 of specs/001)

| Level | `RiskBadge` class set | Treatment | Word | Semantic token | Prominent? |
|-------|-----------------------|-----------|------|----------------|------------|
| `LOW` | `cd-risk cd-risk-low` | canvas bg, ink-2 text, line border | low risk | `semantic.risk.low` → `color.ink-2` | no |
| `MEDIUM` | `cd-risk cd-risk-medium` | indigo-soft bg, indigo text | medium risk | `semantic.risk.medium` → `color.indigo` | no |
| `HIGH` | `cd-risk cd-risk-high` | saffron-soft bg, saffron-ink text, weight 700 | high risk | `semantic.risk.high` → `color.saffron-ink` | **yes** |
| `CRITICAL` | `cd-risk cd-risk-critical` | saffron-strong bg, white text, 1px red border, weight 700 | critical risk | `semantic.risk.critical` → `color.saffron-strong` | **yes** |

Distinctions required by tests:
- `CRITICAL` class set ∩ {`cd-fail`, `cd-blocked`} = ∅ and its computed background is not `red-soft` (so it is not read as "failed").
- `HIGH`/`CRITICAL` use weight 700; `LOW`/`MEDIUM` use 600.
- Every badge's accessible name ends with the word "risk".

## Review finding vocabulary (specs/001 FR-020)

| Severity | Pill variant | Blocking class | Pill variant |
|----------|--------------|----------------|--------------|
| `CRITICAL` | `blocked` (red border) | `BLOCKING` | `needs-you` |
| `HIGH` | `fail` | `NON-BLOCKING` | `neutral` |
| `MEDIUM` | `wait` | `SUGGESTION` | `neutral` |
| `LOW` | `neutral` | | |
| `INFO` | `neutral` | | |

## Evidence / gate vocabulary (specs/001 FR-017, US5)

| Concept | Component | Rule |
|---------|-----------|------|
| Platform evidence (test passed, CI passed, secret scan) | `GateCheck` with `source` | `state="ok"` green |
| Human override of a gate | `GateCheck state="override"` | saffron, never green (DR-04) |
| Agent claim / summary | `Message variant="summary"` | dashed border, heading "Summary from the agent — not evidence" |
| Approval request | `DecisionCard tone="needs-you"` with `Button variant="saffron"` primary | one saffron button per screen (DR-02) |
| Clarification question | `DecisionCard` + `OptionRow`s + `Button` "Answer" | |
| Agent decision (specs/001 FR-017) | `Card` with `KeyValue` (action, reason, confidence, policy) + `GateList` for evidence | policy outcome shown as `Pill`: allowed→`done`, approval required→`needs-you`, denied→`blocked` |
