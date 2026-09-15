# Research: SDLC Control Plane MVP — User Story 1 (Workflow Detail)

**Phase 0 output** for [plan.md](plan.md). Each entry records the decision, the rationale and the alternatives considered. Everything here builds on the decisions in `specs/003-inbox-home/research.md` (R1–R14), which remain in force.

## R1 — Extend the 003 persistence, do not recreate it

**Decision**: Keep `workflows`, `workflow_transitions`, `approvals`, `clarifications` exactly as `0001_init.sql` defines them. Add four tables (`workflow_stages`, `agent_runs`, `artifacts`, `test_runs`) and two nullable columns on `workflow_transitions` (`stage_id`, `user_id`) in `0002_workflow_detail.sql`. The workflow row keeps its denormalised `stage_index / stage_count / stage_name` (the Inbox reads them); the stage table is the detailed source and ingestion keeps both in step.

**Rationale**: The spec's Key Entities already exist for Workflow / Approval / Clarification; US1 needs Workflow Stage, Agent Run, Artifact and Test Run. Re-using `workflow_transitions` for stage-level transitions (with `stage_id` set) satisfies FR-002 ("all state transitions recorded with timestamp and cause") with one log, one index and one activity query. `user_id` lets human actions (retry / escalate / cancel) be attributed without inventing a second actor table.

**Alternatives**: A separate `stage_transitions` table (duplicated shape, second query for the feed); JSONB `stages` column on `workflows` (no per-stage indexes, no immutability trigger for artifacts, hard to transition one stage atomically).

## R2 — Agent run timeline as bounded JSONB

**Decision**: `agent_runs.timeline jsonb NOT NULL DEFAULT '[]'` — an array of `{ at, kind, message }` (kind ∈ `tool | decision | note | error`), validated by Zod on ingestion, at most 50 entries (oldest dropped by the ingestion service), each message ≤ 240 chars of plain language.

**Rationale**: The timeline is written whole by the orchestrator per run and only read to render the activity feed; there is no per-event query. A table would add a fifth table and a fifth query for no read benefit. The 240-char cap and the fixed `kind` vocabulary keep raw model chain-of-thought out of the product (spec: "no raw model chain-of-thought is displayed").

**Alternatives**: `agent_run_events` table (rejected: query count, ingestion complexity); free-text `transcript` column (rejected: would invite chain-of-thought).

## R3 — Live updates: reuse `inbox.changed`, filter by `workflowId`

**Decision**: No second SSE route. The new tables get `AFTER INSERT OR UPDATE` triggers calling the existing `notify_inbox_changed()`; the frame already carries `workflowId`. `apps/web/lib/workflow-stream.ts` subscribes to `/api/inbox/stream` and calls `onChange` only when `data.workflowId` equals the open workflow. The client then refetches `GET /api/workflows/{id}` (notification, not data — same as the Inbox).

**Rationale**: The 003 plumbing (durable `inbox_change_log`, `LISTEN` per process, replay by `Last-Event-ID`, reconnect back-off) already meets FR-034 "recover missed events after a disconnect without loss or duplication". A workflow-scoped stream would duplicate that code for one filter predicate. Frame fan-out is bounded by the organisation's visible projects exactly as today.

**Alternatives**: `GET /workflows/{id}/stream` (rejected: duplicate lifecycle code, second connection when the user also has the Inbox open); polling (rejected by FR-034).

**Consequence**: stage, agent-run, artifact and test-run changes now also produce `inbox_change_log` rows. The Inbox refetches on them too (debounced 250 ms); its snapshot is unchanged, so the cost is one extra bounded query per burst. Acceptable at S-500 scale; recorded in `docs/architecture.md`.

## R4 — Read model derived by pure functions, composed by the API

**Decision**: `packages/contracts/src/workflow-detail-model.ts` holds pure functions — `orderStages`, `deriveCurrentStage`, `deriveProgress`, `stageElapsed`, `groupArtifactsByStage`, `orderActivity`, `deriveAttention`, `deriveFailure`, `allowedActions(role)` — over plain row shapes. `apps/api/src/services/workflow-detail.ts` runs 6 queries (workflow+project, stages, runs, artifacts, test runs, transitions) in one `REPEATABLE READ` transaction and composes the response with those functions. The web never derives; it renders the response.

**Rationale**: Same pattern as 003 R8: derivation rules are the acceptance criteria (ordering, current stage, "last successful stage") and must be unit-testable without Postgres. Unlike the Inbox (keyset pagination in SQL), a single workflow's data is small and bounded, so composing in TypeScript costs nothing and avoids duplicating the rules in SQL.

**Alternatives**: One big SQL with `json_agg` (rejected: untestable rules, two sources of truth).

## R5 — Actions: retry / escalate / cancel as one POST with a role gate

**Decision**: `POST /api/workflows/{id}/actions` with body `{ action: "retry" | "escalate" | "cancel", note? }`.
- **retry** (roles `engineer`, `administrator`): allowed only when the workflow is `FAILED`; moves the failing stage and the workflow to `RETRYING` (valid per `WORKFLOW_TRANSITIONS`), logs two transitions with `user_id` and reason `Retry requested by <name>`.
- **cancel** (roles `engineer`, `administrator`): allowed when `canTransition(state, 'CANCELLED')`; moves every non-terminal stage and the workflow to `CANCELLED`, sets `finished_at`.
- **escalate** (roles `engineer`, `approver`, `administrator`): allowed when the workflow is `FAILED`, `BLOCKED` or `WAITING_FOR_HUMAN`; records a transition row `state → state` with reason `Escalated by <name>: <note>` (visible in the activity feed) — no state change, because FR-006 says "escalate to a named person or group" and the addressee directory is out of US1 scope.
- `viewer`: 403 Problem; the UI renders the buttons disabled with `ActionBar help`.
- Project visibility is checked first; an invisible workflow is a 404 identical to a missing one.

**Rationale**: One route keeps CSRF/origin checks, role gating and logging in one place. Re-using the transition log means the action appears in the activity feed with actor and timestamp (FR-002) without a new table.

**Alternatives**: Three routes (more surface, same logic); ingestion-token driven actions (wrong principal — these are human decisions).

## R6 — Artifact immutability enforced in the database

**Decision**: `artifacts` has no `updated_at`; a `BEFORE UPDATE` trigger raises `artifact_immutable` when the producing stage's state is `COMPLETED`. Ingestion is `PUT /ingest/artifacts/{externalId}` (upsert) so an orchestrator may correct an artifact while its stage is still running; after completion the upsert fails with a 409 Problem.

