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
