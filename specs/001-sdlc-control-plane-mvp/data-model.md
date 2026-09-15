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

---

# Part D — User Story 4 (Requirements): §22–§30

First migration that adds tables. §22 is the migration `0005_requirements.sql`; §23–§27 are the Zod shapes; §28 the pure state-machine rules (zod-free subpath `@cdevi/contracts/requirement-rules`); §29 the transactions; §30 the seed.

## 22. Migration `0005_requirements.sql` (research R32–R40)

```sql
-- specs/001 US4 (Part D): requirements, analysis items, transitions, Jira project mappings; workflows.requirement_id;
-- inbox_change_log.requirement_id. RLS and grants follow 0001–0003.

CREATE TYPE requirement_state  AS ENUM ('DRAFT','ANALYZING','NEEDS_CLARIFICATION','READY','APPROVED','IN_IMPLEMENTATION','COMPLETED','REJECTED');
CREATE TYPE requirement_source AS ENUM ('manual','jira');
CREATE TYPE analysis_item_kind AS ENUM ('acceptance_criterion','rule','open_question');
CREATE TYPE external_flag      AS ENUM ('deleted','closed');

-- §22.1 integration_project_mappings: Jira project key → CDevi project (R36). One key resolves to one project.
CREATE TABLE integration_project_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('jira')),
  external_project_key text NOT NULL CHECK (external_project_key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  external_base_url text NOT NULL CHECK (external_base_url ~ '^https://' AND char_length(external_base_url) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_project_key),
  UNIQUE (organization_id, project_id, provider)
);

-- §22.2 requirements (R32, R34)
CREATE TABLE requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (external_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  business_objective text NOT NULL CHECK (char_length(business_objective) BETWEEN 10 AND 4000),
  state requirement_state NOT NULL DEFAULT 'DRAFT',
  source requirement_source NOT NULL DEFAULT 'manual',
  external_ref jsonb,                                   -- { provider:'jira', key, url, updatedAt } (R36)
  external_flag external_flag,
  external_flagged_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),         -- NULL for Jira-created rows
  assignee_user_id uuid REFERENCES users(id),
  submitted_by_user_id uuid REFERENCES users(id),
  submitted_at timestamptz,
  analysis_observed_at timestamptz,                     -- idempotency watermark for the analysis ingest (R35)
  analysis_agent text CHECK (char_length(analysis_agent) <= 80),
  analysis_summary text CHECK (char_length(analysis_summary) <= 400),  -- AI-generated (labelled)
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  rejected_by_user_id uuid REFERENCES users(id),
  rejected_at timestamptz,
  rejection_reason text CHECK (char_length(rejection_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id),
  CONSTRAINT requirements_external_ref_check CHECK (
    (source = 'manual' AND external_ref IS NULL) OR
    (source = 'jira' AND external_ref ? 'key' AND external_ref ? 'url')),
  CONSTRAINT requirements_flag_check CHECK ((external_flag IS NULL) = (external_flagged_at IS NULL))
);
CREATE UNIQUE INDEX requirements_jira_key_idx ON requirements (organization_id, (external_ref->>'key')) WHERE source = 'jira';
CREATE INDEX requirements_list_idx     ON requirements (organization_id, project_id, created_at DESC, id DESC);
CREATE INDEX requirements_state_idx    ON requirements (organization_id, state, created_at DESC, id DESC);   -- full: the state filter accepts terminal states too (§23.3)
CREATE INDEX requirements_assignee_idx ON requirements (organization_id, assignee_user_id, created_at DESC, id DESC) WHERE assignee_user_id IS NOT NULL;
CREATE TRIGGER requirements_updated_at BEFORE UPDATE ON requirements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- §22.3 requirement_analysis_items: one row per criterion / rule / open question (R34).
-- Human-authored items (create form) and AI items (analysis ingest) have DISJOINT position spaces:
-- the unique key includes ai_generated, so an authored criterion and an AI criterion may both be position 1.
CREATE TABLE requirement_analysis_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  kind analysis_item_kind NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  ai_generated boolean NOT NULL,
  source text NOT NULL CHECK (char_length(source) <= 120),   -- 'user:<display name>' | 'agent:<agent>'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requirement_id, kind, ai_generated, position),
  CONSTRAINT requirement_analysis_items_human_check CHECK (ai_generated OR (kind = 'acceptance_criterion' AND position <= 20))   -- humans author ≤ 20 criteria only (R45)
);
CREATE INDEX requirement_analysis_items_req_idx ON requirement_analysis_items (requirement_id, kind, ai_generated, position);

-- §22.4 requirement_transitions: append-only history (R32), mirrors workflow_transitions
CREATE TABLE requirement_transitions (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  from_state requirement_state,                          -- NULL on creation
  to_state requirement_state NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id text,
  actor_name text NOT NULL CHECK (char_length(actor_name) <= 120),
  reason text CHECK (char_length(reason) <= 500),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requirement_transitions_req_idx ON requirement_transitions (requirement_id, occurred_at);
CREATE FUNCTION requirement_transitions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'requirement_transitions is append-only' USING ERRCODE = 'P0001';
END $$;   -- same body as 0003 audit_events_append_only(), per-table message like 0001
CREATE TRIGGER requirement_transitions_append_only BEFORE UPDATE OR DELETE ON requirement_transitions
  FOR EACH ROW EXECUTE FUNCTION requirement_transitions_append_only();

-- §22.5 workflows.requirement_id — one workflow per requirement in US4 (R37)
ALTER TABLE workflows ADD COLUMN requirement_id uuid REFERENCES requirements(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX workflows_requirement_idx ON workflows (requirement_id) WHERE requirement_id IS NOT NULL;
CREATE INDEX workflows_list_idx ON workflows (organization_id, state_observed_at DESC, id DESC);   -- GET /workflows keyset (R38)

-- §22.6 Approved → In Implementation → Completed follows the linked workflow (R33)
CREATE FUNCTION requirements_follow_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state requirement_state; v_next requirement_state;
BEGIN
  SELECT state INTO v_state FROM requirements WHERE id = NEW.requirement_id FOR UPDATE;
  IF v_state IS NULL THEN RETURN NEW; END IF;
  IF NEW.state = 'COMPLETED' AND v_state IN ('APPROVED','IN_IMPLEMENTATION') THEN v_next := 'COMPLETED';
  ELSIF v_state = 'APPROVED' AND NEW.state NOT IN ('QUEUED','CANCELLED','BLOCKED') THEN v_next := 'IN_IMPLEMENTATION';
  ELSE RETURN NEW; END IF;
  UPDATE requirements SET state = v_next WHERE id = NEW.requirement_id;
  INSERT INTO requirement_transitions (organization_id, requirement_id, from_state, to_state, actor_type, actor_name, reason, occurred_at)
    VALUES (NEW.organization_id, NEW.requirement_id, v_state, v_next, 'system', 'workflow', 'workflow ' || NEW.external_id || ' → ' || NEW.state, NEW.state_observed_at);
  RETURN NEW;
END $$;
CREATE TRIGGER workflows_follow_requirement AFTER UPDATE OF state ON workflows FOR EACH ROW
  WHEN (NEW.requirement_id IS NOT NULL AND OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION requirements_follow_workflow();

-- §22.7 live updates: requirement changes ride inbox_changed (R40). ONE trigger, on requirements only:
-- requirement_analysis_items has no trigger — every write to it (create form, analysis ingest) happens in a
-- transaction that also INSERTs/UPDATEs the parent requirements row, which is the single NOTIFY per transaction.
ALTER TABLE inbox_change_log ALTER COLUMN workflow_id DROP NOT NULL, ADD COLUMN requirement_id uuid;
ALTER TABLE inbox_change_log ADD CONSTRAINT inbox_change_log_target_check CHECK (workflow_id IS NOT NULL OR requirement_id IS NOT NULL);
CREATE FUNCTION notify_requirement_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_seq bigint;
BEGIN
  INSERT INTO inbox_change_log (organization_id, project_id, workflow_id, requirement_id)
    VALUES (NEW.organization_id, NEW.project_id, NULL, NEW.id) RETURNING seq INTO v_seq;
  PERFORM pg_notify('inbox_changed', json_build_object('seq', v_seq, 'organizationId', NEW.organization_id,
    'projectId', NEW.project_id, 'workflowId', NULL, 'requirementId', NEW.id)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER inbox_changed_requirements AFTER INSERT OR UPDATE ON requirements FOR EACH ROW EXECUTE FUNCTION notify_requirement_changed();

-- §22.8 RLS policies (same shape as 0001; ENABLE/DISABLE ROW LEVEL SECURITY is NOT done here — the CDEVI_RLS loop in
-- packages/db/src/migrate.ts owns it for every table in RLS_TABLES, which gains these four names) and grants
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_project_mappings','requirements','requirement_analysis_items','requirement_transitions'] LOOP
    EXECUTE format('CREATE POLICY %I_org_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)::uuid)', t, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON requirements, requirement_analysis_items TO app_user;
GRANT SELECT ON integration_project_mappings TO app_user;          -- mappings are seeded/administered (US8), never written by US4 routes
GRANT SELECT, INSERT ON requirement_transitions TO app_user;      -- append-only
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
```

Notes: `requirement_transitions_append_only()` has the same body as 0003's `audit_events_append_only()` but names its own table in the message, as 0001 does per table. **Existing tests that 0005 changes** (the `db` project applies every migration in `beforeAll`, so these assertions see 0005): (i) `packages/db/tests/schema.test.ts` ≈ line 149 — the `inbox_changed_%` trigger list asserted with `toEqual` gains exactly one name, `'inbox_changed_requirements'` (sorted position: after `inbox_changed_clarifications`, before `inbox_changed_test_runs`); (ii) `packages/db/tests/schema.test.ts` ≈ line 741 (`SC-007 0004 adds no tables, columns, triggers, policies or grants (indexes only)`) — the `pg_tables` expectation becomes `[...TABLES_AFTER_0003, ...TABLES_ADDED_BY_0005].sort()` with `TABLES_ADDED_BY_0005 = ['integration_project_mappings', 'requirements', 'requirement_analysis_items', 'requirement_transitions']` declared next to `TABLES_AFTER_0003`; the `columnCounts` map (`test_runs 17, agent_runs 15, audit_events 15, approvals 20, clarifications 19`) is untouched because 0005 adds columns only to `workflows` and `inbox_change_log`, which are not in that map; the 0004 SQL-text assertions are untouched. No other US1–US3 test reads the trigger list, `pg_tables` or the column counts (`FR-001 updated_at triggers …` uses `toContain`). These two edits are made in T092 (tests-first) and are the **only** changes to an existing assertion in US4 (other tasks only append new tests to existing files). **Webhook and RLS**: the mapping lookup (`SELECT … FROM integration_project_mappings WHERE provider = 'jira' AND external_project_key = $1`) runs on `app.pool` (`DATABASE_URL`, role `app_user`) *before* any organization is known, so `app.organization_id` is unset; the table carries the same `organization_id` isolation policy as every other table, which means that with `CDEVI_RLS=on` this lookup returns no rows — exactly the limitation the sessions bootstrap in `apps/api/src/plugins/db.ts` already has (it also reads before the organization is known). RLS is flag-off in dev, test and CI (`CDEVI_RLS` unset), which both bootstraps depend on; a bypass role for the two bootstraps is an open question for the deployment story, not for US4, and nothing in US4 widens the policy — recorded as an explicit open item in plan.md Part D Complexity Tracking and written into `docs/architecture.md` §6 by T118. After the mapping resolves, `handleJiraEvent` opens `app.tx({ organizationId })` like every other write. Mirrored in `packages/db/src/schema.ts`: `requirementState`, `requirementSource`, `analysisItemKind`, `externalFlag` enums; `integrationProjectMappings`, `requirements`, `requirementAnalysisItems`, `requirementTransitions` tables; `workflows.requirementId`; `inboxChangeLog.requirementId` (and `workflowId` nullable); every index above. `packages/db/src/migrate.ts` `RLS_TABLES` gains `integration_project_mappings`, `requirements`, `requirement_analysis_items`, `requirement_transitions`. Rollback: drop the triggers `requirements_updated_at`, `requirement_transitions_append_only`, `workflows_follow_requirement`, `inbox_changed_requirements` and the functions `requirement_transitions_append_only()`, `requirements_follow_workflow()`, `notify_requirement_changed()`, the `inbox_change_log` constraint and column (re-add `NOT NULL` only if no requirement rows exist), `workflows.requirement_id` and its indexes, the four tables, the four enums.

