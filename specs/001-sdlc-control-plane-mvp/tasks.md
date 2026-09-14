# Tasks: SDLC Control Plane MVP — User Story 1 (Workflow Detail)

**Input**: Design documents from `/specs/001-sdlc-control-plane-mvp/` — plan.md (US1 scope), spec.md (US1, lines 20–35; FR-001…FR-006, FR-034, SC-001, SC-003), research.md (R1–R10), data-model.md, contracts/{openapi.yaml, ui-workflow-detail-screen.md}, quickstart.md §2

**Tests**: Tests are REQUIRED for every behaviour change (Constitution Principle II): the failing test task precedes its implementation task in every phase below, and every test name starts with the FR/SC id it proves. Live Postgres is used only by the identified Vitest projects `db` and `api` and by Playwright.

**Organization**: Only User Story 1 is in scope for this branch (`feature/US1`). Phase 1 Setup and Phase 2 Foundational are empty by design — everything US1 needs (workspace, database, auth, ingestion, SSE, shell, design system 1.2.0) shipped with `specs/003`; the story phase is split into layers (contracts → db → api → web → e2e) so each layer is red → green before the next consumes it. Other user stories (Dashboard, Approval Center, Requirements, Agent Activity, Testing, PR Review, Admin) are **not** tasked here.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: `[US1]` on every story task
- Include exact file paths in descriptions

## Path Conventions

Web application (monorepo): `apps/web`, `apps/api`, `packages/contracts`, `packages/db`, `packages/design-system` — see plan.md "Project Structure".

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Nothing to add — workspace, Postgres, test projects and CI exist from `specs/003` (plan.md Technical Context: "nothing new is added to `package.json`").

- [ ] T001 Verify the baseline: `pnpm i --frozen-lockfile && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm check && pnpm test:api` green on `feature/US1` before any change (no file changes)

**Checkpoint**: baseline green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None required. Design System Compliance in plan.md proposes **no** new component, so there is no design-system task (template rule: only when a pattern is missing).

**Checkpoint**: n/a.

---

## Phase 3: User Story 1 — Follow one requirement from ticket to PR (Priority: P1) 🎯 MVP

**Goal**: `/workflows/[id]` shows the ordered stage pipeline (StatePill per stage, current highlighted), current-stage detail (agent, model, elapsed, plain-language summary, progress), an ordered activity feed, artifacts tagged by producing stage, test-run evidence, a never-hidden needs-you/blocked card with reason + one direct action, and a failure panel with reason / failing stage / last successful stage / retry-escalate-cancel (role-gated) — refreshed within 5 s over the existing SSE stream.

**Independent Test** (quickstart §2.3): seed S-500 (which now includes showcase workflows `s500-001` and `s500-045`), sign in as the engineer, open `s500-001` and answer the eight supervision questions from the page alone; open `s500-045` and see the failure panel with enabled actions; ingest a stage transition and watch the page change within 5 s without reload.

### 3a. Contracts (`packages/contracts`) — tests first