**Rationale**: Spec Key Entities: "immutable once the stage completes". A trigger holds regardless of which service writes.

**Alternatives**: Application-only check (bypassable by future writers).

## R7 — Test runs as summaries with a link

**Decision**: `test_runs` stores category, status (`RUNNING | PASSED | FAILED`), counts (total / passed / failed / skipped), timings and an optional `href` to the full results (the Testing screen is US5). The detail page renders them as `GateCheck` rows — platform evidence, visually separate from the agent's `Message` summary (DR-03).

**Alternatives**: Per-test rows (US5 scope); embedding results in artifacts (loses evidence/claim separation).

## R8 — Seed: two showcase workflows inside S-500

**Decision**: `buildS500` gains a deterministic `showcase` for two existing workflows so bucket counts (`EXPECTED_BUCKETS`) do not change:
- `s500-001` (first approval, `WAITING_FOR_HUMAN`, CRITICAL, title "Add rate limiting to /api/auth") — 7 stages: 1–5 `COMPLETED` (Testing has a `FAILED → RETRYING → RUNNING → COMPLETED` history), 6 Review `WAITING_FOR_HUMAN` (the approval), 7 PR `QUEUED`; 8 agent runs; 6 artifacts covering every `ArtifactType`; 4 test runs (unit, integration, e2e, accessibility — the first unit run `FAILED`, the rerun `PASSED`).
- `s500-045` (first `FAILED`, stage 5 Testing) — stages 1–4 `COMPLETED`, 5 `FAILED` with error summary "3 unit tests failing", 6–7 `QUEUED`; 5 agent runs; 4 artifacts; 1 `FAILED` test run.

**Rationale**: The Independent Test needs one workflow with a full history including a `WAITING_FOR_HUMAN` stage and a `FAILED` stage; the first showcase carries both (a currently waiting stage and a failed-then-retried stage in its history), the second shows the failure panel as the *current* state so scenario 5 is testable from seed alone. Reusing existing workflows keeps the 003 seed tests green.

## R9 — OpenAPI: a fragment for 001, the 003 document untouched

**Decision**: `buildOpenApi()` (003 snapshot) is unchanged. `buildWorkflowDetailOpenApi()` returns the US1 fragment (paths + only the new schemas) written to `specs/001-sdlc-control-plane-mvp/contracts/openapi.yaml` and snapshot-tested. `buildFullOpenApi()` merges both for the API's swagger endpoint.

**Rationale**: The user story asks for "an openapi.yaml fragment"; keeping 003's artefact byte-stable avoids editing a finished feature's contract.

## R10 — Web composition: server first paint, client refresh

**Decision**: `page.tsx` (server) fetches `GET /api/workflows/{id}` with the forwarded cookie and renders `WorkflowDetailScreen` (client) with the snapshot; the client subscribes to the workflow stream and refetches. 404/400/403 render the identical "This item isn't available to you." `Notice` with a Back link (edge case: never confirm existence). The 003 `renderRecord`/`RecordStub` stay for `/approvals/[id]` only.

**Rationale**: Mirrors the Inbox (003 R1): SSR for LCP ≤ 2 s, client for freshness; one fetch path and one type (`WorkflowDetail`).

## Resolved unknowns summary

| Unknown | Resolution |
|---------|------------|
| Where do stage transitions live? | `workflow_transitions.stage_id` (R1) |
| How is the agent timeline stored? | bounded JSONB on `agent_runs` (R2) |
| Second SSE stream or reuse? | reuse `inbox.changed`, filter `workflowId` (R3) |
| Where are derivation rules? | pure functions in contracts, composed by the API (R4) |
| How are retry/escalate/cancel gated? | one POST, role gate, transition log with `user_id` (R5) |
| How is immutability enforced? | DB trigger on artifacts (R6) |
| Test results depth? | summary rows + href (R7) |
| Which seed workflows carry history? | `s500-001` and `s500-045` (R8) |
| OpenAPI artefact shape? | fragment + merged document (R9) |
| Any design-system change? | none — every region maps to an existing component (plan: Design System Compliance) |

## Architecture document updates required (same change)

- §4 "Streaming to the browser": the Workflow Detail page subscribes to the same stream and filters by `workflowId`; stage/run/artifact/test-run tables feed `inbox_change_log`.
- §8 repository layout: `packages/db/migrations/0002_workflow_detail.sql`, `apps/api/src/routes/workflows.ts`, `apps/web/app/(app)/workflows/[id]/WorkflowDetailScreen.tsx`.

---

# Part B — User Story 2 (Approval Center)

**Phase 0 output** for plan.md Part B. R1–R10 remain in force; R11–R20 add the decisions US2 needs. Branch `feature/US2`.

## R11 — Human decisions are a separate write path from agent ingestion

**Decision**: Add `apps/api/src/services/decisions.ts` (`approveApproval`, `rejectApproval`, `answerClarification`) and routes `POST /api/approvals/{id}/approve`, `POST /api/approvals/{id}/reject`, `POST /api/clarifications/{id}/answer`, authenticated with the session cookie (`app.requireUser`, CSRF/origin check) and gated to `approver` / `administrator` (FR-032). `IngestionService` is untouched apart from accepting the new optional clarification context fields (R14). Agent ingestion keeps writing *observed* facts (`decision` echoed back from the runtime); the human path writes *authoritative* decisions attributed to a `users.id`.

**Rationale**: The two paths have different principals (Bearer ingestion principal vs. session user), different authorisation (project scope vs. role + project membership), different concurrency rules (ingestion is idempotent upsert with `observedAt` staleness; a human decision is exactly-once, FR-015) and different audit obligations. Mixing them in one service would force every branch to check "who am I" before every write. The existing human write path (`workflow-actions.ts`, R5) already established the pattern: a `SessionUser`, a `DetailScope`, `FOR UPDATE`, `canTransition`, a transition row with `user_id`.

**Alternatives**: Reuse `POST /workflows/{id}/actions` with new action names (`approve`, `reject`, `answer`) — rejected: those actions target an approval/clarification row, not the workflow, and need item-specific bodies (reason, target, answer). A generic `POST /decisions` with a discriminated body — rejected: three small routes are simpler to document, gate and test; the OpenAPI stays readable.

## R12 — Exactly-once resolution: lock the item, then the workflow; loser gets the recorded outcome

