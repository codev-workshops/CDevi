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
