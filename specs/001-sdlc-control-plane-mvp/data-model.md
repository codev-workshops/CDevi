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
