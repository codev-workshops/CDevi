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

---

# Part D — User Story 4 (Requirements): R31–R45

Scope reminder (approved, not reopened — R31): analysis is produced by the agent runtime and delivered through the ingestion API (no analyzer, no LLM call in the API); Jira is inbound-only through a signed webhook (no outbound Jira calls, no OAuth, no Integrations screen — US8); the Workflow Center list page is not built (`/workflows` stays the `[section]` placeholder; a bounded `GET /api/workflows` is added for it to consume later). First migration that adds tables: `0005_requirements.sql`.

## R31 — Scope decisions recorded

**Decision**: (1) `POST /api/requirements/{id}/submit` moves `Draft → Analyzing` and records who/when; the runtime delivers results via `PUT /api/ingest/requirements/{externalId}/analysis`; `Ready` when there are no open questions, otherwise `Needs Clarification`. Seed and e2e simulate the runtime by calling the ingest endpoint with the seeded `e2e-tests` principal token. (2) `POST /api/integrations/jira/webhook`, HMAC-SHA256 over the raw body, constant-time compare, secret from `JIRA_WEBHOOK_SECRET`; `integration_project_mappings` maps a Jira project key to a CDevi project (seeded once for `payments-api`); created/updated → create/update, deleted/closed → flag + `BLOCKED`. (3) "Appears in the Workflow Center" is verified through `/workflows/{id}`, the Dashboard active-workflow card and `GET /api/workflows?project=&requirement=&state=&stage=&cursor=`.

**Rationale**: keeps the API deterministic and testable (no model in the loop), keeps secrets out of the repo, and keeps US4 from absorbing the Workflow Center (US5-scope list page) and US8 (Integrations).

**Alternatives considered**: built-in heuristic analyzer (non-deterministic quality, hides the runtime boundary FR-036 requires — rejected); Jira polling (needs outbound credentials — US8, rejected); building `/workflows` now (doubles the story — rejected).

## R32 — Requirement state machine and who may trigger each transition (FR-009, FR-032)

**Decision**: enum `requirement_state` = `DRAFT | ANALYZING | NEEDS_CLARIFICATION | READY | APPROVED | IN_IMPLEMENTATION | COMPLETED | REJECTED` (stored SCREAMING_SNAKE like `workflow_state`; displayed words come from the design system, R41). Transition table `REQUIREMENT_TRANSITIONS` in `@cdevi/contracts/requirement-rules` (zod-free), enforced by `canTransitionRequirement(from, to)` in the API and asserted by a `CHECK`-free but trigger-free design (the API is the only writer of state, except the follow-workflow trigger R33):

| From | To | Trigger | Actor / role gate |
|------|----|---------|-------------------|
| — | `DRAFT` | `POST /requirements`, Jira `issue_created`/first `issue_updated` | user with `canCreateRequirement` (engineer, approver, administrator) and visibility of the project; or the Jira webhook (actor `system`) |
| `DRAFT` | `ANALYZING` | `POST …/submit` | `canCreateRequirement`; records `submitted_by_user_id`, `submitted_at` |
| `NEEDS_CLARIFICATION` | `ANALYZING` | `POST …/submit` (resubmit) | `canCreateRequirement` |
| `ANALYZING`, `NEEDS_CLARIFICATION` | `READY` | ingest analysis with `openQuestions.length === 0` | ingestion principal scoped to the project (actor `agent`) |
| `ANALYZING`, `NEEDS_CLARIFICATION` | `NEEDS_CLARIFICATION` | ingest analysis with open questions | ingestion principal (actor `agent`) |
| `READY` | `APPROVED` | `POST …/approve` | `canDecide` (approver, administrator); creates the workflow (R37) |
| `DRAFT`, `NEEDS_CLARIFICATION`, `READY` | `REJECTED` | `POST …/reject` with `reason` | `canDecide` |
| `APPROVED` | `IN_IMPLEMENTATION` | linked workflow leaves `QUEUED` (any non-terminal state) | `system` (trigger, R33) |
| `APPROVED`, `IN_IMPLEMENTATION` | `COMPLETED` | linked workflow `COMPLETED` | `system` (trigger, R33) |

`ANALYZING → REJECTED` is not allowed (avoids racing the runtime; reject after the result lands). `REJECTED`, `COMPLETED` are terminal. Viewer: read-only on every route (403 `urn:cdevi:problem:forbidden`). Every human transition also checks project visibility (`visibleProjects`), returning 404 for invisible requirements (no existence leak). `requirementActions(state, role)` returns `{ canSubmit, canApprove, canReject, submitLabel: 'Submit for analysis' | 'Resubmit for analysis', reasons[] }` and is the single source for API enforcement and web affordances. Each transition writes one `requirement_transitions` row (`from_state`, `to_state`, `actor_type ∈ user|agent|system`, `actor_id`, `actor_name`, `reason`, `occurred_at`) and, for human/system decisions, one `audit_events` row (`requirement.submitted`, `requirement.approved`, `requirement.rejected`, `requirement.flagged`, `requirement.workflow_created`; `target_type = 'requirement'`, `risk_level = NULL` — requirements carry no risk level and the Dashboard counts only HIGH/CRITICAL audit rows, data-model §27).

**Rationale**: FR-009 fixes the eight states; FR-032 fixes the roles; reusing the existing predicates `canCreateRequirement` (`packages/contracts/src/vocabulary.ts`) and `canDecide` (`packages/contracts/src/decision-rules.ts`) keeps one role vocabulary. A dedicated append-only transitions table mirrors `workflow_transitions` for FR-002-style traceability while `audit_events` keeps the human-facing trail already rendered by `AuditTable`.

**Alternatives considered**: storing transitions only in `audit_events` (loses agent/system transitions that are not audit-worthy and mixes vocabularies — rejected); allowing engineers to approve their own requirement (violates FR-032 — rejected); a `CANCELLED` requirement state (not in FR-009 — rejected; `REJECTED` covers it).

## R33 — `Approved → In Implementation → Completed` follow the linked workflow through a trigger

**Decision**: `0005` adds `requirements_follow_workflow()` — `AFTER UPDATE OF state ON workflows FOR EACH ROW WHEN (NEW.requirement_id IS NOT NULL AND OLD.state IS DISTINCT FROM NEW.state)`: if the requirement is `APPROVED` and `NEW.state NOT IN ('QUEUED','CANCELLED','BLOCKED')` → `IN_IMPLEMENTATION` (a workflow blocked before it ran — e.g. by the Jira flag, R36 — leaves the requirement `APPROVED`); if the requirement is `APPROVED` or `IN_IMPLEMENTATION` and `NEW.state = 'COMPLETED'` → `COMPLETED`; otherwise no change. The trigger writes the `requirement_transitions` row (`actor_type = 'system'`, `actor_name = 'workflow'`, `reason = 'workflow ' || NEW.external_id || ' → ' || NEW.state`) and touches `updated_at` so `notify_requirement_changed()` fires. The pure equivalent `requirementStateForWorkflow(current, workflowState)` lives in `requirement-rules` so the web can predict the pill and the trigger is tested against the same table.

