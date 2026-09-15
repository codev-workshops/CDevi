# Contract: Agent Run Inspector — `/agents/runs/{id}`: regions, states, accessibility, and the Workflow Detail drill-down

Normative for `apps/web/app/(app)/agents/runs/[id]/` and the "Inspect run" extension of `apps/web/app/(app)/workflows/[id]/WorkflowDetailScreen.tsx` (User Story 5). Every element is an `@cdevi/design-system` component (1.4.0; 1.5.0 only if Phase 11d confirms a gap — plan Part E) imported through `apps/web/lib/ds.ts`; no `cd-` markup, no inline styles, no literal colours in the app (DR-06…DR-09). Data comes only from `GET /api/agent-runs/{id}` and, for the drill-down, `GET /api/workflows/{id}` `stages[].agentRuns` ([openapi.yaml](openapi.yaml) after Phase 11a; shapes in [data-model.md §32](../data-model.md)); rules from `@cdevi/contracts/agent-run-model` ([research R48, R49, R51, R54](../research.md)). The screen derives nothing except display strings: `humanDuration(runDuration(...))`, `humanAgo(at)`, and the words from `POLICY_OUTCOME_WORDS`, `CONFIDENCE_WORDS`, `EVIDENCE_KIND_WORDS`. Run states render only through `StatePill` (DR-01). **Nothing on this screen mutates anything** — there is no form, no action and no saffron control (§7, R55). **Nothing on this screen renders private reasoning** — the contract has no such field (FR-018, R50).

## 1. Routes and composition

- `agents/runs/[id]/page.tsx` (server): `getAgentRunDetail(id)` (`lib/session.ts`, cached like `getRequirementDetail`) → `apiFetch<AgentRunDetail>('/api/agent-runs/{id}', { cookie })`; 400/401/403/404/5xx all render §5.5 *not available* (no existence leak). Success renders `<AgentRunScreen initial={run} me={me} />`. `lib/navigation.ts` is **unchanged**: `/agents` remains a `[section]` placeholder (not in `BUILT_SECTIONS`); the `[section]` catch-all matches one segment, so this nested route is served by its own `page.tsx` (R51).
- `AgentRunScreen.tsx` (client): renders §2 from the read model only; subscribes with `subscribeInboxStream({ onChange, workflowId: run.workflow.id })` (debounced 300 ms) → refetch `GET /api/agent-runs/{id}` and replace the whole model (FR-034, R53); runs a 1 s `setInterval` **only while `finishedAt === null`** to re-render the Duration cell with `runDuration(startedAt, null, new Date())`; recomputes `runFreshness(run, now)` on every tick and refetch (R54); owns the `Tabs` value (`'timeline' | 'decisions'`, default `'decisions'` when `decisions.length > 0`, else `'timeline'`; a `#decision-n` hash selects `'decisions'` and scrolls/focuses that card).
- Shell (`AppShell`, `Side`, `Main`, `Panel`) from `(app)/layout.tsx`; the `Side` nav highlights nothing new (`/agents` stays "not built"); `Panel` receives §2.9; header `NavItem` counts (FR-035) are unchanged.
- Workflow Detail drill-down (§4): `WorkflowDetailScreen.tsx` renders one "Inspect run" link per `stage.agentRuns[]` entry with `href={agentRunHref(run.id)}` — the AS-1 entry point ("from a workflow stage into the agent run").