**Decision**: Inside one `app.tx({ isolation: 'REPEATABLE READ' })`: `SELECT … FROM approvals WHERE id = $1 AND organization_id = $2 FOR UPDATE` (same for `clarifications`); if the row is already decided/answered → throw `ProblemError(409, urn:cdevi:problem:already-resolved)` carrying a `resolution` extension (`outcome`, `by { id, displayName }`, `at`, `reason`, `target`, `answer`, `workflowState`); otherwise lock the workflow row `FOR UPDATE`, require `state = 'WAITING_FOR_HUMAN'`, apply `canTransition(from, to)` from `@cdevi/contracts`, write the item, the transition (`user_id` set, `reason` = human reason), the audit event, and let the existing `notify_inbox_changed()` triggers fire. Two concurrent callers serialise on the item lock; the second one observes the committed decision after the first commits and gets 409 with the existing outcome (spec edge case "first writer wins").

**Rationale**: `SELECT … FOR UPDATE` on the item row is the smallest lock that makes "exactly once" true under REPEATABLE READ — the second transaction's locked read returns the *newest committed* version of the row (Postgres re-reads locked rows), so it sees `decision IS NOT NULL` even though its snapshot predates the first commit. Locking the item before the workflow keeps lock order identical to ingestion (`lockWorkflow` then item upsert is the reverse — but ingestion never locks approvals/clarifications, so no cycle). Returning 409 + the resolution rather than 200 satisfies FR-015 "later attempts MUST be refused with the existing outcome shown" and gives the web a single code path for "already resolved, by whom, with what".

**Alternatives**: `UPDATE … WHERE decision IS NULL RETURNING` (compare-and-set) — correct for the approval row alone but cannot atomically also guard the workflow state and transition; advisory locks — extra machinery for the same effect; returning 200 with the existing outcome — hides that the caller's action was *not* applied and breaks the "refused" wording.

## R13 — Resulting workflow state per decision

**Decision**: approve → `RUNNING`; answer → `RUNNING`; reject → caller-chosen `BLOCKED` (default in the UI) or `CANCELLED`. Every target is reachable from `WAITING_FOR_HUMAN` in the 0001 state machine (`canTransition`), so no state-machine change. If the workflow is not in `WAITING_FOR_HUMAN` the request is refused with the existing `invalid-transition` 409 and nothing is written. The rejection reason is stored on the approval (`rejection_reason`, `rejection_target`) *and* copied to `workflow_transitions.reason` so the agent run's activity feed shows it (scenario 5: "the requesting agent's run records the rejection").

**Rationale**: Scenario 3/4 say the workflow "leaves `WAITING_FOR_HUMAN`" / resumes; the runtime resumes the paused stage, so `RUNNING` is the observed truth. Scenario 5 names `BLOCKED` with `CANCELLED` as the user's choice. Reusing `workflow_transitions` (R1) is what makes the rejection visible in the Workflow Detail activity feed without a new join.

**Alternatives**: `WAITING` on approve (waiting for the runtime to pick up) — rejected, the Inbox would keep showing the item as a needs-you fallback; a dedicated `agent_run_events` write — the feed already derives from transitions.

## R14 — Clarification context and answer storage

**Decision**: Extend `clarifications` with `why_it_matters text`, `options jsonb NOT NULL DEFAULT '[]'` (array of `{ value, label, recommended }`), `links jsonb NOT NULL DEFAULT '{}'` (`requirement`, `workflow`, `agentRun`, `externalTicket` hrefs), `answer_text text`, `answer_option text`, `answered_by_user_id uuid REFERENCES users(id)`. Extend `approvals` with `context text`, `links jsonb`, `rejection_reason text`, `rejection_target workflow_state`, `decided_by_user_id uuid`. `answered_by` / `decided_by` (text) stay as the display name so the Inbox and seed keep working. Ingestion (`ClarificationUpsert`, `ApprovalUpsert`) accepts the new optional context fields so agents can supply "why this matters", options and links (scenario 2).

**Rationale**: Scenario 2 needs question, why it matters, options and four links; scenario 3 needs the answer text with author and time. JSONB for options/links keeps the migration small and matches R2 (bounded JSONB for agent-supplied structure); bounds are enforced in Zod (≤ 8 options, ≤ 4 links, label ≤ 120, answer ≤ 2 000 chars). A `users.id` FK is added because audit (FR-029) needs a stable actor id, not just a name.

**Alternatives**: A `clarification_options` table — over-normalised for ≤ 8 rows never queried independently; storing the answer only in `audit_events` — the requirement record (scenario 3) would need to join audit for display.

## R15 — Append-only `audit_events`

**Decision**: New table `audit_events (id, organization_id, project_id, workflow_id, actor_type ('user'|'agent'|'system'), actor_id uuid null, actor_name text, action text, target_type text, target_id uuid, risk_level risk_level null, result text, policy text null, details jsonb, occurred_at)` in `0003_approval_center.sql`, with indexes on `(organization_id, occurred_at DESC)` and `(organization_id, target_type, target_id)`, RLS + `app_user` `SELECT, INSERT` only, and a `BEFORE UPDATE OR DELETE` trigger that raises — append-only in the database, not just by convention. Every human decision writes one row in the same transaction. Actions are `approval.approved`, `approval.rejected`, `clarification.answered`; result mirrors the resulting workflow state.

**Rationale**: FR-029 lists timestamp, actor, action, target, workflow, policy, risk, result — exactly the columns of the design-system `AuditEvent` row, so the detail screen renders it with `AuditTable` unchanged. `policy` is nullable now (policy engine is a later story). The raising trigger is the same technique R6 used for artifact immutability.

**Alternatives**: Reuse `ingestion_log` — wrong actor and shape; reuse `workflow_transitions` — no target/risk/result columns and not every audit event is a transition.

## R16 — Approval Center read model

**Decision**: `GET /api/approvals?project=all|{uuid}` returns `ApprovalCenterSnapshot { generatedAt, project, items[] (≤ 200), counts { approvals, clarifications } }` where each `ApprovalCenterItem` is a union of pending approvals and clarifications for visible projects whose workflow is `WAITING_FOR_HUMAN`, ordered by `riskRank(riskLevel) DESC, requestedAt ASC, id ASC` in SQL (`orderApprovalCenter` in contracts is the pure mirror used by tests). Clarifications carry `riskLevel: null` and sort **after** all approvals (rank −1), oldest first. `GET /api/approvals/{id}` returns `ApprovalCenterDetail` (item + kind-specific `approval` or `clarification` block + `resolution | null` + `audit[]` (≤ 20 events for the target) + `canDecide` derived from the session role). Project visibility reuses `visibleProjects()` (administrators all, others by membership); an unknown or invisible id is 404 like every other read.

