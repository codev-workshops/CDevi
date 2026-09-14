# Contract: Workflow Detail screen — components, states, accessibility

Normative for `apps/web/app/(app)/workflows/[id]/` (User Story 1). Every element is an `@cdevi/design-system` component; no `cd-` markup or inline styles in the app (DR-06…DR-09). The data comes only from `GET /api/workflows/{id}` ([openapi.yaml](openapi.yaml)); the screen derives nothing except relative time strings.

## 1. Route and composition

- `page.tsx` (server): `params.id` → `apiFetch<WorkflowDetail>('/api/workflows/{id}', { cookie })`. Any error (400/403/404/5xx/timeout) renders §4 *unavailable*. Success renders `<WorkflowDetailScreen initial={detail} role={me.user.role} />`.
- `WorkflowDetailScreen.tsx` (client): renders §2 from `initial`; subscribes with `subscribeWorkflowStream({ workflowId, onChange })` (filters `inbox.changed` frames by `workflowId`) and refetches on change; posts actions to `POST /api/workflows/{id}/actions` then refetches.
- The shell (`AppShell`, `Side`, `Main`, `Panel`) is provided by `(app)/layout.tsx`; the screen owns only `Main`'s content and the `Panel`'s blocks.

## 2. Regions (top to bottom inside `Main`)

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 2.1 | Topbar | `Topbar` (`<h1>` = workflow title) with `Button variant="ghost" href="/inbox"` "Back to Inbox" in the leading slot; `actions` empty | Exactly one `<h1>` on the page |
| 2.2 | Meta | `PageMeta`: `StatePill state={workflow.state}`, `RiskBadge level={workflow.riskLevel}` when non-null, `Mono` external id, project key, "Agent: {agent}" , "Stage {stage.index} of {stage.count} · {stage.name}", "Elapsed {humanDuration(elapsedMs)}" | Words come from `stateToPill`/`riskToVariant` — never typed |
| 2.3 | Progress | `Meter label="Progress" value={progress.completed} max={progress.total}` + visible text "{completed} of {total} stages complete" | FR-001 progress indicator |
| 2.4 | **Needs you / blocked notice** | `DecisionCard tone="needs-you"` title "{stage.name} — {StatePill word}", body `attention.reason`, `badge` = `StatePill state={attention.state}`, `actions` = **the one saffron `Button href={attention.action.href}`** with `attention.action.label` | Rendered whenever `attention !== null`; **first region after meta, never collapsible, no toggle, no `hidden`** (FR-005, scenario 3). Absent → nothing rendered, no saffron button on the page |
| 2.5 | **Failure panel** | `Card as="section" aria-labelledby` heading "Workflow failed" → `KeyValue` rows Reason / Failed at (stage n · name) / Last successful stage (or "None"), then `ActionBar` with `Button variant="primary"` Retry, `Button variant="ghost"` Escalate, `Button variant="danger"` Cancel; `ActionBar help` = "Only engineers and administrators can retry or cancel." when any is disabled | Rendered whenever `failure !== null` (scenario 5). Each button `disabled` when `actions[x] === false`. Cancel is two-step: first click swaps label to "Confirm cancel" and shows `Notice tone="info"` "Cancelling stops every remaining stage."; second click posts; Escape or blur-out reverts. Escalate opens a `Field`+`Input` "Escalate to (name or group)" inline with a `Button variant="primary"` "Send" |
| 2.6 | Stage pipeline | `Stepper label="Stage pipeline"` → one `Step` per `stages[]` in order: `title` = "{position}. {name}", `detail` = `StatePill state` + " · {agent ?? 'unassigned'}" + (" · {humanDuration(elapsedMs)}" when non-null); `state` = `done` when COMPLETED, `current` when `stage.current`, else `todo` | Current step has `aria-current="step"` (scenario 1). Cancelled/failed stages are `todo` visually but their pill carries the word |
| 2.7 | Current stage | `Card as="section"` heading "Current stage: {name}" → `KeyValue` Agent / Model / Started / Elapsed / Next stage ("{position}. {name}" or "None — workflow complete"); then `Message variant="summary" author={agent}` with `currentStage.summary` and caption "Agent summary — not evidence" | `currentStage === null` → `Card` with text "No stages recorded yet." (DR-03: claim vs evidence) |
| 2.8 | Activity | `List aria-label="Activity"` → `ListRow` per `activity[]` **in array order** (ascending time): `title` = message, `meta` = `<time dateTime>` absolute + relative · `Pill variant="neutral"` source word (workflow / stage / agent / human) · "Stage n" when present | Empty → `List empty="No activity yet."` (scenario 2) |
| 2.9 | Artifacts | `List aria-label="Artifacts"` → `ListRow` per `artifacts[]`: `title` = artifact title, `href` when present, `trailing` = `Pill variant="neutral"` type word, `meta` = "Stage {position} · {name} · {relative producedAt}" and summary | Empty → `List empty="No artifacts yet."`. Type words: requirement spec · impact analysis · implementation plan · test results · code diff · pull request |
| 2.10 | Test runs (Panel) | `PanelBlock title="Test runs"` → `GateList` → `GateCheck` per `testRuns[]`: `state` ok (PASSED) / bad (FAILED) / wait (RUNNING), label = "{category}", `source` = "{passed}/{total} passed · {failed} failed · Stage {position}", link when `href` | Empty → text "No test runs yet." Platform evidence (DR-03) |
| 2.11 | Freshness (Panel) | `PanelBlock` → "Updated {relative generatedAt}" + `Pill variant="neutral"` "live" / "reconnecting" | Same pattern as Inbox |

