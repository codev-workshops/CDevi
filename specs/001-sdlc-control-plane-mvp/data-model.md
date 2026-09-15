# Data Model: SDLC Control Plane MVP — User Story 1 (Workflow Detail)

**Phase 1 output** for [plan.md](plan.md). Extends `specs/003-inbox-home/data-model.md` (tables §2 there are unchanged unless listed under "Extended"). Source of truth is `packages/db/migrations/0002_workflow_detail.sql`, mirrored in `packages/db/src/schema.ts`.

## 1. Entity overview

```text
workflows 1 ──< workflow_stages 1 ──< agent_runs           (an agent run executes one stage)
    │                 │        1 ──< artifacts             (produced by one stage; immutable when it completes)
    │                 │        1 ──< test_runs             (evidence for one stage, usually Testing)
    │                 └──< workflow_transitions.stage_id   (stage-level transitions; NULL = workflow-level)
    └──< workflow_transitions (existing) + user_id         (human actions: retry / escalate / cancel)
approvals, clarifications (existing) ── linked to a stage by workflow_stages.approval_id / clarification_id
```

Every new table carries `organization_id` **and** `project_id` (denormalised from the workflow) so RLS and the change-log trigger work without joins.

## 2. New tables

### workflow_stages

One step of a workflow (spec Key Entities: Workflow Stage). Ordered by `position`.

| column | type | rules |
|--------|------|-------|
| id | uuid PK | default `gen_random_uuid()` |
| organization_id | uuid NOT NULL → organizations | |
| project_id | uuid NOT NULL → projects | equals the workflow's project |
| workflow_id | uuid NOT NULL → workflows ON DELETE CASCADE | |
| position | smallint NOT NULL | 1-based; `CHECK (position BETWEEN 1 AND 20)`; UNIQUE `(workflow_id, position)` |
| name | text NOT NULL | ≤ 60 chars (Requirement, Analysis, Architecture, Implementation, Testing, Review, PR …) |
| state | workflow_state NOT NULL | one of the nine states (FR-002) |
| state_observed_at | timestamptz NOT NULL | monotonic per stage (older observations are `stale`) |
| state_reason | text | plain-language cause of the current state (block reason, failure summary, wait reason) |
| agent | text | assigned agent name |
| started_at / finished_at | timestamptz | set on first `RUNNING` / on `COMPLETED`, `CANCELLED`, `FAILED` |
| error_summary | text | ≤ 240 chars; set when `FAILED`; cleared on `RETRYING` |
| requires_approval | boolean NOT NULL DEFAULT false | the stage cannot complete without a human decision |
| approval_id | uuid → approvals | the pending/decided approval that gates this stage |
| clarification_id | uuid → clarifications | the pending/answered question raised in this stage |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | `set_updated_at` trigger |

Indexes: `workflow_stages_workflow_idx (workflow_id, position)`; `workflow_stages_attention_idx (organization_id, state) WHERE state IN ('WAITING_FOR_HUMAN','BLOCKED','FAILED')`.

### agent_runs

One execution of an agent for a stage (spec: Agent Run — timeline, status, model, duration, decisions).

| column | type | rules |
|--------|------|-------|
| id | uuid PK | |
| organization_id, project_id | uuid NOT NULL | |
| workflow_id | uuid NOT NULL → workflows ON DELETE CASCADE | |
| stage_id | uuid NOT NULL → workflow_stages ON DELETE CASCADE | |
| external_id | text NOT NULL | UNIQUE `(organization_id, external_id)`; ingestion idempotency key |
| agent | text NOT NULL | ≤ 80 |
| model | text | ≤ 80, e.g. `claude-sonnet-4` |
| state | workflow_state NOT NULL | `RUNNING`, `RETRYING`, `WAITING`, `WAITING_FOR_HUMAN`, `BLOCKED`, `FAILED`, `COMPLETED`, `CANCELLED` (never `QUEUED` — a run exists once started) |
| started_at | timestamptz NOT NULL | |
| finished_at | timestamptz | duration = `finished_at − started_at` (or `now − started_at` while running) — derived, not stored |
| summary | text | ≤ 400; the agent's plain-language account of what it is doing / did — **a claim, not evidence** (DR-03) |
| timeline | jsonb NOT NULL DEFAULT '[]' | array ≤ 50 of `{ at: ISO, kind: 'tool'\|'decision'\|'note'\|'error', message: ≤ 240 }`, ordered by `at` |
| created_at / updated_at | | `set_updated_at` trigger |

Indexes: `agent_runs_workflow_idx (workflow_id, started_at)`; `agent_runs_stage_idx (stage_id, started_at)`.