## 23. Requirement shapes (`packages/contracts/src/requirements.ts`, Zod)

```ts
export const RequirementState = z.enum(['DRAFT','ANALYZING','NEEDS_CLARIFICATION','READY','APPROVED','IN_IMPLEMENTATION','COMPLETED','REJECTED']);
export const RequirementSource = z.enum(['manual','jira']);
export const ExternalFlag = z.enum(['deleted','closed']);
export const AnalysisItemKind = z.enum(['acceptance_criterion','rule','open_question']);

export const ExternalRef = z.object({ provider: z.literal('jira'), key: z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/), url: z.string().url().startsWith('https://'), updatedAt: IsoDateTime });
export const UserRef = z.object({ id: Uuid, name: z.string() });
export const ProjectRef = z.object({ id: Uuid, key: z.string(), name: z.string() });

export const LinkedWorkflow = z.object({
  id: Uuid, externalId: ExternalId, state: WorkflowState,
  stage: z.object({ index: z.number().int(), count: z.number().int(), name: z.string().nullable() }).nullable(),
  href: z.string(),                       // '/workflows/{id}'
});

export const Requirement = z.object({            // list row (§23.1)
  id: Uuid, externalId: ExternalId, project: ProjectRef,
  title: z.string(), state: RequirementState, source: RequirementSource,
  externalRef: ExternalRef.nullable(), externalFlag: ExternalFlag.nullable(),
  assignee: UserRef.nullable(), createdBy: UserRef.nullable(),
  createdAt: IsoDateTime, updatedAt: IsoDateTime, submittedAt: IsoDateTime.nullable(),
  openQuestionCount: z.number().int().min(0),
  linkedWorkflow: LinkedWorkflow.nullable(),
  href: z.string(),                              // '/requirements/{id}'
});

export const AnalysisItem = z.object({ id: Uuid, kind: AnalysisItemKind, position: z.number().int().min(1).max(50), text: z.string(), aiGenerated: z.boolean(), source: z.string() });
// `position` is 1..n within (kind, aiGenerated); lists are ordered human items first (ai_generated ASC), then position ASC

export const RequirementActions = z.object({ canSubmit: z.boolean(), canApprove: z.boolean(), canReject: z.boolean(), submitLabel: z.enum(['Submit for analysis','Resubmit for analysis']), reasons: z.array(z.string()) });

export const RequirementDetail = z.object({       // §23.2
  requirement: Requirement,
  businessObjective: z.string(),
  analysis: z.object({
    observedAt: IsoDateTime.nullable(), agent: z.string().nullable(), summary: z.string().nullable(),   // summary is AI-generated when present
    acceptanceCriteria: z.array(AnalysisItem).max(70),   // ≤ 20 human (positions 1..20, aiGenerated:false) + ≤ 50 AI (positions 1..50, aiGenerated:true)
    rules: z.array(AnalysisItem).max(50),
    openQuestions: z.array(AnalysisItem).max(20),
  }),
  decision: z.object({
    submittedBy: UserRef.nullable(), submittedAt: IsoDateTime.nullable(),
    approvedBy: UserRef.nullable(), approvedAt: IsoDateTime.nullable(),
    rejectedBy: UserRef.nullable(), rejectedAt: IsoDateTime.nullable(), rejectionReason: z.string().nullable(),
    externalFlaggedAt: IsoDateTime.nullable(),
  }),
  actions: RequirementActions,                    // computed for request.user by requirementActions()
  transitions: z.array(z.object({ from: RequirementState.nullable(), to: RequirementState, actorType: z.enum(['user','agent','system']), actorName: z.string(), reason: z.string().nullable(), occurredAt: IsoDateTime })).max(40),
  audit: z.array(AuditEventView).max(20),        // reuses the US2 view (AuditTable)
  generatedAt: IsoDateTime,
});

export const RequirementListQuery = z.object({    // §23.3
  project: z.union([z.literal('all'), Uuid]).default('all'),
  state: z.preprocess(splitCsv, z.array(RequirementState).max(8)).optional(),   // splitCsv: new helper in common.ts (T090) — 'READY,DRAFT' → ['READY','DRAFT']; non-strings pass through
  assignee: z.union([z.literal('me'), z.literal('unassigned'), Uuid]).optional(),
  cursor: z.string().max(200).optional(),
});
export const RequirementListPage = z.object({
  generatedAt: IsoDateTime, project: z.union([z.literal('all'), Uuid]),
  filters: z.object({ state: z.array(RequirementState), assignee: z.union([z.literal('me'), z.literal('unassigned'), Uuid]).nullable() }),
  items: z.array(Requirement).max(50), nextCursor: z.string().nullable(), total: z.number().int().min(0),
});

export const CreateRequirementRequest = z.object({   // §23.4 (R45)
  projectId: Uuid,
  title: z.string().trim().min(3).max(200),
  businessObjective: z.string().trim().min(10).max(4000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  assigneeUserId: Uuid.optional(),
});
export const RejectRequirementRequest = z.object({ reason: z.string().trim().min(1).max(500) });
export const RequirementIdParams = z.object({ id: Uuid });
```

Route table (all Problems `application/problem+json`; 401 without a session on every session route):

| Route | Auth / role | Body | 2xx | Problems |
|-------|-------------|------|-----|----------|
| `GET /requirements` | session; any role; `visibleProjects` | `RequirementListQuery` | 200 `RequirementListPage` | 400 `invalid-cursor`/query |
| `POST /requirements` | session; `canCreateRequirement`; `projectId` visible | `CreateRequirementRequest` | 201 `RequirementDetail` + `Location` | 403 `forbidden`, 404 (invisible project), 400 `validation` |
| `GET /requirements/{id}` | session; any role | — | 200 `RequirementDetail` | 404 |
| `POST /requirements/{id}/submit` | session; `canCreateRequirement` | — | 200 `RequirementDetail` | 403, 404, 409 `invalid-transition` |
| `POST /requirements/{id}/approve` | session; `canDecide` | — | 200 `RequirementDetail` | 403, 404, 409 `invalid-transition` (incl. exactly-once) |
| `POST /requirements/{id}/reject` | session; `canDecide` | `RejectRequirementRequest` | 200 `RequirementDetail` | 403, 404, 409, 400 |

## 24. Workflow list shapes (`packages/contracts/src/workflow-list.ts`, Zod) — research R38

```ts
export const WorkflowListQuery = z.object({
  project: z.union([z.literal('all'), Uuid]).default('all'),
  requirement: Uuid.optional(),
  state: z.preprocess(splitCsv, z.array(WorkflowState).max(9)).optional(),
  stage: z.coerce.number().int().min(1).max(7).optional(),
  cursor: z.string().max(200).optional(),
});
export const WorkflowListItem = z.object({          // FR-003 shape
  id: Uuid, externalId: ExternalId, title: z.string(), project: ProjectRef,
  state: WorkflowState, stateObservedAt: IsoDateTime,
  stage: z.object({ index: z.number().int(), count: z.number().int(), name: z.string().nullable() }).nullable(),
  agent: z.string().nullable(), pullRequestRef: z.string().nullable(),
  requirement: z.object({ id: Uuid, title: z.string(), href: z.string() }).nullable(),
  startedAt: IsoDateTime.nullable(), finishedAt: IsoDateTime.nullable(),
  href: z.string(),                                 // '/workflows/{id}'
});
export const WorkflowListPage = z.object({
  generatedAt: IsoDateTime, project: z.union([z.literal('all'), Uuid]),
  filters: z.object({ requirement: Uuid.nullable(), state: z.array(WorkflowState), stage: z.number().int().nullable() }),
  items: z.array(WorkflowListItem).max(50), nextCursor: z.string().nullable(), total: z.number().int().min(0),
});
```

| Route | Auth / role | 2xx | Problems |
|-------|-------------|-----|----------|
| `GET /workflows` | session; any role; `visibleProjects` (invisible `project`/`requirement` → empty page, `total: 0`) | 200 `WorkflowListPage` | 400 `invalid-cursor`/query |

Order `state_observed_at DESC, id DESC`; cursor b64url `['workflows', stateObservedAtIso, id]`; `WORKFLOWS_PAGE_SIZE = 50`.

## 25. Analysis ingest shapes (`packages/contracts/src/ingest.ts`, extended) — research R35

```ts
export const RequirementAnalysisIngest = z.object({
  agent: line(80), observedAt: IsoDateTime, summary: line(400).nullable().optional(),        // line(n) = the existing helper in common.ts
  acceptanceCriteria: z.array(line(1000)).max(50), rules: z.array(line(1000)).max(50), openQuestions: z.array(line(1000)).max(20),
});
export const RequirementIngestResult = z.object({ outcome: z.enum(['accepted','stale']), id: Uuid, state: RequirementState });
```

| Route | Auth | Body | 2xx | Problems |
|-------|------|------|-----|----------|
| `PUT /ingest/requirements/{externalId}/analysis` | bearer ingestion principal (`app.requirePrincipal`), scoped to the requirement's project | `RequirementAnalysisIngest` | 200 `RequirementIngestResult` (`accepted` → state `READY` or `NEEDS_CLARIFICATION`; `stale` → unchanged) | 401, 403 `forbidden` (principal not scoped), 404 (unknown `externalId`), 409 `invalid-transition` (state not `ANALYZING`/`NEEDS_CLARIFICATION`), 400 |

Every call appends an `ingestion_log` row (`route = 'PUT /ingest/requirements/{externalId}/analysis'`, outcome).

## 26. Jira webhook shapes (`packages/contracts/src/integrations.ts`, Zod) — research R36

```ts
export const JiraWebhookEvent = z.object({
  timestamp: z.number().int().optional(),
  webhookEvent: z.string().max(80),                 // 'jira:issue_created' | 'jira:issue_updated' | 'jira:issue_deleted' | other → ignored
  issue: z.object({
    id: z.string().max(40), key: z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/), self: z.string().url().optional(),
    fields: z.object({
      summary: z.string().max(2000),
      description: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional(),   // string or ADF document
      updated: z.string().optional(),               // Jira timestamp; parsed leniently
      project: z.object({ key: z.string().max(64) }),
      status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }).optional() }).optional(),
      assignee: z.object({ emailAddress: z.string().email().optional() }).nullable().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();
export const JiraWebhookResult = z.object({ outcome: z.enum(['created','updated','flagged','stale','ignored']), requirementId: Uuid.nullable() });
```

| Route | Auth | Body | 2xx | Problems |
|-------|------|------|-----|----------|
| `POST /integrations/jira/webhook` | `x-hub-signature: sha256=<hex HMAC-SHA256(JIRA_WEBHOOK_SECRET, raw body)>`, `timingSafeEqual`; no session | raw JSON ≤ 256 KB, validated as `JiraWebhookEvent` after verification | 202 `JiraWebhookResult` | 401 `unauthenticated` (missing/invalid signature or unconfigured secret), 413 (body limit), 400 `validation`, 429 (route limit 120/min/IP) |

## 27. Audit and transition vocabulary

`AUDIT_ACTIONS` (US2 `approval-center.ts`) gains `requirement.submitted`, `requirement.approved`, `requirement.rejected`, `requirement.flagged`, `requirement.workflow_created`; `target_type = 'requirement'`, `target_id = requirements.id`, `workflow_id` set for `approved`/`workflow_created`/`flagged`, `details` carries `{ externalId, fromState, toState, reason?, jiraKey?, flag? }` — never the body text of the requirement. **`risk_level IS NULL` for all five `requirement.*` actions** (the column is nullable in 0003; requirements carry no risk vocabulary — plan Part D Design System Compliance). Consequence: `apps/api/src/services/dashboard.ts` counts only `risk_level IN ('HIGH','CRITICAL')`, so no requirement action ever moves the Dashboard `risk.auditHighCritical` figure (asserted in T097 and T099). `AuditEventView` (US2) is reused unchanged (`riskLevel: null`).

## 28. Pure state-machine rules (`packages/contracts/src/requirement-rules.ts`, zod-free, subpath `@cdevi/contracts/requirement-rules`)