## 3. Saffron rule

Exactly one saffron `Button` **when `attention` is present**, none otherwise. Failure actions are `primary`/`ghost`/`danger`. The component test asserts by role and name (`getByRole('link', { name: attention.action.label })` exists exactly once) and that no saffron-variant button exists in the failed-only fixture.

## 4. States (Constitution III)

| State | Rendering |
|-------|-----------|
| loading (refetch after SSE) | `Main` region `aria-busy="true"`; existing content stays; `Pill` "updating" in 2.11 |
| unavailable (404/403/400/network) | `Topbar` h1 "Workflow" + `Notice tone="error"` "This item isn't available to you." + `Button variant="ghost" href="/inbox"` "Back to Inbox". Identical for not-found and forbidden |
| load error after first paint | `Notice tone="error"` "Couldn't refresh this workflow." + `Button` "Retry" (refetch); stale content remains visible |
| empty lists | 2.7/2.8/2.9/2.10 empty texts |
| action pending | the clicked button `disabled` + `aria-busy`; others unchanged |
| action error | `Notice tone="error" role="alert"` with the Problem `title`; focus stays on the button |
| viewer / no permission | failure buttons `disabled` + `ActionBar help` text; needs-you action still shown (it is a link to a screen that enforces its own permissions) |
| completed / cancelled | no attention, no failure; 2.7 shows the last stage with "Next stage: None — workflow complete" |

## 5. Keyboard and focus

Tab order: Back to Inbox → saffron action (if any) → Retry → Escalate → Cancel (if failure) → activity links (none unless artifact) → artifact links → test-run links → shell nav. `Stepper` is a list, not a tab stop. Escape while "Confirm cancel" is showing reverts it and keeps focus on Cancel. After a successful Retry/Cancel the failure panel disappears; focus moves to the `<h1>`. Every control has a visible focus ring (design-system).

## 6. Accessible names asserted by tests

- `h1` = workflow title; `Stepper` `aria-label="Stage pipeline"`; current `Step` `aria-current="step"`; `Meter` `aria-label="Progress"`, `aria-valuenow=completed`, `aria-valuemax=total`.
- `DecisionCard` region labelled by its title; the saffron link name = `attention.action.label`.
- Failure `section` labelled "Workflow failed"; buttons "Retry", "Escalate", "Cancel" / "Confirm cancel".
- Lists: `aria-label` "Activity", "Artifacts"; `PanelBlock` heading "Test runs".
- Every `StatePill` renders the mapped word (needs you, blocked, failed, …) as text.

## 7. Accessibility acceptance

- axe (component, jsdom) → 0 violations for fixtures: running, waiting-for-human, blocked, failed (engineer), failed (viewer), completed, cancelled, unavailable, load-error.
- axe (Playwright, page) → 0 violations on `/workflows/{s500-001}`, `/workflows/{s500-045}`, `/workflows/00000000-0000-0000-0000-000000000000`.
- Contrast and tokens are the design system's (no new CSS).

## 8. Performance

- LCP ≤ 2 s p95 (10 runs, seeded S-500, showcase workflow) — recorded by `workflow-detail-journey.spec.ts`.
- SSE change → DOM update ≤ 5 s p95 (`workflow-detail-freshness.spec.ts`, 5 iterations; SC-003).