## 2. Agent run — regions (top to bottom inside `Main`)

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 2.1 | Crumbs + Topbar | `Crumbs`: "Workflows" (`href="/workflows"`) › "{workflow.title}" (`href="/workflows/{workflow.id}"`) › "Stage {stage.position} · {stage.name}" (`href="/workflows/{workflow.id}#stage-{stage.position}"`) › "Run · {agent}" (current); `Topbar` (`<h1>` "{agent} — {stage.name}"), `actions` = `Button variant="ghost" href="/workflows/{workflow.id}"` "Back to workflow" | Exactly one `<h1>`. The only button on the screen is a ghost link (§7) |
| 2.2 | Meta | `PageMeta`: `StatePill state={state}` (first, always visible), `Mono externalId`, "{workflow.externalId}", `Pill variant="neutral"` "live" / "reconnecting" (SSE status — same words as Workflow Detail) | FR-016 status as a word (DR-01); live status visible (FR-034) |
| 2.3 | Header | `Card as="section"` heading "Run" → `KeyValue` rows in this order: **Agent** "{agent}"; **Workflow** `Link href="/workflows/{workflow.id}"` "{workflow.externalId} · {workflow.title}"; **Stage** "{stage.position}. {stage.name}"; **Model** "{model ?? 'not reported'}"; **Started** `<time dateTime={startedAt}>` "{absolute} ({humanAgo})"; **Duration** `<time>` "{humanDuration(durationMs)}" + `Pill variant="run"` "running" while `finishedAt === null` (the cell re-renders every second — §1); **Finished** `<time dateTime={finishedAt}>` "{absolute} ({humanAgo})" when `finishedAt` is set, otherwise the neutral text "in progress" (no pill, no saffron); **Status** `StatePill state={state}` | Scenario 1 / FR-016: agent name, workflow, start time, duration, model, status. Platform record — never inside a `Message` (DR-03) |
| 2.4 | Summary | when `summary`: `Message who="{agent} · summary" variant="summary"` with `<p>` summary and caption "Agent summary — not evidence"; when null: `<p>` "The agent has not reported a summary." | DR-03: the agent's account is a claim, visually separate from 2.3 |
| 2.5 | Structured progress | `Card as="section"` heading "Progress" + `Mono` "{completed} of {steps.length} steps completed" (from `stepsSummary`) → `Stepper label="Progress"` → one `Step` per `steps[]` in order: `title` = "{label}", `state` = `done` (`completed`) / `current` (`running`, gets `aria-current="step"`) / `todo` (`pending`, `failed`); `detail` = `Pill variant="fail"` "failed" for `failed`, `Pill variant="run"` "running" for `running`, nothing otherwise. `steps.length === 0` → `<p>` "The runtime has not reported structured progress for this run." | Scenario 3 (AS-3): a checklist of completed/running/pending steps — **never a spinner, never "thinking…"** (asserted: no element with `role="progressbar"` or `aria-busy` inside 2.5). Candidate gap (plan Part E): a `Step` `failed` state — default is the word in a `Pill` |
| 2.6 | Tabs | `Tabs label="Run details" value onChange` → `Tab value="timeline"` "Timeline ({timeline.length})", `Tab value="decisions"` "Decisions ({decisions.length})" | Two bounded lists, one visible at a time; arrow keys switch (§6) |
| 2.7 | Timeline (tab panel) | `ToolLog label="Agent activity"` → one `ToolLine` per `timeline[]` **oldest first**: `kind` = `read` (`tool`) / `write` (`decision`) / `dim` (`note`) / `error` (`error`); text = `<time dateTime={at}>` "{HH:MM:SS}" + " " + "{kind word}" + " · " + "{message}" — the kind word (`tool` / `decision` / `note` / `error`) is rendered as text so colour is never the only cue. `timeline.length === 0` → `<p>` "No activity recorded yet." | Scenario 1 (timestamped timeline), Scenario 3 (updates live: new lines appear after refetch; the log scrolls to the newest line only if the user was already at the bottom). Tool activity is evidence of *what happened*, not the agent's narrative (DR-03) |
| 2.8 | Decisions (tab panel) | `<ol aria-label="Decisions">` of ≤ 50 `<li id={decisionAnchor(position).slice(1)} tabIndex={-1}>` → `DecisionCard tone="neutral"`: `title` = "{position}. {action}"; `badge` = `Pill variant={ALLOWED→"done" \| APPROVAL_REQUIRED→"wait" \| DENIED→"fail"}` "{POLICY_OUTCOME_WORDS[policyOutcome]}" + `Pill variant="neutral"` "confidence {CONFIDENCE_WORDS[confidence]}" + (`RiskBadge level={riskLevel}` when non-null); `description` = `<p>` "{reason}" + `Mono` "decided {humanAgo(decidedAt)}" (`<time>`) + (`Mono` "policy {policyRef}" when non-null); `actions` = **none**; body = §2.8a evidence list | Scenario 2 / FR-017: action, reason, evidence, confidence, policy result. FR-026: `RiskBadge` HIGH/CRITICAL are the loud variants. `APPROVAL_REQUIRED` is a **word**, not a call to action (§7). `reason` is the agent's justification (a claim, inside the card) |
| 2.8a | Evidence (inside each card) | `GateList label="Evidence for decision {position}"` → one `GateCheck` per `evidence[]`: when `evidenceHref(ref) !== null` → `state="ok"`, `label` = `<a href={href}>` "{label}" (external `http(s)` hrefs get `target="_blank" rel="noopener noreferrer"` and name "{label} (opens in a new tab)"; app-relative hrefs are `Link`s; artifact refs point at `/workflows/{id}#artifact-{externalId}`, which Workflow Detail resolves because every artifact `ListRow` carries `id="artifact-{externalId}"`), `source` = "{EVIDENCE_KIND_WORDS[kind]}{locator ? ' · ' + locator : ''}"; when `null` → `state="pending"`, `label` = "{label} — access restricted" (plain text, **no `<a>`**), `source` = "{kind word}{locator ? ' · ' + locator : ''} · not available to you". `evidence.length === 0` → `<p>` "No evidence cited." | FR-017 "navigable evidence"; edge case "evidence the user cannot access → access-restricted indicator, never a broken link" (R49). Evidence is *platform evidence* (`GateCheck` with `source`), visually separate from the reason (DR-03) |
| 2.9 | Panel (right) | `PanelBlock title="About this run"` → `KeyValue`: "Decisions" "{n}", "Approval required" "{count of APPROVAL_REQUIRED}", "Denied" "{count of DENIED}", "Highest risk" `RiskBadge` of the highest non-null `riskLevel` or "none reported"; `PanelBlock title="Live"` → `Pill` "live"/"reconnecting" + `Mono` "Updated {humanAgo(lastFetchedAt)}" | Counts computed in the client from the bounded list (≤ 50) — display only |
| 2.10 | **Saffron rule** | — | **Zero** `Button variant="saffron"` on the screen in every §5 state (§7) |