**Rationale**: three existing writers already update `workflows.state` (ingestion transitions, US2 decisions, US1 actions); a trigger keeps them untouched and 9b independent of 9c (Part D Complexity Tracking).

**Alternatives considered**: computing the requirement state at read time from the workflow (would make `state` a view column and break the list filter index — rejected); service call in each writer (coupling — rejected).

## R34 — Requirements table and analysis content model with `ai_generated` labelling

**Decision**: `requirements` (one row per requirement; data-model §22) carries identity (`id`, `organization_id`, `project_id`, `external_id` — the runtime handle, `req-<12 hex>` for manual rows, `req-<lowercased jira key>` for Jira rows, unique per organization), content (`title` ≤ 200, `business_objective` ≤ 4 000), lifecycle (`state`, `submitted_*`, `analysis_observed_at`, `analysis_agent`, `analysis_summary` ≤ 400, `approved_*`, `rejected_*`, `rejection_reason` ≤ 500), ownership (`created_by_user_id` nullable — Jira rows have none, `assignee_user_id` nullable) and the external link (`source ∈ manual|jira`, `external_ref jsonb` `{ provider:'jira', key, url, updatedAt }`, `external_flag ∈ deleted|closed` nullable, `external_flagged_at`). `requirement_analysis_items` holds every criterion / rule / open question as one row: `kind ∈ acceptance_criterion|rule|open_question`, `position`, `text` ≤ 1 000, `ai_generated boolean NOT NULL`, `source` ≤ 120 (`'user:<display name>'` for human-authored criteria entered on the create form, `'agent:<agent name>'` for ingested items), unique `(requirement_id, kind, ai_generated, position)` — human-authored and AI items have **disjoint position spaces** (human criteria 1..20, AI items 1..n per kind), so the first analysis ingest on a requirement created with authored criteria never collides with them; a `CHECK` restricts human rows to `kind = 'acceptance_criterion'` with `position <= 20`. Lists are ordered `ai_generated ASC, position ASC` (human criteria first). The API never sets `ai_generated = true` outside the ingest path and never `false` inside it. Responses expose `aiGenerated` and `source` on every `AnalysisItem`; the UI labels every `aiGenerated` item "AI-generated" (DR-03, FR-009).

**Rationale**: rows instead of a JSON blob give bounded, orderable items (≤ 120 per requirement enforced by the ingest schema), a truthful per-item provenance flag, and future per-item answers (clarifications) without a migration of the content shape.

**Alternatives considered**: one `analysis jsonb` column (cannot label per item, unbounded, no per-item identity — rejected); separate tables per kind (three identical tables — rejected).

## R35 — `PUT /api/ingest/requirements/{externalId}/analysis`: payload and idempotency

**Decision**: same conventions as `PUT /ingest/workflows/{externalId}` — bearer `ingestion_principals` token (`app.requirePrincipal`), principal must be scoped to the requirement's project (403 `urn:cdevi:problem:forbidden`), unknown `externalId` → 404, one transaction with `SELECT … FROM requirements … FOR UPDATE`, outcome written to `ingestion_log`. Body `RequirementAnalysisIngest { agent: line(80), observedAt: IsoDateTime, summary?: line(400) | null, acceptanceCriteria: line(1000)[] ≤ 50, rules: line(1000)[] ≤ 50, openQuestions: line(1000)[] ≤ 20 }`. Preconditions: state ∈ `ANALYZING | NEEDS_CLARIFICATION` (else 409 `urn:cdevi:problem:invalid-transition`). Idempotency: `observedAt <= analysis_observed_at` → `200 { outcome: 'stale', id, state }` with no write; otherwise delete the requirement's `ai_generated = true` items, insert the new ones (positions 1..n per kind with `ai_generated = true` — their own key space, so they never collide with the human criteria at positions 1..20), set `analysis_observed_at`, `analysis_agent`, `analysis_summary`, compute `stateAfterAnalysis(openQuestions.length)` = `READY` when 0 else `NEEDS_CLARIFICATION`, write the transition row (actor `agent`) and return `200 { outcome: 'accepted', id, state }`. Human-authored criteria (`ai_generated = false`) are never touched by ingestion. Replaying the same body is a no-op (`stale`); redelivering a newer analysis replaces the AI items wholesale.

**Rationale**: monotonic `observedAt` is the existing staleness rule (R-002/ingestion.ts); wholesale replacement keeps "the analysis" one coherent artefact instead of merging lists.

**Alternatives considered**: `POST` with an idempotency key header (new convention — rejected); merge by text (duplicates and reorders — rejected); accepting analysis while `DRAFT` (skips the submit audit — rejected).

## R36 — Jira webhook: signature verification, event mapping, project mapping and the BLOCKED edge case (FR-008)

**Decision**: `POST /api/integrations/jira/webhook` is registered in an encapsulated Fastify plugin that replaces the JSON content-type parser with `parseAs: 'buffer'` (body limit 256 KB) so the **raw bytes** are available; `verifyJiraSignature(raw, header, secret)` computes `HMAC-SHA256(secret, raw)` and compares to the `x-hub-signature` header (`sha256=<hex>`; I believe this is the header Jira Cloud sends when a webhook secret is configured — the header name is a single constant `JIRA_SIGNATURE_HEADER` so it can be corrected without touching logic) with `crypto.timingSafeEqual` on equal-length buffers; missing secret env, missing header, malformed or wrong signature all return **401** `urn:cdevi:problem:unauthenticated` (the missing env var is additionally logged once as a warning). After verification the buffer is parsed and validated with `JiraWebhookEvent` (400 Problem on failure, no body echoed). Mapping (`mapJiraEvent(event)` in `requirement-rules`, pure):

| `webhookEvent` | Condition | Effect | `outcome` |
|----------------|-----------|--------|-----------|
| `jira:issue_created` | project key mapped | create requirement `DRAFT`, `source = jira`, `external_ref = { provider:'jira', key, url: <baseUrl>/browse/<key>, updatedAt }`, `title = fields.summary`, `business_objective = adfToPlainText(fields.description) || 'Imported from Jira <key>'`, `assignee` = user with matching `emailAddress` in the organization if any | `created` |
| `jira:issue_updated` | key known, `fields.updated` newer than `external_ref.updatedAt` | update `title`, `business_objective`, `external_ref` (state unchanged); if `fields.status.statusCategory.key === 'done'` → also flag `closed` | `updated` / `flagged` |
| `jira:issue_updated` | key unknown | treated as created | `created` |
| `jira:issue_updated` | `fields.updated` not newer | no write | `stale` |
| `jira:issue_deleted` | key known | flag `deleted` | `flagged` |
| any | project key not mapped, or unknown event name | no write | `ignored` |