- [ ] T002 [P] [US1] Write failing pure read-model tests in `packages/contracts/tests/workflow-detail.test.ts` against data-model.md §6: `FR-001 orderStages sorts by position`, `FR-001 deriveCurrentStage picks first non-terminal stage / last when all done / null without stages`, `FR-001 deriveProgress counts COMPLETED over total`, `FR-001 stageElapsed uses finishedAt or now and null before start`, `FR-004 orderActivity merges transitions, run start/finish and timeline ascending, bounded to 200`, `FR-004 groupArtifactsByStage orders by stage position then producedAt and tags stage`, `FR-005 deriveAttention returns first WAITING_FOR_HUMAN/BLOCKED stage with reason and action href (approval → /approvals/{id}, clarification → /approvals/{id}, blocked → /integrations)`, `FR-006 deriveFailure returns reason, failing stage and last successful stage (or null)`, `FR-006 allowedActions gates retry/cancel to engineer+administrator and escalate to engineer+approver+administrator, by workflow state`, `FR-001 nextStage returns the following stage or null`
- [ ] T003 [P] [US1] Write failing schema tests in `packages/contracts/tests/schemas.test.ts`: `FR-002 StageUpsert accepts the nine states, rejects position 0/21, name > 60, reason > 240`; `FR-001 AgentRunUpsert rejects QUEUED, timeline > 50 events, message > 240, unknown kind`; `FR-004 ArtifactUpsert accepts the six ArtifactType values, rejects others and href > 500`; `FR-004 TestRunUpsert rejects passed+failed+skipped > total`; `FR-006 WorkflowActionRequest accepts retry|escalate|cancel with optional note ≤ 240`; `FR-004 WorkflowDetail parses the running/waiting/failed fixtures`
- [ ] T004 [P] [US1] Extend `packages/contracts/tests/openapi.test.ts`: snapshot `specs/001-sdlc-control-plane-mvp/contracts/openapi.yaml` against `buildWorkflowDetailOpenApi()`; assert its paths equal `['/workflows/{id}', '/workflows/{id}/actions', '/ingest/workflows/{externalId}/stages/{position}', '/ingest/agent-runs/{externalId}', '/ingest/artifacts/{externalId}', '/ingest/test-runs/{externalId}']`; keep the 003 assertions unchanged
- [ ] T005 [US1] Create `packages/contracts/src/workflow-detail.ts`: `ARTIFACT_TYPES` (`requirement_spec`, `impact_analysis`, `implementation_plan`, `test_results`, `code_diff`, `pull_request`) + `ArtifactType`; `TEST_RUN_STATUSES` (`RUNNING`, `PASSED`, `FAILED`) + `TestRunStatus`; `AgentRunEvent` `{ at: IsoDateTime, kind: 'tool'|'decision'|'note'|'error', message: line(240) }`; `WORKFLOW_ACTIONS` (`retry`, `escalate`, `cancel`) + `WorkflowActionRequest { action, note?: line(240) }`; `WorkflowDetail` exactly as data-model.md §7 (`StageRef`, `WorkflowStageView`, `CurrentStageView`, `ActivityEvent`, `ArtifactView`, `TestRunView`, `AttentionView`, `FailureView`, `ActionsView`); `WorkflowIdParams { id: Uuid }`; export types (T003 fixtures parse)
- [ ] T006 [US1] Create `packages/contracts/src/workflow-detail-model.ts` with the pure functions of data-model.md §6 over row-shaped inputs (`StageRow`, `RunRow`, `ArtifactRow`, `TestRunRow`, `TransitionRow`, `AttentionSourceRow`): `orderStages`, `deriveCurrentStage`, `nextStage`, `deriveProgress`, `stageElapsed`, `workflowElapsed`, `orderActivity` (bounded `ACTIVITY_LIMIT = 200`), `groupArtifactsByStage` (bounded `ARTIFACT_LIMIT = 100`), `deriveAttention`, `deriveFailure`, `allowedActions` (uses `canTransition` from `read-model.ts`); no I/O, no Date.now (T002 passes)
- [ ] T007 [US1] Extend `packages/contracts/src/ingest.ts`: `StagePositionParams { externalId: ExternalId, position: coerce int 1–20 }`, `StageUpsert { name: line(60), state: WorkflowState, observedAt: IsoDateTime, reason?: line(240)|null, agent?: line(80)|null, requiresApproval?: boolean, approvalExternalId?: ExternalId|null, clarificationExternalId?: ExternalId|null, count?: int 1–20 }`, `AgentRunUpsert { workflowExternalId, stagePosition: int 1–20, agent: line(80), model?: line(80)|null, state: WorkflowState.exclude(['QUEUED']), startedAt, finishedAt?: null, summary?: line(400)|null, timeline: AgentRunEvent[] max 50 default [] }`, `ArtifactUpsert { workflowExternalId, stagePosition, type: ArtifactType, title: line(200), href?: url max 500|null, summary?: line(400)|null, producedAt }`, `TestRunUpsert { workflowExternalId, stagePosition, category: line(40), status: TestRunStatus, total/passed/failed/skipped: int ≥ 0 default 0 with refine passed+failed+skipped ≤ total, href?: url|null, startedAt, finishedAt?: null }`; export from `src/index.ts` together with T005/T006 (T003 passes)
- [ ] T008 [US1] Extend `packages/contracts/src/openapi.ts`: register the new schemas; add `buildWorkflowDetailOpenApi()` returning an OpenAPI 3.1 fragment (`info.title` "CDevi API — Workflow Detail (specs/001 US1)", `servers: /api`, tags `workflows`, `ingest`) with `GET /workflows/{id}` (200 `WorkflowDetail`, 404 Problem — identical for forbidden), `POST /workflows/{id}/actions` (200 `WorkflowDetail`, 400/403/404/409 Problem), `PUT /ingest/workflows/{externalId}/stages/{position}`, `PUT /ingest/agent-runs/{externalId}`, `PUT /ingest/artifacts/{externalId}`, `PUT /ingest/test-runs/{externalId}` (200 `IngestResult`, 400/401/403/404/409 Problem); add `buildFullOpenApi()` merging 003 + fragment; extend `packages/contracts/scripts/write-openapi.ts` to also write `specs/001-sdlc-control-plane-mvp/contracts/openapi.yaml`; run `pnpm -F @cdevi/contracts openapi` (T004 passes; 003 yaml byte-identical)