## 3. Stale-run and error notices (rendered between 2.2 and 2.3)

| Condition | Component | Copy |
|-----------|-----------|------|
| `runFreshness(run, now) === 'stale'` (R54) | `Notice tone="info"` (role `status`) | "No activity for {humanDuration(now − lastActivityAt)} — the runtime has not reported progress. The run's state is unchanged; see the workflow if it stays quiet." + `Link` "Open workflow" |
| refetch failed after a live change | `Notice tone="error"` (role `alert`) | "The run couldn't be refreshed. Showing the last loaded state from {humanAgo(lastFetchedAt)}." + `Button variant="ghost"` "Retry" |

The stale notice is an **indicator**: `StatePill` still shows the runtime's state; the notice disappears on the next refetch/tick that makes the run `active`.

## 4. Workflow Detail drill-down (EXTENDED regions of `ui-workflow-detail-screen.md`)

| # | Region | Extension |
|---|--------|-----------|
| 2.6 Stage pipeline | each `Step` `detail` gains, after the existing text, one `Link href={agentRunHref(run.id)}` per `stage.agentRuns[]` (≤ 20, API order = newest first) with accessible name "Inspect run {index} of {n} by {run.agent}, {stateToPill[run.state].word}" and visible text "Inspect run" (+ " · {agent}" when the stage has more than one run). The `Step` keeps its single visible `StatePill` (the stage's); the run's state word travels in the link's accessible name so the pipeline still has exactly one state pill per stage. Each `Step` carries `id="stage-{position}"` so the run screen's breadcrumb (`/workflows/{id}#stage-{n}`) lands on it |
| 2.7 Current stage | the `KeyValue` gains a row **Run** → the same `Link`(s) for the current stage's runs, each followed by `StatePill state={run.state}`, or "No run recorded" |
| 5 States | a stage with `agentRuns.length === 0` renders no link (nothing to inspect); the existing keyboard order (§6 of that contract) gains the "Inspect run" links after the `Step` they belong to — `Stepper` itself remains a list, its links are tab stops |

The links are plain `Link`s (no button, no saffron): they navigate to evidence, they do not ask for a person.

## 5. States (Constitution III)

| State | Rendering |
|-------|-----------|
| 5.1 loading | server first paint carries the whole read model (no skeleton); on client refetch the `Main` region gets `aria-busy="true"` and all content stays visible (no layout shift, no spinner) |
| 5.2 populated | §2 with a finished run (`finishedAt` set): Duration is static, no "running" pill, no ticker; `Stepper` shows the final checklist (every step `done` or `failed`); Decisions tab selected by default when `decisions.length > 0` |
| 5.3 in-progress (live) | `state ∈ {RUNNING, RETRYING, WAITING, WAITING_FOR_HUMAN, BLOCKED}` and `finishedAt === null`: Duration re-renders each second with `Pill variant="run"` "running" (only for RUNNING/RETRYING — other states show the `StatePill` word alone); `Stepper` has exactly one `current` step when a `running` step exists; every `inbox.changed` for `workflow.id` triggers a debounced refetch that replaces steps, timeline and decisions in place (the selected tab and scroll position are preserved; focus is not moved); "live" pill pulses briefly |
| 5.4 empty decisions | Decisions tab label "Decisions (0)"; panel body `Notice tone="info"` "No decisions recorded yet — decisions appear here as the agent reports them."; the Timeline tab is selected by default |
| 5.5 not available | `Topbar` "Agent run" + `Notice tone="error"` "This item isn't available to you." + ghost `Button href="/workflows"` "Back to Workflows" (400/401/403/404/5xx alike — no existence leak; same copy as Workflow Detail and Requirement Detail) |
| 5.6 restricted evidence | any `GateCheck` with `evidenceHref(ref) === null` renders §2.8a's restricted row: text label + "access restricted", `source` ending "not available to you", **no anchor element inside the row**; the rest of the card is unchanged |
| 5.7 stale run | §3 info notice present in addition to 5.3; `StatePill` unchanged; the "running" pill next to Duration is **replaced** by `Pill variant="wait"` "no recent activity" so the duration cell does not claim liveness |
| 5.8 refresh error | §3 error notice; last good model stays rendered; "Retry" refetches |
| 5.9 empty timeline / empty steps | §2.7 / §2.5 empty texts; never a spinner |

No *disabled* state exists: the screen has no controls other than links, tabs and the two ghost buttons.

## 6. Keyboard and focus

- Tab order: "Back to workflow" → crumbs (Workflows → workflow → stage) → Workflow link in the header (2.3) → stale-notice "Open workflow" link (when present) → `Tabs` tablist (one tab stop; `ArrowLeft`/`ArrowRight` move between "Timeline" and "Decisions", `Home`/`End` jump) → active tab panel content: timeline has no tab stops (the `ToolLog` is a `pre` with `aria-label`); decisions expose only the accessible evidence links, in card order → Panel links → shell nav.
- `#decision-n` in the URL (from `DecisionLinks.agentRun` deep links or the Approval Center): selects the Decisions tab, scrolls the card into view and moves focus to its `<li tabIndex={-1}>` so the card title is announced; the `Tabs` value change does not steal focus otherwise.
- The duration ticker never moves focus or announces (the cell is not live-region-annotated; the `PageMeta` live region announces only "Run updated" after a refetch).
- Every link and tab is a native `a`/`button` with the design-system focus ring (no `outline: none`); external links state "(opens in a new tab)" in their accessible name.
- `Escape` does nothing (no overlays exist).

## 7. Saffron decisions (DR-02 — justified per screen)

| Screen | Saffron control | Justification |
|--------|-----------------|---------------|
| Agent run — every state | **none** | The screen inspects; nothing waits on a person *here*. A decision with `policyOutcome = APPROVAL_REQUIRED` is a fact about what the agent reported, shown as a word in a `Pill`; the person's action, if any, is an approval that the Inbox and the Approval Center already surface in saffron with its own link back to this run. A run that is `WAITING_FOR_HUMAN`/`BLOCKED`/`FAILED` shows the state word and links to the workflow, where Workflow Detail owns the saffron action (US1). Two saffron controls for one obligation would weaken the signal |
| Workflow Detail — "Inspect run" links | none | Navigation to evidence, not a request for a person; plain `Link`s |

Tests assert `.cd-saffron` count **0** in every §5 state of the run screen and that the Workflow Detail saffron count is unchanged by the drill-down links.

## 8. Accessible names asserted by tests

- `h1`: "{agent} — {stage.name}"; not-available: "Agent run".
- Crumbs: "Workflows", "{workflow.title}", "Stage {position} · {name}", "Run · {agent}".
- `KeyValue` terms: "Agent", "Workflow", "Stage", "Model", "Started", "Duration", "Finished", "Status".
- `Stepper` `aria-label="Progress"`; current `Step` `aria-current="step"`; step pills "failed" / "running".
- `Tabs` `aria-label="Run details"`; tabs "Timeline ({n})", "Decisions ({n})".
- `ToolLog` `aria-label="Agent activity"`.
- Decisions list `aria-label="Decisions"`; card titles "{position}. {action}"; pills "allowed" / "approval required" / "denied", "confidence low|medium|high"; `RiskBadge` words from `riskToVariant` (e.g. "high risk").
- `GateList` `aria-label="Evidence for decision {position}"`; accessible evidence link "{label}" or "{label} (opens in a new tab)"; restricted row text "{label} — access restricted" with no link role inside.
- Notices: role `status` for `tone="info"` (stale, empty decisions), `alert` for `tone="error"` (not available, refresh error).
- Buttons/links: "Back to workflow", "Back to Workflows", "Retry", "Open workflow", "Inspect run …".
- Live pill: "live" / "reconnecting"; duration pills "running" / "no recent activity".

## 9. Accessibility acceptance

- axe (WCAG 2.2 AA rules) passes in every §5 state in component tests and on the populated, in-progress and restricted-evidence screens in Playwright (SC-010).
- No information is conveyed by colour alone: run state, step status, policy outcome, confidence, risk, evidence accessibility and timeline kind are all words.
- No raw model reasoning is present in the DOM in any state (SC-009): the component test renders every fixture and asserts the absence of any `reasoning`/`chainOfThought` text; a fixture typed with such a field fails `tsc` (the contract has no such key).
- Live updates announce "Run updated" through the `PageMeta` `aria-live="polite"` region and never steal focus; the duration ticker is silent.
- `<time dateTime>` on every timestamp; durations are human-readable ("4 min 12 s"), never bare milliseconds.

## 10. Performance (plan Part E budgets)

- Initial content (header + first decision) ≤ 2 s p95 (SC-007); the whole model is in the server render; lists bounded (timeline 50, steps 20, decisions 50, evidence 20).
- `inbox.changed` → updated `Stepper` ≤ 5 s p95, ≤ 1 s median (SC-003, FR-034); debounce 300 ms; one refetch per burst.
- Duration ticker: one interval, one cell, ≤ 16 ms per tick; cleared on unmount and when `finishedAt` arrives.
- Route JS ≤ 200 KB gzip; browser imports only `@cdevi/contracts/agent-run-model`, `/vocabulary`, `/read-model` (no zod in the client bundle).
- Workflow Detail: `agentRuns` adds ≤ 20 links per stage and no extra request.