All outcomes return **202** `JiraWebhookResult { outcome, requirementId: Uuid | null }` so Jira does not retry; only auth/validation failures are non-2xx. `integration_project_mappings (organization_id, project_id, provider = 'jira', external_project_key, external_base_url)` is unique on `(provider, external_project_key)` — the webhook carries no organization, so a key resolves to exactly one project; the seed maps `PAY → payments-api` with base URL `https://jira.example.invalid`. The mapping lookup runs on `app.pool` (role `app_user`) before any organization is known; with `CDEVI_RLS=on` the org-isolation policy hides the rows — the same limitation the sessions bootstrap already has, and RLS is flag-off in dev/test/CI (data-model §22 Notes). **Open item (tracked in plan.md Part D Complexity Tracking, written to `docs/architecture.md` §6 by T118)**: before `CDEVI_RLS=on` is turned on in any deployment, the mapping lookup and the sessions bootstrap need a bypass role or a policy that admits `app.organization_id IS NULL` for these two reads — decided in the deployment/RLS story, not here. Secret plumbing: `apps/api/src/main.ts` reads `process.env['JIRA_WEBHOOK_SECRET']` and passes it as `BuildOptions.jiraWebhookSecret` (the same process.env → option convention as `rateLimit.signInMax`); the plugin receives `{ secret }` and never touches `process.env`, so tests inject `JIRA_TEST_SECRET` (`apps/api/tests/helpers.ts`) and the e2e suite injects `E2E.jiraWebhookSecret` (`apps/web/playwright.config.ts` → `sharedEnv.JIRA_WEBHOOK_SECRET`) without any change to `.github/workflows/ci.yml`. **Edge case**: flagging (`external_flag`, `external_flagged_at`) does not change the requirement state; the flag path reads the requirement `id` and its linked `workflows.id` without locking, then locks **the workflow first, then the requirement** (`SELECT … FOR UPDATE` each — the same order the R33 trigger uses, which fires inside a `workflows` UPDATE that already holds the workflow lock and then locks the requirement; a Jira flag and a concurrent stage ingest therefore never deadlock, see data-model §29 Lock order); if the linked workflow is in `QUEUED | RUNNING | RETRYING | WAITING | WAITING_FOR_HUMAN` (all of which allow `→ BLOCKED` in `WORKFLOW_TRANSITIONS`) it is moved to `BLOCKED` with `state_reason = 'Jira <key> <deleted|closed> — human decision required'`, its current non-terminal stage to `BLOCKED`, a `workflow_transitions` row (`reason` = the same text, `principal_id` and `user_id` both NULL — the table has no `source` column and 0005 adds none; NULL actor columns mark the system writer) and an `audit_events` row `requirement.flagged` (actor `system`, `result = 'blocked'`); the Inbox needs-you tab and Dashboard show it through the existing triggers. A workflow already `BLOCKED`, `FAILED`, `COMPLETED` or `CANCELLED` is left unchanged (the flag is still shown on the requirement). Unflagging is a human action deferred to US8. The Requirement Detail shows the flag as a `Notice tone="error"` (role `alert`; `NoticeTone` is `info | error` only — no new tone is added, and `error` is right because the workflow is paused pending a human decision) and the list row as a `Pill variant="blocked"` "Jira closed/deleted".

**Rationale**: raw-body HMAC with constant-time comparison is the standard webhook trust model and needs no outbound calls; 202-for-everything-verified avoids Jira retry storms; `statusCategory.key === 'done'` is Jira's provider-neutral notion of "closed".

**Alternatives considered**: IP allow-listing (Atlassian ranges change — rejected); parsing then re-serialising to verify (breaks on key order — rejected); moving the requirement to `REJECTED` on delete (destroys human context; spec says *flag* — rejected).

## R37 — Approve → workflow creation in one transaction (FR-010, SC-008)

**Decision**: `approveRequirement(client, user, id, now)` in `services/requirements.ts`, inside `app.tx({ organizationId, userId })`: (1) `canDecide(role)` else 403; (2) `SELECT … FROM requirements WHERE id = $1 AND project_id = ANY($visible) FOR UPDATE` else 404; (3) state must be `READY` else 409 `invalid-transition` (a second concurrent approver blocks on the lock and then sees `APPROVED` → 409 — exactly once, same as US2 `applyDecision`); (4) `INSERT INTO workflows (organization_id, project_id, external_id = 'wf-' || requirement.external_id, title, agent = NULL, state = 'QUEUED', state_observed_at = now, started_at = now, stage_index = 1, stage_count = 7, stage_name = 'Requirement', requirement_id)`; (5) seven `workflow_stages` rows from `SDLC_STAGES` (`@cdevi/contracts/dashboard-model`), positions 1–7, all `QUEUED`, `state_observed_at = now` (stage 1 is what the runtime picks up; there is no earlier vocabulary word for "not yet reached" and the Dashboard pipeline counts by `workflows.stage_index`); (6) `workflow_transitions (from_state NULL → to_state QUEUED, observed_at = now, reason = 'Requirement <externalId> approved', user_id = approver)` plus one per stage (`stage_id` set) — the columns 0001/0002 define, no `source` column; (7) `UPDATE requirements SET state = 'APPROVED', approved_by_user_id, approved_at`; (8) `requirement_transitions (READY → APPROVED, actor user)`; (9) `audit_events` `requirement.approved` (`workflow_id` set, `result = 'approved'`) and `requirement.workflow_created`; (10) commit. NOTIFY: the `workflows` insert trigger and the `requirements` update trigger both write `inbox_change_log` and `pg_notify('inbox_changed', …)` — Inbox, Dashboard, Requirement Detail and the open Workflow Detail all refetch (FR-034). Response `200 RequirementDetail` (with `linkedWorkflow`). `workflows.requirement_id` has a partial unique index so a requirement can own at most one workflow in US4.

**Rationale**: mirrors US2 (`decisions.ts`: lock → check → write → audit) and US1 ingestion (`QUEUED` first, transitions appended); one transaction satisfies "workflow is created and its first stage is queued" atomically.

**Alternatives considered**: creating the workflow through the ingestion service by "self-calling" `PUT /ingest/workflows` (two transactions, principal impersonation — rejected); leaving stages to the runtime (Workflow Detail would show 0/7 — rejected).

## R38 — `GET /api/workflows` list shape (bounded, keyset cursor, filters)