**Rationale**: Scenario 1 orders "highest risk and oldest first" — same rule as the Inbox `orderNeedsYou`, reused via `riskRank`. 200 items is far above the S-500 pending count (36) and keeps the payload < 96 KB; a cursor is deferred (research summary). Putting `canDecide` in the response lets the screen render the permission-disabled state without duplicating role rules client-side.

**Alternatives**: Reuse the Inbox `needsYou` tab — it is per-workflow and mixes blocked/failed items; a separate `/clarifications` list — scenario 1 requires one list.

## R17 — Confirmation for HIGH/CRITICAL is enforced in both layers

**Decision**: `ApproveRequest { confirmed: boolean }`. The pure rule `requiresConfirmation(riskLevel)` (HIGH, CRITICAL → true) lives in `@cdevi/contracts`; the API refuses `confirmed: false` for such approvals with 400 `validation` (`path: 'confirmed'`); the web renders the two-step "Confirm approval" `DecisionCard` that restates the ask and `RiskBadge` before it sends `confirmed: true`. LOW/MEDIUM approve in one click.

**Rationale**: FR-013 is a system requirement, not a UI nicety — an API client must not be able to skip it. The same pure rule drives both layers, so they cannot drift.

## R18 — Web: `/approvals` list + `/approvals/[id]` decision view, server first paint, SSE refresh

**Decision**: `apps/web/app/(app)/approvals/page.tsx` (server component reads the snapshot with the selected project) renders `ApprovalCenterScreen` (client; `subscribeInboxStream` refetch on `inbox.changed`, debounced 300 ms as the Inbox does). `apps/web/app/(app)/approvals/[id]/page.tsx` stops calling `renderRecord` and renders `ApprovalDecisionScreen` (client) which owns the forms and posts decisions through `/api/*`. `record-page.tsx` / `RecordStub.tsx` lose their `approvals` branch (the `workflows` branch was already removed in US1 — the file is deleted if nothing else uses it). After a decision the screen shows the resolution `Notice` and keeps the Back-to-Approval-Center link; on 409 `already-resolved` it renders the returned resolution with an "already resolved by … at …" notice (edge case). The header count already points at `/approvals` via `NavItem count` (scenario 6) — no change beyond keeping it fresh.

**Rationale**: R10 (server first paint, client refresh) and R3 (reuse `inbox.changed`) apply unchanged; the decision and answer writes change approval/clarification/workflow rows, all of which already fire `notify_inbox_changed()`, so the header count and Inbox refresh for free.

**Alternatives**: Inline decision forms in the list rows — violates DR-02 (one saffron control per screen) as soon as two items are visible.

## R19 — Seed: the three Independent-Test items

**Decision**: Add to S-500 three deterministic showcase items on `WAITING_FOR_HUMAN` workflows: `s500-apr-req` (requirement approval, LOW, "Approve requirement spec for …"), `s500-apr-pr` (PR-merge approval, MEDIUM, with `links.pullRequest`), `s500-clr-01` (clarification with `why_it_matters`, three options — one recommended — and all four links). The Playwright Independent Test creates its own three items through ingestion with `uniq()` ids (isolation), and the seeded ones are what a demo user sees. Seed reset truncates `audit_events` too.

## R20 — OpenAPI: extend the 001 fragment; architecture doc carry-over

**Decision**: The three decision routes and the two Approval Center reads join `buildWorkflowDetailOpenApi()` (retitled "specs/001 US1–US2"); the ingestion `ClarificationUpsert`/`ApprovalUpsert` schemas gain the optional context fields in the 003 document (additive). `docs/architecture.md` was already reconciled for the "obvious/workbooks/billing" carry-over (spec.md line 298) by specs/003 and US1; US2 marks the "Approve / reject / answer clarification" interaction (§4) and the audit log (§5) as landed and adds the new files to §8. No other deviation from the architecture document.

## Resolved unknowns summary (Part B)

| Unknown | Resolution |
|---------|------------|
| Separate service or ingestion? | `services/decisions.ts`, three session routes (R11) |
| How is exactly-once enforced? | item `FOR UPDATE` → 409 `already-resolved` with resolution (R12) |
| Resulting states? | approve/answer → RUNNING; reject → BLOCKED or CANCELLED (R13) |
| Where do options / why / links / answer live? | columns + bounded JSONB on `clarifications`, `approvals` (R14) |
| Audit storage? | `audit_events`, append-only by trigger (R15) |
| List ordering and scope? | `riskRank DESC, requestedAt ASC`, clarifications last, `visibleProjects` (R16) |
| Who enforces HIGH/CRITICAL confirmation? | both layers via `requiresConfirmation` (R17) |
| Cursor paging for the list? | deferred — 200-item bound; add a keyset cursor when an organization exceeds it |
| Any design-system change? | none — `DecisionCard`, `OptionRow`, `TextArea`, `Notice`, `AuditTable`, `RiskBadge`, `StatePill` cover every region |

## Architecture document updates required (Part B)

- §4 interaction table: "Approve / reject / answer clarification" → landed (`POST /api/approvals/{id}/approve|reject`, `POST /api/clarifications/{id}/answer`).
- §5: audit events persisted in `audit_events` (append-only) for human decisions; policy column reserved.
- §8 repository layout: `packages/db/migrations/0003_approval_center.sql`, `apps/api/src/services/decisions.ts`, `apps/api/src/routes/approvals.ts`, `apps/web/app/(app)/approvals/`.

---

# Part C — User Story 3 (Dashboard): R21–R30

Scope reminder (approved, not reopened): no review/finding tables (US6); `/workflows` stays the `[section]` placeholder — Dashboard links carry the query params the Workflow Center will honour; no new tables — the Dashboard is a read model over `workflows`, `workflow_stages`, `agent_runs`, `artifacts`, `test_runs`, `approvals`, `clarifications`, `workflow_transitions`, `audit_events`; only an index-only migration `0004_dashboard.sql`.

## R21 — Time window: `window = 24h | 7d | 30d`, default `7d`, closed on `now`

**Decision**: `DashboardQuery { project: 'all' | Uuid = 'all', window: '24h' | '7d' | '30d' = '7d' }`. The window is `[now − W, now]` with `now = app.now()` (fixed clock in tests, R-003 pattern). It applies **only to rate and event figures**: PRs generated, test pass rate, agent success rate, human intervention rate, HIGH/CRITICAL audit events. Point-in-time figures (active workflows, running agents, pipeline, needs-me, open failures, pending HIGH/CRITICAL approvals, active cards) ignore the window — they describe *now*. The snapshot echoes `window: { key, from, to }` so the UI labels every windowed figure ("last 7 days").