### artifacts

An output of a stage (spec: Artifact — immutable once the stage completes).

| column | type | rules |
|--------|------|-------|
| id | uuid PK | |
| organization_id, project_id | uuid NOT NULL | |
| workflow_id | uuid NOT NULL → workflows ON DELETE CASCADE | |
| stage_id | uuid NOT NULL → workflow_stages ON DELETE CASCADE | the **producing stage** (the artifact list tags every artifact with it) |
| external_id | text NOT NULL | UNIQUE `(organization_id, external_id)` |
| type | artifact_type NOT NULL | enum `requirement_spec`, `impact_analysis`, `implementation_plan`, `test_results`, `code_diff`, `pull_request` |
| title | text NOT NULL | ≤ 200 |
| href | text | ≤ 500; link to the artifact (PR URL, results page, spec document) |
| summary | text | ≤ 400 plain language |
| produced_at | timestamptz NOT NULL | |
| created_at | timestamptz NOT NULL DEFAULT now() | no `updated_at`: see immutability |

Indexes: `artifacts_workflow_idx (workflow_id, produced_at)`. Trigger `artifacts_immutable BEFORE UPDATE`: raises `artifact_immutable` (SQLSTATE `P0001`) when `(SELECT state FROM workflow_stages WHERE id = OLD.stage_id) = 'COMPLETED'`. Ingestion maps that error to a 409 Problem `artifact-immutable`.

### test_runs

Results of one test category for a workflow (spec: Test Run — summary level in US1; per-test outcomes are US5).

| column | type | rules |
|--------|------|-------|
| id | uuid PK | |
| organization_id, project_id | uuid NOT NULL | |
| workflow_id | uuid NOT NULL → workflows ON DELETE CASCADE | |
| stage_id | uuid NOT NULL → workflow_stages ON DELETE CASCADE | |
| external_id | text NOT NULL | UNIQUE `(organization_id, external_id)` |
| category | text NOT NULL | ≤ 40: `unit`, `integration`, `e2e`, `accessibility`, `performance`, `security`, … |
| status | test_run_status NOT NULL | enum `RUNNING`, `PASSED`, `FAILED` |
| total / passed / failed / skipped | integer NOT NULL DEFAULT 0 | `CHECK (passed + failed + skipped <= total)` |
| href | text | ≤ 500 link to full results |
| started_at | timestamptz NOT NULL | |
| finished_at | timestamptz | |
| created_at / updated_at | | `set_updated_at` trigger |

Indexes: `test_runs_workflow_idx (workflow_id, started_at)`.

## 3. Extended tables

### workflow_transitions (+2 columns)