**Decision**: `WorkflowListQuery { project: 'all' | Uuid = 'all', requirement?: Uuid, state?: comma-separated WorkflowState list (≤ 9, `z.preprocess` split), stage?: int 1..7, cursor?: string ≤ 200 }`; response `WorkflowListPage { generatedAt, project, filters: { requirement, state[], stage }, items: WorkflowListItem[] (≤ 50), nextCursor: string | null, total: int }`. `WorkflowListItem` is the FR-003 shape: `{ id, externalId, title, project { id, key, name }, state, stateObservedAt, stage { index, count, name } | null, agent, pullRequestRef, requirement { id, title, href } | null, startedAt, finishedAt, href: '/workflows/{id}' }`. Order `state_observed_at DESC, id DESC`; cursor = b64url `['workflows', stateObservedAtIso, id]` (`encodeWorkflowCursor`/`decodeWorkflowCursor`, invalid → 400 `urn:cdevi:problem:invalid-cursor`, same as the Inbox). One `REPEATABLE READ` transaction, one page statement + one `COUNT(*)` with the same predicate; scoped by `visibleProjects`; invisible `project`/`requirement` → empty page with `total: 0`. Index `workflows_list_idx (organization_id, state_observed_at DESC, id DESC)`; `workflows_requirement_idx` serves `requirement=`. `WORKFLOWS_PAGE_SIZE = 50`. The Dashboard's §6 placeholder params (`hasPr`, `intervention`) are **not** added here — they are Workflow Center scope and are listed as an open question.

**Rationale**: the same cursor and bound conventions as `GET /api/inbox` (R5) so the Workflow Center can consume it unchanged; `requirement=` is what the Independent Test needs.

**Alternatives considered**: reusing `InboxItem` (needs-you vocabulary, no requirement link — rejected); offset pagination (unbounded scan — rejected).

## R39 — Requirements list filters (state / project / assignee) and keyset pagination

**Decision**: `RequirementListQuery { project: 'all' | Uuid = 'all', state?: comma-separated RequirementState list (≤ 8), assignee?: 'me' | 'unassigned' | Uuid, cursor?: string ≤ 200 }`; `RequirementListPage { generatedAt, project, filters: { state[], assignee }, items: Requirement[] (≤ 50), nextCursor, total }`. Order `created_at DESC, id DESC` (newest first — the list is a work queue for new work); cursor b64url `['requirements', createdAtIso, id]`. Indexes: `requirements_list_idx (organization_id, project_id, created_at DESC, id DESC)`, `requirements_state_idx (organization_id, state, created_at DESC, id DESC)` (full, not partial — `state=` accepts `COMPLETED`/`REJECTED` too, so a partial index would silently fall back to a scan for those filters), partial `requirements_assignee_idx (organization_id, assignee_user_id, created_at DESC, id DESC) WHERE assignee_user_id IS NOT NULL`; `EXPLAIN` tests assert an index scan for each filter at the fixture. Each `Requirement` row carries `linkedWorkflow { id, externalId, state, stage { index, count, name }, href } | null` (LEFT JOIN on `workflows.requirement_id`) and `openQuestionCount` (a correlated `COUNT` over `requirement_analysis_items … kind = 'open_question'`, bounded by the ≤ 20 rule). The filters are URL query params on `/requirements` (server first paint honours them; the client updates the URL with `router.replace`) so filtered views are linkable, like the Dashboard's `project`/`window`. `REQUIREMENTS_PAGE_SIZE = 50`.

**Rationale**: acceptance scenario 5 names the three filters and "the linked workflow's status"; FR-025 gives the project selector (with "All projects", administrators see all, others their memberships).

**Alternatives considered**: free-text search (unbounded `ILIKE` at scale — rejected for US4); ordering by `updated_at` (rows jump while the runtime writes — rejected).

## R40 — Live updates: `inbox_change_log.requirement_id` and refetch on `inbox.changed` (FR-034, SC-003)

**Decision**: `0005` makes `inbox_change_log.workflow_id` nullable and adds `requirement_id uuid`; new `notify_requirement_changed()` with **one** trigger, `inbox_changed_requirements` (`AFTER INSERT OR UPDATE ON requirements FOR EACH ROW`), inserts `(organization_id, project_id, NULL, requirement_id)` and `pg_notify('inbox_changed', json { seq, organizationId, projectId, workflowId: null, requirementId })`. **`requirement_analysis_items` has no trigger**: every write to it happens inside a transaction that also writes the parent `requirements` row (`POST /requirements` inserts the requirement, the analysis ingest ends with `UPDATE requirements SET state, analysis_summary, analyzed_at`), so one requirement-level row/NOTIFY per transaction already tells every subscriber to refetch; a per-row item trigger would emit up to ~240 `inbox_change_log` rows per analysis delivery (delete-then-insert of ≤ 120 items), eat the 200 ms ingest budget and the ≤ 1000-row SSE replay window for nothing. The existing `schema.test.ts` trigger-list assertion therefore gains exactly one name (data-model §22.7 notes). `plugins/notify.ts` parses `requirementId` (nullable) into `InboxChange`; `routes/inbox.ts` replays and emits `inbox.changed` frames as `{ seq, projectId, workflowId, requirementId }` (additive; the Inbox, Dashboard and Approval Center ignore the new key). `lib/inbox-stream.ts` gains a `requirementId` filter (generalising `frameWorkflowId` to `frameId(data, key)`); the Requirements list refetches on every visible frame (debounce 300 ms), the Requirement Detail only on frames carrying its `requirementId` **or** its linked `workflowId`. Budget: pill updated ≤ 5 s p95 after the ingest call (e2e measures it).

**Rationale**: one channel, one LISTEN connection, one replay table — the reason R6 chose NOTIFY; requirement changes are "inbox-relevant" (a `Needs Clarification` requirement is work for a person).

**Alternatives considered**: separate `requirements_changed` channel (second LISTEN client and SSE endpoint — rejected); polling (fails SC-003 median — rejected); per-row trigger on `requirement_analysis_items` (redundant with the parent UPDATE in the same transaction, ~240 rows per delivery — rejected); statement-level trigger on the items table (still one extra row per DELETE and per INSERT statement with no information the parent UPDATE does not carry — rejected).

## R41 — Requirement-state pill: `RequirementStatePill` in the design system (DR-01, DESIGN.md §4, §8)

**Decision**: `StatePill` **cannot legitimately render requirement states**: its `state` prop is `WorkflowState`, its words/pulse come from `stateToPill` (workflow vocabulary) and DESIGN.md §4 defines a *separate* requirement-lifecycle mapping. Rendering `Pill` with an app-side `switch` would move vocabulary into `apps/web` (DR-09: missing patterns are added to the package) and make the mapping untestable in the design system. Therefore 1.4.0 adds to `src/tokens.ts` the `RequirementState` union, `REQUIREMENT_STATES` tuple and **`requirementStateToPill: Record<RequirementState, StatePresentation>`** — a Record object with the same shape as the existing `stateToPill: Record<WorkflowState, StatePresentation>` (indexed `requirementStateToPill[state].word`, never called as a function; no `modifier` key) — plus `RequirementStatePill({ state })` next to `StatePill`, reusing the existing `.cd-pill` variant classes (no new CSS):