**Rationale**: `7d` is already the Inbox "Done" horizon (`DONE_WINDOW_MS` in `@cdevi/contracts/read-model`), so the two screens agree by default; `24h` answers "what happened since yesterday", `30d` is the leadership cadence. A closed enum keeps the query cacheable and bounded (no arbitrary `from/to`, which would allow unbounded scans at SC-007 scale). Mixing windowed and current figures is what the story asks for ("pending" vs "in the window") and is made explicit per figure in data-model §19.

**Alternatives considered**: free `from`/`to` (unbounded, rejected); a single fixed 7-day window (no leadership view, rejected); windowing every figure including pipeline counts (a workflow that entered a stage 8 days ago would vanish — misleading, rejected).

## R22 — Aggregation shape: eight bounded statements in one `REPEATABLE READ` transaction

**Decision**: `services/dashboard.ts › dashboardSnapshot(client, scope, query, now)` runs, in one `app.tx({ isolation: 'REPEATABLE READ' })` (same as Workflow Detail R4 and the Approval Center), these statements, all scoped by `organization_id = $org AND project_id = ANY($projects)` where `$projects` = `visibleProjects()` (or the single requested project if visible):

| # | Statement | Feeds | Index (existing / `0004`) |
|---|-----------|-------|---------------------------|
| Q1 | `SELECT COUNT(*) FILTER (WHERE state IN <active>) …, COUNT(*) FILTER (WHERE state IN ('RUNNING','RETRYING')), COUNT(*) FILTER (WHERE state IN ('FAILED','BLOCKED')), COUNT(*) FILTER (WHERE state = 'FAILED'), COUNT(*) FILTER (WHERE state = 'BLOCKED'), 7 × COUNT(*) FILTER (WHERE state IN <active> AND stage_index = n), COUNT(*) FILTER (WHERE state IN <active> AND (stage_index IS NULL OR stage_index NOT BETWEEN 1 AND 7)), COUNT(*) FILTER (WHERE pull_request_ref IS NOT NULL AND COALESCE(finished_at, state_observed_at) >= $from) FROM workflows WHERE …` | counts, pipeline, needsMe.failed, needsMe.blocked | `workflows_org_project_state_idx` (existing) |
| Q2 | `SELECT COUNT(*) FILTER (WHERE a.risk_level IN ('HIGH','CRITICAL')) AS high, COUNT(*) AS pending FROM approvals a JOIN workflows w ON w.id = a.workflow_id WHERE a.decision IS NULL AND w.state = 'WAITING_FOR_HUMAN' AND …` | needsMe.approvals, risk.pendingHighCritical | `approvals_pending_idx` (existing) |
| Q3 | same over `clarifications c … WHERE c.answered_at IS NULL AND w.state = 'WAITING_FOR_HUMAN'` | needsMe.clarifications | `clarifications_pending_idx` (existing) |
| Q4 | `SELECT COALESCE(SUM(passed),0), COALESCE(SUM(passed + failed),0) FROM test_runs WHERE finished_at >= $from AND finished_at <= $to AND …` | health.testPassRate | `test_runs_org_project_finished_idx` (**0004**, partial `finished_at IS NOT NULL`) |
| Q5 | `SELECT COUNT(*) FILTER (WHERE state = 'COMPLETED'), COUNT(*) FILTER (WHERE state IN ('COMPLETED','FAILED')) FROM agent_runs WHERE finished_at BETWEEN $from AND $to AND …` | health.agentSuccessRate | `agent_runs_org_project_finished_idx` (**0004**, partial) |
| Q6 | `SELECT COUNT(*) AS den, COUNT(*) FILTER (WHERE EXISTS (approvals a WHERE a.workflow_id = w.id) OR EXISTS (clarifications c WHERE c.workflow_id = w.id) OR EXISTS (workflow_transitions t WHERE t.workflow_id = w.id AND t.user_id IS NOT NULL)) AS num FROM workflows w WHERE (state IN <active> OR COALESCE(finished_at, state_observed_at) >= $from) AND …` | health.humanInterventionRate | `approvals_workflow_idx`, `clarifications_workflow_idx` (**0004**); `workflow_transitions_workflow_idx` (existing) |
| Q7 | `SELECT COUNT(*) FROM audit_events WHERE risk_level IN ('HIGH','CRITICAL') AND occurred_at BETWEEN $from AND $to AND organization_id = $org AND (project_id = ANY($projects) OR ($all AND project_id IS NULL))` | risk.auditHighCritical | `audit_events_org_risk_time_idx` (**0004**, partial `risk_level IN ('HIGH','CRITICAL')`) |
| Q8 | `SELECT w.id, external_id, title, agent, state, stage_index, stage_count, stage_name, started_at, state_observed_at FROM workflows w WHERE state IN <active> AND … ORDER BY state_observed_at DESC, id ASC LIMIT 12` | activeWorkflows | `workflows_org_project_state_idx` |

`<active>` = the seven non-terminal states (`QUEUED, RUNNING, RETRYING, WAITING, WAITING_FOR_HUMAN, BLOCKED, FAILED`, i.e. `!isTerminal`). Every statement is an aggregate or `LIMIT 12`; the response is built by the pure `buildDashboardSnapshot(rows, now, window)` in `@cdevi/contracts/dashboard-model`, so the SQL only counts and the derivation is unit-tested without a database. The route emits `Server-Timing: db;dur=…` like the Approval Center.

**Rationale**: SC-007 sets the workload (500 workflows / 5 000 agent runs / 50 000 audit events). Each statement touches one table through one index and returns ≤ 12 rows, so cost is proportional to the *filtered* subset, not to table size — the partial indexes in 0004 make the 50 000-row `audit_events` and 5 000-row `agent_runs` scans index-only. One transaction keeps the eight figures mutually consistent (a workflow cannot be counted as RUNNING in Q1 and appear as FAILED in Q8).

**Alternatives considered**: one giant CTE statement (harder to attribute time and to keep each part index-friendly; same consistency guarantee already given by the transaction — rejected); a materialised view or a `dashboard_counters` table refreshed by trigger (a new table, contrary to the approved scope, and stale under SC-003 — rejected); computing rates from `inbox_change_log` (not a fact table — rejected).

## R23 — Index-only migration `0004_dashboard.sql`

**Decision**: five indexes, no tables, no columns, no grants (indexes inherit):

```sql
CREATE INDEX test_runs_org_project_finished_idx  ON test_runs  (organization_id, project_id, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX agent_runs_org_project_finished_idx ON agent_runs (organization_id, project_id, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX audit_events_org_risk_time_idx      ON audit_events (organization_id, project_id, occurred_at DESC) WHERE risk_level IN ('HIGH','CRITICAL');
CREATE INDEX approvals_workflow_idx              ON approvals (workflow_id);
CREATE INDEX clarifications_workflow_idx         ON clarifications (workflow_id);
```

