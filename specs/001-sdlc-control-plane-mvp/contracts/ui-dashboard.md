# Contract: Dashboard — regions, states, accessibility

Normative for `apps/web/app/(app)/dashboard/` (User Story 3). Every element is an `@cdevi/design-system` component imported through `apps/web/lib/ds.ts`; no `cd-` markup, no inline styles, no literal colours in the app (DR-06…DR-09). Data comes only from `GET /api/dashboard?project=all|<uuid>&window=24h|7d|30d` ([openapi.yaml](openapi.yaml) after Phase 7a; shape in [data-model.md §19](../data-model.md)); derivations from `@cdevi/contracts/dashboard-model` ([research R24–R25](../research.md)). The screen derives nothing except display strings: `ratePercent()`, `humanDuration(elapsedMs)`, `humanAgo(generatedAt)`. **The Dashboard is read-only: it has no saffron control** (§2.9, R28).

## 1. Routes and composition

- `dashboard/page.tsx` (server): reads the project cookie (`cdevi_project`, shared with Inbox and Approval Center) and `?window=` (default `7d`, invalid → `7d`) → `getDashboardSnapshot(project, window)` (`lib/session.ts`, cached) → `apiFetch<DashboardSnapshot>('/api/dashboard?project=…&window=…', { cookie })`; any error renders §4 *error*. Success renders `<DashboardScreen initial={snapshot} me={me} />`. Replaces the `[section]` placeholder for `/dashboard`.
- `DashboardScreen.tsx` (client): owns the project `Select` (writes the cookie and `?project=` like the Inbox — FR-025, "All projects" allowed), the window `Select` (`?window=`), refetches on either change, subscribes with `subscribeInboxStream({ onChange })` (debounced 300 ms) and refetches (FR-034). Renders §2 from the snapshot only.
- Shell (`AppShell`, `Side`, `Main`, `Panel`) comes from `(app)/layout.tsx`; the header `NavItem` counts (FR-035) are unchanged by this story — the Dashboard's `needsMe` figures equal them by construction (R24).
- No `Panel` content is added by the Dashboard (the existing Today panel stays); every region lives inside `Main`.