```ts
export const REQUIREMENT_STATES = ['DRAFT','ANALYZING','NEEDS_CLARIFICATION','READY','APPROVED','IN_IMPLEMENTATION','COMPLETED','REJECTED'] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];
export const REQUIREMENT_TRANSITIONS: Readonly<Record<'CREATE' | RequirementState, readonly RequirementState[]>> = {
  CREATE: ['DRAFT'],
  DRAFT: ['ANALYZING','REJECTED'],
  ANALYZING: ['READY','NEEDS_CLARIFICATION'],
  NEEDS_CLARIFICATION: ['ANALYZING','READY','NEEDS_CLARIFICATION','REJECTED'],
  READY: ['APPROVED','REJECTED'],
  APPROVED: ['IN_IMPLEMENTATION','COMPLETED'],
  IN_IMPLEMENTATION: ['COMPLETED'],
  COMPLETED: [], REJECTED: [],
};
export const canTransitionRequirement = (from: RequirementState | null, to: RequirementState) => REQUIREMENT_TRANSITIONS[from ?? 'CREATE'].includes(to);
export const isTerminalRequirement = (s: RequirementState) => s === 'COMPLETED' || s === 'REJECTED';
export const stateAfterAnalysis = (openQuestions: number): RequirementState => openQuestions === 0 ? 'READY' : 'NEEDS_CLARIFICATION';
export function requirementStateForWorkflow(current: RequirementState, workflow: WorkflowState): RequirementState | null;   // R33 table
export function requirementActions(state: RequirementState, role: Role): RequirementActions;   // (state, role) only — no flags; imports canCreateRequirement from './vocabulary' and canDecide from './decision-rules' (both zod-free); reasons[] explain disabled actions ("Only approvers and administrators can approve", "Analysis has not finished")
export const REQUIREMENTS_PAGE_SIZE = 50; export const WORKFLOWS_PAGE_SIZE = 50;
export function encodeRequirementCursor(keys: { createdAt: string; id: string }): string;  export function decodeRequirementCursor(cursor: string): { createdAt: string; id: string };  // b64url ['requirements', createdAt, id]; throws InvalidCursorError
export function encodeWorkflowCursor(keys: { stateObservedAt: string; id: string }): string; export function decodeWorkflowCursor(cursor: string): { stateObservedAt: string; id: string };
export const requirementHrefs = { requirement: (id: string) => `/requirements/${id}`, workflow: (id: string) => `/workflows/${id}`, list: (q: { project?: string; state?: RequirementState[]; assignee?: string }) => string };
export const isSafeExternalUrl = (url: string) => /^https:\/\//.test(url);
export type JiraMappedEvent = { kind: 'create' | 'update' | 'flag' | 'ignore'; key: string; projectKey: string; title: string; objective: string; url: (base: string) => string; updatedAt: string | null; flag: 'deleted' | 'closed' | null; assigneeEmail: string | null };
export function mapJiraEvent(event: JiraWebhookEventLike): JiraMappedEvent;   // R36 table; 'done' status category → flag 'closed'
export function adfToPlainText(doc: unknown, max = 4000): string;              // walks ADF `content[].text`, joins paragraphs with '\n', truncates
export const REQUIREMENT_STATE_WORDS: Readonly<Record<RequirementState, string>>;   // 'needs clarification' etc. — must equal the design-system Record `requirementStateToPill[state].word` (R41); asserted equal in apps/web (T110), the only package that depends on both @cdevi/contracts and @cdevi/design-system
```

Browser code imports only this subpath, `/vocabulary` and `/read-model`; `requirements.ts`, `workflow-list.ts`, `integrations.ts` (Zod) stay server-side.

## 29. Transactions

| Operation | Isolation | Steps |
|-----------|-----------|-------|
| `POST /requirements` | default | visibility + role check → `INSERT requirements` (`external_id = 'req-' || 12 hex`, retry once on unique violation) → `INSERT requirement_analysis_items` (human criteria, `ai_generated=false`, `source='user:<name>'`) → `requirement_transitions (NULL→DRAFT)` → detail |
| `…/submit` | default | `SELECT … FOR UPDATE` → `canTransitionRequirement(state,'ANALYZING')` else 409 → `UPDATE state, submitted_*` → transition row (user) → `audit_events requirement.submitted` → detail |
| `…/approve` | default | R37 steps 1–10 (lock → READY check → workflow + 7 stages + transitions → APPROVED → transition → 2 audit rows) |
| `…/reject` | default | lock → state ∈ DRAFT/NEEDS_CLARIFICATION/READY → `UPDATE state='REJECTED', rejected_*` → transition (reason) → `audit_events requirement.rejected` |
| analysis ingest | default | principal scope → lock → state check → `observedAt` watermark → `DELETE … WHERE requirement_id AND ai_generated` → `INSERT` AI items (positions 1..n per kind, `ai_generated = true`; human rows keep positions 1..20 in their own key space) → `UPDATE analysis_*, state` → transition (agent) → `ingestion_log` |
| Jira webhook | default | verify (outside tx) → mapping lookup (no lock) → tx with resolved organization: create/update → lock the requirement; **flag path**: read the requirement's `id` and linked `workflows.id` without locking, then lock **the workflow first** (`SELECT … FROM workflows … FOR UPDATE`), then the requirement (`FOR UPDATE`), `canTransition(state,'BLOCKED')` → `UPDATE workflows`, current stage → BLOCKED, `workflow_transitions (from_state, to_state = 'BLOCKED', observed_at = now, reason = 'Jira <key> <deleted|closed> — human decision required', principal_id = NULL, user_id = NULL)` — the table has no `source` column (0001 + 0002: `from_state, to_state, observed_at, recorded_at, reason, principal_id, stage_id, user_id`) and 0005 adds none; the NULL actor columns plus the `reason` text identify the system writer, `UPDATE requirements SET external_flag…`, `audit_events requirement.flagged` |
| reads (`GET /requirements`, `GET /requirements/{id}`, `GET /workflows`) | `REPEATABLE READ` | page + count (list); header + items + transitions (≤ 40) + audit (≤ 20) + linked workflow (detail) |

Every `audit_events` row written above has `risk_level = NULL` (§27).

**Lock order** (deadlock rule): any transaction that locks both a workflow and its requirement locks the **workflow first, then the requirement**. The R33 trigger runs inside a `workflows` UPDATE (stage ingest, US1 actions, US2 decisions) that already holds the workflow row lock and then locks the requirement; the webhook flag path follows the same order. `…/approve` locks only the requirement and *inserts* the workflow (no existing row to lock), so it cannot participate in a cycle.

## 30. Seed additions (research R44)

`packages/db/src/seed/requirements.ts` exports `buildRequirements(base)`, `EXPECTED_REQUIREMENTS`, `REQUIREMENT_SHOWCASE = { draft: 'req-seed-001', analyzing: 'req-seed-002', needsClarification: 'req-seed-003', ready: 'req-seed-004', approved: 'req-seed-005', inImplementation: 'req-seed-006', completed: 'req-seed-007', rejected: 'req-seed-008', jira: 'req-seed-003' }` and `JIRA_MAPPING`. `seed/index.ts` inserts, after `dashboard-demo` and **before** the final `TRUNCATE inbox_change_log RESTART IDENTITY` (so the `inbox_changed_requirements` rows the inserts produce are discarded and `select count(*) from inbox_change_log` stays 0 — seed.test.ts lines 185/220 unchanged): 1 mapping, 8 requirements (fixed `created_at = base − (9 − n) days`), 28 analysis items (26 AI), the `requirement_transitions` history per row (26 rows: 001 → 1, 002 → 2, 003 → 3, 004 → 3, 005 → 4, 006 → 5 (last row `actor_type = 'system'`, `actor_name = 'workflow'`), 007 → 6 (…→ IN_IMPLEMENTATION → COMPLETED, the last two `system`), 008 → 2 (DRAFT → REJECTED); `EXPECTED_REQUIREMENTS.transitions = 26`), and three `UPDATE workflows SET requirement_id` links (first `QUEUED` S-500 by `external_id` ← 005, `SHOWCASE_WAITING` ← 006, first `COMPLETED` S-500 by `external_id` ← 007). **No `audit_events` rows are seeded** — the seed records history in `requirement_transitions` only, exactly as the US2 seed records `workflow_transitions` and leaves `audit_events` empty; `seed.test.ts` `SC-006 seeding … leaves audit_events empty` (line 270) and the dashboard-demo `count(*) from audit_events = 0` (line 551) stay true as written. The seeded requirements therefore show an empty `audit` array on their detail (the transitions list carries the history); audit rows appear only from runtime actions. No other table changes; `EXPECTED_BUCKETS`, `EXPECTED_SHOWCASE`, `EXPECTED_DASHBOARD` untouched.

---

# Part E — User Story 5 (Agent Run Inspector): §31–§37

> Appended for `feature/US5`. §1–§30 above are unchanged. Source: the approved US5 plan (decisions confirmed 2026-09-15) and research R46–R55. Shapes below are the binding ones for the contracts and database work; the only addition beyond the source plan is the `columnCounts` test edit in §31 Notes (a consequence of `agent_runs.steps`).

## 31. Migration `0006_agent_decisions.sql` (research R46, R48, R53)