`schema.ts` mirrors them in the Drizzle `index()` definitions; `packages/db/tests/schema.test.ts` asserts `pg_indexes` rows and that `EXPLAIN (FORMAT JSON)` of Q4/Q5/Q7 at the SC-007 fixture reports an index (bitmap or index-only) scan rather than a seq scan.

**Rationale**: the existing `approvals_pending_idx` / `clarifications_pending_idx` are partial on pending items and cannot serve Q6's "ever had a human action" EXISTS; `audit_events_org_time_idx` is not selective on risk at 50 000 rows; `agent_runs_workflow_idx` and `test_runs` have no org/project/finished path.

**Alternatives considered**: no new indexes (Q7 seq-scans 50 000 rows — measured risk to the 300 ms budget, rejected); covering indexes with `INCLUDE (passed, failed)` (premature; add if Q4 misses its budget).

## R24 — Figure derivations (FR-023) from existing tables

**Decision** (exact rules mirrored as pure functions in `@cdevi/contracts/dashboard-model`, data-model §19):

| Figure | Definition | Windowed? |
|--------|------------|-----------|
| activeWorkflows | workflows whose state is not terminal (`!isTerminal`) | no |
| runningAgents | workflows in `RUNNING` or `RETRYING` — the workflow's `agent` column is the agent at work | no |
| prsGenerated | workflows with `pull_request_ref IS NOT NULL` whose `COALESCE(finished_at, state_observed_at)` lies in the window | yes |
| openFailures | workflows in `FAILED` or `BLOCKED` ("incidents / failures") | no |
| pipeline[n].count (n = 1..7) | active workflows with `stage_index = n`; `pipeline.unstaged` = active workflows with no valid `stage_index` (counted in activeWorkflows, shown as a footnote, never silently dropped) | no |
| needsMe.approvals / .clarifications | pending items (`decision IS NULL` / `answered_at IS NULL`) on `WAITING_FOR_HUMAN` workflows — identical to the Approval Center `counts` (R16) so header, Approval Center and Dashboard agree | no |
| needsMe.failed | workflows in `FAILED` | no |
| needsMe.blocked | workflows in `BLOCKED` (SC-002 requires BLOCKED workflows to appear in the needs-me area; scenario 2 names approvals, clarifications and failed — blocked is the additive fourth count) | no |
| health.testPassRate | `Σ passed / Σ (passed + failed)` over `test_runs` finished in the window (skipped tests are not evidence either way) | yes |
| health.agentSuccessRate | `COMPLETED / (COMPLETED + FAILED)` over `agent_runs` finished in the window | yes |
| health.humanInterventionRate | numerator: workflows with ≥ 1 approval **or** clarification (any decision state) **or** a `workflow_transitions` row with `user_id IS NOT NULL`; denominator: workflows that are active or finished/observed in the window | yes |
| risk.pendingHighCritical | pending approvals with `risk_level IN ('HIGH','CRITICAL')` on `WAITING_FOR_HUMAN` workflows | no |
| risk.auditHighCritical | `audit_events` with `risk_level IN ('HIGH','CRITICAL')` in the window (events without a project are counted only for `project=all`) | yes |
| risk.securityFindings | **not connected** (R29) | — |

Rates are transported as `{ numerator, denominator }`; `ratePercent()` returns `null` when the denominator is 0 and the UI renders "—" with "No {test runs \| agent runs \| workflows} in this window" (never `0 %`, never `NaN`). Percent is rounded to one decimal at render time (`97.4 %`), never in the API.

**Rationale**: every figure is a set the user can open (FR-023), so each definition is phrased as a filter a list can reproduce (R25). "Running agents" reads `workflows.agent` because agent runs are only ingested for instrumented workflows (S-500 has 13 runs for 500 workflows) and a dashboard that shows "0 running agents" next to "60 running workflows" would be wrong. Human intervention counts *any* human touch (asked or acted) because the story defines it as "requiring at least one human action" — a pending approval already required one.

**Alternatives considered**: runningAgents from `agent_runs.finished_at IS NULL` (sparse data, rejected — noted as the definition to switch to once US5 makes runs mandatory); pass rate including skipped in the denominator (penalises quarantined tests, rejected); intervention rate over *all* workflows ever (no window ⇒ meaningless trend, rejected).

## R25 — Every figure has an href; the project scope is the shared cookie, not a query param

**Decision**: hrefs are computed by the pure `dashboardHrefs(window)` and returned in the snapshot, so API tests pin them and the UI never builds URLs:

| Figure | href |
|--------|------|
| activeWorkflows | `/workflows?state=QUEUED,RUNNING,RETRYING,WAITING,WAITING_FOR_HUMAN,BLOCKED,FAILED` |
| runningAgents | `/workflows?state=RUNNING,RETRYING` |
| prsGenerated | `/workflows?hasPr=true&window={key}` |
| openFailures | `/workflows?state=FAILED,BLOCKED` |
| pipeline[n] | `/workflows?stage={n}` (approved scope decision 2) |
| pipeline.unstaged | `/workflows?stage=none` |
| needsMe.approvals | `/approvals` |
| needsMe.clarifications | `/approvals?kind=clarification` |
| needsMe.failed | `/workflows?state=FAILED` |
| needsMe.blocked | `/workflows?state=BLOCKED` |
| health.testPassRate | `/testing?window={key}` |
| health.agentSuccessRate | `/agents?window={key}` |
| health.humanInterventionRate | `/workflows?intervention=human&window={key}` |
| risk.pendingHighCritical | `/approvals?risk=HIGH,CRITICAL` |
| risk.auditHighCritical | `/audit?risk=HIGH,CRITICAL&window={key}` |
| risk.securityFindings | `/reviews` (placeholder; link is present but labelled "not connected yet") |
| activeWorkflows[i] | `/workflows/{id}` (Workflow Detail, US1) |
| "Show all N" under the cards | activeWorkflows href |

The selected project travels in the `cdevi_project` cookie shared by every screen (R18, Inbox), so hrefs carry **no** `project=`; the target screen reads the same cookie. `/workflows`, `/testing`, `/agents`, `/audit`, `/reviews` are placeholder sections today; the params are the contract those screens must honour (recorded in the Architecture doc, R30). `/approvals?kind=` and `/approvals?risk=` are additive filters for the Approval Center (accepted by `ApprovalCenterQuery` in a later story; ignored today, list still opens).

