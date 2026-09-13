# Quickstart: Verify the design-system adoption end to end

**Feature**: 002-adopt-design-system. This guide proves the feature works; it does not restate implementation. Contracts: [components.md](contracts/components.md), [state-risk-mapping.md](contracts/state-risk-mapping.md), [checks.md](contracts/checks.md).

## Prerequisites

- Node 26 (`nvm use` reads `.nvmrc`), pnpm 10 (`npm i -g pnpm`)
- `pnpm i` at repo root
- For visual tests once: `pnpm exec playwright install chromium`

## 1. Package imported, repaired, accessible (US3)

```bash
pnpm -F @cdevi/design-system build           # tokens → css → dist; must succeed
pnpm -F @cdevi/design-system gallery         # open the printed URL
```

Expected in the gallery:
- Every component in `contracts/components.md` has an entry; theme toggle switches all of them; no entry references Google Fonts (DevTools Network tab shows only same-origin requests).
- "Table" entry renders styled header/rows (regression for the `cd-cd-table` bug).
- Keyboard walkthrough: Tab reaches every Button/Tab/NavItem/Segmented/Chip/OptionRow; focus ring visible; ←/→ moves within Tabs and Segmented; Space toggles Chips and toggleable GateChecks; Enter activates Buttons.

```bash
pnpm check:contrast    # all pairs in tokens/pairs.json ≥ 4.5 (or 3.0 large) in both themes
```

Red→green evidence for the table bug: `git log -p --follow packages/design-system/src/components/Table/Table.test.tsx` shows the test committed before the CSS fix.

## 2. Tokens are the single source (US4)

```bash
# change a value
sed -i '' 's/"#E39A3B"/"#E39A3C"/' packages/design-system/tokens/tokens.json
pnpm -F @cdevi/design-system build:tokens
git diff --stat            # tokens.css, cdevi.css, tailwind/preset.js all changed; nothing else
pnpm check:tokens          # passes
git checkout -- packages/design-system/css packages/design-system/tailwind
pnpm check:tokens          # FAILS naming --saffron (dark) as drifted
git checkout -- packages/design-system/tokens/tokens.json && pnpm -F @cdevi/design-system build:tokens
```

Also: `node -e "const p=require('./packages/design-system/tailwind/preset.js');console.log(Object.keys(p.theme.colors))"` prints only token colours (no `blue`, `gray`, …) — preset replaces, not extends.

## 3. Vocabulary coverage (US5)

```bash
pnpm -F @cdevi/design-system test -- mapping
```

Expected: tests pass asserting all 9 states and 4 levels map; `BLOCKED` ≠ `FAILED`; `WAITING_FOR_HUMAN` → needs-you; `CRITICAL` not styled as fail. In the gallery, the "StatePill" and "RiskBadge" entries show every value with its word.

## 4. Enforcement blocks violations (US2, SC-002)

```bash
pnpm test -- fixtures
```

Expected: one passing test per fixture in `tools/lint-fixtures/`, each asserting the expected rule fired (raw colour → strict-value; inline style → forbid-dom-props; div onClick → jsx-a11y; icon without label → control-has-associated-label; unknown `cd-` class → class-prefix; drift and bad contrast pairs generated in temp).

Manual proof: copy `tools/lint-fixtures/inline-style.tsx` to `apps/scratch/Bad.tsx`, run `pnpm lint` → error citing DR-07; delete it → passes.

## 5. Agent conformance (US1, SC-001)

In a scratch branch, give an agent only: "Implement the Approval Center list from specs/001 as a component in apps/web (create the app if missing)". Do not mention the design system. Then run `pnpm check`. Pass criterion: zero violations on first run in ≥ 4 of 5 trials. Confirm the agent's transcript shows it read `AGENTS.md`/`DESIGN.md` or the skill fired.

## 6. Governance (US6)

- `.specify/memory/constitution.md`: version 1.1.0, Principle III contains the design-system MUSTs, ratified date unchanged.
- `.specify/templates/plan-template.md` has `## Design System Compliance`; `.specify/templates/tasks-template.md` has the component-task pattern.
- `AGENTS.md` and `.devin/skills/cdevi-design-system/SKILL.md` both link `packages/design-system/DESIGN.md`.
- Run `/speckit-analyze` on this feature: no constitution violations reported.

## 7. Architecture rewrite (US7, SC-009)

```bash
grep -inE "workbook|duckdb|query-worker|stripe|credit|checkout|obvious" docs/architecture.md   # no output
grep -n "packages/design-system" docs/architecture.md                                        # ≥1 match
```

## 8. Budgets (Principle IV)

```bash
pnpm check:size      # prints css bytes ≤ 40960, fonts bytes ≤ 204800
pnpm test:visual     # all screenshots match; report shows per-page axe clean
```

## 9. Full gate

```bash
pnpm check && pnpm build && pnpm test:visual
```

All green = feature complete; open the PR and confirm the four CI jobs (`lint`, `unit`, `build`, `visual`) are required.