| State | Word | Variant | Pulse |
|-------|------|---------|-------|
| `DRAFT` | draft | neutral | no |
| `ANALYZING` | analyzing | run | yes |
| `NEEDS_CLARIFICATION` | needs clarification | needs-you | no |
| `READY` | ready | neutral | no |
| `APPROVED` | approved | done | no |
| `IN_IMPLEMENTATION` | in implementation | run | yes |
| `COMPLETED` | completed | done | no |
| `REJECTED` | rejected | fail | no |

Added per DESIGN.md §8 in tasks 9d: tokens + component + test (behaviour and `expectAccessible`) → export → gallery entry + visual baseline → DESIGN.md §3 row, §4 table, §5 glossary → CHANGELOG 1.4.0 + `package.json` bump → `pnpm check`. `apps/web/lib/ds.ts` re-exports it. The linked workflow's state stays a `StatePill`. `@cdevi/contracts/requirement-rules` carries the same words as `REQUIREMENT_STATE_WORDS` (for API copy and e2e assertions); the two tables are asserted equal in an `apps/web` test (T110) because `apps/web` is the only package depending on both `@cdevi/contracts` and `@cdevi/design-system` — neither package gains a dependency on the other.

**Rationale**: DR-01 demands the word in a pill; keeping both mappings in `tokens.ts` keeps the design system the single vocabulary owner.

**Alternatives considered**: widening `StatePill`'s union (conflates two state machines and their tests — rejected); app-local `Pill` switch (DR-09 — rejected).

## R42 — Hrefs and external links

**Decision**: `requirementHrefs` (pure): requirement `/requirements/{id}`; linked workflow `/workflows/{id}` (Workflow Detail, existing); Jira `external_ref.url` rendered as an `<a href target="_blank" rel="noopener noreferrer">` whose accessible name is `"Open PAY-231 in Jira (opens in a new tab)"`; `isSafeExternalUrl` accepts `https:` only and the API stores the URL as `<mapping.external_base_url>/browse/<key>` (never the raw `issue.self` REST URL). List row title links to the detail; the detail's "Workflow" `KeyValue` links to `/workflows/{id}` with the `StatePill`; the Dashboard active card already links to `/workflows/{id}`. `/requirements/new` is linked from the list header and the Inbox (existing).

**Rationale**: FR-008 "link preserved both ways" is satisfied by `external_ref` (CDevi → Jira) and the mapping (Jira → CDevi); `noopener` prevents tab-nabbing.

**Alternatives considered**: same-tab Jira navigation (leaves the control plane — rejected).

## R43 — Roles, visibility and Problems on the nine routes

**Decision**: session routes use `app.requireUser` + `scopeFor(user)`/`visibleProjects`; create requires the target `projectId` to be visible (else 404, no leak) and `canCreateRequirement` (else 403); `assigneeUserId` must be a member of the organization (else 400 `urn:cdevi:problem:validation`). Status codes: 200 (reads, submit/approve/reject return `RequirementDetail`), 201 (`POST /requirements` returns `RequirementDetail` + `Location`), 400 (invalid cursor/query), 401 (no session / bad signature), 403 (role), 404 (invisible/unknown), 409 (`invalid-transition`, incl. exactly-once), 400 (body validation — existing `problems.validation`). No Problem includes SQL, stack traces or the request body (`problem.ts` already guarantees this). Rate limits: existing global limiter; the webhook adds a route-level `max: 120/min` per IP.

## R44 — Seed requirements (deterministic) without touching US1–US3 figures

**Decision**: `packages/db/src/seed/requirements.ts › buildRequirements(base)` adds, in project `payments-api` (an S-500 project visible to `admin@cdevi.demo`, `approver1@cdevi.demo`, `engineer1@cdevi.demo` and `viewer1@cdevi.demo` through the existing memberships), **eight** requirements with fixed `external_id`s and fixed timestamps relative to the S-500 base time — one per state — plus **one** `integration_project_mappings` row:

| `external_id` | State | Content / links |
|---------------|-------|-----------------|
| `req-seed-001` | `DRAFT` | "Retry queue for card declines", created by engineer1, 2 human-authored acceptance criteria (`ai_generated = false`, `source = 'user:Engineer 1'`) |
| `req-seed-002` | `ANALYZING` | submitted by engineer1; no analysis items |
| `req-seed-003` | `NEEDS_CLARIFICATION` | **the Jira-linked one**: `source = jira`, `external_ref { provider:'jira', key:'PAY-231', url:'https://jira.example.invalid/browse/PAY-231', updatedAt }`, assignee approver1; 3 AI criteria, 2 AI rules, 2 AI open questions (`source = 'agent:Requirement Agent'`) |
| `req-seed-004` | `READY` | 4 AI criteria, 3 AI rules, 0 open questions; assignee engineer1 |
| `req-seed-005` | `APPROVED` | approved by approver1; linked to the first `QUEUED` S-500 workflow in `external_id` order (stays `APPROVED` per R33); 3 AI criteria, 2 AI rules |
| `req-seed-006` | `IN_IMPLEMENTATION` | linked to the `SHOWCASE_WAITING` S-500 workflow (`WAITING_FOR_HUMAN`); 3 AI criteria, 1 AI rule |
| `req-seed-007` | `COMPLETED` | linked to the first `COMPLETED` S-500 workflow in `external_id` order; 3 AI criteria |
| `req-seed-008` | `REJECTED` | rejected by approver1, reason "Duplicate of req-seed-004"; no items |