**Rationale**: FR-023 ("every figure MUST link to the filtered list behind it") is testable only if the href is data, not markup. Comma lists mirror the mandated `/audit?risk=HIGH,CRITICAL`.

**Alternatives considered**: hrefs with `?project=` (duplicates the cookie and diverges when the user changes project elsewhere, rejected); no href for placeholder screens (violates FR-023, rejected); a `state=active` alias (invents vocabulary the Workflow Center does not have yet, rejected).

## R26 — Live updates: refetch on `inbox.changed`, debounced 300 ms, no dashboard payload on the stream

**Decision**: `DashboardScreen.tsx` subscribes with the existing `subscribeInboxStream({ onChange })` (same helper as Inbox and Approval Center) and refetches `GET /api/dashboard?project=…&window=…` at most once per 300 ms while events arrive; the "live / reconnecting" `Pill` mirrors the stream state. Every write that moves a figure (state transition, approval, clarification, decision, test run, agent run) already fires `notify_inbox_changed()`, so no new NOTIFY, event or trigger is added. Focus is preserved across refetch (rows keyed by `workflowId`, figures re-rendered in place).

**Rationale**: FR-034/SC-003 need ≤ 5 s; the stream delivers in < 1 s and one aggregate call costs ≤ 300 ms (Part C budgets). Embedding a snapshot in the event would broadcast per-organization aggregates to every connected client on every change (N × cost) and leak project scope across users.

**Alternatives considered**: polling every 5 s (wasteful, later than the stream, rejected); a dedicated `dashboard.changed` event (nothing to add beyond `inbox.changed`, rejected); server push of the snapshot (scope leak, rejected).

## R27 — Web: `/dashboard` server first paint + client refresh; project selector with "All projects"

**Decision**: `apps/web/app/(app)/dashboard/page.tsx` (server) reads `cdevi_project` and `?window=` → `apiFetch<DashboardSnapshot>('/api/dashboard?project=…&window=…', { cookie })`; error → contract §4 *error*; success → `<DashboardScreen initial={snapshot} me={me} />`. `DashboardScreen.tsx` (client) owns the project `Select` (writes the cookie and `?project=` exactly like Inbox / Approval Center — FR-025 with "All projects"), the window `Select` (`?window=`), the SSE subscription and the refetch. Remove `dashboard` from the `[section]` fall-through. Elapsed time and relative times are formatted client-side from `elapsedMs` / ISO strings with `humanDuration` / `humanAgo` (`@cdevi/contracts/read-model`); everything else is displayed as received.

**Rationale**: identical composition to the two landed screens; server first paint meets SC-007's 2 s on cold load; the client only re-renders.

**Alternatives considered**: client-only page (slower first paint, rejected); embedding the Dashboard into the Inbox home (different audience, rejected).

## R28 — Design-system mapping: no new pattern

**Decision**: header counts = `StatGrid` of `Stat` whose `value` is a Next `Link` (so the figure itself is the link, FR-023) and whose `label` carries the window when applicable; pipeline = `Card` with a `List aria-label="Pipeline"` of seven `ListRow`s (`leading` = stage number, `title` = stage name linking to `/workflows?stage=n`, `trailing` = count) plus a `Bars` chart (`role="img"`, labelled summary) for the visual read; needs-me = `Card` "What needs me" with four `Stat`s (approvals, clarifications, failed, blocked); health = `Card` with three `Meter`s (`label` = metric name, `value`/`max` = numerator/denominator, `muted` when the denominator is 0) each followed by the percent as a link; risk = `Card` "Risk" with two `Stat`s whose `label` includes `RiskBadge level="HIGH"` + `RiskBadge level="CRITICAL"` (FR-026) and a `Notice tone="info"` for security findings (R29); active cards = `List aria-label="Active workflows"` of ≤ 12 `ListRow`s with `Mono` identifier, `StatePill`, `Meter` progress (`label` "Progress"), agent, elapsed. No `Button variant="saffron"` anywhere on the screen (R29/contract §2.9): the Dashboard offers no direct action — the needs-me counts are links to the Approval Center, where the single saffron action lives.

**Rationale**: DR-01 (state as a pill word), DR-02 (saffron = a person is needed **and** an action here; the Dashboard has counts, not actions), DR-03 (all figures are platform evidence — no agent claims are rendered), DR-05 layout. Each component above exists in design-system 1.3.0 → no bump, no CHANGELOG entry.

**Alternatives considered**: a new `KpiTile` component (`Stat` inside `Card` covers it; adding a pattern requires DESIGN.md §8 work for no new semantics — rejected); saffron for the needs-me card (violates DR-02 on a read-only screen — rejected; revisit only if a direct "Approve" appears on the Dashboard); a chart library (bundle budget and a11y; `Bars` + the `List` give the accessible equivalent — rejected).

## R29 — "Security findings: not connected yet" is an explicit, neutral state

**Decision**: `risk.securityFindings = { connected: false, count: null, href: '/reviews' }` in US3. The UI renders `Stat value="—" label="Security findings"` plus `Notice tone="info"` "Not connected yet — review findings arrive with PR Review (User Story 6)." Neutral tokens only: never `Pill variant="wait"`/saffron (no person is needed) and never a green/"ok" treatment (0 is not evidence of safety). When US6 lands, `connected: true, count: n` and the href becomes `/reviews?severity=HIGH,CRITICAL`; the schema is designed for that without a breaking change.

**Rationale**: approved scope decision 1; showing `0` would assert a fact the platform does not have (DR-03 evidence rule).

**Alternatives considered**: omitting the figure (the Independent Test lists it, rejected); `count: 0` (false evidence, rejected).

## R30 — Seed: a fifth project `dashboard-demo` produces the Independent Test figures without touching S-500

**Decision**: add `packages/db/src/seed/dashboard.ts › buildDashboardShowcase(base)` writing one extra project (`key: 'dashboard-demo'`, name "Dashboard Demo") with 24 workflows (`s500-d01…s500-d24`), 43 stage rows, 44 agent runs and 6 test runs, inserted by `seed()` **after** `buildS500` and **without** any project membership (only administrators see it, via the administrator rule in `visibleProjects`). `buildS500(base)` and its outputs (`EXPECTED_BUCKETS`, `EXPECTED_SHOWCASE`, `DECISION_SHOWCASE`, ids `s500-001…s500-500`) are byte-for-byte unchanged, so every US1/US2 pure seed test keeps passing. With `project = dashboard-demo`, `window = 7d`, at the fixed clock:

| Figure | Value | How the seed gets there |
|--------|-------|-------------------------|
| activeWorkflows | **18** | 2 QUEUED, 6 RUNNING, 1 RETRYING, 1 WAITING, 6 WAITING_FOR_HUMAN, 1 BLOCKED, 1 FAILED |
| needsMe.approvals | **4** | 4 pending approvals (CRITICAL, HIGH, MEDIUM, LOW) on 4 of the 6 WAITING_FOR_HUMAN workflows |
| needsMe.clarifications | **2** | 2 pending clarifications on the other 2 |
| needsMe.failed | 1 | the FAILED workflow (stage 5) |
| needsMe.blocked | 1 | the BLOCKED workflow (stage 4) |
| openFailures | 2 | FAILED + BLOCKED |
| runningAgents | 7 | 6 RUNNING + 1 RETRYING |
| pipeline 1..7 | 3, 2, 1, 4, 3, 3, 2 | stage_index assignment in data-model §21 (sums to 18) |
| prsGenerated | 6 | 5 COMPLETED with `pull_request_ref` finished 1–3 days ago + the MEDIUM PR-merge approval workflow |
| health.testPassRate | **97.4 %** = 974 / 1000 | 6 test runs finished in the window: five `[180 total, 177 passed, 3 failed]` on the COMPLETED workflows + one `[100, 89, 11]` on the FAILED workflow |
| health.agentSuccessRate | 94.6 % = 35 / 37 | 35 COMPLETED runs (7 per COMPLETED workflow) + 2 FAILED (the FAILED workflow, the RETRYING workflow's first attempt); 7 running runs are not finished |
| health.humanInterventionRate | 33.3 % = 8 / 24 | 4 + 2 pending items + 2 COMPLETED workflows carrying a decided approval |
| risk.pendingHighCritical | 2 | the CRITICAL and HIGH approvals |
| risk.auditHighCritical | 0 | the seed still leaves `audit_events` empty (US2 test `SC-006 … leaves audit_events empty` unchanged) |
| risk.securityFindings | not connected | R29 |
| activeWorkflows cards | 12 of 18 | ordered `state_observed_at DESC`; "Show all 18" links to the Workflow Center |

Consequences for existing **database-level** assertions (they count rows across the whole database, so they must add the new constant `EXPECTED_DASHBOARD = { workflows: 24, active: 18, approvals: 4, clarifications: 2, stages: 43, runs: 44, testRuns: 6 }`): `packages/db/tests/seed.test.ts` lines 164 and 166 (`500` → `EXPECTED_BUCKETS.total + EXPECTED_DASHBOARD.workflows`), 168 (`24` → `EXPECTED_BUCKETS.approvals + EXPECTED_DASHBOARD.approvals`), 169 (`12` → `+ EXPECTED_DASHBOARD.clarifications`), 185/186/188 (`EXPECTED_SHOWCASE.stages|runs|testRuns` → `+ EXPECTED_DASHBOARD.stages|runs|testRuns`); 187 (artifacts) unchanged. API tests use `≥ 24` / `≥ 12` and keep passing. E2E: `inbox-journey.spec.ts` keeps `toHaveCount(100)` after one "Load more" (page size 50; the administrator's Running tab now has 110 rows) and the last row stays `queued` (Running order is `started_at DESC NULLS LAST`: 88 started rows precede 22 queued rows, so row 100 is queued); the viewer's project option count is unaffected (no membership); `00-inbox-visual.spec.ts` screenshots of the administrator's "Needs you" list **change** (8 new needs-you rows enter the risk-ordered first page) and must be refreshed intentionally with `pnpm -F @cdevi/web exec playwright test 00-inbox-visual --update-snapshots` in the same commit as the seed (AGENTS.md sanctions this); the "Needs you" `toHaveCount(50)` still holds (first page). Nothing in US1 (`s500-001`, `s500-045`) or US2 (`s500-apr-req`, `s500-apr-pr`, `s500-clr-01`) moves.

**Rationale**: the S-500 pending buckets (24 approvals, 12 clarifications, 100 running) are asserted exactly by US1/US2 tests and by `EXPECTED_BUCKETS`; they cannot become 4 / 2 / 18 under `all`. The story's figures are per *selected project* (FR-023, FR-025), so a dedicated project is the only way to hit them exactly without rewriting S-500. Administrator-only visibility keeps every role-scoped e2e assertion (viewer/engineer/approver membership counts, project filters) intact.

**Alternatives considered**: mutating S-500 buckets (breaks `EXPECTED_BUCKETS`, seed tests, the 100-row Running assertion — rejected); making the Independent Test run against `all` (impossible without the previous option — rejected); a separate seed command (`pnpm db:seed:dashboard`) so the default seed is untouched (then `pnpm test:e2e` global-setup must call it anyway and the visual baseline still changes — same cost, more moving parts; rejected, but kept as the fallback if reviewers prefer an untouched `pnpm db:seed`).

## Resolved questions (Part C)

| Question | Answer |
|----------|--------|
| Window enum and default? | `24h \| 7d \| 30d`, default `7d`, closed on `app.now()` (R21) |
| Query shape for SC-007? | 8 bounded statements, one `REPEATABLE READ` tx, 5 new indexes (R22, R23) |
| How is each figure computed? | R24 table; pure mirror in `@cdevi/contracts/dashboard-model` |
| Where does each figure link? | R25 table; hrefs are data in the snapshot |
| Live updates? | `inbox.changed` → debounced refetch (R26) |
| Security findings? | explicit `connected: false`, neutral (R29) |
| Seed for 18 / 4 / 2 / 97.4 %? | fifth project `dashboard-demo`, administrator-only, S-500 untouched (R30) |
| Any design-system change? | none (R28) |
| Saffron on the Dashboard? | none — no direct action is offered (R28) |

## Architecture document updates required (Part C)

- §4 interaction table: "Dashboard" → landed (`GET /api/dashboard?project=&window=`), read model only.
- §6 (query contracts for placeholder screens): `/workflows?stage=n|state=A,B|hasPr=true|intervention=human`, `/approvals?kind=clarification|risk=HIGH,CRITICAL`, `/testing?window=`, `/agents?window=`, `/audit?risk=HIGH,CRITICAL&window=`, `/reviews` — parameters the later Workflow Center / Testing / Agent Activity / Audit Log screens must honour.
- §8 repository layout: `packages/db/migrations/0004_dashboard.sql`, `packages/db/src/seed/dashboard.ts`, `apps/api/src/services/dashboard.ts`, `apps/api/src/routes/dashboard.ts`, `apps/web/app/(app)/dashboard/`.