## 2. Regions (top to bottom inside `Main`)

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 2.1 | Topbar | `Topbar` (`<h1>` "Dashboard"), `actions` empty | Exactly one `<h1>`; no button in the topbar |
| 2.2 | Meta | `PageMeta`: `Field label="Project"` + `Select id="dashboard-project"` ("All projects" + one option per `me.projects`); `Field label="Window"` + `Select id="dashboard-window"` ("Last 24 hours" / "Last 7 days" / "Last 30 days"); "Updated {humanAgo(generatedAt)}"; `Pill variant="neutral"` "live" / "reconnecting" | FR-025; the window label is repeated on every windowed figure (2.3 PRs, 2.6, 2.7 audit) |
| 2.3 | Header counts — *what is happening* | `StatGrid` of four `Stat`: `value` = `Link href={figure.href}` with the number, `label` = "active workflows" / "running agents" / "PRs generated · {window}" / "open failures" | Scenario 1, FR-023, FR-035. The link's accessible name is "{value} {label}" (e.g. "18 active workflows") |
| 2.4 | Pipeline | `Card as="section"` heading "Pipeline" → `Bars label="Workflows per SDLC stage: {n1} Requirement, … {n7} PR"` (`role="img"`) **and** `List aria-label="Pipeline"` of seven `ListRow`: `title` = "{name}" with `href="/workflows?stage={n}"`, `meta` = `Mono` "Stage {n}", `trailing` = the count as `Mono`; footnote row "{unstaged} without a stage" linking to `/workflows?stage=none` only when `unstaged > 0` | Scenario 1 (each stage count is clickable → Workflow Center filtered to the stage). Rows are the accessible equivalent of the chart; the chart is decorative for AT beyond its label |
| 2.5 | What needs me | `Card as="section"` heading "What needs me" → `StatGrid` of four `Stat`: "approvals" → `/approvals`, "clarifications" → `/approvals?kind=clarification`, "failed workflows" → `/workflows?state=FAILED`, "blocked workflows" → `/workflows?state=BLOCKED` | Scenario 2 (approvals, clarifications, failed counted separately) + SC-002 (BLOCKED workflows must appear in the needs-me area). **No saffron** (§2.9): the person acts on the Approval Center |
| 2.6 | Health | `Card as="section"` heading "Health · {window}" → three rows, each `Meter label="{metric}" value={numerator} max={denominator} muted={denominator === 0}` followed by `Link href={rate.href}` "{ratePercent} %" and the fraction "{numerator} / {denominator}" as `Mono`; metrics: "Test pass rate", "Agent success rate", "Human intervention rate" | Scenario 3. Zero denominator → link text "—" and helper text "No test runs in this window" / "No finished agent runs in this window" / "No workflows in this window" (never `0 %`, never `NaN`); `Meter` never uses `warn` (saffron) here |
| 2.7 | Risk | `Card as="section"` heading "Risk" → `StatGrid` of two `Stat` whose `label` contains `RiskBadge level="HIGH"` `RiskBadge level="CRITICAL"` + text: "pending approvals" → `/approvals?risk=HIGH,CRITICAL`; "audit events · {window}" → `/audit?risk=HIGH,CRITICAL&window={key}`; third `Stat value="—" label="security findings"` + `Notice tone="info"` "Not connected yet — review findings arrive with PR Review (User Story 6)." with `Link href="/reviews"` "Open Reviews" | Scenario 4, FR-026 (badges make HIGH/CRITICAL prominent — text, not colour alone). Security findings: neutral only — never saffron, never green (R29) |
| 2.8 | Active workflows — *what is the AI doing* | `Card as="section"` heading "Active workflows ({activeWorkflowsTotal})" → `List aria-label="Active workflows"` of ≤ 12 `ListRow`: `title` = "{title}" with `href={card.href}`; `meta` = `Mono externalId` +  "Stage {stage.index ?? '—'} of {stage.count} · {stage.name ?? 'no stage'} · {agent ?? 'no agent'} · {humanDuration(elapsedMs) ?? 'not started'}"; inline `Meter label="Progress" value={progress.done} max={progress.total}`; `trailing` = `StatePill state={card.state}`; when `activeWorkflowsTotal > 12` a footer `Button variant="ghost" href={counts.activeWorkflows.href}` "Show all {activeWorkflowsTotal}" | Scenario 5 (identifier, title, stage, progress, agent, elapsed, status → Workflow Detail). Rows in array order (API order `stateObservedAt desc, id asc`) |
| 2.9 | **Saffron rule** | — | **Zero** `Button variant="saffron"` / `Pill variant="wait"` / `Meter warn` on the Dashboard in every state. Justification (R28): DR-02 reserves saffron for "a person is needed *here*"; the Dashboard shows counts and links, the action itself is taken on the Approval Center (one saffron button there). Tests assert `.cd-saffron` count 0. A future inline action on a card must re-open this rule |

## 3. Link targets (FR-023) — asserted as `href` attributes

| Figure | href (from `dashboardHrefs(window)`) |
|--------|--------------------------------------|
| active workflows | `/workflows?state=QUEUED,RUNNING,RETRYING,WAITING,WAITING_FOR_HUMAN,BLOCKED,FAILED` |
| running agents | `/workflows?state=RUNNING,RETRYING` |
| PRs generated | `/workflows?hasPr=true&window={key}` |
| open failures | `/workflows?state=FAILED,BLOCKED` |
| stage n (1..7) | `/workflows?stage={n}` |
| without a stage | `/workflows?stage=none` |
| approvals | `/approvals` |
| clarifications | `/approvals?kind=clarification` |
| failed workflows | `/workflows?state=FAILED` |
| blocked workflows | `/workflows?state=BLOCKED` |
| test pass rate | `/testing?window={key}` |
| agent success rate | `/agents?window={key}` |
| human intervention rate | `/workflows?intervention=human&window={key}` |
| HIGH/CRITICAL pending approvals | `/approvals?risk=HIGH,CRITICAL` |
| HIGH/CRITICAL audit events | `/audit?risk=HIGH,CRITICAL&window={key}` |
| security findings | `/reviews` |
| active card / Show all | `/workflows/{workflowId}` / active workflows href |