As landed on `feature/US5-contracts-db` (PR #6) — `packages/db/migrations/0006_agent_decisions.sql` is the source of truth; this section mirrors it. The API session adds one more column to the same migration, `agent_runs.decisions_observed_at` (the decisions watermark — §36), shown below.

```sql
-- specs/001 US5 (data-model §31–§37): agent_runs.steps (structured progress, AS-3) and the agent_decisions table
-- (FR-017, FR-018). Decisions are delivered whole by the runtime (PUT /api/ingest/agent-runs/{externalId}/decisions →
-- DELETE + batch INSERT); the read model is GET /api/agent-runs/{id}. RLS and grants follow 0001–0005: policies are
-- written here, ENABLE/DISABLE is owned by the CDEVI_RLS loop in migrate.ts (RLS_TABLES gains agent_decisions).

-- vocabulary
CREATE TYPE confidence_level AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE policy_outcome AS ENUM ('ALLOWED', 'APPROVAL_REQUIRED', 'DENIED');

-- structured progress on the run (R48): ≤ 20 { label ≤ 120, status: completed|running|pending|failed }, runtime-provided.
ALTER TABLE agent_runs
  ADD COLUMN steps jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT agent_runs_steps_check CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 20);

-- decisions watermark (§36): observedAt of the last ACCEPTED decisions snapshot; NULL until the first one.
-- Dedicated column (not derived from ingestion_log) so the stale check reads the locked run row itself.
ALTER TABLE agent_runs ADD COLUMN decisions_observed_at timestamptz;

-- one row per reported decision (R46); `reason` is a bounded summary, never chain-of-thought (FR-018).
-- risk_level is optional until US8 makes it mandatory. evidence is ≤ 20 typed refs validated by the contract.
CREATE TABLE agent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  decided_at timestamptz NOT NULL,
  action text NOT NULL CHECK (char_length(action) <= 200),
  reason text NOT NULL CHECK (char_length(reason) <= 600),
  confidence confidence_level NOT NULL,
  policy_outcome policy_outcome NOT NULL,
  policy_ref text CHECK (char_length(policy_ref) <= 120),
  risk_level risk_level,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_decisions_run_position_key UNIQUE (agent_run_id, position)
);
CREATE INDEX agent_decisions_run_idx ON agent_decisions (agent_run_id, position);

-- live updates (R53, FR-004/FR-034). Replace-whole ingestion inserts up to 50 rows in one statement, so the
-- trigger is statement-level over the transition table: one inbox_change_log row and one NOTIFY per
-- (organization, project, workflow) touched — never one frame per decision. The payload shape is the one
-- notify_inbox_changed() emits, so the SSE fan-out and the client filter by workflowId are unchanged.
CREATE FUNCTION notify_agent_decision_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v_seq bigint;
BEGIN
  FOR r IN SELECT DISTINCT organization_id, project_id, workflow_id FROM inserted LOOP
    INSERT INTO inbox_change_log (organization_id, project_id, workflow_id)
      VALUES (r.organization_id, r.project_id, r.workflow_id) RETURNING seq INTO v_seq;
    PERFORM pg_notify('inbox_changed', json_build_object('seq', v_seq, 'organizationId', r.organization_id,
      'projectId', r.project_id, 'workflowId', r.workflow_id)::text);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER inbox_changed_agent_decisions AFTER INSERT ON agent_decisions
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_agent_decision_changed();

-- RLS policy (same shape as 0001–0005; not enabled here) and grants: replace-whole ingestion needs
-- SELECT, INSERT and DELETE; decisions are never edited in place (no UPDATE).
CREATE POLICY agent_decisions_org_isolation ON agent_decisions
  USING (organization_id = current_setting('app.organization_id', true)::uuid);
GRANT SELECT, INSERT, DELETE ON agent_decisions TO app_user;
```

**Trigger.** Exactly one trigger, `inbox_changed_agent_decisions`: statement-level, `AFTER INSERT` only, over the `REFERENCING NEW TABLE AS inserted` transition table. A replace of ≤ 50 decisions therefore produces **one** `inbox_change_log` row (carrying the run's `workflow_id`, `requirement_id` NULL) and **one** `inbox_changed` NOTIFY per distinct `(organization_id, project_id, workflow_id)` in the statement. The preceding `DELETE` of the old set does **not** notify — the re-INSERT does. Consequence for the API layer (§36): a replace-whole with an **empty** `decisions` array inserts nothing and fires no trigger, so `replaceAgentDecisions` must write the `inbox_change_log` row (and its NOTIFY via the existing `notify_inbox_changed()` path or an explicit `INSERT … RETURNING seq` + `pg_notify`) itself in that case so the open run screen drops its last decisions without reload.

`agent_decisions.evidence[]` element shape (validated by the contract, §32 `EvidenceRef`; the `CHECK` only bounds the array): `{ kind: 'file'|'ticket'|'artifact'|'url'|'pullRequest', label ≤ 200, href?: DecisionLink, locator? ≤ 200, accessible: boolean }`.

`agent_runs.steps[]` element shape (contract §32 `RunStep`): `{ label ≤ 120, status: 'completed'|'running'|'pending'|'failed' }`. Constraint name `agent_runs_steps_check`; unique constraint name `agent_decisions_run_position_key`.

`agent_runs.decisions_observed_at timestamptz NULL` is written only by the decisions ingest (§36) — never by the run upsert, the seed (stays NULL; the seeded decisions are inserted directly) or the browser — and is not part of `AgentRunDetail`.

**Existing tests that 0006 changes** (as landed in PR #6 `packages/db/tests/schema.test.ts`; same pattern as §22 for 0005): (i) the `inbox_changed_%` trigger list asserted with `toEqual` gains `'inbox_changed_agent_decisions'` (sorted before `inbox_changed_agent_runs`); (ii) `SC-007 0004 adds no tables …` — the `pg_tables` expectation becomes `[...TABLES_AFTER_0003, ...TABLES_ADDED_BY_0005, ...TABLES_ADDED_BY_0006].sort()` with `TABLES_ADDED_BY_0006 = ['agent_decisions']`; (iii) the same test's `columnCounts` map pins `agent_runs: 15`, which `steps` and `decisions_observed_at` make **17**. These three edits are the only changes to existing assertions; the new `describe('migration 0006_agent_decisions …')` block covers enums, `agent_runs.steps` CHECK, `agent_runs.decisions_observed_at` (`timestamptz`, nullable, no default), the 16 columns/nullability/enum types/unique/index, CHECK bounds and duplicate-position rejection, cascade + replace-whole, RLS policy + exact grants (`DELETE, INSERT, SELECT`; `UPDATE` is `permission denied`), and the statement-level trigger (one log row per 50-row batch, DELETE alone does not notify, exactly one NOTIFY frame per committed batch).

Mirrored in `packages/db/src/schema.ts`: `confidenceLevel`, `policyOutcome` pg enums; `agentRuns.steps` (`jsonb().notNull().default([])`); `agentRuns.decisionsObservedAt` (`timestamp({ withTimezone: true })`, nullable); `agentDecisions` table with every column above, `agent_decisions_run_position_key` and `agent_decisions_run_idx`. `packages/db/src/migrate.ts` `RLS_TABLES` gains `agent_decisions`. Rollback: drop the trigger and `notify_agent_decision_changed()`, the policy, the table, `agent_runs.steps`, `agent_runs.decisions_observed_at`, the two enums.

## 32. Agent run shapes (`packages/contracts/src/agent-runs.ts`, Zod; `ingest.ts` and `workflow-detail.ts` extended) — research R46–R50, R52

```ts
// agent-runs.ts
export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const ConfidenceLevel = z.enum(CONFIDENCE_LEVELS);
export const POLICY_OUTCOMES = ['ALLOWED', 'APPROVAL_REQUIRED', 'DENIED'] as const;
export const PolicyOutcome = z.enum(POLICY_OUTCOMES);
export const EVIDENCE_KINDS = ['file', 'ticket', 'artifact', 'url', 'pullRequest'] as const;
export const EvidenceKind = z.enum(EVIDENCE_KINDS);
export const RUN_STEP_STATUSES = ['completed', 'running', 'pending', 'failed'] as const;
export const RunStepStatus = z.enum(RUN_STEP_STATUSES);

export const EvidenceRef = z.object({
  kind: EvidenceKind,
  label: line(200),
  href: DecisionLink.optional(),          // decisions.ts (US2): http(s) URL or app-relative path, ≤ 500
  locator: line(200).optional(),          // e.g. "src/auth/limiter.ts:42", "PAY-1207", "s500-001-diff"
  accessible: z.boolean(),                // runtime's statement; false or no href → "access restricted" (R49)
}).strict();

export const RunStep = z.object({ label: line(120), status: RunStepStatus }).strict();

export const AgentDecision = z.object({
  id: Uuid,
  position: z.number().int().min(1).max(50),
  decidedAt: IsoDateTime,
  action: line(200),
  reason: line(600),                      // the agent's stated justification — a claim (DR-03); the ONLY prose field
  confidence: ConfidenceLevel,
  policyOutcome: PolicyOutcome,
  policyRef: line(120).nullable(),
  riskLevel: RiskLevel.nullable(),        // OPTIONAL in US5 (R46)
  evidence: z.array(EvidenceRef).max(20),
});                                        // no reasoning / chainOfThought field exists (FR-018, R50)

export const AgentRunDetail = z.object({
  id: Uuid,
  externalId: ExternalId,
  agent: line(80),
  model: line(80).nullable(),
  state: WorkflowState.exclude(['QUEUED']),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  durationMs: z.number().int().min(0),   // runDuration(startedAt, finishedAt, now) computed by the API at read time
  summary: line(400).nullable(),         // agent claim (Message variant="summary")
  workflow: z.object({ id: Uuid, externalId: ExternalId, title: line(200) }),
  stage: z.object({ position: z.number().int().min(1).max(20), name: line(60) }),
  steps: z.array(RunStep).max(20),
  timeline: z.array(AgentRunEvent).max(50),   // workflow-detail.ts (US1), ordered by `at` ascending
  decisions: z.array(AgentDecision).max(50),  // ordered by position ascending
});
export const AgentRunIdParams = z.object({ id: Uuid });

// ingest.ts EXTENDED
export const AgentRunUpsert = z.object({ …existing fields…, steps: z.array(RunStep).max(20).default([]) });  // R48
export const AgentDecisionIngest = z.object({
  position: z.number().int().min(1).max(50),
  decidedAt: IsoDateTime,
  action: line(200),
  reason: line(600),
  confidence: ConfidenceLevel,
  policyOutcome: PolicyOutcome,
  policyRef: line(120).nullable().optional(),
  riskLevel: RiskLevel.nullable().optional(),
  evidence: z.array(EvidenceRef).max(20).default([]),
}).strict();                                                    // unknown keys (chainOfThought, reasoning, …) → 400 (R50)
export const AgentDecisionsIngest = z.object({
  observedAt: IsoDateTime,                                      // watermark (§36)
  decisions: z.array(AgentDecisionIngest).max(50),              // positions must be unique → 400 otherwise
}).strict();
export const AgentDecisionsIngestResult = z.object({ result: z.enum(['accepted', 'stale']), count: z.number().int().min(0).max(50) });

// workflow-detail.ts EXTENDED (additive — every existing field unchanged)
export const StageAgentRun = z.object({ id: Uuid, agent: line(80), state: WorkflowState.exclude(['QUEUED']), stagePosition: z.number().int().min(1).max(20) });
export const WorkflowStageView = z.object({ …existing fields…, agentRuns: z.array(StageAgentRun).max(20).default([]) });  // the source plan's "StageDetail.agentRuns"
```

Rules: `line(n)` is the existing trimmed non-empty helper in `common.ts`; `Uuid`, `IsoDateTime`, `ExternalId`, `RiskLevel`, `WorkflowState`, `AgentRunEvent`, `DecisionLink` are the existing schemas. `AgentRunDetail` is the OpenAPI component `AgentRunDetail`; `AgentDecisionsIngest` and `AgentDecisionsIngestResult` are registered as components; all exported from `src/index.ts`. No schema in this section has a field for private reasoning, and `.strict()` on the two ingest objects rejects any attempt to add one at the boundary; `AgentRunDetail` is not `.strict()` (a read model — the API constructs it) but has no such field either.

## 33. Routes (research R47, R52, R55)

| Route | Auth | Request | Response | Problems |
|-------|------|---------|----------|----------|
| `GET /agent-runs/{id}` | session (`requireUser`), `visibleProjects` | `AgentRunIdParams` | 200 `AgentRunDetail`; `Server-Timing: db;dur=…`, `Cache-Control: no-store` | 400 `validation-failed` (non-uuid id); 401 `unauthenticated`; **404 `not-found`** when the run does not exist **or** belongs to a project the user cannot see (existence is not leaked — no 403 on this route) |
| `PUT /ingest/agent-runs/{externalId}/decisions` | ingestion principal (`requirePrincipal`) | `AgentDecisionsIngest` (`.strict()`) | 200 `AgentDecisionsIngestResult` `{ result: 'accepted' \| 'stale', count }` | 400 `validation-failed` (schema, > 50 decisions, > 20 evidence refs, duplicate `position`, **any unknown key** — `errors[].pointer` names the key; the request body is never echoed); 401 `unauthenticated`; 403 `forbidden` (principal's project ≠ run's project); 404 `not-found` (unknown `externalId` in the principal's organization); 409 `stale-terminal-run` (run `COMPLETED`/`CANCELLED`/`FAILED` **and** `observedAt` older than the watermark — §36) |
| `PUT /ingest/agent-runs/{externalId}` (EXTENDED) | ingestion principal | `AgentRunUpsert` + optional `steps` ≤ 20 | unchanged | unchanged (+ 400 when `steps` exceeds bounds) |
| `GET /workflows/{id}` (EXTENDED, additive) | unchanged | unchanged | `stages[].agentRuns: StageAgentRun[]` ≤ 20 per stage, ordered by `started_at` descending | unchanged |

All Problems are `application/problem+json` with `type`, `title`, `status`, `detail`, `instance` and never carry SQL, stack traces, credentials or the request body. Every route is registered with its Zod schema through `fastify-type-provider-zod`; the OpenAPI fragment (`contracts/openapi.yaml`) is regenerated from `src/openapi.ts` with tag `agent-runs` and title "… (specs/001 US1–US5)".

## 34. Pure rules (`packages/contracts/src/agent-run-model.ts`, zod-free, subpath `@cdevi/contracts/agent-run-model`) — research R48, R49, R51, R54

```ts
export const STALE_AFTER_MS = 30 * 60 * 1000;

/** finished − started, or now − started while unfinished; never negative. */
export function runDuration(startedAt: string, finishedAt: string | null, now: Date): number;

/** 'stale' when state ∈ {RUNNING, RETRYING} and (last timeline `at` ?? startedAt) is > STALE_AFTER_MS before now; else 'active'. */
export function runFreshness(run: Pick<AgentRunDetail, 'state' | 'startedAt' | 'timeline'>, now: Date): 'active' | 'stale';

/** Counts per status; every key present (0 when absent). */
export function stepsSummary(steps: readonly RunStep[]): { completed: number; running: number; pending: number; failed: number };

/** ref.href when accessible === true and href is present; otherwise null (render "access restricted", never <a>). */
export function evidenceHref(ref: EvidenceRef): string | null;

export const POLICY_OUTCOME_WORDS: Record<PolicyOutcome, string> = { ALLOWED: 'allowed', APPROVAL_REQUIRED: 'approval required', DENIED: 'denied' };
export const CONFIDENCE_WORDS: Record<ConfidenceLevel, string> = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
export const EVIDENCE_KIND_WORDS: Record<EvidenceKind, string> = { file: 'file', ticket: 'ticket', artifact: 'artifact', url: 'link', pullRequest: 'pull request' };

export function agentRunHref(id: string): string;        // `/agents/runs/${id}`
export function decisionAnchor(position: number): string; // `#decision-${position}`
```

Rules: the file imports only `type`s from `./agent-runs` (no zod at runtime — the `check:size` budget for the route depends on it); `runFreshness` is the **only** source of the stale indicator (the API does not compute it — R54); `runDuration` is used by the API for `durationMs` and by the web for the 1 s ticker while `finishedAt` is null; the word tables are the **only** source of the confidence/policy/kind words shown in `Pill`s (DR-01 — never typed in TSX). Presentation mapping (web, not in this module): `ALLOWED → Pill variant="done"`, `APPROVAL_REQUIRED → "wait"`, `DENIED → "fail"`; confidence → `"neutral"`; step `completed → Step state="done"`, `running → "current"`, `pending → "todo"`, `failed → "todo"` + `Pill variant="fail"` "failed".

## 35. Transactions and read-model rules (research R52)

| Operation | Isolation | Steps |
|-----------|-----------|-------|
| `GET /agent-runs/{id}` | `REPEATABLE READ` (read only) | (1) run + workflow + stage in one join, filtered by `organization_id` and `project_id IN visibleProjects` (0 rows → 404); (2) `SELECT … FROM agent_decisions WHERE agent_run_id = $1 ORDER BY position` (uses `agent_decisions_run_idx`); (3) *optional* nothing — **≤ 3 statements**, enforced by a test that counts statements through the `pg` client wrapper (`SC-007`) |
| `GET /workflows/{id}` (extended) | unchanged (`REPEATABLE READ`) | + one statement bounded in SQL, not in code: `SELECT id, agent, state, stage_id FROM (SELECT id, agent, state, stage_id, row_number() OVER (PARTITION BY stage_id ORDER BY started_at DESC, id DESC) AS rn FROM agent_runs WHERE workflow_id = $1) r WHERE rn <= 20 ORDER BY stage_id, rn` (≤ 20 × stages rows leave the database whatever the run history; uses `agent_runs_workflow_idx`), grouped per stage in code |

Bounds enforced at the read boundary (the API truncates nothing — the writes are bounded, so the reads never exceed): `timeline ≤ 50`, `steps ≤ 20`, `decisions ≤ 50`, `evidence ≤ 20` per decision, `agentRuns ≤ 20` per stage. `durationMs = runDuration(startedAt, finishedAt, app.clock.now())` (the fixed clock in tests). The response carries `Server-Timing: db;dur=<ms>` for the whole transaction, asserted ≤ 150 ms p95 over 20 calls at the SC-007 fixture (one run with 50 timeline × 240 chars, 20 steps, 50 decisions × 20 evidence refs) and `content-length ≤ 1 MB` there (the schema maximum — 50 × (600 + 200 + 120 + 20 × (200 + 200 + 500)) chars of bounded strings ≈ 1 MB — so the ceiling is asserted at the real maximum, not below it). The **48 KB payload budget** of plan §9 is asserted at the *realistic* fixture (50 timeline × 240 chars, 20 steps, 50 decisions with 240-char reasons and 2 evidence refs each), which is the shape the seed and the runtime produce; both fixtures are built by the same helper in `agent-runs.test.ts`. Reads write nothing: no `audit_events`, no `workflow_transitions`, no `ingestion_log` (R55).

## 36. Ingestion rules — `PUT /ingest/agent-runs/{externalId}/decisions` (research R47, R50)

One transaction (default isolation), in order:

1. **Principal scope**: resolve the run by `(organization_id = principal.organization_id, external_id)` → 404 when absent; the principal's project scope must include the run's `project_id` → 403 otherwise (`ingestion_log outcome='forbidden'`, as existing routes do).
2. **Lock**: `SELECT id, state, project_id, workflow_id, stage_id, decisions_observed_at FROM agent_runs WHERE id = $1 FOR UPDATE` — the run **row** is locked (not the workflow, as the run upsert does), so two snapshots for one run serialise and the compare-and-write below is atomic.
3. **Watermark**: the watermark is the locked row's `agent_runs.decisions_observed_at` (§31; `NULL` before the first accepted snapshot → always accepted). `observedAt ≤ decisions_observed_at` → if the run's `state ∈ {COMPLETED, CANCELLED, FAILED}` → **409 `stale-terminal-run`** (a late snapshot for a finished run is an integration fault worth surfacing); otherwise **200 `{ result: 'stale', count: <existing count> }`** with an `ingestion_log outcome='stale'` row and no change.
4. **Replace whole**: `DELETE FROM agent_decisions WHERE agent_run_id = $1`; one batch `INSERT … VALUES (…) × n` with `organization_id, project_id, workflow_id, stage_id` copied from the locked run and `position, decided_at, action, reason, confidence, policy_outcome, policy_ref, risk_level, evidence` from the payload (`evidence` stored exactly as validated — `EvidenceRef` is `.strict()`, so nothing unvalidated reaches the row). In the same transaction `UPDATE agent_runs SET decisions_observed_at = $observedAt WHERE id = $1` (the watermark moves only on an accepted snapshot; a `stale` result writes nothing but its `ingestion_log` row). The statement-level `AFTER INSERT` trigger (§31) writes one `inbox_change_log` row with the run's `workflow_id` and one `pg_notify` for the batch. **Empty set** (`decisions: []`): the `INSERT` is skipped, nothing fires, so the service itself inserts the `inbox_change_log (organization_id, project_id, workflow_id)` row for the run's workflow (same payload shape) inside the transaction, so the screen learns the decisions were cleared.
5. **Log**: `ingestion_log (principal_id, route, target_external_id, outcome='accepted', detail='observedAt=<ISO> count=<n>')` — an audit record only; the watermark is the column, not this row.
6. **Respond**: `200 { result: 'accepted', count: n }`.

Validation happens before step 1 (Fastify + Zod): schema errors, `decisions.length > 50`, any `evidence.length > 20`, duplicate `position`, `label`/`reason`/`action` bounds and **any unknown key at either level** → 400 `validation-failed` with `errors[] = { pointer, message }` and **no echo of the offending value or body** (`message` for an unknown key is "Unrecognized key" — the key name appears in `pointer`, the value never). An empty `decisions: []` is a valid snapshot (the run made no decisions yet) and clears the set. `PUT /ingest/agent-runs/{externalId}` (existing) gains `steps` with its existing semantics unchanged — the run upsert has **no** observation watermark today (`upsertAgentRun` locks the workflow and writes last-write-wins, as US1 specified for `state` and `timeline`), so an out-of-order run snapshot can regress `steps` exactly as it can already regress `timeline`; a run-level watermark is out of US5 scope (flagged for the runtime integration work), and the decisions route (above) is the only watermarked one; a run upsert that omits `steps` keeps the stored value? **No** — `steps` defaults to `[]` in the schema, and the upsert writes the payload as the snapshot (replace-whole, like `timeline`), so a runtime that reports steps must send them on every upsert (documented in AGENTS.md by T151). Budget: ≤ 200 ms p95 for 50 decisions × 20 evidence refs, asserted in `ingest-decisions.test.ts`.

## 37. Seed additions (research R55) — `packages/db/src/seed/agent-runs.ts` (NEW), `seed/index.ts` (EXTENDED)

No new workflows, stages, runs, artifacts, test runs, approvals, clarifications or requirements: `EXPECTED_SHOWCASE` (2/14/13/10/5), `EXPECTED_DASHBOARD` (24 workflows, 18 active, 4 approvals, 2 clarifications, 43 stages, 44 runs, 6 test runs) and every US2/US4 `EXPECTED_*` figure are unchanged and re-asserted.

| Target run | Change |
|------------|--------|
| `s500-d05-r1` — the Dashboard showcase **RUNNING** run (`dashboard-demo`, stage 2 "Analysis"; the only seeded RUNNING runs are `s500-d05…d08-r1` and `s500-d11-r1`) | `steps` (6): "Read requirement and linked tickets" `completed`, "Map affected services" `completed`, "Draft impact analysis" `completed`, "Cross-check with policy catalogue" `running`, "Write acceptance criteria" `pending`, "Publish analysis artifact" `pending`. **3 decisions**: (1) `ALLOWED`, `HIGH`, action "Read the payments service repository", reason "Impact analysis needs the current limiter implementation", evidence `file` `src/payments/limiter.ts` (accessible, `href` to the repository file URL) + `ticket` (accessible, `https://jira.acme.example/browse/…`); (2) `APPROVAL_REQUIRED`, `MEDIUM`, `riskLevel: 'MEDIUM'`, action "Plan a schema change to `payment_attempts`", reason "Adds a nullable column; migration requires an owner's approval under the data-change policy", `policyRef: 'data-change/schema'`, evidence `artifact` (accessible, `href` = `/workflows/{workflow.id}#artifact-…` resolved at seed time) + `url` (design doc, accessible); (3) `DENIED`, `HIGH`, action "Fetch production customer records for realistic fixtures", reason "Production PII is not permitted in fixtures; synthetic data will be used instead", `policyRef: 'data-access/pii'`, evidence `url` with `accessible: false` (label "Production data warehouse query", no `href`) — the **restricted** evidence |
| `s500-001-r8` — **COMPLETED** run on `s500-001` (`payments-api`, stage 6 "Review", summary "Prepared the code diff and PR description.") | **2 decisions**: (1) `ALLOWED`, `HIGH`, action "Generate the diff and PR description from the reviewed changes", reason "All stage-5 test suites passed after the retry", evidence `artifact` (`s500-001-diff`, accessible, app-relative href to the Workflow Detail artifact) + `pullRequest` (accessible, `https://git.cdevi.demo/payments-api/pull/512`); (2) `APPROVAL_REQUIRED`, `MEDIUM`, action "Open the pull request", reason "Opening a PR into main requires human approval for this repository", `policyRef: 'delivery/pr-open'`, evidence `ticket` (accessible) |
| `s500-clr-01` (clarification showcase, US2) | `links.agentRun` set to `agentRunHref(<uuid of s500-d05-r1>)` by an `UPDATE clarifications SET links = links \|\| jsonb_build_object('agentRun', $1)` after runs are inserted (uuids are generated at insert). **Note for the parent session**: the clarification's own workflow has no seeded run and adding one is forbidden by the "no new runs" rule, so the link deliberately targets the RUNNING showcase run of another workflow — a demo cross-link. If a same-workflow link is preferred, the alternative is one new run on the clarification's workflow, which changes `EXPECTED_SHOWCASE.runs`/`agent_runs` count assertions (not done in US5) |

`EXPECTED_AGENT_DECISIONS = { total: 5, runsWithDecisions: 2, approvalRequired: 2, denied: 1, restrictedEvidence: 1, withRiskLevel: 1 }` exported from `seed/agent-runs.ts` and asserted in `packages/db/tests/seed.test.ts` (`FR-017 seed decisions …`). `seed/index.ts`: `TRUNCATE` list gains `agent_decisions` (before `agent_runs`, or rely on CASCADE); the `agent_runs` INSERT carries `steps` (`'[]'` for every run but `s500-d05-r1`); `agent_decisions` are inserted after runs with `agent_run_id`, `workflow_id`, `stage_id`, `project_id`, `organization_id` resolved from the inserted run. Every seeded `decidedAt` lies between the run's `startedAt` and `finishedAt ?? base` and every timeline stays ≤ 50.

# Part F — User Story 6 (PR Review Center & fix loop): §38–§44

> Appended for `feature/US6`. §1–§37 above are unchanged. Source: the approved US6 plan (Q1–Q6 decided 2026-09-15 — plan.md Part F) and research R56–R65. Shapes below are the binding ones for the contracts, database, API and web work; `packages/db/migrations/0007_reviews.sql` becomes the source of truth once it lands and this section mirrors it.

## 38. Vocabulary — enums (research R58, R60)

| Enum | Values | Words (`@cdevi/contracts/review-model`) | Pill |
|------|--------|------------------------------------------|------|
| `review_lane` | `correctness`, `security`, `dependencies`, `edge_cases`, `testing`, `architecture`, `general` — **this order is the display order** (`REVIEW_LANES`) | `LANE_WORDS`: correctness · security · dependencies · edge cases · testing · architecture · general | `Pill variant="neutral"` on a finding; the lane row itself is a `GateCheck` |
| `lane_status` | `PASS`, `WARN`, `FAIL` | pass · warn · fail | `GateCheck state`: `ok` · `warn` · `fail` (`pending` = "not yet reviewed" before the first review) |
| `review_status` | `RUNNING`, `COMPLETE`, `FAILED` | `REVIEW_STATUS_WORDS`: review running · ai review complete · review failed | `run` · `done` · `fail` |
| `finding_severity` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` | `SEVERITY_WORDS`: lower-case | design system `severityToPill`: `blocked` · `fail` · `wait` · `neutral` · `neutral` |
| `finding_blocking` | `BLOCKING`, `NON_BLOCKING`, `SUGGESTION` | `BLOCKING_WORDS`: blocking · non-blocking · suggestion; `blockingToDesignSystem`: `NON_BLOCKING → 'NON-BLOCKING'` (the design system's `FindingBlocking` spelling) | design system `blockingToPill`: `needs-you` · `neutral` · `neutral` |
| `finding_state` | `OPEN`, `FIX_REQUESTED`, `FIXED`, `DISMISSED`, `ISSUE_REQUESTED` | `FINDING_STATE_WORDS`: open · fix requested · fixed · dismissed · issue requested | `wait` · `run` · `done` · `neutral` · `neutral` |
| `review_cycle_state` | `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` (the `workflow_state` subset a cycle can be in) | `CYCLE_STATE_WORDS`: running · completed · failed · cancelled | `run` · `done` · `fail` · `neutral` |
| `pull_request_status` | `OPEN`, `MERGED`, `CLOSED` | open · merged · closed | `neutral` · `done` · `neutral` |

Audit vocabulary (`AUDIT_ACTIONS`, `@cdevi/contracts/approval-center`, EXTENDED — §27 list gains): `finding.dismissed`, `finding.fix_requested`, `finding.issue_requested` (`target_type = 'review_finding'`).

## 39. Migration `0007_reviews.sql` (research R57, R58, R62, R64)

```sql
-- specs/001 US6 (data-model §38–§44): pull requests, AI reviews with seven lanes, individual findings and review
-- cycles (FR-020, FR-021, FR-022). Reviews and cycle progress are delivered by the runtime (PUT /api/ingest/pull-requests/…);
-- humans act on findings through POST /api/reviews/{prId}/findings/{findingId}/{dismiss,fix,issue}. ready_for_merge is
-- derived in the read model (research R60) and deliberately has no column. RLS and grants follow 0001–0006: policies are
-- written here, ENABLE/DISABLE is owned by the CDEVI_RLS loop in migrate.ts (RLS_TABLES gains the four tables).

-- vocabulary (§38)
CREATE TYPE review_lane AS ENUM ('correctness','security','dependencies','edge_cases','testing','architecture','general');
CREATE TYPE lane_status AS ENUM ('PASS','WARN','FAIL');
CREATE TYPE review_status AS ENUM ('RUNNING','COMPLETE','FAILED');
CREATE TYPE finding_severity AS ENUM ('CRITICAL','HIGH','MEDIUM','LOW','INFO');
CREATE TYPE finding_blocking AS ENUM ('BLOCKING','NON_BLOCKING','SUGGESTION');
CREATE TYPE finding_state AS ENUM ('OPEN','FIX_REQUESTED','FIXED','DISMISSED','ISSUE_REQUESTED');
CREATE TYPE review_cycle_state AS ENUM ('RUNNING','COMPLETED','FAILED','CANCELLED');
CREATE TYPE pull_request_status AS ENUM ('OPEN','MERGED','CLOSED');

-- one pull request per workflow in the MVP (R63); requirement and Review-stage links are nullable (R57)
CREATE TABLE pull_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES requirements(id) ON DELETE SET NULL,
  review_stage_id uuid REFERENCES workflow_stages(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  title text NOT NULL CHECK (char_length(title) <= 200),
  href text NOT NULL CHECK (char_length(href) <= 400),
  status pull_request_status NOT NULL DEFAULT 'OPEN',
  observed_at timestamptz NOT NULL,                       -- PR upsert watermark (§43)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pull_requests_org_external_key UNIQUE (organization_id, external_id),
  CONSTRAINT pull_requests_workflow_key UNIQUE (workflow_id)
);
CREATE INDEX pull_requests_org_updated_idx ON pull_requests (organization_id, updated_at DESC, id DESC);   -- keyset list (R63)
CREATE INDEX pull_requests_project_idx ON pull_requests (project_id, updated_at DESC);

-- one review per PR and cycle number; the latest cycle_number is the one the Review Center shows (R58)
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  cycle_number smallint NOT NULL CHECK (cycle_number BETWEEN 1 AND 100),
  status review_status NOT NULL,
  lanes jsonb NOT NULL CHECK (jsonb_typeof(lanes) = 'array' AND jsonb_array_length(lanes) = 7),  -- 7 × { lane, status, summary ≤ 240 }
  observed_at timestamptz NOT NULL,                       -- review snapshot watermark (§43)
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_pr_cycle_key UNIQUE (pull_request_id, cycle_number)
);
CREATE INDEX reviews_pr_cycle_idx ON reviews (pull_request_id, cycle_number DESC);

-- individual findings: ≤ 50 per review, stable external_id across snapshots, five-state machine (§41)
CREATE TABLE review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  lane review_lane NOT NULL,
  severity finding_severity NOT NULL,
  blocking finding_blocking NOT NULL,
  title text NOT NULL CHECK (char_length(title) <= 200),
  description text NOT NULL CHECK (char_length(description) <= 600),
  impact text CHECK (char_length(impact) <= 400),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 20),  -- EvidenceRef[] (R62)
  recommended_fix text CHECK (char_length(recommended_fix) <= 400),
  state finding_state NOT NULL DEFAULT 'OPEN',
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  dismissed_reason text CHECK (char_length(dismissed_reason) <= 240),
  dismissed_by text CHECK (char_length(dismissed_by) <= 120),
  dismissed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at timestamptz,
  fix_cycle_id uuid REFERENCES review_cycles(id) ON DELETE SET NULL,   -- forward reference: created after review_cycles below (ALTER … ADD CONSTRAINT) or order the DDL accordingly
  fix_requested_by text CHECK (char_length(fix_requested_by) <= 120),
  fix_requested_at timestamptz,
  issue_requested_by text CHECK (char_length(issue_requested_by) <= 120),
  issue_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_findings_review_external_key UNIQUE (review_id, external_id),
  CONSTRAINT review_findings_review_position_key UNIQUE (review_id, position),
  CONSTRAINT review_findings_dismissed_check CHECK (state <> 'DISMISSED' OR (dismissed_reason IS NOT NULL AND dismissed_at IS NOT NULL))
);
CREATE INDEX review_findings_review_idx ON review_findings (review_id, position);
CREATE INDEX review_findings_blocking_open_idx ON review_findings (review_id) WHERE blocking = 'BLOCKING' AND state IN ('OPEN','FIX_REQUESTED');  -- FR-022 count (R60)

-- review cycles: the fix loop's history, reported by the runtime, created by Apply Fix (R56)
CREATE TABLE review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  cycle_number smallint NOT NULL CHECK (cycle_number BETWEEN 1 AND 100),
  findings_count smallint NOT NULL CHECK (findings_count BETWEEN 0 AND 50),
  fixed_count smallint NOT NULL CHECK (fixed_count >= 0),
  remaining_count smallint NOT NULL CHECK (remaining_count >= 0),
  iteration smallint NOT NULL,
  max_iterations smallint NOT NULL DEFAULT 5 CHECK (max_iterations BETWEEN 1 AND 20),
  state review_cycle_state NOT NULL,
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('user','agent','system')),
  requested_by_id text,
  requested_by_name text NOT NULL CHECK (char_length(requested_by_name) <= 120),
  observed_at timestamptz NOT NULL,                       -- cycle report watermark (§43); = started_at when created by Apply Fix
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_cycles_pr_cycle_key UNIQUE (pull_request_id, cycle_number),
  CONSTRAINT review_cycles_counts_check CHECK (fixed_count + remaining_count <= findings_count),
  CONSTRAINT review_cycles_iteration_check CHECK (iteration BETWEEN 1 AND max_iterations)
);
CREATE INDEX review_cycles_pr_idx ON review_cycles (pull_request_id, cycle_number DESC);
CREATE UNIQUE INDEX review_cycles_one_running_idx ON review_cycles (pull_request_id) WHERE state = 'RUNNING';   -- at most one RUNNING cycle per PR (R56/R59)