`JIRA_MAPPING = { provider: 'jira', externalProjectKey: 'PAY', projectKey: 'payments-api', baseUrl: 'https://jira.example.invalid' }`. The three links are written with `UPDATE workflows SET requirement_id = $1 WHERE id = $2` after the requirements are inserted; the follow-workflow trigger fires only on `UPDATE OF state`, so the seeded requirement states stay exactly as listed. **No new workflows, stages, runs, test runs, approvals or clarifications are inserted**, so `EXPECTED_BUCKETS`, `EXPECTED_SHOWCASE`, `EXPECTED_DASHBOARD`, the Inbox counts, the Approval Center showcase and the Dashboard figures (18 / 4 / 2 / 97.4 %) are unchanged; the only S-500 change is three `requirement_id` values, which no existing assertion reads. `EXPECTED_REQUIREMENTS = { total: 8, byState: { DRAFT:1, ANALYZING:1, NEEDS_CLARIFICATION:1, READY:1, APPROVED:1, IN_IMPLEMENTATION:1, COMPLETED:1, REJECTED:1 }, analysisItems: 28, aiGenerated: 26, openQuestions: 2, jiraLinked: 1, linkedWorkflows: 3, mappings: 1 }`. Every requirement also gets its `requirement_transitions` history (26 rows in total, e.g. `NULL→DRAFT→ANALYZING→NEEDS_CLARIFICATION` for `req-seed-003`; data-model §30). **The seed writes no `audit_events` rows**: `packages/db/tests/seed.test.ts` asserts `count(*) from audit_events = 0` twice (`SC-006 seeding … leaves audit_events empty`, line 270, and the dashboard-demo test, line 551), and the US2/US3 seed likewise records history in `workflow_transitions` only — so the requirement seed records history in `requirement_transitions` only and both assertions stay true as written. Audit rows for `requirement.*` are written by runtime actions only and always with **`risk_level = NULL`** (data-model §27), so `dashboard.ts` Q7 (`risk_level IN ('HIGH','CRITICAL')`) never counts them and the `auditHighCritical` figure cannot move because of a requirement action (asserted in T097/T099). **Two existing schema assertions do change** because 0005 adds objects and the `db` project migrates everything: `schema.test.ts` ≈ 149 (`inbox_changed_%` trigger list) gains `'inbox_changed_requirements'`, and ≈ 741 (`SC-007 0004 adds no tables …`) compares `pg_tables` to `[...TABLES_AFTER_0003, ...TABLES_ADDED_BY_0005].sort()`; both edits are in T092 (data-model §22.7 notes, quickstart §5.5). The `TRUNCATE` list gains the four tables. The `e2e-tests` principal's `project_ids` already include `payments-api`, so the e2e can call the analysis ingest with `SEED_INGEST_TOKEN`. The e2e **creates its own requirement** (`uniq('e2e-req')`) for the Independent Test and never mutates seed rows; `req-seed-003` is used to assert the Jira link, the needs-you pill and the AI labels; `req-seed-004` to assert *Approve* is offered to approver1 and not to engineer1/viewer1 (without clicking); `req-seed-006` to assert the linked workflow's `StatePill` and `/workflows/{id}` link.

**Rationale**: one row per state makes every pill, filter and gate observable from the seed; reusing S-500 workflows keeps every existing invariant literally unchanged.

**Alternatives considered**: creating new workflows for the linked requirements (changes `EXPECTED_BUCKETS.total` and the Inbox e2e — rejected); seeding in `dashboard-demo` (administrator-only; engineer/approver scenarios impossible — rejected).

## R45 — Create form validation and the saffron decision