### 3b. Database (`packages/db`) — tests first

- [ ] T009 [P] [US1] Write failing migration tests in `packages/db/tests/schema.test.ts` (`describe('migration 0002_workflow_detail (specs/001 data-model.md §2–§4)')`): `FR-001 workflow_stages has position CHECK 1..20, UNIQUE(workflow_id, position), organization_id + project_id NOT NULL`; `FR-001 agent_runs, artifacts, test_runs exist with organization_id, project_id, workflow_id, stage_id and UNIQUE(organization_id, external_id)`; `FR-002 workflow_transitions has stage_id and user_id columns and workflow_transitions_stage_idx`; `FR-004 enums artifact_type and test_run_status have the exact values`; `FR-034 inserting/updating a stage, run, artifact or test run writes inbox_change_log and NOTIFYs inbox_changed`; `FR-001 artifacts_immutable rejects UPDATE when the producing stage is COMPLETED and allows it while RUNNING`; `FR-001 updated_at triggers on workflow_stages, agent_runs, test_runs`; `FR-033 every new table has an org-isolation RLS policy and app_user grants`
- [ ] T010 [P] [US1] Write failing seed tests in `packages/db/tests/seed.test.ts`: `SC-001 showcase is deterministic and matches EXPECTED_SHOWCASE counts`; `SC-001 s500-001 has 7 stages with 1–5 COMPLETED, 6 WAITING_FOR_HUMAN linked to its approval, 7 QUEUED, a FAILED→RETRYING→RUNNING→COMPLETED history on stage 5, all six ArtifactType values, ≥ 4 test runs including one FAILED and a later PASSED unit run`; `FR-006 s500-045 has stage 5 FAILED with error_summary, stages 1–4 COMPLETED, 6–7 QUEUED, one FAILED test run`; `SC-001 seeding writes the showcase rows and keeps EXPECTED_BUCKETS`
- [ ] T011 [US1] Write `packages/db/migrations/0002_workflow_detail.sql` per data-model.md §2–§4: enums `artifact_type`, `test_run_status`; tables `workflow_stages`, `agent_runs`, `artifacts`, `test_runs` with the listed columns, FKs (`ON DELETE CASCADE` to workflows/stages), CHECKs, UNIQUEs, indexes (`workflow_stages_workflow_idx`, `workflow_stages_attention_idx`, `agent_runs_workflow_idx`, `agent_runs_stage_idx`, `artifacts_workflow_idx`, `test_runs_workflow_idx`); `ALTER TABLE workflow_transitions ADD COLUMN stage_id uuid REFERENCES workflow_stages(id) ON DELETE CASCADE, ADD COLUMN user_id uuid REFERENCES users(id)` + `workflow_transitions_stage_idx`; `set_updated_at` triggers on stages/runs/test_runs; `notify_inbox_changed` triggers `AFTER INSERT OR UPDATE` on all four tables; `artifacts_immutable()` function + `BEFORE UPDATE` trigger raising `artifact_immutable`; RLS policies `<t>_org_isolation`; grants `SELECT, INSERT, UPDATE` to `app_user` on the four tables; add the four names to `RLS_TABLES` in `packages/db/src/migrate.ts` (T009 passes)
- [ ] T012 [US1] Mirror the migration in `packages/db/src/schema.ts`: `artifactType`, `testRunStatus` pgEnums; `workflowStages`, `agentRuns`, `artifacts`, `testRuns` tables; `stageId`, `userId` on `workflowTransitions`; export inferred types
- [ ] T013 [US1] Extend `packages/db/src/seed/s500.ts` (research R8): types `SeedStage { position, name, state, stateObservedAt, stateReason, agent, startedAt, finishedAt, errorSummary, requiresApproval, linkApproval: boolean, history: { fromState|null, toState, observedAt, reason }[] }`, `SeedAgentRun`, `SeedArtifact`, `SeedTestRun`, `SeedShowcase { externalId, stages, runs, artifacts, testRuns }`; `buildShowcase(base)` producing the two showcase workflows exactly as R8 (s500-001: 7 stages, 8 runs, 6 artifacts covering every type, 4 test runs; s500-045: 7 stages, 5 runs, 4 artifacts, 1 test run); pin `stageIndex/stageName` of `s500-001` to 6/Review and `s500-045` to 5/Testing in `buildS500`; export `EXPECTED_SHOWCASE = { workflows: 2, stages: 14, runs: 13, artifacts: 10, testRuns: 5 }`; `buildS500` returns `{ users, workflows, showcase }` (T010 unit part passes)
- [ ] T014 [US1] Extend `packages/db/src/seed/index.ts`: add `workflow_stages, agent_runs, artifacts, test_runs` to the `TRUNCATE`; after workflows/approvals/clarifications, insert each showcase's stages (linking `approval_id` to the workflow's seeded approval when `linkApproval`), stage `history` rows into `workflow_transitions` with `stage_id`, runs (timeline as JSONB), artifacts, test runs; add showcase counts to the result and the log line (T010 DB part passes; `pnpm db:seed` prints `stages: 14 runs: 13 artifacts: 10 testRuns: 5`)