-- updated_at, RLS (policies <table>_org_isolation on all four, pattern of 0002), grants for app_user:
--   pull_requests, reviews, review_cycles: SELECT, INSERT, UPDATE;  review_findings: SELECT, INSERT, UPDATE, DELETE (absent findings are removed by the review ingest — R65)
-- live updates (FR-034): statement-level triggers, one inbox_change_log row + one pg_notify('inbox_changed') per distinct workflow per statement,
-- de-duplicated per transaction exactly like notify_agent_decision_changed() (0006):
--   inbox_changed_pull_requests           AFTER INSERT OR UPDATE ON pull_requests   REFERENCING NEW TABLE AS inserted
--   inbox_changed_reviews                 AFTER INSERT OR UPDATE ON reviews         REFERENCING NEW TABLE AS inserted
--   inbox_changed_review_findings         AFTER INSERT OR UPDATE ON review_findings REFERENCING NEW TABLE AS inserted
--   inbox_changed_review_findings_deleted AFTER DELETE ON review_findings           REFERENCING OLD TABLE AS deleted
--   inbox_changed_review_cycles           AFTER INSERT OR UPDATE ON review_cycles   REFERENCING NEW TABLE AS inserted
-- (Postgres allows one event per transition-table trigger, so INSERT and UPDATE are two CREATE TRIGGER statements sharing the name prefix
--  where needed — the schema test lists the resulting tgname set.)
```

**Notes**: `fix_cycle_id` references `review_cycles`, which is created after `review_findings` — the migration either creates `review_cycles` first (it has no dependency on findings) or adds the constraint with `ALTER TABLE … ADD CONSTRAINT review_findings_fix_cycle_fkey` after both tables; the landed file decides and this section is updated to mirror it. `workflow_id` is denormalised onto all four tables so the NOTIFY function has it without a join (as `agent_decisions` does) and so RLS/visibility filters need no extra join. Mirrored in `packages/db/src/schema.ts` (`pullRequests`, `reviews`, `reviewFindings`, `reviewCycles`; eight `pgEnum`s); `RLS_TABLES` gains the four tables. **Existing assertions this migration changes** (`packages/db/tests/schema.test.ts`): the `inbox_changed_%` trigger list and the `pg_tables` list (`TABLES_ADDED_BY_0007`); `columnCounts` is unchanged because no pinned table gains a column.

## 40. Review shapes (`packages/contracts/src/reviews.ts`, Zod; `ingest.ts` and `workflow-detail.ts` extended) — research R56, R60–R63, R65

```ts
export const ReviewLane = z.enum(REVIEW_LANES);                 // ordered as §38
export const LaneStatus = z.enum(['PASS','WARN','FAIL']);
export const ReviewStatus = z.enum(['RUNNING','COMPLETE','FAILED']);
export const FindingSeverity = z.enum(['CRITICAL','HIGH','MEDIUM','LOW','INFO']);
export const FindingBlocking = z.enum(['BLOCKING','NON_BLOCKING','SUGGESTION']);
export const FindingState = z.enum(['OPEN','FIX_REQUESTED','FIXED','DISMISSED','ISSUE_REQUESTED']);
export const ReviewCycleState = z.enum(['RUNNING','COMPLETED','FAILED','CANCELLED']);
export const PullRequestStatus = z.enum(['OPEN','MERGED','CLOSED']);

