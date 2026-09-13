# Evidence: agent conformance trials (US1, SC-001)

**Pass criterion**: an agent given only the task (no mention of the design system) produces code that passes `pnpm check` on the first run in ≥ 4 of 5 trials.

**Setup**: `apps/web-scratch` (Vite + React, depends on `@cdevi/design-system`). Before each trial `apps/web-scratch/src/App.tsx` is reset to an empty component and any `ApprovalCenter.tsx` is deleted. The agent is a fresh subagent with write access to the repository and no conversation history; it sees only the prompt below plus whatever it chooses to read in the repository (`AGENTS.md`, `.devin/skills/…`, `DESIGN.md`).

**Verification**: `pnpm check` at the repo root (lint incl. DR-06/07/08 rules, typecheck, `cd-` class scan, unit tests, size) on the agent's untouched output. Manual review notes which DR rules the output honours.

## Prompt template

> Implement the Approval Center list from `specs/001-sdlc-control-plane-mvp/spec.md` (User Story 2, acceptance scenario 1) as a React component at `apps/web-scratch/src/ApprovalCenter.tsx`, rendered from `apps/web-scratch/src/App.tsx`, using hard-coded sample data (three pending items: a requirement approval, a PR merge approval with MEDIUM risk, and an agent clarification question). Show for each item: identifier, what is being requested, requester, when, and risk level, ordered highest risk first then oldest first. Do not add dependencies. Do not run tests or commit; just write the code.

## Trials

| # | Prompt variation | Read AGENTS.md / skill / DESIGN.md? | `pnpm check` first run | Violations | Notes |
|---|------------------|-------------------------------------|------------------------|------------|-------|
| 1 | template verbatim | yes — AGENTS.md → SKILL.md → DESIGN.md, then component sources and gallery | **pass** (lint, typecheck, classes, 169 tests, size) | none | `AppShell`/`Side`/`Main`/`Topbar`/`PageMeta`/`List`/`ListRow` + `RiskBadge`; exported pure `sortPendingItems()`; `<time dateTime>`; no buttons (noted DR-02) |
| 2 | "…as a page component…" + "make it look good" | yes (same path; also read eslint config, css grid rules) | **pass** | none | Full page incl. right `Panel` with `StatGrid`; one saffron button ("Review highest risk"); kind shown as neutral `Pill` to keep saffron reserved |
| 3 | "…quickly, minimal code…" | yes | **pass** | none | Minimal `List`/`ListRow` inside shell; `StatePill WAITING_FOR_HUMAN` trailing; ordering via `RISK_LEVELS.indexOf` |
| 4 | "…Review button per item, Approve/Reject pair on PR item…" | yes | **pass** | none | Chose `DecisionCard` (glossary §5) because `ListRow` has no action slot — explicitly declined to add local styling (DR-09); exactly one saffron Approve; Reject = `danger`; avoided `Date.now()` default after `react-hooks/purity` lint |
| 5 | "…header with pending count as big number + approvals/clarifications counts…" | yes | **pass** | none | `StatGrid columns={3}`/`Stat`; `Pill` + `RiskBadge` in `trailing` exposed a layout gap (two trailing items landed in separate grid cells) — fixed in the package as `.cd-trailing` (CHANGELOG 1.1.0) |

## Result

**5 / 5 trials passed `pnpm check` on the first run** (criterion: ≥ 4/5). Every agent read `AGENTS.md`, then the auto-loaded skill, then `DESIGN.md`, without being told the design system existed. Sources saved as `trial-N/*.tsx.txt`.

Observations fed back into the package:
- `ListRow trailing` with two elements broke the row grid → wrapped in `.cd-trailing` (flex). Visual baseline for the `List` gallery entry updated intentionally.
- Two agents hit `react-hooks/purity` on a `Date.now()` default parameter and adapted; not a design-system issue.
- Agents differed on whether the list screen should carry a saffron primary action (trials 1/3/5: none; 2/4: one). Both satisfy DR-02; the plan for specs/001 US2 should decide which.
- No agent hand-wrote `cd-` markup, used `style=`, or introduced a literal colour.

`apps/web-scratch` is kept as the conformance-trial target for future design-system changes (decision recorded here per T081); it is a private workspace package and not a product app.