### 3c. API (`apps/api`) — tests first

- [ ] T015 [P] [US1] Write failing integration tests in `apps/api/tests/workflow-detail.test.ts` (seeded showcase, `FIXED_NOW`, sign-in helpers from `helpers.ts`): `FR-001 GET /workflows/:id returns ordered stages with current flag, agent, elapsedMs, progress and currentStage summary for s500-001`; `FR-003 GET /workflows/:id carries stage index/count/name and workflow elapsedMs`; `FR-004 activity is ascending by time and includes stage transitions, run start/finish and timeline events`; `FR-004 artifacts list every seeded type tagged with the producing stage`; `FR-004 testRuns list the seeded runs with counts and status`; `FR-005 attention is set for s500-001 with the approval ask and href /approvals/{approvalId}`; `FR-006 failure for s500-045 names stage 5 Testing and last successful stage 4 Implementation`; `FR-006 actions for engineer are retry+escalate+cancel true, for viewer all false, for approver escalate only`; `FR-033 workflow in an invisible project → 404 identical to unknown id`; `FR-006 POST actions retry as engineer moves stage 5 and workflow to RETRYING and logs transitions with user_id`; `FR-006 POST actions cancel as engineer moves workflow and non-terminal stages to CANCELLED`; `FR-006 POST actions escalate as approver records a transition row with reason "Escalated by …" and no state change`; `FR-006 POST actions as viewer → 403 Problem`; `FR-006 POST retry on a non-FAILED workflow → 409 Problem`; `SC-003 GET /workflows/:id p95 ≤ 150 ms over 20 calls (Server-Timing)`; `FR-034 detail payload for a 200-event, 100-artifact workflow ≤ 96 KB and bounded`
- [ ] T016 [P] [US1] Extend `apps/api/tests/ingest.test.ts`: `FR-002 PUT stages/:position creates a stage and records a stage transition`; `FR-002 out-of-order stage observation is stale`; `FR-002 invalid stage transition → 409`; `FR-001 stage upsert of the current stage updates workflows.stage_index/stage_name`; `FR-001 PUT agent-runs upserts a run with truncated 50-event timeline`; `FR-004 PUT artifacts upserts while the stage runs and → 409 artifact-immutable once COMPLETED`; `FR-004 PUT test-runs upserts and rejects counts > total with 400`; `FR-033 ingestion outside the principal's projects → 403 and is logged`; `FR-001 unknown stage position for runs/artifacts/test runs → 404`
- [ ] T017 [P] [US1] Extend `apps/api/tests/stream.test.ts`: `FR-034 a stage upsert, artifact and test-run ingestion each emit inbox.changed frames whose workflowId is the workflow's id within 5 s`
- [ ] T018 [US1] Create `apps/api/src/services/workflow-detail.ts`: `loadWorkflowDetail(pool, user, id, now): Promise<WorkflowDetail | null>` — `BEGIN ISOLATION LEVEL REPEATABLE READ`; query 1 workflow + project (filtered by `organization_id` and `visibleProjects`), 2 stages ordered by position, 3 agent runs ordered by started_at, 4 artifacts (limit 100), 5 test runs, 6 transitions (workflow- and stage-level, limit 400 newest) + the linked approval/clarification asks; compose with the T006 functions; `null` when not visible (T015 read tests pass)
- [ ] T019 [US1] Create `apps/api/src/services/workflow-actions.ts`: `applyWorkflowAction(pool, user, id, body, now)` per research R5 — visibility check → `allowedActions` gate (403 `forbidden` Problem) → state precondition (409 `invalid-transition` Problem) → in one transaction: retry (failing stage + workflow → `RETRYING`, clear `error_summary`, `finished_at`; two transition rows with `user_id`, reason `Retry requested by <displayName>`), cancel (workflow + non-terminal stages → `CANCELLED`, `finished_at = now`; transition rows), escalate (transition row `state → state`, reason `Escalated by <displayName>: <note ?? 'no note'>`); returns the reloaded detail (T015 action tests pass)
- [ ] T020 [US1] Create `apps/api/src/routes/workflows.ts` (`workflowRoutes`): `GET /workflows/:id` (`WorkflowIdParams`, session required, 404 `not-found` Problem when `null`, `Server-Timing: detail;dur=…`), `POST /workflows/:id/actions` (`WorkflowActionRequest`, same origin check as auth routes, maps service errors to Problems); register in `apps/api/src/app.ts` after `inboxRoutes`; switch swagger to `buildFullOpenApi()` (T015 route tests pass)
- [ ] T021 [US1] Extend `apps/api/src/services/ingestion.ts` with `upsertStage(externalId, position, body)` (lock workflow, stale rule, `canTransition`, set `started_at/finished_at/error_summary` per data-model.md §5, link approval/clarification by external id, insert `workflow_transitions` with `stage_id`, sync `workflows.stage_index/stage_count/stage_name` when the stage is current), `upsertAgentRun(externalId, body)` (resolve stage by position → 404 `unknown-stage`; timeline sorted by `at`, newest 50), `upsertArtifact(externalId, body)` (map SQLSTATE `P0001` `artifact_immutable` → 409 `artifact-immutable`), `upsertTestRun(externalId, body)`; all log to `ingestion_log` with the route name (T016 passes)
- [ ] T022 [US1] Extend `apps/api/src/routes/ingest.ts` with `PUT /ingest/workflows/:externalId/stages/:position`, `PUT /ingest/agent-runs/:externalId`, `PUT /ingest/artifacts/:externalId`, `PUT /ingest/test-runs/:externalId` using the T007 schemas and the same bearer/principal handling as existing routes (T016, T017 pass)