The selected project is not in the URL — the target screen reads the shared `cdevi_project` cookie (R25). `/workflows`, `/testing`, `/agents`, `/audit`, `/reviews` are `[section]` placeholders until their stories land; the links must still resolve (200) and keep their query string.

## 4. States (Constitution III)

| State | Rendering |
|-------|-----------|
| loading | Server-rendered, so first paint is populated. Client refetch (project/window change, `inbox.changed`): `Main aria-busy="true"`, previous content stays visible, selects stay enabled; `List loading` (3 skeleton rows) only for 2.8 when no `initial` exists (client-side navigation) |
| populated | §2 |
| empty | `counts.activeWorkflows.value === 0 && needsMe` all zero: 2.3–2.7 render zeros (still links), 2.8 renders `List empty` "No active workflows in **{project name}**. Show all projects" (link resets the selector) or "No active workflows." for `all`; health rows show "—" with their reason when denominators are 0 |
| error | `Notice tone="error"` (role alert) "Couldn't load the dashboard." + `Button variant="ghost"` "Retry" (refetch); on a refetch error the previous snapshot stays visible under the notice with "Updated {humanAgo}" so stale data is labelled |
| unavailable | Only the security-findings figure (2.7): `value "—"` + info `Notice` "Not connected yet …" — neutral. Never rendered for other figures (they always have a value) |
| refreshing | Figures re-render in place; the focused element keeps focus (rows keyed by `workflowId`, figures by key); "Updated {humanAgo}" and the live `Pill` update; no layout shift (fixed grid) |

## 5. Keyboard and focus

Tab order: Project select → Window select → four header links (2.3) → seven stage links (2.4, then "without a stage" if present) → four needs-me links → three health links → risk links (pending, audit, Open Reviews) → card links in order → "Show all" → panel. Every figure is a native `<a>` (Next `Link`) inside `Stat value`, so Enter follows it and focus is visible (design-system focus ring). Changing a `Select` keeps focus on the select while refetching. After "Retry" focus moves to the `<h1>`. No custom key handling; no `<div onClick>`.

## 6. Accessible names asserted by tests

- `heading level 1` = "Dashboard"; `heading level 2` = "Pipeline", "What needs me", "Health · Last 7 days", "Risk", "Active workflows (18)".
- `combobox` "Project", "Window".
- `link` names: "18 active workflows", "7 running agents", "6 PRs generated · Last 7 days", "2 open failures"; "Requirement" … "PR" (stage rows); "4 approvals", "2 clarifications", "1 failed workflows", "1 blocked workflows"; "97.4 %" ×3 pattern `/^\d+(\.\d)? %$|^—$/` with `aria-describedby` the fraction; "2 pending approvals" (with badges), "0 audit events · Last 7 days"; "Open Reviews"; each card's title; "Show all 18".
- `img` "Workflows per SDLC stage: …" (Bars); `meter` "Test pass rate", "Agent success rate", "Human intervention rate", "Progress" (per card).
- `list` "Pipeline", "Active workflows"; `status` for the info notice and "live"; `alert` for the error notice; `button` "Retry".
- `RiskBadge` text "HIGH" and "CRITICAL" present in the risk region; `StatePill` text is the state word on every card.

## 7. Accessibility acceptance

axe (WCAG 2.2 AA tags, colour contrast excluded in jsdom) passes for: populated (with HIGH/CRITICAL > 0 and unstaged > 0), populated with zero denominators, empty (`all` and single project), error, refreshing (`aria-busy`). Playwright runs page-level axe on the populated Dashboard for `dashboard-demo` and performs the keyboard walk of §5 (Tab reaches every figure link; Enter on "Requirement" navigates to `/workflows?stage=1`).

## 8. Performance (plan Part C budgets)

Initial content ≤ 2 s p95 at the SC-007 workload; `GET /api/dashboard` ≤ 300 ms p95; payload ≤ 8 KB; `inbox.changed` → refreshed figure ≤ 5 s p95 / ≤ 1 s median (SC-003, SC-002); refetch re-render ≤ 100 ms; route JS ≤ 200 KB gzip (`check:size`); cards ≤ 12.