export const LaneResult = z.object({ lane: ReviewLane, status: LaneStatus, summary: line(240).nullable() }).strict();
/** Read-model lane: the runtime's status plus the cross-check flag (R65). */
export const LaneView = LaneResult.extend({ disputed: z.boolean(), findingsSay: LaneStatus.nullable() }).strict();

export const ReviewFinding = z.object({
  id: Uuid, externalId: ExternalId, position: z.number().int().min(1).max(50),
  lane: ReviewLane, severity: FindingSeverity, blocking: FindingBlocking,
  title: line(200), description: z.string().max(600), impact: z.string().max(400).nullable(),
  evidence: z.array(EvidenceRef).max(20),                        // reused from agent-runs.ts (R62)
  recommendedFix: z.string().max(400).nullable(),
  state: FindingState, stateChangedAt: IsoDate,
  dismissal: z.object({ reason: line(240), by: z.string(), at: IsoDate }).strict().nullable(),
  fixRequest: z.object({ cycleNumber: z.number().int().min(1), by: z.string(), at: IsoDate }).strict().nullable(),
  issueRequest: z.object({ by: z.string(), at: IsoDate }).strict().nullable(),
}).strict();

export const ReviewCycle = z.object({
  id: Uuid, cycleNumber: z.number().int().min(1).max(100),
  findingsCount: z.number().int().min(0).max(50), fixedCount: z.number().int().min(0), remainingCount: z.number().int().min(0),
  iteration: z.number().int().min(1), maxIterations: z.number().int().min(1).max(20),
  state: ReviewCycleState,
  requestedBy: z.object({ type: z.enum(['user','agent','system']), name: z.string() }).strict(),
  agentRunId: Uuid.nullable(),                                    // → agentRunHref() when present
  startedAt: IsoDate, finishedAt: IsoDate.nullable(), observedAt: IsoDate,
}).strict();