### 3d. Web (`apps/web`) — tests first

- [ ] T023 [P] [US1] Create fixtures `apps/web/tests/fixtures/workflow-detail.ts` (typed `WorkflowDetail`): `running`, `waitingForHuman` (attention + approval href), `blocked` (attention → /integrations), `failedEngineer` (failure + all actions true), `failedViewer` (all false), `completed`, `cancelled`, `empty` (no stages/activity/artifacts/testRuns)
- [ ] T024 [P] [US1] Write failing component tests in `apps/web/tests/components/workflow-detail.test.tsx` with `renderApp`/`expectNoViolations`: `FR-001 renders the pipeline in order with one StatePill word per stage and aria-current on the current step`; `FR-001 shows agent, elapsed, plain-language summary and a Progress meter with valuenow/valuemax`; `FR-004 activity rows appear in ascending time order with time and source`; `FR-004 every artifact row shows its type word and "Stage n · name"`; `FR-005 waiting-for-human renders a DecisionCard with the reason and exactly one link named by the action label, before the pipeline, with no hidden/collapsed ancestor`; `FR-005 blocked renders the same with "Open Integrations"`; `FR-006 failed shows reason, failing stage, last successful stage and enabled Retry/Escalate/Cancel for the engineer`; `FR-006 viewer sees the three buttons disabled and the help text`; `FR-006 Cancel requires a second "Confirm cancel" click and Escape reverts`; `FR-006 no saffron button when only failure is present`; `FR-034 calls the stream subscription with the workflow id and refetches on change`; `SC-010 axe has no violations for every fixture and the unavailable state`
- [ ] T025 [US1] Create `apps/web/lib/workflow-stream.ts`: `subscribeWorkflowStream({ workflowId, onChange, onStatus })` built on `EventSource('/api/inbox/stream')` parsing `event: inbox.changed` frames and invoking `onChange` only when `data.workflowId === workflowId` (debounce 250 ms, reconnect back-off 1 s → 30 s as `inbox-stream.ts`)
- [ ] T026 [US1] Create `apps/web/app/(app)/workflows/[id]/WorkflowDetailScreen.tsx` (client) composing regions 2.1–2.11 of contracts/ui-workflow-detail-screen.md from design-system components only (`Topbar`, `PageMeta`, `StatePill`, `RiskBadge`, `Mono`, `Meter`, `DecisionCard`, `Button`, `Card`, `KeyValue`, `ActionBar`, `Notice`, `Stepper`, `Step`, `Message`, `List`, `ListRow`, `Pill`, `Field`, `Input`, `GateList`, `GateCheck`, `PanelBlock`), states of §4, keyboard/focus of §5, names of §6; refetch via `apiFetch<WorkflowDetail>` on stream change; actions via `POST /api/workflows/{id}/actions` (T024 passes)
- [ ] T027 [US1] Replace `apps/web/app/(app)/workflows/[id]/page.tsx`: server fetch with forwarded cookie, `getMe()` for the role, unavailable notice on any error, `<WorkflowDetailScreen initial role />`; narrow `apps/web/app/(app)/record-page.tsx` `kind` to `'approvals'` and remove the `workflows` branch from `RecordStub.tsx` `WHERE`; add a `Button variant="ghost" href={`/workflows/${item.id}`}` "Open workflow" to the approval stub so Needs-you approval rows reach the detail page (contract §1, quickstart §2.3)