**Decision**: `CreateRequirementRequest { projectId: Uuid, title: line(200) (trimmed, ≥ 3 chars), businessObjective: string 10..4000 (trimmed), acceptanceCriteria: line(1000)[] ≤ 20 (default []), assigneeUserId?: Uuid }`. Client-side messages (also returned as `errors[]` by the API's 400 Problem, `pointer` per field): title "Enter a title (3–200 characters)", objective "Describe the business objective (10–4 000 characters)", criterion "Each acceptance criterion must be 1–1 000 characters", too many "At most 20 acceptance criteria". On success the API returns 201 + `Location: /api/requirements/{id}` and the form navigates to `/requirements/{id}` where the state pill reads *draft* and *Submit for analysis* is offered. The form's single **saffron** control is *Create requirement*: it is the screen's one primary action, it completes a person's entry of new work (the same reason the Inbox's "New requirement" link is saffron), and nothing else on the screen asks for a person; *Cancel* is `ghost`. On the Detail screen the saffron control is the one that resolves a "person needed" state (*Approve* on `READY` for deciders, *Resubmit for analysis* on `NEEDS_CLARIFICATION` for creators); *Submit for analysis* on a `DRAFT` is `primary` because nothing is waiting on a human yet.

**Rationale**: DR-02 — saffron is "a person is needed", one per screen; the create form is *only* a person's action.

**Alternatives considered**: `primary` create button (inconsistent with the saffron Inbox entry point — rejected); saffron *Submit* on drafts (two saffron states on one screen type, weakens the signal — rejected).

## Architecture document updates required (Part D)

- §4 interaction table: "Requirements" → landed (`GET/POST /api/requirements`, `GET /api/requirements/{id}`, `POST …/submit|approve|reject`); "Jira (inbound)" → `POST /api/integrations/jira/webhook`; "Agent runtime → analysis" → `PUT /api/ingest/requirements/{externalId}/analysis`; "Workflow list" → `GET /api/workflows` (consumed by the Workflow Center later).
- §6 (query contracts for placeholder screens): `/workflows` now has a live API behind it (`project`, `requirement`, `state`, `stage`, `cursor`); `hasPr`/`intervention` remain to be added by the Workflow Center story.
- §8 repository layout: `packages/db/migrations/0005_requirements.sql`, `packages/db/src/seed/requirements.ts`, `apps/api/src/services/requirements.ts`, `requirement-analysis.ts`, `jira-webhook.ts`, `workflow-list.ts`, `apps/api/src/routes/requirements.ts`, `integrations.ts`, `apps/web/app/(app)/requirements/`, `packages/design-system/src/components/Pill/RequirementStatePill.tsx`.

---

# Part E — User Story 5 (Agent Run Inspector): R46–R55

> Appended for `feature/US5`. R1–R45 above are unchanged. Source: the approved US5 plan (decisions confirmed 2026-09-15); spec User Story 5, FR-016/017/018, FR-004/034, FR-026, FR-032, FR-036, edge cases "run exceeds duration" and "evidence the user cannot access".

## R46 — Decisions are a new table `agent_decisions`, not more jsonb on `agent_runs`

**Decision**: Migration `0006_agent_decisions.sql` creates `agent_decisions` (`id, organization_id, project_id, workflow_id, stage_id, agent_run_id → agent_runs ON DELETE CASCADE, position smallint 1..50, decided_at, action ≤ 200, reason ≤ 600, confidence confidence_level, policy_outcome policy_outcome, policy_ref ≤ 120 NULL, risk_level risk_level NULL, evidence jsonb ≤ 20, created_at`, `UNIQUE (agent_run_id, position)`, index `agent_decisions_run_idx (agent_run_id, position)`), with RLS policies and grants patterned on 0002 and mirrored in `packages/db/src/schema.ts`. Evidence refs stay jsonb *inside* a decision (≤ 20, bounded by the contract and a `CHECK`). `risk_level` is nullable in US5 and becomes mandatory with US8 (policy evaluation). The `agent_runs.timeline` jsonb (US1) is unchanged.

**Rationale**: FR-017 makes a decision a first-class record with five fields and a list of evidence, ordered and bounded (≤ 50 per run); the read model needs one indexed statement (`WHERE agent_run_id = $1 ORDER BY position`) and the ingest needs to replace the set atomically. A row per decision keeps every column typed (two new enums), keeps position uniqueness in the database, and lets US8 add policy columns without a jsonb rewrite. Evidence refs are leaf data read only with their decision, so jsonb there is bounded and cheap.

**Alternatives considered**: `agent_runs.decisions jsonb` (≈ 60 KB in one row at the bounds, no position uniqueness, the web validating nested arrays, and a change to the US1 `AgentRunUpsert` contract — rejected); a separate `agent_decision_evidence` table (a join for ≤ 20 leaf rows per decision, one more statement in the read — rejected as over-normalisation for US5); reusing `audit_events` (those are *human* actions — DR-03 distinction — rejected).

## R47 — Decisions are delivered by the agent runtime through ingestion, replace-whole

**Decision**: `PUT /api/ingest/agent-runs/{externalId}/decisions` (`requirePrincipal`, principal scoped to the run's project) carries `{ observedAt, decisions[] ≤ 50 }` and **replaces the run's whole decision set**: lock the run (`SELECT … FOR UPDATE`), compare `observedAt` with the stored watermark (the latest `ingestion_log.observed_at` for this run and kind), and if newer `DELETE` all rows then batch `INSERT` the payload; write one `ingestion_log` row; return `{ status: 'accepted' | 'stale' }` — the same watermark protocol as every US1/US4 ingest (R7, R38). Decisions are never created or edited by the API from the browser.

**Rationale**: FR-036 — the runtime is the source of runs and their decisions; the platform records and displays. Replace-whole matches how the runtime knows a run (a full snapshot each report), makes the endpoint idempotent, and avoids per-decision upsert/tombstone logic; the watermark keeps an out-of-order older snapshot from clobbering a newer one.

**Alternatives considered**: `POST …/decisions` appending one decision at a time (ordering and deletion become the platform's problem; retries duplicate — rejected); decisions inside `PUT /ingest/agent-runs/{externalId}` (couples run and decision snapshot cadence, one 60 KB payload per heartbeat — rejected); the API deriving decisions from `timeline[kind='decision']` events (a 240-char message is not a decision record — rejected).

## R48 — Structured progress (AS-3) is a runtime-provided `steps` array on the run

**Decision**: `agent_runs.steps jsonb NOT NULL DEFAULT '[]'` — ≤ 20 `{ label ≤ 120, status: 'completed' | 'running' | 'pending' | 'failed' }` — set by the existing `PUT /ingest/agent-runs/{externalId}` (`AgentRunUpsert.steps`, optional, default `[]`), returned in `AgentRunDetail.steps`, summarised by the pure `stepsSummary(steps)` and rendered as `Stepper`/`Step` (`completed → done`, `running → current`, `pending → todo`, `failed → todo + Pill "failed"`). The screen **never** renders a spinner or "thinking…".

**Rationale**: Acceptance Scenario 3 asks for a checklist of completed/running/pending steps, which only the runtime knows; the timeline is an event log, not a plan. A bounded, typed array is cheap to store and validate, and `Stepper` is the design-system component for exactly this (glossary "structured progress").

**Alternatives considered**: deriving steps from timeline events (guesswork about structure — rejected); a separate `agent_run_steps` table (a join for ≤ 20 rows that change as one snapshot — rejected); a spinner for RUNNING (explicitly forbidden by AS-3 and the design principles — rejected).

## R49 — Evidence references are typed, and inaccessible evidence is text, never a broken link

**Decision**: `EvidenceRef = { kind: 'file' | 'ticket' | 'artifact' | 'url' | 'pullRequest', label ≤ 200, href?: DecisionLink, locator? ≤ 200, accessible: boolean }` (`.strict()`). `evidenceHref(ref)` returns `href` only when `accessible === true` and `href` is present, else `null`; the screen renders a linked label for a non-null href and the label plus the words "access restricted" (no `<a>`) otherwise. `artifact` refs are expected to carry an app-relative `href` to the producing Workflow Detail artifact anchor (`/workflows/{id}#artifact-{externalId}`). Evidence renders as *platform evidence* (`GateList`/`GateCheck` with `source` = kind word + locator), visually distinct from the agent's `reason`.

**Rationale**: FR-017 "evidence references (navigable)" plus the edge case "evidence the user cannot access → access-restricted indicator": the runtime knows what it cited and whether the platform user may follow it; the platform must never render a dead link. Reusing `DecisionLink` (US2) keeps the href allow-list (http(s) or app-relative) in one place. DR-03 keeps the citation distinct from the claim.

**Alternatives considered**: free-text evidence strings (not navigable — rejected); the API resolving accessibility per user at read time (needs per-repo/per-ticket authorisation the MVP does not have — rejected; the flag is the runtime's statement, revisited with US7 PR integration); rendering restricted refs as disabled links (a disabled anchor is not a control and reads as broken — rejected).

## R50 — FR-018 is enforced by the contract, not by trust

**Decision**: `AgentDecisionIngest` and `AgentDecisionsIngest` are `.strict()` Zod objects with **no free-form reasoning field**: the only prose fields are `action ≤ 200` and `reason ≤ 600` (the decision's stated justification — a summary the runtime writes for people, as FR-017 requires). A payload carrying `chainOfThought`, `reasoning`, `thoughts`, `scratchpad` or any other unknown key is a 400 Problem (`errors[].pointer` names the key; the body is not echoed). `AgentRunDetail`/`AgentDecision` have no such field either, so nothing can be stored, returned or rendered. The `AgentRunUpsert` (`summary ≤ 400`, `timeline[].message ≤ 240`) is unchanged and already bounded.

**Rationale**: FR-018 and SC-009 ("no raw model reasoning is displayed") are best guaranteed where data enters: if the schema has no field for it, no layer can leak it. Bounded summaries (200/600) make a pasted transcript fail validation by size as well.

**Alternatives considered**: accepting a `reasoning` field and hiding it in the UI (stored data leaks through exports/logs; violates the principle — rejected); redacting free text heuristically (unreliable — rejected); `.passthrough()` for forward compatibility (forbidden by the same reasoning; new fields land through the contract — rejected).

## R51 — Route shape: `/agents/runs/{id}`; `/agents` stays the section placeholder

**Decision**: The screen is `apps/web/app/(app)/agents/runs/[id]/page.tsx`; `agentRunHref(id) = '/agents/runs/{id}'`; `decisionAnchor(position) = '#decision-{position}'`. `DecisionLinks.agentRun` (US2) points straight at `agentRunHref`. `/agents` remains the `[section]` placeholder ("not built") and `BUILT_SECTIONS` is unchanged — the Next.js catch-all matches one segment, so the nested route coexists. Breadcrumbs read Workflows → {workflow title} → Stage {n} · {name} → Run {agent}.

**Rationale**: The spec's Agent Activity screen (roster, later story) is `/agents`; a run is an entity under it. Landing the deep route now avoids a later move and keeps the Approval Center's `agentRun` links stable. The placeholder semantics for one-segment sections are untouched.

**Alternatives considered**: `/workflows/{id}/runs/{runId}` (ties a run's URL to a workflow route that already has anchors; a run is addressed on its own by Inbox/Approval links — rejected); `/agents/{agent}/runs/{id}` (needs the roster to exist — rejected); building `/agents` now (out of scope).

## R52 — Read model: `GET /api/agent-runs/{id}` in one transaction, plus an additive `agentRuns` per stage on Workflow Detail

**Decision**: `GET /api/agent-runs/{id}` (session, `visibleProjects`) returns `AgentRunDetail` — `{ id, externalId, agent, model, state, startedAt, finishedAt, durationMs, summary, workflow: { id, externalId, title }, stage: { position, name }, steps ≤ 20, timeline ≤ 50, decisions ≤ 50 }` — from **one `REPEATABLE READ` transaction with ≤ 3 statements** (run + workflow + stage join; decisions ordered by position; nothing else). 404 for unknown *or* invisible ids. `GET /api/workflows/{id}` gains `stages[].agentRuns: [{ id, agent, state, stagePosition }]` (≤ 20 per stage, additive; one extra statement at most) so Workflow Detail lists "Inspect run" per run.

**Rationale**: FR-016 and the Independent Test open a run and see everything at once; one transaction gives a consistent snapshot (run state and decisions from the same instant), and ≤ 3 statements keeps the 150 ms p95 budget. The additive extension is the drill-down entry (AS-1 "from a workflow stage") without a new list route.

**Alternatives considered**: a separate `GET /api/agent-runs/{id}/decisions` (two round trips, two snapshots — rejected); embedding full runs in Workflow Detail (payload growth on the busiest screen — rejected); `GET /api/agent-runs?workflowId=` list route (nothing in US5 needs a list beyond the stage — deferred to the Agent Activity story).

## R53 — Live updates ride `inbox_changed`; `agent_decisions` gets its own NOTIFY trigger

**Decision**: `0006` adds `notify_agent_decision_changed()` and trigger `inbox_changed_agent_decisions` — a single statement-level `AFTER INSERT … REFERENCING NEW TABLE AS inserted` trigger — that writes one `inbox_change_log (organization_id, project_id, workflow_id)` row with the run's `workflow_id` and one `pg_notify('inbox_changed', …)` per distinct workflow in the inserted batch (never one per decision; the preceding `DELETE` does not notify). A replace with an empty `decisions` array inserts nothing, so the ingestion service writes the `inbox_change_log` row itself in that case (§36). Run changes already notify through `inbox_changed_agent_runs`. The screen subscribes to the existing SSE stream filtered by `workflowId` and refetches `GET /api/agent-runs/{id}` with the existing 300 ms debounce.

**Rationale**: FR-004/FR-034/SC-003 — timeline, steps and decisions must update within 5 s without reload; the decisions ingest writes only `agent_decisions`, which without its own trigger would be silent. Reusing the channel, the LISTEN client and the SSE endpoint costs one trigger and zero new plumbing.

**Alternatives considered**: bumping `agent_runs.updated_at` from the ingest to fire the existing trigger (implicit coupling, spurious timestamps — rejected); a dedicated `agent_run_changed` channel (a second LISTEN client and SSE endpoint — rejected); polling every 5 s (SC-003 is met but contradicts the SSE architecture — rejected).

## R54 — Stale-run indicator is a pure rule, shown as a notice, never a state change

**Decision**: `runFreshness(run, now): 'active' | 'stale'` in `@cdevi/contracts/agent-run-model`: `stale` when `state ∈ { RUNNING, RETRYING }` and the last timeline `at` (or `startedAt` when the timeline is empty) is more than `STALE_AFTER_MS = 30 min` before `now`; otherwise `active`. The screen shows `Notice tone="info"` "No activity for {n} min — the runtime has not reported progress; the workflow's state is unchanged." The run's `state` and the `StatePill` are untouched.

**Rationale**: Edge case "run exceeds duration/budget → nothing may appear to run indefinitely": the user must see that a running run has gone quiet; but states are the orchestrator's account (US1 R3) and the platform must not fabricate a transition. A pure rule is testable at 29/30/31 min with a fixed clock and needs no scheduler.

**Alternatives considered**: a database job marking runs FAILED after a timeout (invents a transition and desyncs from the workflow — rejected); putting the threshold in the API response (the same rule then lives in two places — rejected); no indicator (violates the edge case — rejected).

## R55 — Every role reads; nothing mutates; no saffron and no audit rows

**Decision**: `GET /api/agent-runs/{id}` requires only a session and project visibility — `viewer`, `engineer`, `approver` and `admin` see the same read model (FR-032: everyone may read; only the two ingest routes write, under an ingestion principal). The screen has **no `Button variant="saffron"`** in any state (DR-02 — nothing needs a person; `APPROVAL_REQUIRED` is a word in a `Pill`, the action lives in the Approval Center), **no human action** at all, and therefore writes **no `audit_events` rows** and no `workflow_transitions` (US1 audit invariants unchanged). Seed additions (§37) touch two existing runs only, so every `EXPECTED_*` figure from US1–US4 is unchanged.

**Rationale**: US5 is inspection: "evidence over explanation" is served by making the run legible, not by acting on it. Role gating exists for actions (US1 R5, US2 R14) and there are none here; a saffron control would be a false "person needed" signal.

**Alternatives considered**: a "Retry"/"Cancel" action on the run screen (belongs to Workflow Detail's failure panel, US1 — rejected as duplication); hiding decisions from `viewer` (the spec grants viewers read access everywhere — rejected); auditing reads (not an audit event in this system — rejected).

## Architecture document updates required (Part E)

- §4 interaction table: "Agent runs" → landed (`GET /api/agent-runs/{id}`; `PUT /api/ingest/agent-runs/{externalId}/decisions`; `PUT /api/ingest/agent-runs/{externalId}` now carries `steps`); "Workflow Detail" → `stages[].agentRuns`.
- §8 repository layout: `packages/db/migrations/0006_agent_decisions.sql`, `packages/contracts/src/agent-runs.ts`, `packages/contracts/src/agent-run-model.ts`, `apps/api/src/services/agent-runs.ts`, `apps/api/src/routes/agent-runs.ts`, `apps/web/app/(app)/agents/runs/[id]/`.