export const ReviewSummary = z.object({
  id: Uuid, externalId: ExternalId, cycleNumber: z.number().int(), status: ReviewStatus,
  lanes: z.array(LaneView).length(7), agentRunId: Uuid.nullable(),
  startedAt: IsoDate, finishedAt: IsoDate.nullable(), observedAt: IsoDate,
}).strict();

export const PullRequestReviewView = z.object({
  pullRequest: z.object({
    id: Uuid, externalId: ExternalId, number: z.number().int().min(1), title: line(200), href: HttpsUrl, status: PullRequestStatus,
    workflow: z.object({ id: Uuid, externalId: ExternalId, title: z.string() }).strict(),
    requirement: z.object({ id: Uuid, key: z.string(), title: z.string() }).strict().nullable(),   // href = /requirements/{id}
    reviewStage: z.object({ id: Uuid, position: z.number().int(), name: z.string(), state: WorkflowState }).strict().nullable(),
  }).strict(),
  review: ReviewSummary.nullable(),                               // null before the first review snapshot
  findings: z.array(ReviewFinding).max(50),                       // the latest review's findings, by position
  cycles: z.array(ReviewCycle).max(20),                           // newest first
  readyForMerge: z.boolean(),                                     // derived (R60), never stored
  blockingOpenCount: z.number().int().min(0).max(50),
  counts: z.object({ open: count, fixRequested: count, fixed: count, dismissed: count, issueRequested: count }).strict(),
  me: z.object({ canAct: z.boolean(), reason: z.string().nullable() }).strict(),   // viewer → { false, "Only engineers, approvers and administrators can act on findings" }
  generatedAt: IsoDate,
}).strict();

export const ReviewListItem = z.object({
  pullRequestId: Uuid, number: z.number().int(), title: line(200), href: HttpsUrl, status: PullRequestStatus,
  workflow: z.object({ id: Uuid, externalId: ExternalId, title: z.string() }).strict(),
  requirement: z.object({ id: Uuid, key: z.string(), title: z.string() }).strict().nullable(),
  reviewStatus: ReviewStatus.nullable(),
  lanes: z.array(z.object({ lane: ReviewLane, status: LaneStatus }).strict()).max(7),   // [] before the first review
  blockingOpenCount: z.number().int().min(0), readyForMerge: z.boolean(), updatedAt: IsoDate,
}).strict();
export const ReviewListQuery = z.object({ project: ProjectKey.optional(), status: ReviewStatus.optional(), cursor: z.string().max(200).optional() }).strict();
export const ReviewListPage = z.object({ items: z.array(ReviewListItem).max(50), nextCursor: z.string().nullable(), generatedAt: IsoDate }).strict();

export const ReviewIdParams = z.object({ pullRequestId: Uuid }).strict();
export const FindingParams = ReviewIdParams.extend({ findingId: Uuid }).strict();
export const DismissFindingBody = z.object({ reason: line(240) }).strict();          // required, non-empty (line() trims and rejects '')
export const ApplyFixBody = z.object({}).strict();
export const CreateIssueBody = z.object({}).strict();
export const FindingActionResult = z.object({ finding: ReviewFinding, cycle: ReviewCycle.nullable(), readyForMerge: z.boolean(), blockingOpenCount: z.number().int() }).strict();

// ingest.ts (EXTENDED) — every object .strict(); no field for reasoning exists (FR-018/SC-009, R65)
export const PullRequestUpsert = z.object({
  observedAt: IsoDate, workflowExternalId: ExternalId, number: z.number().int().min(1), title: line(200), href: HttpsUrl,
  status: PullRequestStatus.default('OPEN'), requirementExternalId: ExternalId.nullable().optional(), reviewStagePosition: z.number().int().min(1).max(20).nullable().optional(),
}).strict();
export const FindingIngest = z.object({
  externalId: ExternalId, lane: ReviewLane, severity: FindingSeverity, blocking: FindingBlocking,
  title: line(200), description: z.string().min(1).max(600), impact: z.string().max(400).nullable().optional(),
  evidence: z.array(EvidenceRef).max(20).default([]), recommendedFix: z.string().max(400).nullable().optional(),
  status: z.enum(['open','fixed']),
}).strict();
export const ReviewIngest = z.object({
  observedAt: IsoDate, externalId: ExternalId, status: ReviewStatus, startedAt: IsoDate, finishedAt: IsoDate.nullable().optional(),
  agentRunExternalId: ExternalId.nullable().optional(),
  lanes: z.array(LaneResult).length(7),                           // superRefine: each of the seven lanes exactly once
  findings: z.array(FindingIngest).max(50),                       // superRefine: externalId unique
}).strict();
export const ReviewCycleIngest = z.object({
  observedAt: IsoDate, iteration: z.number().int().min(1), maxIterations: z.number().int().min(1).max(20).optional(),
  findingsCount: z.number().int().min(0).max(50), fixedCount: z.number().int().min(0), remainingCount: z.number().int().min(0),
  state: ReviewCycleState, startedAt: IsoDate.optional(), finishedAt: IsoDate.nullable().optional(), agentRunExternalId: ExternalId.nullable().optional(),
}).strict();                                                      // superRefine: fixedCount + remainingCount ≤ findingsCount; iteration ≤ maxIterations
export const CycleParams = ExternalIdParams.extend({ cycle: z.coerce.number().int().min(1).max(100) });   // and { n } for /cycles/{n}
export const ReviewIngestResult = z.object({ result: z.enum(['accepted','stale']), findings: z.object({ inserted: count, updated: count, deleted: count, fixed: count }).strict() }).strict();
export const ReviewCycleIngestResult = z.object({ result: z.enum(['accepted','stale']), cycleNumber: z.number().int(), stageSynced: z.boolean() }).strict();