### 3e. End-to-end (`apps/web/tests/e2e`) — tests first, then wire-up

- [ ] T028 [P] [US1] Write `apps/web/tests/e2e/workflow-detail-journey.spec.ts`: `FR-001 workflow detail shows the ordered pipeline, current stage, agent, elapsed, summary and progress for s500-001`; `FR-004 activity is chronological and artifacts list all six types with their stage`; `FR-005 the needs-you card is visible above the fold with reason and one saffron action leading to the approval`; `FR-006 s500-045 shows failure reason, failing stage, last successful stage and retry/escalate/cancel; Retry moves the pipeline to retrying`; logs and asserts LCP ≤ 2 000 ms (p95 over the run's navigations)
- [ ] T029 [P] [US1] Write `apps/web/tests/e2e/workflow-detail-freshness.spec.ts`: `SC-003 a stage transition ingested via the API appears in the pipeline within 5 s without reload (5 iterations, p95 ≤ 5 000 ms)`; `FR-034 an ingested artifact and test run appear within 5 s`
- [ ] T030 [P] [US1] Write `apps/web/tests/e2e/workflow-detail-keyboard.spec.ts`: `FR-005 Tab reaches Back → saffron action → artifact links in order; Enter on the action navigates`; `FR-006 on s500-045 Tab reaches Retry, Escalate, Cancel; Escape reverts Confirm cancel`
- [ ] T031 [P] [US1] Write `apps/web/tests/e2e/workflow-detail-a11y.spec.ts`: `SC-010 page-level axe has no violations on s500-001, s500-045 and an unknown id`
- [ ] T032 [US1] Run `pnpm test:e2e -- workflow-detail` and fix wiring (page fetch, stream filter, action refetch, focus management) until T028–T031 pass

**Checkpoint**: US1 independently demonstrable — `pnpm check`, `pnpm test:api`, `pnpm test:e2e` green; quickstart §2.3 and §2.4 hold.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T033 [P] Update `docs/architecture.md` §4 "Streaming to the browser" (detail page filters `inbox.changed` by `workflowId`; stage/run/artifact/test-run tables feed the change log) and §8 layout (new files) per research.md "Architecture document updates required"
- [ ] T034 [P] Update `AGENTS.md`: list `GET /api/workflows/:id`, `POST /api/workflows/:id/actions` and the four ingestion routes; note that `pnpm -F @cdevi/contracts openapi` now writes two yaml files
- [ ] T035 Run `pnpm check && pnpm test:api && pnpm test:e2e`; walk quickstart §2.3 (eight questions) and §2.4 (live update) against `pnpm dev`; record outcomes in the PR description mapping each acceptance scenario to its tests

---

## Dependencies & Execution Order

- **T001** first.
- **3a Contracts**: T002, T003, T004 in parallel → T005 → T006 (T002 green) → T007 (T003 green) → T008 (T004 green).
- **3b Database**: T009, T010 in parallel (after T005/T007 for the enum vocab) → T011 → T012 → T013 → T014. 3b may start alongside 3a once T005 exists.
- **3c API**: T015, T016, T017 in parallel (need T014 for the seeded showcase) → T018 → T019 → T020 → T021 → T022.
- **3d Web**: T023 (after T005) → T024 → T025 → T026 → T027. T023–T024 can run in parallel with 3c.
- **3e E2E**: T028–T031 in parallel (after T014 for seed ids and T022/T027 for routes) → T032.
- **Phase 4**: T033, T034 parallel after 3e; T035 last.

## Parallel Execution Examples

- Tests first, together: T002 + T003 + T004 (contracts); T009 + T010 (db); T015 + T016 + T017 (api); T028 + T029 + T030 + T031 (e2e).
- Cross-layer: while 3c is implemented, T023–T024 (web fixtures/tests) and T033–T034 (docs drafts) proceed on different files.

## Implementation Strategy

US1 is the MVP for this branch and the only story tasked. Deliver bottom-up so each layer is verifiable alone: contracts (pure, no DB) → db (migration + seed, `pnpm test:api --project db`) → api (`pnpm test:api`) → web (`pnpm test -- --project web`) → e2e. The PR from `feature/US1` to `develop` must show every acceptance scenario mapped to the tests above (quickstart §2.2 table).

## Traceability

| Spec id | Tasks |
|---------|-------|
| FR-001 | T002, T005, T006, T009, T011–T014, T015, T016, T018, T024, T026, T028 |
| FR-002 | T003, T007, T009, T011, T016, T021 |
| FR-003 | T015, T018 |
| FR-004 | T002–T009, T011, T015, T016, T018, T024, T026, T028 |
| FR-005 | T002, T006, T015, T018, T024, T026, T028, T030 |
| FR-006 | T002, T003, T006, T010, T015, T019, T020, T024, T026, T028, T030 |
| FR-034 | T009, T011, T015, T017, T024, T025, T029 |
| SC-001 | T010, T013, T014, T035 |
| SC-003 | T015, T029 |
| SC-010 | T024, T031 |
| FR-033 | T009, T015, T016 |