| column | type | rules |
|--------|------|-------|
| stage_id | uuid → workflow_stages ON DELETE CASCADE | NULL = workflow-level transition; set = stage-level transition (`from_state`/`to_state` are the stage's) |
| user_id | uuid → users | set when a human caused the transition (retry / escalate / cancel); `principal_id` stays for ingestion |

Index added: `workflow_transitions_stage_idx (stage_id, observed_at)`.

## 4. Triggers, NOTIFY, RLS, grants

- `set_updated_at` on `workflow_stages`, `agent_runs`, `test_runs`.
- `notify_inbox_changed()` (existing) attached `AFTER INSERT OR UPDATE` to all four tables — every row has `organization_id`, `project_id`, `workflow_id`, so the existing function body works unchanged and the SSE frame carries the `workflowId` the detail page filters on (research R3).
- RLS policy `<table>_org_isolation` on each new table (same expression as 0001); `packages/db/src/migrate.ts` `RLS_TABLES` gains the four names so the flag toggles them.
- Grants: `SELECT, INSERT, UPDATE ON workflow_stages, agent_runs, test_runs TO app_user`; `SELECT, INSERT, UPDATE ON artifacts TO app_user` (UPDATE guarded by the immutability trigger); `UPDATE (stage_id, user_id)` is not needed — transitions stay insert-only.

## 5. Stage and run state rules

- Stage states use `WORKFLOW_TRANSITIONS` from `@cdevi/contracts` (same machine as workflows). Ingestion of a stage with an `observedAt` not newer than `state_observed_at` is `stale` (no change, logged) — same rule as workflows.
- A new stage may start in `QUEUED` or `RUNNING` (`canTransition(null, s)`).
- `started_at` is set on the first `RUNNING`; `finished_at` on `COMPLETED`, `CANCELLED` or `FAILED`; cleared when a `FAILED` stage moves to `RETRYING`.
- `error_summary` is set from the transition `reason` when the stage enters `FAILED`, cleared on `RETRYING`.
- Ingesting a stage also updates the parent workflow's denormalised `stage_index/stage_count/stage_name` when the stage is the **current** stage (§6) so the Inbox rows stay correct.
- Agent-run `state` is written by ingestion as-is (no transition validation — runs are the orchestrator's account of an execution); the timeline is replaced whole and truncated to the newest 50 events.

## 6. Workflow Detail read model (derived, not stored)

Implemented as pure functions in `packages/contracts/src/workflow-detail-model.ts`; the API composes them from six queries; every rule below has a unit test named by its FR.

| Derivation | Rule |
|------------|------|
| `orderStages(stages)` | ascending `position`; ties impossible (unique) |
| `deriveCurrentStage(stages)` | the first stage whose state is not `COMPLETED`/`CANCELLED`, else the last stage (all done); `null` when there are no stages (FR-001, scenario 1 "current stage highlighted") |
| `deriveProgress(stages)` | `{ completed: count(COMPLETED), total: stages.length, percent: round(100·completed/total) }`; `{0,0,0}` without stages |
| `stageElapsed(stage, now)` | `finished_at ?? now` − `started_at`; `null` when never started; rendered with `humanDuration` |
| `workflowElapsed(workflow, now)` | same over the workflow's `started_at/finished_at` |
| `orderActivity(transitions, runs, now)` | union of: stage/workflow transitions → `{ at: observed_at, source: 'stage'\|'workflow'\|'human', message }`; agent run start/finish → `source: 'agent'`; timeline events → `source: 'agent'`; sorted **ascending** by `at`, then source, then message; bounded to the newest 200 (FR-004 "ordered activity feed") |
| `groupArtifactsByStage(artifacts, stages)` | artifacts ordered by `(stage.position, produced_at)` each tagged `{ stagePosition, stageName }`; artifacts whose stage is missing are dropped (cannot happen with FKs) |
| `deriveAttention(stages, approvals, clarifications)` | the first stage (by position) in `WAITING_FOR_HUMAN` or `BLOCKED`, with `reason` = pending approval `ask` / clarification `question` / `state_reason`, and `action` = `{ label: 'Review approval', href: '/approvals/<id>' }` / `{ label: 'Answer question', href: '/approvals/<clarificationId>' }` / `{ label: 'Open Integrations', href: '/integrations' }` for `BLOCKED` without a request; `null` otherwise (FR-005) |
| `deriveFailure(workflow, stages)` | when the workflow **or any stage** is `FAILED`: `{ reason: stage.error_summary ?? stage.state_reason ?? workflow.state_reason, failingStage: {position,name}, lastSuccessfulStage: the highest-position COMPLETED stage before it or null }`; `null` otherwise (FR-006, scenario 5) |
| `allowedActions(role, workflowState)` | `retry` → role ∈ {engineer, administrator} ∧ state = FAILED; `cancel` → role ∈ {engineer, administrator} ∧ `canTransition(state,'CANCELLED')`; `escalate` → role ∈ {engineer, approver, administrator} ∧ state ∈ {FAILED, BLOCKED, WAITING_FOR_HUMAN}; result `{ retry, escalate, cancel }: boolean` (FR-006 role gate) |
| `nextStage(stages, current)` | the stage after the current one by position, or `null` ("what happens next") |

## 7. `WorkflowDetail` response shape (Zod, `packages/contracts/src/workflow-detail.ts`)

```ts
WorkflowDetail = {
  generatedAt: IsoDateTime,
  workflow: { id, externalId, title, project: { id, key }, state, stateReason, stateObservedAt,
              agent, pullRequestRef, startedAt, finishedAt, elapsedMs: number|null,
              stage: { index, count, name } | null, riskLevel: RiskLevel|null },
  stages: WorkflowStageView[],          // ordered; each { id, position, name, state, stateReason, agent,
                                        //   startedAt, finishedAt, elapsedMs, errorSummary, requiresApproval, current: boolean }
  currentStage: { position, name, state, agent, model, elapsedMs, summary: string|null, runId } | null,
  nextStage: { position, name } | null,
  progress: { completed, total, percent },
  activity: ActivityEvent[],            // ascending; { at, source: 'workflow'|'stage'|'agent'|'human', kind, message, stagePosition?, agent? }
  artifacts: ArtifactView[],            // { id, type, title, href, summary, producedAt, stage: { position, name } }
  testRuns: TestRunView[],              // { id, category, status, total, passed, failed, skipped, href, startedAt, finishedAt, stage }
  attention: { state: 'WAITING_FOR_HUMAN'|'BLOCKED', stage: {position,name}, reason, action: { label, href } } | null,
  failure: { reason, failingStage: {position,name}, lastSuccessfulStage: {position,name}|null } | null,
  actions: { retry: boolean, escalate: boolean, cancel: boolean },
}
```

## 8. Validation rules (Zod, ingestion extensions)

| Schema | Route | Rules |
|--------|-------|-------|
| `StageUpsert` | `PUT /ingest/workflows/{externalId}/stages/{position}` | `name` ≤ 60, `state` WorkflowState, `observedAt` ISO, `reason` ≤ 240?, `agent` ≤ 80?, `requiresApproval` bool?, `approvalExternalId`?, `clarificationExternalId`?, `count` 1–20? (sets `stage_count` when given). Transition validated with `canTransition`; stale rule as §5 |
| `AgentRunUpsert` | `PUT /ingest/agent-runs/{externalId}` | `workflowExternalId`, `stagePosition` 1–20, `agent` ≤ 80, `model` ≤ 80?, `state` (not QUEUED), `startedAt`, `finishedAt`?, `summary` ≤ 400?, `timeline` ≤ 50 × `{ at, kind, message ≤ 240 }` |
| `ArtifactUpsert` | `PUT /ingest/artifacts/{externalId}` | `workflowExternalId`, `stagePosition`, `type` ArtifactType, `title` ≤ 200, `href` url ≤ 500?, `summary` ≤ 400?, `producedAt` |
| `TestRunUpsert` | `PUT /ingest/test-runs/{externalId}` | `workflowExternalId`, `stagePosition`, `category` ≤ 40, `status` TestRunStatus, counts ≥ 0 with `passed+failed+skipped ≤ total`, `href`?, `startedAt`, `finishedAt`? |
| `WorkflowActionRequest` | `POST /workflows/{id}/actions` | `action` ∈ retry/escalate/cancel; `note` ≤ 240? (escalate) |

All ingestion routes: unknown workflow → 404; workflow outside the principal's projects → 403; unknown stage position for runs/artifacts/test runs → 404 `Unknown stage`; stale → `{ outcome: 'stale' }`; invalid transition → 409; immutable artifact → 409.

## 9. Seed additions (research R8)

`buildS500(base)` returns `{ users, workflows, showcase }` where `showcase: SeedShowcase[]` lists, per showcase workflow, `stages[]` (with `history[]` transitions), `runs[]`, `artifacts[]`, `testRuns[]`, all deterministic relative to `base`. `seed()` writes them after the workflows and truncates the change log at the end as before. `EXPECTED_BUCKETS` is unchanged; `EXPECTED_SHOWCASE = { workflows: 2, stages: 14, runs: 13, artifacts: 10, testRuns: 5 }`.

---

# Part B — User Story 2 (Approval Center)

Migration `packages/db/migrations/0003_approval_center.sql`, mirrored in `packages/db/src/schema.ts`. Research R12–R16.

## 10. Entity overview (US2)

| Entity | Storage | Status |
|--------|---------|--------|
| Approval (spec Key Entities) | `approvals` | existing — extended with context, links, rejection metadata, decider FK |
| Clarification | `clarifications` | existing — extended with why-it-matters, options, links, answer, answerer FK |
| Human decision | `approvals.decision*`, `clarifications.answer*` + `workflow_transitions` row (`user_id` set) | new writes (R11–R13) |
| Audit event (FR-029) | `audit_events` | **new**, append-only (R15) |

## 11. Extended tables

### approvals (new columns)

| column | type | rules |
|--------|------|-------|
| context | text | ≤ 2 000 chars; agent-supplied "what and why" shown under the ask |
| links | jsonb NOT NULL DEFAULT '{}' | keys ⊆ `requirement`, `workflow`, `agentRun`, `externalTicket`, `pullRequest`; each an http(s) or app-relative href ≤ 500 |
| rejection_reason | text | ≤ 500 chars; required when `decision = 'rejected'` by a human (`CHECK (decision <> 'rejected' OR rejection_reason IS NOT NULL OR decided_by_user_id IS NULL)`) |
| rejection_target | workflow_state | `BLOCKED` or `CANCELLED` (`CHECK`) ; NULL unless rejected |
| decided_by_user_id | uuid → users | set by the human path; NULL for ingestion-observed decisions |

`decided_by` (text) keeps the decider's display name so Inbox `RecordView.resolution.by` and the seed are unchanged.

### clarifications (new columns)

| column | type | rules |
|--------|------|-------|
| why_it_matters | text | ≤ 1 000 chars (FR-014 "why it matters") |
| options | jsonb NOT NULL DEFAULT '[]' | ≤ 8 × `{ value ≤ 80, label ≤ 120, recommended boolean }`; at most one `recommended`; `has_recommended_answer` is kept in step by ingestion |
| links | jsonb NOT NULL DEFAULT '{}' | keys ⊆ `requirement`, `workflow`, `agentRun`, `externalTicket` |
| answer_option | text | the chosen option `value`; NULL for free text |
| answer_text | text | ≤ 2 000 chars; free-text answer, or the option label when an option was chosen |
| answered_by_user_id | uuid → users | set by the human path |

Invariant: `answered_at IS NULL` ⇔ pending. A human answer sets `answered_at`, `answered_by` (display name), `answered_by_user_id`, and exactly one of `answer_option`/`answer_text` non-null (`CHECK`).

## 12. New table `audit_events`

| column | type | rules |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` |
| organization_id | uuid NOT NULL → organizations | |
| project_id | uuid → projects | NULL for organization-level events |
| workflow_id | uuid → workflows ON DELETE SET NULL | |
| actor_type | text NOT NULL | `CHECK (actor_type IN ('user','agent','system'))` |
| actor_id | uuid | `users.id` when `actor_type = 'user'` |
| actor_name | text NOT NULL | display name at the time |
| action | text NOT NULL | dotted `<entity>.<past_tense_verb>`: `approval.approved`, `approval.rejected`, `clarification.answered` |
| target_type | text NOT NULL | `approval` \| `clarification` |
| target_id | uuid NOT NULL | |
| risk_level | risk_level | approval's risk; NULL for clarifications |
| policy | text | reserved for the policy engine (NULL in US2) |
| result | text NOT NULL | resulting workflow state (`RUNNING`, `BLOCKED`, `CANCELLED`) |
| details | jsonb NOT NULL DEFAULT '{}' | `{ reason?, target?, answerOption?, answerText?, ask?, question? }` |
| occurred_at | timestamptz NOT NULL | the request clock (`app.now()`), equals `decided_at` / `answered_at` |

Indexes: `(organization_id, occurred_at DESC)`, `(organization_id, target_type, target_id, occurred_at DESC)`, `(workflow_id, occurred_at DESC)`. Trigger `audit_events_append_only` `BEFORE UPDATE OR DELETE` raises `audit_events is append-only`. RLS policy by `organization_id` as in 0001 (flag-enabled; added to `RLS_TABLES`). Grants: `GRANT SELECT, INSERT ON audit_events TO app_user` — no UPDATE/DELETE. Seed reset truncates it.

## 13. Decision rules (pure, `packages/contracts/src/decision-rules.ts`; contract `contracts/decision-rules.md`)

| Rule | Definition |
|------|------------|
| `canDecide(role)` | `role ∈ {approver, administrator}` |
| `requiresConfirmation(riskLevel)` | `riskLevel ∈ {HIGH, CRITICAL}` |
| `resultingState(decision)` | approve → `RUNNING`; answer → `RUNNING`; reject → the request's `target` (`BLOCKED` \| `CANCELLED`) |
| `decisionAllowed(workflowState, itemPending)` | `workflowState = WAITING_FOR_HUMAN ∧ itemPending`; every target is `canTransition(WAITING_FOR_HUMAN, target)` |
| `orderApprovalCenter(a, b)` | comparator: `riskRank(riskLevel) ASC` (CRITICAL=0 … LOW=3, null=4 so clarifications sort last), then `requestedAt ASC`, then `id ASC` |
| `answerIsValid(body, options)` | exactly one of `option`/`text`; `option` must be one of `options[].value`; `text` trimmed 1–2 000 |

## 14. Read models (`packages/contracts/src/approval-center.ts`)

```
ApprovalCenterItem {
  id, kind: 'approval' | 'clarification', workflowId, workflowExternalId, workflowTitle,
  project { id, key, name }, ask, riskLevel: RiskLevel | null, requestedBy: string | null,
  requestedAt, expiresAt: IsoDateTime | null, hasRecommendedAnswer, href: `/approvals/${id}`
}
ApprovalCenterSnapshot { generatedAt, project: 'all' | uuid, items: ApprovalCenterItem[] (≤ 200), counts { approvals, clarifications } }
Resolution { outcome: 'approved' | 'rejected' | 'answered', by { id: uuid | null, name }, at,
             reason: string | null, target: 'BLOCKED' | 'CANCELLED' | null,
             answer: { option: string | null, text } | null, workflowState }
ApprovalCenterDetail {
  item, workflowState, canDecide: boolean,
  approval: { context, links, requiresConfirmation } | null,
  clarification: { whyItMatters, options[], links } | null,
  resolution: Resolution | null,
  audit: AuditEventView[] (≤ 20, newest first)
}
DecisionResult { detail: ApprovalCenterDetail }          // 200 on success (detail reflects the new resolution)
AlreadyResolvedProblem = Problem & { resolution: Resolution }   // 409 urn:cdevi:problem:already-resolved
```

## 15. Validation rules (Zod, `packages/contracts/src/decisions.ts`)

| Schema | Route | Rules |
|--------|-------|-------|
| `DecisionParams` | all three | `id` uuid |
| `ApproveRequest` | `POST /approvals/{id}/approve` | `confirmed` boolean (default false); server requires `true` when `requiresConfirmation(risk)` → 400 `validation` path `confirmed` |
| `RejectRequest` | `POST /approvals/{id}/reject` | `reason` trimmed 1–500 (required); `target` ∈ `BLOCKED`, `CANCELLED` |
| `AnswerRequest` | `POST /clarifications/{id}/answer` | exactly one of `option` (≤ 80) or `text` (trimmed 1–2 000); unknown option → 400 |
| `ApprovalCenterQuery` | `GET /approvals` | `project` uuid \| `all` (default `all`) |
| `ApprovalUpsert` (+) | ingestion | optional `context` ≤ 2 000, `links` (≤ 5 keys) |
| `ClarificationUpsert` (+) | ingestion | optional `whyItMatters` ≤ 1 000, `options` ≤ 8, `links` (≤ 4 keys); `hasRecommendedAnswer` derived when `options` given |

Errors: not signed in → 401; role not allowed → 403 `forbidden`; unknown or invisible item → 404; workflow not `WAITING_FOR_HUMAN` → 409 `invalid-transition`; already resolved → 409 `already-resolved` (+ `resolution`).

## 16. Transaction (one `REPEATABLE READ` transaction per decision)

1. `SELECT … FROM approvals|clarifications WHERE id AND organization_id FOR UPDATE` — 404 if none or project invisible; 409 already-resolved if decided/answered.
2. `SELECT … FROM workflows WHERE id FOR UPDATE` — 409 invalid-transition unless `WAITING_FOR_HUMAN`.
3. `UPDATE approvals SET decision, decided_at, decided_by, decided_by_user_id, rejection_reason, rejection_target` / `UPDATE clarifications SET answered_at, answered_by, answered_by_user_id, answer_option, answer_text`.
4. `UPDATE workflows SET state, state_observed_at` (+ `finished_at` for CANCELLED) and `INSERT workflow_transitions (from_state, to_state, observed_at, reason, user_id)`.
5. `INSERT audit_events (…)`.
6. Commit → the existing `notify_inbox_changed()` triggers on approvals / clarifications / workflows produce `inbox_change_log` rows and `pg_notify('inbox_changed')` → header count and Inbox refresh (FR-034).

## 17. Seed additions (research R19)

`buildS500(base)` adds `decisionShowcase: { approvals: 2, clarifications: 1 }` on three `WAITING_FOR_HUMAN` workflows: a LOW requirement approval (`s500-apr-req`), a MEDIUM PR-merge approval with `links.pullRequest` (`s500-apr-pr`), and a clarification (`s500-clr-01`) with `why_it_matters`, three options (one recommended) and all four links. `EXPECTED_BUCKETS` unchanged; `seed()` truncates `audit_events`.

---

# Part C — User Story 3 (Dashboard): §18–§21

No new tables, columns, enums, triggers or grants. §18 adds indexes only; §19–§20 are read models and pure derivation rules over the tables of §1–§12; §21 is seed data.

## 18. Migration `0004_dashboard.sql` — indexes only (research R23)

```sql
CREATE INDEX test_runs_org_project_finished_idx  ON test_runs  (organization_id, project_id, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX agent_runs_org_project_finished_idx ON agent_runs (organization_id, project_id, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX audit_events_org_risk_time_idx      ON audit_events (organization_id, project_id, occurred_at DESC) WHERE risk_level IN ('HIGH','CRITICAL');
CREATE INDEX approvals_workflow_idx              ON approvals (workflow_id);
CREATE INDEX clarifications_workflow_idx         ON clarifications (workflow_id);
```

Mirrored in `packages/db/src/schema.ts` (`index(...).on(...).where(...)`). `RLS_TABLES` unchanged. Rollback: `DROP INDEX IF EXISTS` for the five names.

## 19. Read model (`packages/contracts/src/dashboard.ts`, Zod) and route

**Route**: `GET /api/dashboard?project=all|<uuid>&window=24h|7d|30d` — session-authenticated (`app.requireUser`), every role; `project` defaults to `all`, `window` defaults to `7d`. Responses: `200 DashboardSnapshot`; `400 Problem` (`validation`, invalid `project` or `window`); `401 Problem`. A `project` uuid that is unknown or not visible to the user yields a snapshot with every count `0`, empty `activeWorkflows` and `project` echoed (same behaviour as `GET /api/approvals`, R16), never a 404 that would confirm the project exists. Header `Server-Timing: db;dur=<ms>`.

```
DashboardQuery      { project: 'all' | Uuid = 'all', window: WindowKey = '7d' }
WindowKey           = '24h' | '7d' | '30d'
Window              { key: WindowKey, from: IsoDateTime, to: IsoDateTime }          // to = generatedAt
Href                = string starting with '/' (≤ 200)
Figure              { value: number (int ≥ 0), href: Href }
Rate                { numerator: number (int ≥ 0), denominator: number (int ≥ 0), href: Href }   // numerator ≤ denominator
PipelineStage       { stage: 1..7, name: SdlcStageName, count: number, href: Href }   // href = `/workflows?stage=${stage}`
SdlcStageName       = 'Requirement' | 'Analysis' | 'Architecture' | 'Implementation' | 'Testing' | 'Review' | 'PR'

DashboardCounts     { activeWorkflows: Figure, runningAgents: Figure, prsGenerated: Figure, openFailures: Figure }
DashboardPipeline   { stages: PipelineStage[7] (exactly one per stage 1..7, ascending), unstaged: Figure }
DashboardNeedsMe    { approvals: Figure, clarifications: Figure, failed: Figure, blocked: Figure }
DashboardHealth     { testPassRate: Rate, agentSuccessRate: Rate, humanInterventionRate: Rate }
SecurityFindings    { connected: false, count: null, href: Href } | { connected: true, count: number, href: Href }   // US3 always the first
DashboardRisk       { pendingHighCritical: Figure, auditHighCritical: Figure, securityFindings: SecurityFindings }
ActiveWorkflowCard  {
  workflowId: Uuid, externalId: string, title: string,
  stage: { index: number | null, count: number, name: string | null },
  progress: { done: number, total: number },            // done = max(index − 1, 0), total = count (≥ 1)
  agent: string | null, elapsedMs: number | null,       // now − started_at; null when not started
  state: WorkflowState, stateObservedAt: IsoDateTime, href: `/workflows/${workflowId}`
}
DashboardSnapshot   {
  generatedAt: IsoDateTime, project: 'all' | Uuid, window: Window,
  counts: DashboardCounts, pipeline: DashboardPipeline, needsMe: DashboardNeedsMe,
  health: DashboardHealth, risk: DashboardRisk,
  activeWorkflows: ActiveWorkflowCard[] (≤ 12, ordered stateObservedAt desc, workflowId asc),
  activeWorkflowsTotal: number                          // = counts.activeWorkflows.value, so the UI can say "Show all 18"
}
```

Every `Figure`/`Rate` carries its `href` (research R25) so FR-023 is asserted on data. Percentages are **not** in the payload; `ratePercent(rate): number | null` (one decimal) lives in the pure model. Payload bound: 4 counts + 8 pipeline + 4 + 3 + 3 + 12 cards ≈ 6 KB.

Exported from `packages/contracts/src/index.ts`; registered in `buildWorkflowDetailOpenApi()` (retitled "specs/001 US1–US3", tag `dashboard`) and regenerated into `contracts/openapi.yaml` by `pnpm -F @cdevi/contracts openapi` in the implementation round.

## 20. Pure derivation rules (`packages/contracts/src/dashboard-model.ts`, zod-free, subpath `@cdevi/contracts/dashboard-model`)

```
ACTIVE_STATES        = ['QUEUED','RUNNING','RETRYING','WAITING','WAITING_FOR_HUMAN','BLOCKED','FAILED']   // = WORKFLOW_STATES minus terminal
RUNNING_AGENT_STATES = ['RUNNING','RETRYING']
FAILURE_STATES       = ['FAILED','BLOCKED']
SDLC_STAGES          = ['Requirement','Analysis','Architecture','Implementation','Testing','Review','PR']
ACTIVE_CARD_LIMIT    = 12
WINDOW_MS            = { '24h': 24h, '7d': 7d, '30d': 30d }

windowFor(key, now)            → { key, from: now − WINDOW_MS[key], to: now }
dashboardHrefs(windowKey)      → the R25 table (pure, total; the API and the UI both call it)
ratePercent({ numerator, denominator }) → null when denominator = 0, else round(100 · n / d, 1)
stageProgress(index, count)    → { done: index == null ? 0 : max(index − 1, 0), total: max(count ?? 7, 1) }
elapsedMs(startedAt, now)      → null when startedAt == null, else max(now − startedAt, 0)
orderActiveCards(a, b)         → stateObservedAt desc, then workflowId asc (mirrors Q8 `ORDER BY`)
pipelineFrom(rowCounts)        → PipelineStage[7] in ascending order with SDLC_STAGES names + unstaged
buildDashboardSnapshot(rows: DashboardRows, now, windowKey, project) → DashboardSnapshot
```

`DashboardRows` is the typed shape of the eight R22 statements (integers and the ≤ 12 card rows). Invariants asserted by tests: `Σ pipeline.stages[i].count + pipeline.unstaged.value = counts.activeWorkflows.value`; `needsMe.failed.value + needsMe.blocked.value = counts.openFailures.value`; `risk.pendingHighCritical.value ≤ needsMe.approvals.value`; every `Rate.numerator ≤ denominator`; `activeWorkflows.length ≤ 12` and `≤ activeWorkflowsTotal`; every href starts with `/` and pipeline href `n` equals `stage`.

Window semantics per figure are the R24 table: windowed = `prsGenerated`, the three health rates, `auditHighCritical`; everything else is point-in-time.

## 21. Seed additions (research R30)

`packages/db/src/seed/dashboard.ts › buildDashboardShowcase(base)` (own `mulberry32(SEED_RNG + 1)` stream so S-500 draws are untouched) returns `{ project: { key: 'dashboard-demo', name: 'Dashboard Demo' }, workflows: SeedWorkflow[24], showcase: SeedShowcase[] }` and `EXPECTED_DASHBOARD = { workflows: 24, active: 18, approvals: 4, clarifications: 2, stages: 43, runs: 44, testRuns: 6 }`. `seed()` inserts the project (no memberships) and writes the workflows with the same helpers as S-500 after the S-500 pass.

| externalId | state | stage | extras |
|------------|-------|-------|--------|
| s500-d01, d02 | QUEUED | 1 | `started_at` null |
| s500-d03 | WAITING_FOR_HUMAN | 1 | clarification (pending) |
| s500-d04 | WAITING_FOR_HUMAN | 2 | clarification (pending) |
| s500-d05 | RUNNING | 2 | 1 stage row, 1 RUNNING agent run |
| s500-d06 | RUNNING | 3 | idem |
| s500-d07, d08 | RUNNING | 4 | idem |
| s500-d09 | WAITING_FOR_HUMAN | 4 | approval **CRITICAL** (pending) |
| s500-d10 | BLOCKED | 4 | `state_reason` set |
| s500-d11 | RUNNING | 5 | idem |
| s500-d12 | RETRYING | 5 | 1 stage row, 1 FAILED run (finished, in window) + 1 RETRYING run |
| s500-d13 | FAILED | 5 | 1 stage row (FAILED), 1 FAILED run, test run `total 100, passed 89, failed 11` finished in window |
| s500-d14 | RUNNING | 6 | idem |
| s500-d15 | WAITING | 6 | — |
| s500-d16 | WAITING_FOR_HUMAN | 6 | approval **HIGH** (pending) |
| s500-d17 | WAITING_FOR_HUMAN | 7 | approval MEDIUM "Approve PR merge" (pending), `pull_request_ref` set |
| s500-d18 | WAITING_FOR_HUMAN | 7 | approval LOW (pending) |
| s500-d19 … d23 | COMPLETED | 7 | `pull_request_ref`, `finished_at` 1–3 days ago; 7 stage rows, 7 COMPLETED runs, test run `total 180, passed 177, failed 3` at stage 5; d19 and d20 also carry a **decided** approval |
| s500-d24 | CANCELLED | 3 | `finished_at` 5 days ago |

Clock rules: every `finished_at` (agent runs, test runs, COMPLETED workflows) lies between 1 and 3 days before `base`, so `7d` and `30d` agree and `24h` has empty health denominators; every active workflow's `state_observed_at` lies within the last 12 hours (d17 included, so `24h` counts one PR).

Pipeline check: stage 1 → d01, d02, d03 = 3 · stage 2 → d04, d05 = 2 · stage 3 → d06 = 1 · stage 4 → d07, d08, d09, d10 = 4 · stage 5 → d11, d12, d13 = 3 · stage 6 → d14, d15, d16 = 3 · stage 7 → d17, d18 = 2 · **total 18**. Health check (7d): tests 5 × 177 + 89 = 974 of 5 × 180 + 100 = 1000 → **97.4 %**; runs 35 / 37 → 94.6 %; intervention (d03, d04, d09, d16, d17, d18, d19, d20) = 8 / 24 → 33.3 %. `audit_events` stays empty.