// workflow-detail.ts (EXTENDED, additive)
export const WorkflowPullRequest = z.object({
  id: Uuid, number: z.number().int(), title: line(200), href: HttpsUrl, status: PullRequestStatus,
  reviewStatus: ReviewStatus.nullable(), blockingOpenCount: z.number().int().min(0), readyForMerge: z.boolean(),
}).strict();
// WorkflowDetail.pullRequest: WorkflowPullRequest.nullable() — default null so existing fixtures stay valid
```

`IsoDate`, `Uuid`, `ExternalId`, `line`, `count`, `ProjectKey`, `HttpsUrl` (https-only URL ≤ 400) and `DecisionLink` are the existing `common.ts` primitives (`HttpsUrl` is added there if absent). `EvidenceRef` is imported from `agent-runs.ts`, not redefined.

## 41. State machines (research R56, R59, R61, R65)

**Finding** (`review_findings.state`; every transition sets `state_changed_at`):

| From | To | Actor | Trigger | Side effects |
|------|----|-------|---------|--------------|
| — | `OPEN` | runtime | review ingest inserts a new `external_id` | — |
| `OPEN` | `DISMISSED` | human (engineer/approver/admin) | `POST …/dismiss { reason }` | `dismissed_*` set; `audit_events finding.dismissed { reason }`; NOTIFY |
| `OPEN` | `FIX_REQUESTED` | human | `POST …/fix` | `fix_cycle_id`, `fix_requested_*`; cycle created or attached (R56); Review stage → RUNNING when a cycle is created and `review_stage_id` is set (R57a); `audit_events finding.fix_requested { cycleNumber, iteration }`; NOTIFY |
| `OPEN` | `ISSUE_REQUESTED` | human | `POST …/issue` | `issue_requested_*`; `audit_events finding.issue_requested { title, lane, severity }`; NOTIFY; **no outbound call** (R61) |
| `OPEN`, `FIX_REQUESTED` | `FIXED` | runtime | review ingest reports `status: 'fixed'` | — (`ingestion_log` only) |
| `FIXED` | `OPEN` | runtime | review ingest reports `status: 'open'` again (regression) | — |
| `DISMISSED`, `ISSUE_REQUESTED` | (unchanged) | runtime | any snapshot | content updated, state preserved (R65) |
| any | (row deleted) | runtime | `external_id` absent from the snapshot | `inbox_changed_review_findings_deleted` NOTIFY |
| `FIX_REQUESTED`, `FIXED`, `DISMISSED`, `ISSUE_REQUESTED` | — | human | any action | **409 `finding-already-actioned`** with `extensions { state, actedAt, actedBy }` and the recorded outcome in `detail` (R59) |

Pure rule: `nextFindingState(current: FindingState, reported: 'open' | 'fixed'): FindingState` (`@cdevi/contracts/review-model`) implements the runtime rows; `humanTransition(current, action: 'dismiss' | 'fix' | 'issue'): FindingState | null` returns `null` when not `OPEN` (the API maps `null` to 409).

**Review cycle** (`review_cycles.state`):

| From | To | Actor | Trigger | Review stage (R57, only if `review_stage_id` set and this is the latest cycle) |
|------|----|-------|---------|-----------------------------------------------------------------------------|
| — | `RUNNING` | human via Apply Fix (no RUNNING cycle exists) | `POST …/fix` | → `RUNNING`, reason "Fix requested by {actor} on finding #{position}", `workflow_transitions` row with `user_id` |
| `RUNNING` | `RUNNING` | runtime | `PUT …/cycles/{n}` (counts/iteration progress) | → `RUNNING`, reason "Review cycle #n running — iteration i of m" iff `observedAt > state_observed_at` |
| `RUNNING` | `COMPLETED` | runtime | `PUT …/cycles/{n} { state: COMPLETED }` | → `COMPLETED`, reason "Review cycle #n completed — r findings remaining" iff newer |
| `RUNNING` | `FAILED` | runtime | `{ state: FAILED }` | → `FAILED`, `error_summary` "Review cycle #n failed" iff newer |
| `RUNNING` | `CANCELLED` | runtime | `{ state: CANCELLED }` | → `CANCELLED` iff newer |
| terminal | any | runtime | older or equal `observedAt` | nothing (`{ result: 'stale' }`); a **newer** report for a terminal cycle is accepted (the runtime may correct counts) but the stage is only re-synced if the cycle is still the latest |
| — | `RUNNING` | runtime | `PUT …/cycles/{n}` for an unknown `n` | the cycle row is created (`requested_by_type = 'agent'`) — the runtime may start a cycle on its own (e.g. an automatic re-review) |

`review_cycles_one_running_idx` guarantees at most one `RUNNING` cycle per PR; a runtime report that would create a second RUNNING cycle while another is RUNNING is 409 `cycle-conflict`. Pure rule: `cycleFromFixRequest(cycles, openFindings, actor, now): ReviewCycle` computes `cycleNumber = max + 1`, `iteration = (latest.iteration ?? 0) + 1` capped at `maxIterations` (when the cap is reached the API answers 409 `max-iterations-reached` and the UI explains "Iteration limit reached — escalate" — the runtime may raise `maxIterations` through the cycle ingest), `findingsCount = openFindings`, `fixedCount = 0`, `remainingCount = openFindings`.

## 42. Routes and read-model rules (research R59, R60, R63, R64)

| Route | Auth | Request | Response | Problems |
|-------|------|---------|----------|----------|
| `GET /reviews` | session (`requireUser`), `visibleProjects` | `ReviewListQuery` | 200 `ReviewListPage` (50 items; `nextCursor`); `Server-Timing`, `Cache-Control: no-store` | 400 `validation-failed` (bad cursor/status); 401 |
| `GET /reviews/{pullRequestId}` | session, `visibleProjects` | `ReviewIdParams` | 200 `PullRequestReviewView` | 400 (non-uuid); 401; **404 `not-found`** when unknown **or** invisible (no 403 — existence is not leaked) |
| `POST /reviews/{pullRequestId}/findings/{findingId}/dismiss` | session + role ∈ {engineer, approver, administrator} + CSRF origin | `DismissFindingBody` | 200 `FindingActionResult` (`cycle: null`) | 400 (missing/empty/too-long reason); 401; **403 `forbidden`** (viewer — `detail` "Only engineers, approvers and administrators can act on findings"); 404 (unknown/invisible PR or finding, or finding not in the PR's latest review); **409 `finding-already-actioned`** |
| `POST …/fix` | same | `ApplyFixBody` | 200 `FindingActionResult` (`cycle` = created or attached) | as above + 409 `max-iterations-reached` |
| `POST …/issue` | same | `CreateIssueBody` | 200 `FindingActionResult` (`cycle: null`) | as above |
| `PUT /ingest/pull-requests/{externalId}` | ingestion principal (`requirePrincipal`, scope includes the workflow's project) | `PullRequestUpsert` | 200 `IngestResult` `{ result: 'accepted' \| 'stale' }` | 400 (schema, unknown key — no echo); 401; 403 (scope); 404 (unknown `workflowExternalId`, `requirementExternalId` or stage position); 409 `workflow-has-pull-request` (another PR already linked to that workflow) |
| `PUT /ingest/pull-requests/{externalId}/reviews/{cycle}` | ingestion principal | `ReviewIngest` | 200 `ReviewIngestResult` | 400 (schema, ≠ 7 lanes, duplicate lane, > 50 findings, duplicate finding `externalId`, > 20 evidence, **any unknown key**); 401; 403; 404 (unknown PR) |
| `PUT /ingest/pull-requests/{externalId}/cycles/{n}` | ingestion principal | `ReviewCycleIngest` | 200 `ReviewCycleIngestResult` | 400; 401; 403; 404; 409 `cycle-conflict` |
| `GET /workflows/{id}` (EXTENDED, additive) | unchanged | unchanged | `pullRequest: WorkflowPullRequest \| null` | unchanged |

**Read model** (`apps/api/src/services/review-center.ts`), one `REPEATABLE READ` transaction, ≤ 5 statements: (1) PR + workflow + requirement + Review stage (`LEFT JOIN`s) filtered by `visibleProjects` → 404 when no row; (2) latest review (`ORDER BY cycle_number DESC LIMIT 1`); (3) its findings `ORDER BY position` (≤ 50); (4) cycles `ORDER BY cycle_number DESC LIMIT 20`; (5) nothing else — `readyForMerge`, `blockingOpenCount`, `counts`, `lanes[].disputed/findingsSay` (`laneCrossCheck`) and `me.canAct` are computed in TypeScript from (1)–(4). `GET /reviews`: one statement over `pull_requests` with `LEFT JOIN LATERAL` (latest review: status + lanes) and a `COUNT(*) FILTER` over `review_findings_blocking_open_idx` for the blocking count, `WHERE project_id = ANY($visible) [AND project = $p] [AND latest.status = $s] AND (updated_at, id) < ($cursorUpdatedAt, $cursorId) ORDER BY updated_at DESC, id DESC LIMIT 51` (the 51st row only decides `nextCursor`). Payload ceiling: `PullRequestReviewView` at the schema maximum ≈ 1.2 MB, asserted ≤ 1.5 MB; realistic fixture ≤ 64 KB.

**Actions** (`apps/api/src/services/finding-actions.ts`), one transaction each (default isolation): role check (403) → `SELECT … FOR UPDATE OF f` joined to the PR's latest review (404 when the finding belongs to an older review or an invisible PR) → `humanTransition` (`null` → 409 with the recorded outcome) → for `fix`: `SELECT … FROM review_cycles WHERE pull_request_id = $1 AND state = 'RUNNING' FOR UPDATE`; none → `pg_advisory_xact_lock(hashtext($1))`, re-check, `INSERT` the cycle from `cycleFromFixRequest` (409 `max-iterations-reached` when capped), Review stage write + `workflow_transitions` (R57a) → finding `UPDATE` → `audit_events` `INSERT` → the triggers write `inbox_change_log`/NOTIFY → respond with the re-read finding, the cycle and the recomputed `readyForMerge`/`blockingOpenCount`.

## 43. Ingestion rules — watermarks and reconciliation (research R57, R65)

Every US6 ingest runs in one transaction: principal scope (404 unknown PR/workflow in the principal's organization; 403 when the principal's project scope excludes the PR's project, `ingestion_log outcome='forbidden'`), then `SELECT … FROM pull_requests WHERE organization_id = $org AND external_id = $ext FOR UPDATE` (the **PR row** is the lock for all three routes, so a PR's reviews, cycles and its own upsert serialise), then the route's watermark:

| Route | Watermark column | Stale rule | Writes on accept |
|-------|------------------|------------|------------------|
| `PUT …/pull-requests/{externalId}` | `pull_requests.observed_at` | `observedAt ≤ stored` → `{ result: 'stale' }`, nothing written but `ingestion_log` | upsert `pull_requests` (`INSERT … ON CONFLICT (organization_id, external_id) DO UPDATE`); `requirement_id` resolved from `requirementExternalId` (404 when unknown; `null` clears), `review_stage_id` from `reviewStagePosition` (404 when the workflow has no such stage; `null` clears); linking a second PR to a workflow → 409 |
| `PUT …/reviews/{cycle}` | `reviews.observed_at` of the row `(pull_request_id, cycle_number = cycle)` (`NULL` = no row → always accepted) | `observedAt ≤ stored` → `{ result: 'stale', findings: { 0,0,0,0 } }` | upsert `reviews` (status, lanes, times, `agent_run_id` from `agentRunExternalId`, `observed_at`); reconcile findings by `external_id` (§41: `DELETE` absent → `INSERT` new as `OPEN` → `UPDATE` existing: content + `position` + `nextFindingState`); `ingestion_log (route, target_external_id, outcome, detail='observedAt=… cycle=… +i ~u -d fixed=f')`. The statement-level triggers notify once per statement (three statements at most → de-duplicated to one frame per transaction by the transaction-local setting, as 0006 does) |
| `PUT …/cycles/{n}` | `review_cycles.observed_at` of `(pull_request_id, cycle_number = n)` | `observedAt ≤ stored` → `{ result: 'stale', cycleNumber: n, stageSynced: false }` | upsert `review_cycles` (counts, iteration, `max_iterations` when given, state, times, `agent_run_id`); if `n` is the PR's highest cycle number and `review_stage_id` is set and `observedAt > workflow_stages.state_observed_at` → stage write + `workflow_transitions` row (R57b), `stageSynced: true`; creating a second RUNNING cycle → 409 `cycle-conflict` |

Validation happens before step 1 (Fastify + Zod): every ingest body is `.strict()` at every level — an unknown key at any level → 400 `validation-failed` with `errors[] = { pointer, message: 'Unrecognized key' }` and **no echo of the offending value or body**; `lanes` must be exactly the seven lanes once each; `findings[].externalId` unique; bounds per §40. A review snapshot with `findings: []` is valid (all clear): every finding of that review is deleted, the deletion notifies, `readyForMerge` becomes `true`. Human actions and ingests never race silently: the PR row lock serialises them, and a human action on a finding the snapshot just deleted answers 404.

## 44. Seed additions (research R64) — `packages/db/src/seed/reviews.ts` (NEW), `seed/index.ts` (EXTENDED)

No new workflows, stages, runs, artifacts, test runs, approvals, clarifications or requirements: `EXPECTED_SHOWCASE`, `EXPECTED_DASHBOARD`, `EXPECTED_AGENT_DECISIONS` and every US2/US4 `EXPECTED_*` figure are unchanged and re-asserted. `workflows.pull_request_ref` of `s500-001` is **not** changed (the Review Center reads `pull_requests`).

| Row | Content |
|-----|---------|
| `pull_requests` `s500-pr-1821` | workflow `s500-001` ("Add rate limiting to /api/auth", `payments-api`, stage 6 "Review" is `WAITING_FOR_HUMAN`), `requirement_id` = the requirement whose `linkedWorkflow` is `SHOWCASE_WAITING` (the `IN_IMPLEMENTATION` one seeded by `requirements.ts`), `review_stage_id` = stage 6, `number 1821`, `title "PAY-1391 Refund processing"`, `href https://git.cdevi.demo/payments-api/pull/1821`, `status OPEN`, `observed_at = base − 10 min` |
| `reviews` cycle 1 (`s500-rev-1821-1`, COMPLETE, `base − 6 h`) | 7 lanes: security FAIL, correctness FAIL, edge_cases WARN, testing WARN, dependencies PASS, architecture PASS, general WARN; 12 findings (all now `FIXED` except 4 carried forward — historical; the Review Center shows only the latest review) |
| `reviews` cycle 2 (`s500-rev-1821-2`, COMPLETE, `base − 3 h`) | security FAIL, edge_cases FAIL, testing WARN, others PASS; 9 findings, of which 2 were `DISMISSED` by Engineer 1 with reasons — 7 were open when cycle #3 started (its `findings_count`) |
| `reviews` cycle 3 (`s500-rev-1821-3`, **latest**, COMPLETE, `agent_run_id` = `s500-001-r8`, `base − 40 min`) | lanes in display order: correctness **WARN** "One unchecked null path in RefundService", security **FAIL** "Authorization gap on the refund endpoint", dependencies **PASS** "No new dependencies", edge_cases **FAIL** "Partial refunds above the captured amount are not rejected", testing **WARN** "Refund paths lack negative tests", architecture **PASS** "Follows the payments module boundaries", general **WARN** "Minor naming inconsistencies". **7 findings** (`external_id` `s500-f-1821-3-{position}`), one per lane, `position` = lane order: (1) correctness MEDIUM / NON_BLOCKING `OPEN` "Null `originalPayment` not handled in `RefundService.refund()`", evidence `file` `RefundService.java:112` (accessible); (2) **security CRITICAL / BLOCKING `OPEN`** "Refund endpoint does not verify authorization against the original payment owner" — impact "A user may potentially refund another user's payment.", evidence `file` `RefundController.java:84` (accessible, repo permalink) + `url` "Threat model — refunds" with `accessible: false` and no `href` (the **restricted** row), recommended fix "Validate payment ownership before processing."; (3) dependencies LOW / SUGGESTION `OPEN` "Pin `payments-sdk` to the tested minor"; (4) **edge_cases HIGH / BLOCKING `OPEN`** "Partial refund amount is not bounded by the captured amount", evidence `file` `RefundService.java:140` + `ticket` `PAY-1391` (accessible, Jira browse URL); (5) testing MEDIUM / NON_BLOCKING `OPEN` "No negative test for refunds after the 90-day window"; (6) architecture LOW / SUGGESTION `OPEN` "Move `RefundPolicy` next to the other payment policies"; (7) general INFO / SUGGESTION `OPEN` "Inconsistent naming: `refundAmt` vs `refundAmount`". Descriptions ≤ 600, no field named anything like reasoning |
| `review_cycles` #1 (COMPLETED, iteration 1 of 5, `base − 5 h` → `base − 4 h`) | 12 / 8 / 4, `requested_by` user "Engineer 1" |
| `review_cycles` #2 (COMPLETED, iteration 2 of 5, `base − 2.5 h` → `base − 2 h`) | 9 / 6 / 3, user "Engineer 1" |
| `review_cycles` #3 (COMPLETED, iteration 3 of 5, `base − 90 min` → `base − 50 min`, `agent_run_id` = `s500-001-r7`) | **7 / 6 / 1** (UI spec §22), user "Approver 1" — the cycle whose output review #3 above reviewed; its one remaining finding is the CRITICAL security finding carried into review #3 |

Derived seed facts (asserted in `packages/db/tests/seed.test.ts` `FR-020 seed reviews …`, `FR-022 seed blocking …`): `EXPECTED_REVIEWS = { pullRequests: 1, reviews: 3, latestFindings: 7, latestBlockingOpen: 2, cycles: 3, runningCycles: 0, restrictedEvidence: 1 }`; `readyForMerge(latest) === false`; `blockingNoticeText(2) === 'Not ready for merge approval — 2 blocking findings open'`; `laneCrossCheck(review3.lanes, findings)` is empty (the seeded lanes agree with the findings — the disputed state is exercised by an API test fixture, not the seed); `review_cycles_one_running_idx` holds. `seed/index.ts`: `TRUNCATE` list gains the four tables (before `workflows`, or rely on CASCADE); rows are inserted after workflows, stages, agent runs and requirements so `workflow_id`, `review_stage_id`, `agent_run_id` and `requirement_id` resolve from inserted uuids. Every seeded timestamp lies within the workflow's `started_at … base` window.
