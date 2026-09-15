# Implementation Plan: SDLC Control Plane MVP — User Stories 1 (Workflow Detail), 2 (Approval Center) and 3 (Dashboard)

**Branch**: `feature/US1` (Part A, landed) · `feature/US2` (Part B, landed) · `feature/US3` (Part C) | **Date**: 2026-09-14 (A, B) · 2026-09-15 (C) | **Spec**: [spec.md](spec.md) — User Stories 1, 2 and 3

> Part A below is the User Story 1 plan as landed. **Part B — User Story 2 (Approval Center)** follows and builds on Part A without changing it. **Part C — User Story 3 (Dashboard)** is appended at the end and builds on A and B without changing them.

# Part A — User Story 1 (Workflow Detail)

**Input**: Feature specification from `/specs/001-sdlc-control-plane-mvp/spec.md`, scoped to **User Story 1 — Follow one requirement from ticket to PR** (spec lines 20–35). The Dashboard, Approval Center, Requirements list, Agent Activity, Testing, PR Review and Admin screens are other user stories and are **out of scope** for this plan.

## Summary

Replace the `specs/003` record stub at `/workflows/[id]` with the real **Workflow Detail** screen: an ordered stage pipeline (each stage a `StatePill` in one of the nine states, current stage highlighted), current-stage detail (agent, model, elapsed time, plain-language activity, progress), an ordered activity feed, an artifact list tagged by producing stage, test-run evidence, a never-hidden **needs you / blocked** notice with its reason and one direct action, and a failure panel (reason, failing stage, last successful stage, retry / escalate / cancel — role-gated) — all refreshed within 5 s over the existing SSE plumbing. Behind it, the entities that `specs/003` did not persist are added by extension, not recreation: **Workflow Stage**, **Agent Run** (with timeline), **Artifact** (immutable) and **Test Run** summary, every table carrying `organization_id` and `project_id`, one hand-reviewed SQL migration (`0002_workflow_detail.sql`) with indexes, `updated_at` and NOTIFY triggers, an extended S-500 seed with two showcase workflows (one waiting for a human with a retried-failure history, one failed at Testing), Zod contracts plus pure read-model helpers in `@cdevi/contracts`, one read route `GET /api/workflows/{id}`, one action route `POST /api/workflows/{id}/actions`, and ingestion extensions for stages, agent runs, artifacts and test runs. The stack is the one `specs/003` established — no alternate architecture.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `tsconfig.base.json`), Node.js 26 (`.nvmrc`), ES modules; React 19.2

**Primary Dependencies**: pnpm 10 workspaces · **web**: Next.js 16 App Router (`apps/web`; server component fetches the first snapshot, a client component keeps it fresh), `@cdevi/design-system` 1.2.0 (**no version bump needed — see Design System Compliance**) · **api**: Fastify 5 + `fastify-type-provider-zod` (`apps/api`), `pg` for queries and `LISTEN inbox_changed` · **db**: `drizzle-orm` schema + hand-written SQL migrations (`packages/db`) · **contracts**: `zod` 4 → OpenAPI 3.1 via `packages/contracts/src/openapi.ts` · nothing new is added to `package.json`

**Storage**: PostgreSQL 17. New tables `workflow_stages`, `agent_runs`, `artifacts`, `test_runs`; two nullable columns on `workflow_transitions` (`stage_id`, `user_id`) so stage-level transitions and human actions reuse the existing transition log (FR-002 "all state transitions recorded with timestamp and cause"). All new tables carry `organization_id` + `project_id`, RLS policies (flag-enabled as in `0001_init.sql`), `app_user` grants, and `AFTER INSERT OR UPDATE` triggers into the existing `notify_inbox_changed()` so a change to any of them produces one `inbox_change_log` row + `pg_notify('inbox_changed')` carrying `workflowId`

**Testing**: Vitest 4 projects — `contracts` (pure read-model + schema + OpenAPI fragment snapshot), `db` (migration shape + seed determinism against real Postgres), `api` (integration, identified suite, fixed clock `FIXED_NOW`, S-500 re-seeded per run), `web` (component tests + axe in jsdom) · Playwright — `apps/web/tests/e2e/workflow-detail-*.spec.ts` for journey, 5 s live update, keyboard, page axe. Every test name begins with the FR/SC id it proves. Red → green: each test task precedes its implementation task in tasks.md

**Target Platform**: Evergreen desktop browsers ≥ 1200 px plus the shell's 768–1199 px rail and < 768 px stacked modes; Node 26 Linux containers; GitHub Actions `ubuntu-latest` with Postgres service (existing `ci.yml`, no job changes)

**Project Type**: Web application — `apps/web` + `apps/api` + shared packages in the existing monorepo

**Performance Goals** (Principle IV; workload = S-500 plus the two showcase workflows: 7 stages, 9 agent runs, 6 artifacts, 4 test runs, ~30 activity events each; measured on CI `ubuntu-latest` with the Postgres service, no throttling):
- Workflow Detail first meaningful content (LCP) ≤ 2 s at p95 — Playwright trace over 10 runs (`workflow-detail-journey.spec.ts` logs LCP; asserted ≤ 2 000 ms)
- `GET /api/workflows/{id}` ≤ 150 ms at p95, ≤ 300 ms at p99 for a showcase workflow — `Server-Timing` header asserted in `apps/api/tests/workflow-detail.test.ts` over 20 sequential calls (p95 ≤ 150 ms); the route issues exactly 6 indexed queries in one `REPEATABLE READ` transaction
- Ingestion write (stage transition / artifact / test run) → change visible in an open Workflow Detail page ≤ 5 s at p95 (SC-003, FR-034), target ≤ 1 s median — `workflow-detail-freshness.spec.ts` measures 5 iterations and asserts p95 ≤ 5 000 ms
- `PUT /api/ingest/workflows/{externalId}/stages/{position}`, `/agent-runs`, `/artifacts`, `/test-runs` ≤ 200 ms at p95 — integration test timing over 20 calls
- `GET /api/workflows/{id}` payload ≤ 96 KB for a workflow with 7 stages, 20 agent runs, 50 artifacts, 20 test runs, 200 activity events (activity bounded to the newest 200 events, artifacts to 100, timeline per run to 50) — asserted in the api test with an ingested worst-case workflow
- Route JS for `/workflows/[id]` ≤ 200 KB gzip — `tools/check-size.mjs` (existing budget applies to every app route)
- SSE-triggered refresh: the client refetches at most once per 250 ms burst (existing debounce) and re-renders ≤ 100 ms for the showcase workflow (React Profiler assertion in the component test)

**Constraints**: All UI from `@cdevi/design-system` (DR-01…DR-10, enforced by `pnpm check`); exactly one saffron `Button` per screen (the needs-you direct action; failure actions are `primary`/`ghost`/`danger`); `WAITING_FOR_HUMAN` and `BLOCKED` never hidden or collapsed (FR-005); agent claims (`Message variant="summary"`) visually separate from platform evidence (`GateCheck` from `test_runs`) — DR-03; no raw model chain-of-thought is stored or shown (timeline events are plain-language messages ≤ 240 chars); WCAG 2.2 AA; 403 and 404 look identical (never confirm a workflow exists in an invisible project); artifacts are immutable once their stage is `COMPLETED` (DB trigger); web→API timeout 5 s, no automatic retries except the SSE reconnect; every list bounded (activity 200, artifacts 100, timeline 50); actions are POST with the existing CSRF origin check; retry/cancel require role `engineer` or `administrator`, escalate additionally allows `approver`, `viewer` sees disabled actions with an explanation

**Scale/Scope**: 1 organization; ≤ 20 stages per workflow (`StageInput.count ≤ 20`); ≤ 10k workflows; 1 screen replaced, 0 new screens; 2 user routes + 4 ingestion routes; 4 tables + 2 columns; 0 design-system component additions; ~50 tasks

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Requirement | How this plan complies | Status |
|-----------|-------------|------------------------|--------|
| I. Maintainable Code Quality | Follow conventions or establish them; pass formatter/lint/types/build; validate input at boundaries; docs updated with behaviour; no obsolete code left | Follows every convention `specs/003` established (research R1): Zod schemas in `packages/contracts` are the single source for request/response types and the OpenAPI fragment; Drizzle schema mirrors a hand-reviewed SQL migration; Fastify route group per resource; read model derived by pure, unit-tested functions that the API service composes. Every ingestion/action input is Zod-validated; errors are `application/problem+json` without internals. Docs updated in the same change: `docs/architecture.md` §4/§8 (workflow detail read path, ingestion extensions), `AGENTS.md` (new routes), `specs/001/quickstart.md` US1 section. The 003 `RecordStub` remains for `/approvals/[id]`; its `workflows` branch and the `renderRecord('workflows', …)` call are removed (no obsolete code). | PASS |
| II. Risk-Based, Reliable Testing | Failing-then-passing tests for every behaviour; regression test first for bugs; deterministic/isolated; live deps in identified suites; required checks pass before merge | Read-model derivations (stage ordering, current stage, elapsed/progress, artifact grouping, activity ordering, attention, failure, role-gated actions) are pure and unit-tested first in `packages/contracts/tests/workflow-detail.test.ts`. Migration shape + seed determinism in the identified `db` project; API behaviour in the identified `api` project against real Postgres with `FIXED_NOW`; component tests + axe for `WorkflowDetailScreen` in every state (running, waiting, blocked, failed, completed, loading, error, viewer); Playwright covers the journey (one test per acceptance scenario 1, 2, 3, 5), the 5 s live update (scenario 4), keyboard operability and page-level axe. tasks.md places each test before its implementation; names begin with FR/SC ids. No retries or skips for flakiness. | PASS |
| III. Consistent and Accessible UX | Reuse components/tokens; define loading/empty/success/error/disabled states; WCAG 2.2 AA; viewports; destructive confirm; design-system mandatory; new patterns land in the package first | Composed entirely from existing `@cdevi/design-system` 1.2.0 components (see Design System Compliance) — DESIGN.md §5 already maps stage pipeline → `Stepper`, artifact → `ListRow`, evidence → `GateList`, agent claim → `Message`, decision → `DecisionCard`, state → `StatePill`; **no new pattern is required**, so no package change. States: loading (`List loading`, `aria-busy` on the refetching region), empty (each `List empty` text: "No activity yet." / "No artifacts yet." / "No test runs yet."), error (`Notice tone="error"` + Retry `Button`), permission-restricted (identical 404 notice), disabled actions (`Button disabled` + `ActionBar help` "Only engineers can retry or cancel"). **Cancel is destructive → two-step confirm** (the Cancel button becomes "Confirm cancel" with a `Notice tone="info"` explaining, Escape/second click reverts). Viewports via the shell. | PASS |
| IV. Measurable Performance | Numeric budgets with metric/threshold/workload/environment/method; bounded operations; timeouts and bounded retries; measurements exposed | Budgets above each name metric, threshold, workload, environment and method. Every list bounded; all queries hit indexes on `(workflow_id, …)`; the read route runs 6 queries in one transaction and exposes `Server-Timing`; SSE payloads remain notifications only (client refetches, debounced). Web→API 5 s timeout; SSE reconnect back-off 1 s → 30 s with `Last-Event-ID` replay (existing). | PASS |
| Quality Requirements | Spec + plan identify criteria, journeys, failure scenarios, conventions, boundaries, UI/a11y criteria, budgets, checks, evidence | spec.md US1 (criteria, journey, edge cases) · this plan (conventions, boundaries, budgets) · contracts/ (OpenAPI fragment, screen contract) · data-model.md (tables, state rules, read model) · quickstart.md (US1 Independent Test — eight supervision questions). Reproducible build/lint/test already exists (`pnpm check`, `pnpm test:api`, `pnpm test:e2e`); no CI job changes. | PASS |
| Governance | Constitution precedence; exceptions explicit | No exception requested. The `docs/architecture.md` "Streaming to the browser" section is extended (not deviated from): the detail page subscribes to the existing `inbox.changed` stream and filters on `workflowId` instead of a second stream (research R3). | PASS |

**Gate result (pre-research)**: PASS — no violations to justify. Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-sdlc-control-plane-mvp/
├── spec.md                              # Existing — all user stories; this plan covers US1
├── plan.md                              # This file
├── research.md                          # Phase 0 — decisions R1–R10 (US1)
├── data-model.md                        # Phase 1 — new tables, stage/run/artifact rules, detail read model
├── quickstart.md                        # Phase 1 — run, seed, verify; US1 Independent Test (eight questions)
├── contracts/
│   ├── openapi.yaml                     # Fragment: GET /workflows/{id}, POST /workflows/{id}/actions, 4 ingestion routes (generated)
│   └── ui-workflow-detail-screen.md     # Screen contract: regions → components, states, keyboard, a11y names
├── checklists/requirements.md           # Existing
└── tasks.md                             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── contracts/
│   ├── src/
│   │   ├── workflow-detail.ts           # NEW  Zod: WorkflowDetail response, ArtifactType, TestRunStatus, WorkflowAction
│   │   ├── workflow-detail-model.ts     # NEW  pure: orderStages, deriveCurrentStage, deriveProgress, stageElapsed,
│   │   │                                #      groupArtifactsByStage, orderActivity, deriveAttention, deriveFailure, allowedActions
│   │   ├── ingest.ts                    # EXT  StageUpsert, AgentRunUpsert, ArtifactUpsert, TestRunUpsert, StagePositionParams
│   │   ├── openapi.ts                   # EXT  buildWorkflowDetailOpenApi() fragment + buildFullOpenApi() (003 document untouched)
│   │   └── index.ts                     # EXT  re-exports
│   ├── scripts/write-openapi.ts         # EXT  also writes specs/001-…/contracts/openapi.yaml
│   └── tests/
│       ├── workflow-detail.test.ts      # NEW  FR-001/FR-004/FR-005/FR-006 pure derivations
│       ├── schemas.test.ts              # EXT  ingestion extension schemas
│       └── openapi.test.ts              # EXT  fragment snapshot + route list
├── db/
│   ├── migrations/0002_workflow_detail.sql   # NEW  tables, columns, indexes, triggers, RLS, grants
│   ├── src/schema.ts                    # EXT  workflowStages, agentRuns, artifacts, testRuns (+ transitions columns)
│   ├── src/migrate.ts                   # EXT  RLS_TABLES += 4
│   ├── src/seed/s500.ts                 # EXT  buildShowcase(): stage history, runs, artifacts, test runs for 2 workflows
│   ├── src/seed/index.ts                # EXT  writes the showcase rows; TRUNCATE list
│   └── tests/
│       ├── schema.test.ts               # EXT  0002 shape: columns, indexes, triggers, immutability
│       └── seed.test.ts                 # EXT  showcase determinism and Independent-Test invariants
apps/
├── api/
│   ├── src/
│   │   ├── app.ts                       # EXT  register workflowRoutes; swagger uses buildFullOpenApi()
│   │   ├── routes/workflows.ts          # NEW  GET /workflows/:id · POST /workflows/:id/actions
│   │   ├── routes/ingest.ts             # EXT  PUT stages / agent-runs / artifacts / test-runs
│   │   ├── services/workflow-detail.ts  # NEW  6 queries → contracts pure functions → WorkflowDetail
│   │   ├── services/workflow-actions.ts # NEW  retry / escalate / cancel with role gate + transition log
│   │   └── services/ingestion.ts        # EXT  upsertStage, upsertAgentRun, upsertArtifact, upsertTestRun
│   └── tests/
│       ├── workflow-detail.test.ts      # NEW  FR-001 FR-003 FR-004 FR-005 FR-006 FR-034 read/actions/permissions/perf
│       ├── ingest.test.ts               # EXT  stage/run/artifact/test-run ingestion, immutability, scope
│       └── stream.test.ts               # EXT  stage/artifact/test-run changes emit inbox.changed with workflowId
└── web/
    ├── app/(app)/workflows/[id]/
    │   ├── page.tsx                     # REPLACED  server fetch → WorkflowDetailScreen (404/403 identical notice)
    │   └── WorkflowDetailScreen.tsx     # NEW  client: regions per ui-workflow-detail-screen.md, SSE refresh, actions
    ├── app/(app)/record-page.tsx        # EXT  kind narrowed to 'approvals'
    ├── lib/workflow-stream.ts           # NEW  subscribeWorkflowStream(workflowId) over the inbox stream
    └── tests/
        ├── fixtures/workflow-detail.ts  # NEW  detail fixtures per state
        ├── components/workflow-detail.test.tsx   # NEW  FR-001 FR-004 FR-005 FR-006 + axe per state
        └── e2e/
            ├── workflow-detail-journey.spec.ts    # NEW  scenarios 1, 2, 3, 5 + LCP
            ├── workflow-detail-freshness.spec.ts  # NEW  scenario 4 (SC-003)
            ├── workflow-detail-keyboard.spec.ts   # NEW  keyboard operability
            └── workflow-detail-a11y.spec.ts       # NEW  page-level axe per state
docs/architecture.md                      # EXT  §4 detail read path + §8 layout
AGENTS.md                                 # EXT  new routes
```

**Structure Decision**: Web application layout already in place from `specs/003`; US1 adds files inside the same packages and apps. No new workspace package.

## Design System Compliance

_Required by Constitution Principle III. Rules: `packages/design-system/DESIGN.md`._

- **Components used** (all exist in `@cdevi/design-system` 1.2.0): `Topbar` (h1 = workflow title; actions slot empty), `PageMeta` (`StatePill` workflow state, `RiskBadge` when a pending approval carries risk, project key, agent, "stage n of m", elapsed via `humanDuration`), `Meter` (progress, `aria-label="Progress"`, `value=completedStages max=stageCount`), `DecisionCard tone="needs-you"` (the needs-you / blocked notice: title = stage name + reason, badge = `StatePill`, `actions` = **the one saffron `Button`** linking to the approval / clarification / integration), `Card as="section"` + `KeyValue` + `ActionBar help` (failure panel: reason, failing stage, last successful stage; `Button` Retry `primary`, Escalate `ghost`, Cancel `danger` → "Confirm cancel"), `Stepper`/`Step` (pipeline; `state` done/current/todo, `detail` = `StatePill` + agent + elapsed), `Card` + `KeyValue` (current stage: agent, model, started, elapsed, next stage) + `Message variant="summary"` (plain-language activity — the agent's claim, labelled "not evidence", DR-03), `List`/`ListRow` (activity: title = message, `meta` = time · source `Pill`; artifacts: title = name with `href`, `trailing` = `Pill` type, `meta` = "Stage n · name"), `GateList`/`GateCheck` (test runs: `state` ok/bad/wait, `source` = category · counts — platform evidence), `Notice tone="error"` + `Button` Retry (load error), `Notice tone="info"` (cancel confirmation, viewer explanation), `Pill variant="neutral"` for artifact types and event sources, `Mono` for refs/branches, `Button variant="ghost"` "Back to Inbox".
- **Components proposed**: none. Every region maps to an existing catalogue row (DESIGN.md §5 glossary). No CSS, gallery, DESIGN.md, CHANGELOG or version change in this feature.
- **Vocabulary mapping**: all nine workflow/stage states via `StatePill` (`stateToPill`) — words never typed in app code; risk via `RiskBadge`; artifact types rendered as neutral `Pill` words from `ArtifactType` (`requirement spec`, `impact analysis`, `implementation plan`, `test results`, `code diff`, `pull request`); test-run outcome via `GateCheck` state names (passed / failed / waiting).
- **Accessibility verification**: component axe for `WorkflowDetailScreen` in running, waiting-for-human, blocked, failed, completed, cancelled, loading, error and viewer states (Vitest `web`); page-level axe in Playwright on the two showcase workflows and an error page; keyboard spec: Tab order = Back → saffron action (when present) → pipeline (inert list) → failure actions → activity links → artifact links → test-run rows; Enter activates; Escape reverts "Confirm cancel"; names asserted: `Stepper` "Stage pipeline", current step `aria-current="step"`, `Meter` "Progress" with `aria-valuenow`, `DecisionCard` labelled by its heading, `GateCheck` box names, artifact links = artifact title, `List` names "Activity", "Artifacts", "Test runs". Focus after an action stays on the actioned button (or moves to the failure heading when the button disappears).
- **UI performance budgets**: LCP ≤ 2 s p95; route JS ≤ 200 KB gzip; refetch re-render ≤ 100 ms; design-system CSS budget untouched (no CSS change).

## Complexity Tracking

_No constitution violations — nothing to justify._

## Post-Design Constitution Re-check

Re-evaluated after Phase 1 (research.md, data-model.md, contracts/, quickstart.md):

| Principle | Re-check |
|-----------|----------|
| I | Contracts are the single source: `WorkflowDetail` Zod → API response schema → web props → OpenAPI fragment (snapshot-tested). Migration is hand-written and mirrored in `schema.ts`; `db` tests assert columns, indexes and triggers exist. Obsolete workflow branch of the record stub removed. **PASS** |
| II | Every task in tasks.md has a failing test before it; pure derivations tested without a database; live-dependency suites identified (`db`, `api`, e2e); fixed clock everywhere. **PASS** |
| III | Zero new patterns; every region maps to a DESIGN.md §5 glossary row; the one saffron button rule holds (needs-you action only — a failed workflow has no saffron button, a waiting one has exactly one); destructive Cancel confirms; all states defined in the screen contract §4. **PASS** |
| IV | Six budgets with methods; bounds on activity/artifacts/timeline; `Server-Timing` exposed; single transaction per read. **PASS** |

**Gate result (post-design)**: PASS.

---

# Part B — User Story 2 (Approval Center)

**Branch**: `feature/US2` (from `develop`; PR targets `develop`) | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md) — User Story 2 (lines 36–58), FR-011…FR-015, plus FR-025 (project scope), FR-029 (audit of human decisions), FR-032 (roles), FR-034 (live propagation). Other stories remain out of scope.

**Input**: research.md R11–R20, data-model.md §10–17, contracts/{openapi.yaml (US2 routes), decision-rules.md, ui-approval-center.md}, quickstart.md §3, tasks.md Phase 5.

## Summary

Turn the read-only `/approvals/[id]` record stub into the **Approval Center**: one list of every pending approval and clarification the user may see (highest risk first, oldest first within a risk, clarifications after approvals), scoped by the global project selector with "all projects", and a decision screen per item with the context an approver needs (ask, risk, requester, workflow, "why this matters", links to requirement / workflow / agent run / external ticket) and the controls to resolve it: approve (two-step confirmation restating action and risk for HIGH/CRITICAL), reject (reason required, BLOCKED or CANCELLED), answer (suggested option or free text). Behind it, a **human decision path distinct from agent ingestion**: three session-authenticated, role-gated routes (`POST /api/approvals/{id}/approve|reject`, `POST /api/clarifications/{id}/answer`) implemented by `services/decisions.ts`, which in one `REPEATABLE READ` transaction locks the item `FOR UPDATE`, refuses an already-resolved item with 409 + the recorded outcome (first writer wins), locks the workflow, reuses the 0001 state machine (`canTransition`) to move it out of `WAITING_FOR_HUMAN` (RUNNING on approve/answer; BLOCKED/CANCELLED on reject), records the decision on the item, a `user_id`-attributed transition, and an **append-only `audit_events`** row, and relies on the existing `notify_inbox_changed()` triggers so the header count, Inbox and Approval Center refresh over SSE. Two read routes (`GET /api/approvals`, `GET /api/approvals/{id}`) feed the screens. Migration `0003_approval_center.sql` adds `audit_events` and the answer / rejection / context columns. No design-system change.

## Technical Context

**Language/Version**: unchanged (TypeScript 5.9 strict, Node 26, React 19.2, ES modules)

**Primary Dependencies**: unchanged — nothing is added to any `package.json`. Web: Next.js 16 App Router (server first paint, client refresh). API: Fastify 5 + `fastify-type-provider-zod`. DB: hand-written SQL + Drizzle mirror. Contracts: zod 4 → OpenAPI 3.1. Design system 1.2.0 (no bump — see Design System Compliance)

**Storage**: PostgreSQL 17. `0003_approval_center.sql`: new `audit_events` (append-only via `BEFORE UPDATE OR DELETE` raising trigger; RLS; `SELECT, INSERT` to `app_user`; indexes on `(organization_id, occurred_at DESC)`, `(organization_id, target_type, target_id, occurred_at DESC)`, `(workflow_id, occurred_at DESC)`); `approvals` + `context`, `links jsonb`, `rejection_reason`, `rejection_target`, `decided_by_user_id`; `clarifications` + `why_it_matters`, `options jsonb`, `links jsonb`, `answer_option`, `answer_text`, `answered_by_user_id`; CHECKs per data-model §11. Existing NOTIFY triggers untouched and sufficient

**Service boundaries** (research R11): `IngestionService` = agent-observed facts (Bearer principal, idempotent upserts) — only gains optional context fields; `services/decisions.ts` = human, authoritative, exactly-once writes (session user, role gate, `FOR UPDATE`); `services/approval-center.ts` = read models. Routes: `routes/approvals.ts` (reads + approve/reject), `routes/clarifications.ts` (answer). Pure rules (`canDecide`, `requiresConfirmation`, `resultingState`, `decisionAllowed`, `orderApprovalCenter`, `answerIsValid`) live in `@cdevi/contracts` and are consumed by both API and web

**Concurrency** (R12): item `SELECT … FOR UPDATE` → already resolved ⇒ 409 `already-resolved` with `resolution`; workflow `FOR UPDATE` → not `WAITING_FOR_HUMAN` ⇒ 409 `invalid-transition`; all writes (item, workflow, transition, audit) in one transaction; the losing concurrent caller receives the winner's outcome, resolver and time

**Testing**: Vitest — `contracts` (decision rules, schemas, OpenAPI snapshot), `db` (0003 shape: columns, CHECKs, append-only trigger, RLS table list, seed items), `api` (integration on real Postgres, fixed clock: scenarios 1–6, four roles, persistence of decision/answer/rejection, transition + audit rows, `inbox_change_log` growth, two concurrent callers via `Promise.all`), `web` (component + axe for list and decision screens in every §4 state). Playwright `apps/web/tests/e2e/approval-center.spec.ts` = the Independent Test (ingest a requirement approval, a MEDIUM PR-merge approval and a clarification; resolve each from the UI; assert each workflow left `WAITING_FOR_HUMAN`; page axe). Test names start with the FR/SC id. Red → green: every test task precedes its implementation task (tasks.md Phase 5)

**Target Platform / Project Type**: unchanged (web app in the existing monorepo; CI `ci.yml` unchanged)

**Performance Goals** (Principle IV; workload = S-500 (36 pending items) and the SC-007 organization; measured on CI `ubuntu-latest` with the Postgres service). These set the budgets deferred by spec.md line 300 for the Approval Center:
- Approval Center initial content ≤ 2 s p95 (SC-007) — Playwright trace over 10 runs in `approval-center.spec.ts`
- `GET /api/approvals` ≤ 200 ms p95 for 200 items — `Server-Timing` asserted in `apps/api/tests/approval-center.test.ts` over 20 calls; one indexed query (partial indexes on pending approvals/clarifications already exist from 0001) + one count query in one transaction; payload ≤ 96 KB at the 200-item bound
- `GET /api/approvals/{id}` ≤ 150 ms p95 — ≤ 5 queries (item, workflow, project, audit ≤ 20, role) in one transaction
- Decision `POST` ≤ 250 ms p95 (lock + 4 writes) — asserted over 20 sequential decisions on fresh items
- Decision → header count / Inbox / Approval Center refreshed ≤ 5 s p95, ≤ 1 s median (SC-003, FR-034) — `approval-center.spec.ts` measures the count change after each of the three decisions
- Reviewer resolves an item in < 60 s median (SC-006): design proxy — ≤ 3 interactions for LOW/MEDIUM approve, ≤ 4 for HIGH/CRITICAL and reject, ≤ 3 for an answer; asserted as click counts in the e2e
- Route JS ≤ 200 KB gzip (`check:size`, browser imports only `@cdevi/contracts/read-model` and `/vocabulary`); refetch re-render ≤ 100 ms

**Constraints**: exactly one saffron control per screen (Approve / Confirm approval / Submit answer — never two visible at once; reject form open ⇒ none); WCAG 2.2 AA; `WAITING_FOR_HUMAN` and `BLOCKED` always shown as pill words; errors are Problems without internals; every list bounded (200 items, cursor deferred — research summary); `.env` never committed

**Scale/Scope**: 2 screens, 5 routes, 1 migration, ~10 pure rules, ≈ 60 tests

## Constitution Check

| Principle | Check | Result |
|-----------|-------|--------|
| I — Specification and contracts first | Zod schemas + pure rules in `@cdevi/contracts` → OpenAPI fragment (snapshot-tested) → API validation → web types; decision-rules.md and ui-approval-center.md written before code; migration hand-written and mirrored in `schema.ts` | PASS |
| II — Tests before behaviour | Every task in tasks.md Phase 5 has a failing test first; pure rules tested without a DB; live suites identified (`db`, `api`, e2e); concurrency edge case has its own test; fixed clock | PASS |
| III — Design system, defined states, accessibility | Every region maps to an existing component (below); §4 of the screen contract defines loading/empty/error/not-found/submitting/submit-error/already-resolved/permission-disabled/refresh; axe in component tests and Playwright; keyboard/focus contract §5 | PASS |
| IV — Performance budgets | Eight numeric budgets with measurement methods above; bounded list; single transaction per read and per write | PASS |
| Security (constitution §Security) | Session auth + CSRF/origin on every decision; role gate before reads; project visibility via `visibleProjects`; RLS + grants for the new table; audit append-only in the DB; Problems carry no SQL/stack | PASS |

**Gate result (pre-design)**: PASS — no violations to justify.

## Project Structure

### Documentation (this feature)

```
specs/001-sdlc-control-plane-mvp/
├── plan.md              # Part A (US1) + Part B (US2, this section)
├── research.md          # R1–R10 (US1) + R11–R20 (US2)
├── data-model.md        # §1–9 (US1) + §10–17 (US2)
├── quickstart.md        # §2 US1 + §3 US2
├── tasks.md             # Phases 1–4 (US1) + Phase 5–6 (US2)
└── contracts/
    ├── openapi.yaml               # generated fragment: US1 routes + US2 approvals/clarifications routes
    ├── ui-workflow-detail-screen.md
    ├── ui-approval-center.md      # US2 screens
    └── decision-rules.md          # US2 pure rules + API behaviour
```

### Source Code (repository root)

```
packages/contracts/src/
├── decisions.ts            # ApproveRequest, RejectRequest, AnswerRequest, DecisionParams, ApprovalCenterQuery, Resolution, AlreadyResolvedProblem
├── approval-center.ts      # ApprovalCenterItem, ApprovalCenterSnapshot, ApprovalCenterDetail, AuditEventView, DecisionResult
├── decision-rules.ts       # pure: canDecide, requiresConfirmation, resultingState, decisionAllowed, orderApprovalCenter, answerIsValid (exported via read-model subpath)
├── ingest.ts               # + optional context/links (ApprovalUpsert), whyItMatters/options/links (ClarificationUpsert)
├── common.ts               # + PROBLEM_TYPES.alreadyResolved
└── openapi.ts              # + US2 paths and schemas in buildWorkflowDetailOpenApi
packages/contracts/tests/{decision-rules,schemas,openapi}.test.ts

packages/db/
├── migrations/0003_approval_center.sql
├── src/schema.ts           # + auditEvents, new columns
├── src/migrate.ts          # + 'audit_events' in RLS_TABLES
├── src/seed/{index,s500}.ts # + three showcase decision items; truncate audit_events
└── tests/schema.test.ts    # + 0003 assertions

apps/api/src/
├── services/decisions.ts        # approveApproval, rejectApproval, answerClarification
├── services/approval-center.ts  # listApprovalCenter, approvalCenterDetail
├── services/ingestion.ts        # + persist context/options/links
├── routes/approvals.ts          # GET /approvals, GET /approvals/:id, POST /approvals/:id/approve|reject
├── routes/clarifications.ts     # POST /clarifications/:id/answer
├── lib/problem.ts               # + alreadyResolved(resolution) with extension member
└── app.ts                       # register the two route plugins
apps/api/tests/{approval-center,decisions}.test.ts

apps/web/
├── app/(app)/approvals/page.tsx                 # list (server)
├── app/(app)/approvals/ApprovalCenterScreen.tsx # list (client)
├── app/(app)/approvals/[id]/page.tsx            # decision (server) — no longer renderRecord
├── app/(app)/approvals/[id]/ApprovalDecisionScreen.tsx
├── app/(app)/record-page.tsx, RecordStub.tsx    # removed if unused after this change
├── lib/api.ts                                   # + postJson helper if missing
└── tests/components/{approval-center,approval-decision}.test.tsx, tests/e2e/approval-center.spec.ts

docs/architecture.md   # §4 interaction landed, §5 audit_events, §8 layout
AGENTS.md              # routes list + openapi command note
```

**Structure Decision**: the existing monorepo; no new package, no new workspace script.

## Design System Compliance

- **Components used** (all existing, 1.2.0): `Topbar`, `PageMeta`, `Field`, `Select`, `TextArea`, `OptionRow`, `List`, `ListRow`, `Card`, `KeyValue`, `DecisionCard`, `ActionBar`, `Button` (saffron / primary / ghost / danger), `Notice`, `Pill`, `Mono`, `StatePill`, `RiskBadge`, `PanelBlock`, `AuditTable`. **No new component, CSS or token → no version bump, no CHANGELOG entry.**
- **Saffron rule (DR-02)**: list screen — none (rows are links); decision screen — exactly one of "Approve" / "Confirm approval" / "Submit answer" while the item is pending and the user may decide; none while the reject form is open, when the user may not decide, or once resolved.
- **Vocabulary mapping**: workflow state via `StatePill` (`WAITING_FOR_HUMAN`, `RUNNING`, `BLOCKED`, `CANCELLED` shown as pill words, never typed); risk via `RiskBadge`; "clarification" as a neutral `Pill`. The BLOCKED/CANCELLED choice in the reject form uses `OptionRow` labels rendered with `StatePill` so the words match everywhere.
- **Claims vs evidence (DR-03)**: agent-supplied `context` / `whyItMatters` render as plain body text under a labelled heading inside the Context card; the audit table is platform evidence.
- **States**: contract §4 — every one has a component and copy.
- **Accessibility verification**: component axe for both screens in every §7 state; Playwright page axe on the list and one decision screen; keyboard spec §5 (Tab order, Escape reverts steps, focus moves to the confirmation button / reason field / resolved notice); names asserted per §6.
- **UI performance budgets**: see Performance Goals.

## Complexity Tracking

_No constitution violations — nothing to justify._

## Post-Design Constitution Re-check

Re-evaluated after Phase 1 (research R11–R20, data-model §10–17, contracts/, quickstart §3):

| Principle | Re-check |
|-----------|----------|
| I | One source: Zod + pure rules → OpenAPI fragment (snapshot test) → API → web. `decision-rules.md` §1–10 map one-to-one onto exported functions and API behaviours. Migration mirrored in `schema.ts`; `db` test asserts columns, CHECKs and the append-only trigger. **PASS** |
| II | tasks.md Phase 5 lists the failing test before each implementation task; concurrency and role tests named for FR-015 / FR-032; the Independent Test is one Playwright spec. **PASS** |
| III | Every region in ui-approval-center.md §2–3 names an existing component; DR-02 holds in every state (§Design System Compliance); ten defined states; axe + keyboard contract. **PASS** |
| IV | Eight budgets with methods; list bounded to 200; single transaction per operation; `Server-Timing` on reads. **PASS** |

**Gate result (post-design)**: PASS.

---

# Part C — User Story 3 (Dashboard)

**Branch**: `feature/US3` (from `develop`; PR targets `develop`) | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md) — User Story 3 (lines 58–75), FR-023, plus FR-025 (project selector with "all projects"), FR-026 (HIGH/CRITICAL prominent), FR-034 (live propagation), FR-035 (header counts). Success criteria SC-002, SC-003, SC-007, SC-010. Other stories remain out of scope; in particular the Workflow Center (`/workflows` list) and review findings (US6) are **not** built here — approved scope decisions 1 and 2 in research.md Part C.

**Input**: research.md R21–R30, data-model.md §18–21, contracts/ui-dashboard.md, quickstart.md §4, tasks.md Phases 7–8.

## Summary

Replace the `/dashboard` placeholder with the **Dashboard**: one read-only screen that answers *what is happening* (active workflows, running agents, PRs generated, open failures, and a stage-1..7 pipeline), *what needs me* (pending approvals, pending clarifications, failed and blocked workflows — SC-002), *is engineering healthy* (test pass rate, agent success rate, human intervention rate for a selected window), *what is the AI doing* (≤ 12 active workflow cards with identifier, title, stage, progress, agent, elapsed time and state) and *is anything risky* (pending HIGH/CRITICAL approvals and HIGH/CRITICAL audit events in the window, plus an explicit "security findings — not connected yet" state). Every figure is a link to the filtered list behind it (FR-023); the project selector offers "All projects" (FR-025); the screen refetches on the existing `inbox.changed` stream (FR-034). Behind it, **one new read route** `GET /api/dashboard?project=all|<uuid>&window=24h|7d|30d` served by `services/dashboard.ts`: eight bounded aggregate statements in one `REPEATABLE READ` transaction over the existing tables, shaped by the pure `buildDashboardSnapshot()` in `@cdevi/contracts/dashboard-model`. **No new table**; migration `0004_dashboard.sql` adds five indexes for SC-007. The seed gains an administrator-only fifth project `dashboard-demo` that produces the Independent Test figures (18 / 4 / 2 / 97.4 %) without changing S-500. No design-system change.

## Technical Context

**Language/Version**: unchanged (TypeScript 5.9 strict, Node 26, React 19.2, ES modules)

**Primary Dependencies**: unchanged — nothing is added to any `package.json`. Web: Next.js 16 App Router (server first paint, client refresh). API: Fastify 5 + `fastify-type-provider-zod`. DB: hand-written SQL + Drizzle mirror. Contracts: zod 4 → OpenAPI 3.1; new zod-free subpath `@cdevi/contracts/dashboard-model` (package.json `exports` entry, like `/decision-rules`). Design system 1.3.0 (no bump — see Design System Compliance)

**Storage**: PostgreSQL 17. `0004_dashboard.sql`: **indexes only** — `test_runs_org_project_finished_idx`, `agent_runs_org_project_finished_idx` (partial `finished_at IS NOT NULL`), `audit_events_org_risk_time_idx` (partial `risk_level IN ('HIGH','CRITICAL')`), `approvals_workflow_idx`, `clarifications_workflow_idx` (data-model §18). No table, column, trigger, RLS or grant change; existing NOTIFY triggers are sufficient for FR-034

**Read model** (R22, R24): `services/dashboard.ts › dashboardSnapshot(client, scope, query, now)` — statements Q1–Q8 (workflow counts + pipeline + PRs; pending approvals incl. HIGH/CRITICAL; pending clarifications; test-run sums; agent-run outcomes; human-intervention numerator/denominator; HIGH/CRITICAL audit events; ≤ 12 active cards), all scoped by `organization_id` and `visibleProjects()`; the response is assembled by the pure `buildDashboardSnapshot(rows, now, window, project)` so every derivation (rates as numerator/denominator, pipeline names, progress, elapsed, hrefs) is unit-tested without a database and shared with the web. Route: `routes/dashboard.ts` (`GET /dashboard`, `preHandler: app.requireUser`, `DashboardQuery`, `Server-Timing`)

**Query**: `project` = `all` | uuid (default `all`; unknown/invisible uuid → zeros, like `GET /api/approvals`); `window` = `24h` | `7d` | `30d` (default `7d`), closed on `app.now()`; windowed figures are PRs generated, the three health rates and HIGH/CRITICAL audit events; all other figures are point-in-time (R21)

**Testing**: Vitest — `contracts` (pure model: window, hrefs, rates, pipeline, progress, ordering, snapshot invariants; Zod schemas; OpenAPI snapshot), `db` (0004 indexes present and used — `EXPLAIN` on Q4/Q5/Q7; seed `dashboard-demo` figures and `EXPECTED_DASHBOARD`; S-500 invariants unchanged), `api` (integration on real Postgres, fixed clock: every figure and href for `dashboard-demo`, `all` vs uuid vs invisible uuid per role, window switching, validation problems, `Server-Timing` at the SC-007 fixture of 500 workflows / 5 000 agent runs / 50 000 audit events inserted by the test with `generate_series`), `web` (component + axe in every ui-dashboard.md §4 state: loading, populated, empty, error, unavailable; project/window selects; refetch on `inbox.changed`; no saffron; HIGH/CRITICAL `RiskBadge`). Playwright `apps/web/tests/e2e/dashboard.spec.ts` = the Independent Test (administrator selects "Dashboard Demo": 18 / 4 / 2 / 97.4 % / not connected; every figure's link target; live update ≤ 5 s after an ingested transition; keyboard walk; page axe; initial content ≤ 2 s). Test names start with the FR/SC id; red → green order in tasks.md Phase 7

**Target Platform / Project Type**: unchanged (web app in the existing monorepo; CI `ci.yml` unchanged)

**Performance Goals** (Principle IV; workload = SC-007 organization: 500 workflows, 5 000 agent runs, 50 000 audit events, measured on CI `ubuntu-latest` with the Postgres service; and the seeded database for e2e). These set the budgets spec.md line 300 defers to the plan:
- Dashboard initial content (header counts and needs-me visible) ≤ 2 s p95 (SC-007) — Playwright trace over 10 runs in `dashboard.spec.ts`; server first paint carries the full snapshot
- `GET /api/dashboard` ≤ 300 ms p95 at the SC-007 fixture — `Server-Timing` asserted in `apps/api/tests/dashboard.test.ts` over 20 calls; eight index-backed statements, one transaction, no statement returns more than 12 rows
- Payload ≤ 8 KB (JSON, ≤ 12 cards) — asserted on `content-length` in the api test
- `inbox.changed` → refetched snapshot rendered ≤ 5 s p95, ≤ 1 s median (SC-003, FR-034) — `dashboard.spec.ts` measures the needs-me count after an ingested transition; debounce 300 ms; refetch re-render ≤ 100 ms (component test with fake timers)
- Needs-me area reflects a `WAITING_FOR_HUMAN`/`BLOCKED` entry ≤ 5 s (SC-002) — e2e ingests one transition of each kind and measures the needs-me counts
- Route JS ≤ 200 KB gzip (`check:size`; browser imports only `@cdevi/contracts/dashboard-model`, `/read-model`, `/vocabulary`)
- Active cards bounded to 12 (`ACTIVE_CARD_LIMIT`), pipeline fixed at 7 + unstaged, header counts fixed at 4 — no unbounded list anywhere on the screen
- Seed growth: `pnpm db:seed` and the e2e global-setup grow by 24 workflows / 43 stages / 44 runs / 6 test runs — < 5 % of S-500, no measurable change to the existing Inbox budgets (`perf:api` unchanged)

**Constraints**: **no saffron control on the Dashboard** (read-only screen; the one saffron action lives on the Approval Center the needs-me links open — R28); HIGH/CRITICAL rendered with `RiskBadge` wherever they appear (FR-026); every workflow state as a `StatePill` word; rates with a zero denominator render "—" with a reason, never `0 %`/`NaN`; "security findings" is a neutral not-connected state, never saffron or green; WCAG 2.2 AA; Problems without internals; `.env` never committed

**Scale/Scope**: 1 screen, 1 route, 1 index-only migration, 1 seed module, ~9 pure functions, ≈ 55 tests

## Constitution Check

| Principle | Check | Result |
|-----------|-------|--------|
| I — Specification and contracts first | `DashboardQuery`/`DashboardSnapshot` Zod schemas + pure model in `@cdevi/contracts` → OpenAPI fragment (snapshot-tested) → API validation → web types; ui-dashboard.md written before code; migration hand-written (indexes) and mirrored in `schema.ts` | PASS |
| II — Tests before behaviour | Every task in tasks.md Phase 7 has a failing test first; pure derivations tested without a DB; live suites identified (`db`, `api`, e2e); SC-007 fixture is a test, not a claim; fixed clock | PASS |
| III — Design system, defined states, accessibility | Every region maps to an existing component (below); §4 of the screen contract defines loading / populated / empty / error / unavailable / refreshing; axe in component tests and Playwright; keyboard/focus contract §5; no saffron on a screen without a direct action | PASS |
| IV — Performance budgets | Eight numeric budgets with measurement methods above; every list bounded; one transaction per read; indexes proven by `EXPLAIN` in a test | PASS |
| Security (constitution §Security) | Session auth on the route; project visibility via `visibleProjects`; invisible project → zeros (no existence leak); read-only (no writes, no CSRF surface); Problems carry no SQL/stack; seed data never grants memberships | PASS |

**Gate result (pre-design)**: PASS — no violations to justify.

## Project Structure

### Documentation (this feature)

```
specs/001-sdlc-control-plane-mvp/
├── plan.md              # Part A (US1) + Part B (US2) + Part C (US3, this section)
├── research.md          # R1–R10 (US1) + R11–R20 (US2) + R21–R30 (US3)
├── data-model.md        # §1–9 (US1) + §10–17 (US2) + §18–21 (US3)
├── quickstart.md        # §2 US1 + §3 US2 + §4 US3
├── tasks.md             # Phases 1–4 (US1) + 5–6 (US2) + 7–8 (US3)
└── contracts/
    ├── openapi.yaml               # generated fragment: US1 + US2 routes + GET /dashboard (regenerated in Phase 7a)
    ├── ui-workflow-detail-screen.md
    ├── ui-approval-center.md
    ├── decision-rules.md
    └── ui-dashboard.md            # US3 screen (NEW)
```

### Source Code (repository root) — NEW vs EXTENDED

```
packages/contracts/
├── src/dashboard.ts             # NEW: DashboardQuery, WindowKey, Figure, Rate, PipelineStage, ActiveWorkflowCard, DashboardSnapshot (Zod)
├── src/dashboard-model.ts       # NEW (zod-free): ACTIVE_STATES, SDLC_STAGES, ACTIVE_CARD_LIMIT, WINDOW_MS, windowFor, dashboardHrefs, ratePercent, stageProgress, elapsedMs, orderActiveCards, pipelineFrom, buildDashboardSnapshot
├── src/index.ts                 # EXTENDED: export * from './dashboard', './dashboard-model'
├── src/openapi.ts               # EXTENDED: GET /dashboard path + schemas in buildWorkflowDetailOpenApi (title "… (specs/001 US1–US3)", tag dashboard)
├── package.json                 # EXTENDED: exports["./dashboard-model"]
└── tests/dashboard-model.test.ts (NEW), tests/schemas.test.ts (EXTENDED), tests/openapi.test.ts (EXTENDED)

packages/db/
├── migrations/0004_dashboard.sql  # NEW: five indexes (data-model §18)
├── src/schema.ts                  # EXTENDED: index mirrors
├── src/seed/dashboard.ts          # NEW: buildDashboardShowcase(base), EXPECTED_DASHBOARD, DASHBOARD_PROJECT
├── src/seed/index.ts              # EXTENDED: insert dashboard-demo project + workflows/stages/runs/test runs after S-500; export EXPECTED_DASHBOARD
└── tests/schema.test.ts (EXTENDED: 0004), tests/seed.test.ts (EXTENDED: dashboard figures; DB totals include EXPECTED_DASHBOARD)

apps/api/
├── src/services/dashboard.ts    # NEW: dashboardSnapshot(client, scope, query, now) — Q1–Q8 + buildDashboardSnapshot
├── src/routes/dashboard.ts      # NEW: GET /dashboard
├── src/app.ts                   # EXTENDED: register dashboardRoutes; DashboardSnapshot in swagger components
└── tests/dashboard.test.ts      # NEW (incl. SC-007 fixture builder in tests/helpers.ts — EXTENDED)

apps/web/
├── app/(app)/dashboard/page.tsx           # NEW: server — cookie + ?window → apiFetch('/api/dashboard…')
├── app/(app)/dashboard/DashboardScreen.tsx # NEW: client — selects, regions, SSE refetch
├── app/(app)/[section]/page.tsx           # EXTENDED: drop the /dashboard fall-through
├── lib/session.ts                         # EXTENDED: getDashboardSnapshot(project, window) (cached, like getApprovalCenterSnapshot)
├── tests/fixtures/dashboard.ts            # NEW: typed DashboardSnapshot fixtures (populated / empty / zero-denominator)
├── tests/components/dashboard.test.tsx    # NEW
└── tests/e2e/dashboard.spec.ts            # NEW; tests/e2e/__screenshots__/00-inbox-visual.spec.ts/*.png REFRESHED (seed grew — R30)

docs/architecture.md   # EXTENDED: §4 Dashboard landed, §6 placeholder query contracts, §8 layout
AGENTS.md              # EXTENDED: GET /api/dashboard in "Backend and web app work"; dashboard-model subpath
```

**Structure Decision**: the existing monorepo; no new package, no new workspace script. `dashboard-demo` is seed data, not a fixture file.

## Design System Compliance

- **Components used** (all existing, 1.3.0): `Topbar`, `PageMeta`, `Field`, `Select`, `Pill`, `StatGrid`, `Stat`, `Card`, `List`, `ListRow`, `Bars`, `Meter`, `Mono`, `StatePill`, `RiskBadge`, `Notice`, `Button` (ghost only, for Retry / Show all). **No new component, CSS or token → no version bump, no CHANGELOG entry.** (R28 records why a `KpiTile` is not added.)
- **Saffron rule (DR-02)**: **none on the Dashboard**. The screen offers no direct human action — every needs-me figure is a link to the Approval Center or Workflow Center where the single saffron action lives. If a later story adds an inline "Approve" to a Dashboard card, that card must follow ui-approval-center.md §3.5 and the rule is re-evaluated then. Tests assert `.cd-saffron` count 0 in every state.
- **Vocabulary mapping**: workflow state on every card via `StatePill`; HIGH and CRITICAL via `RiskBadge` in the risk region labels and on cards whose workflow has a pending HIGH/CRITICAL approval (FR-026); stage names from `SDLC_STAGES`; the "live / reconnecting" `Pill variant="neutral"` as on the Inbox.
- **Claims vs evidence (DR-03)**: the Dashboard renders platform evidence only (counts, rates from `test_runs`/`agent_runs`, audit events). No agent `Message` is rendered; the "not connected yet" notice states the absence of evidence rather than a zero.
- **States**: contract §4 — loading, populated, empty (no workflows in scope), error (+ Retry), unavailable (security findings only), refreshing — each has a component and copy.
- **Accessibility verification**: component axe in every §4 state; Playwright page axe on the populated screen; keyboard contract §5 (Tab order through selects → figures → pipeline → cards; every figure is a real link with an accessible name that includes the figure and its label, e.g. "18 active workflows"); `Bars` carries a text summary; `Meter`s are labelled; names asserted per §6.
- **UI performance budgets**: see Performance Goals.

## Complexity Tracking

_No constitution violations — nothing to justify._ (The fifth seed project is data, not a new mechanism; the five indexes are the minimal SC-007 measure and are proven by a test.)

## Post-Design Constitution Re-check

Re-evaluated after Phase 1 (research R21–R30, data-model §18–21, contracts/ui-dashboard.md, quickstart §4):

| Principle | Re-check |
|-----------|----------|
| I | One source: Zod + pure model → OpenAPI fragment (snapshot test) → API → web. Every figure's definition (R24) and href (R25) is a pure function with a test; the SQL only counts. Indexes mirrored in `schema.ts`. **PASS** |
| II | tasks.md Phase 7 lists the failing test before each implementation task in every layer; the SC-007 fixture and `EXPLAIN` assertions are tests; the Independent Test is one Playwright spec; visual baseline refresh is an explicit task, not a side effect. **PASS** |
| III | Every region in ui-dashboard.md §2 names an existing component; DR-02 holds trivially (no saffron); six defined states; zero-denominator and not-connected states are explicit; axe + keyboard contract. **PASS** |
| IV | Eight budgets with methods; cards ≤ 12, pipeline fixed, one transaction, `Server-Timing`, payload bound. **PASS** |

**Gate result (post-design)**: PASS.

---

# Part D — User Story 4 (Requirements)

**Branch**: `feature/US4` (from `develop`; PR targets `develop`) | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md) — User Story 4 (Manage requirements and start workflows, P2), FR-007, FR-008, FR-009, FR-010, plus FR-002 (workflow/stage states and recorded transitions), FR-025 (project selector), FR-032 (roles on every action), FR-034 (live propagation), FR-036 (control plane triggers and observes agent runs). Success criteria SC-003, SC-007, SC-008, SC-010. Edge case: a linked Jira ticket deleted/closed externally flags the requirement and pauses the linked workflow in `BLOCKED`. Other stories remain out of scope — in particular the Workflow Center list page (`/workflows` stays the `[section]` placeholder) and the Integrations screen (`/integrations` stays the placeholder; US8) — approved scope decisions 1–3 in research.md Part D (R31).

**Input**: research.md R31–R45, data-model.md §22–§30, contracts/ui-requirements.md, quickstart.md §5, tasks.md Phases 9–10.

## Summary

Replace the `/requirements` placeholder and the `/requirements/new` stub with the **Requirements** screens — a bounded, filterable **list** (state / project / assignee, 50 per page, keyset cursor), a **detail** screen (business objective, the agent's analysis — acceptance criteria, AI-identified rules, open questions — every AI item visibly labelled, the requirement state as a word in a pill, the linked workflow, the role- and state-gated actions *Submit for analysis* / *Approve* / *Reject*) and a **create form** (title, business objective, optional acceptance criteria, within the selected project). Behind them, the **first migration that adds tables**: `0005_requirements.sql` creates `requirements`, `requirement_analysis_items` (criteria / rules / open questions with an `ai_generated` flag and a `source`), `requirement_transitions` (append-only), `integration_project_mappings`, adds `workflows.requirement_id` and extends `inbox_change_log` with a nullable `requirement_id` so requirement changes ride the existing `inbox_changed` NOTIFY → SSE path (FR-034). **Analysis is produced by the agent runtime, not the API** (decision 1): `POST /api/requirements/{id}/submit` moves `Draft → Analyzing` and the runtime delivers results through `PUT /api/ingest/requirements/{externalId}/analysis` (same principal auth, `observedAt` idempotency and `ingestion_log` conventions as `/api/ingest/*`); the state becomes `Ready` when there are no open questions, otherwise `Needs Clarification`. **Jira is inbound-only** (decision 2): `POST /api/integrations/jira/webhook` verifies an HMAC-SHA256 signature over the raw body with a constant-time compare (secret from `JIRA_WEBHOOK_SECRET`), maps the Jira project key through `integration_project_mappings`, creates/updates the requirement with `external_ref` (key + url), and on a deleted/closed issue flags the requirement and moves its active workflow to `BLOCKED`. **Approving a `Ready` requirement** reuses the US2 decision path (`SELECT … FOR UPDATE`, exactly once, `audit_events`, NOTIFY) and creates the workflow with its seven stages in one transaction, first stage `QUEUED` (FR-010, SC-008). "Appears in the Workflow Center" is verified through `/workflows/{id}`, the Dashboard active-workflow card and a new bounded **`GET /api/workflows`** list (decision 3). Requirement states are not workflow states: the design system gains `RequirementStatePill` (1.4.0) so DR-01 holds without app-side markup (R41).

## Technical Context

**Language/Version**: unchanged (TypeScript 5.9 strict, Node 26, React 19.2, ES modules)

**Primary Dependencies**: unchanged — nothing is added to any `package.json` except the new zod-free subpath `@cdevi/contracts/requirement-rules` (`exports` entry, like `/decision-rules`) and the design-system minor bump to **1.4.0** (`RequirementStatePill`, `requirementStateToPill`). HMAC uses `node:crypto` (`createHmac`, `timingSafeEqual`). The webhook route reads the raw body through Fastify's `addContentTypeParser(…, { parseAs: 'buffer' })` in an encapsulated plugin — no raw-body dependency

**Storage**: PostgreSQL 17. `0005_requirements.sql` (data-model §22): enums `requirement_state`, `requirement_source`, `analysis_item_kind`, `external_flag`; tables `requirements`, `requirement_analysis_items`, `requirement_transitions` (own `requirement_transitions_append_only()` trigger, per-table message like 0001/0003), `integration_project_mappings`; `ALTER TABLE workflows ADD COLUMN requirement_id uuid REFERENCES requirements(id) ON DELETE SET NULL` + partial unique index (one workflow per requirement in US4); `ALTER TABLE inbox_change_log ALTER COLUMN workflow_id DROP NOT NULL, ADD COLUMN requirement_id uuid`; one NOTIFY trigger `inbox_changed_requirements` on `requirements` only (`notify_requirement_changed()`; no trigger on `requirement_analysis_items` — R40); trigger `requirements_follow_workflow()` (`Approved → In Implementation → Completed` derived from the linked workflow's state — R33); indexes for the list filters (`requirements_state_idx` is full because the state filter accepts terminal states; the assignee index is partial); RLS policies and grants like 0001–0003 (enabling RLS stays with the `CDEVI_RLS` loop in `packages/db/src/migrate.ts`, whose `RLS_TABLES` gains the four tables); all mirrored in `packages/db/src/schema.ts`

**Requirement state machine** (R32, `@cdevi/contracts/requirement-rules`): `DRAFT → ANALYZING` (submit; creator roles), `NEEDS_CLARIFICATION → ANALYZING` (resubmit; creator roles), `ANALYZING | NEEDS_CLARIFICATION → READY | NEEDS_CLARIFICATION` (agent, analysis ingest), `READY → APPROVED` (approve; decider roles), `DRAFT | NEEDS_CLARIFICATION | READY → REJECTED` (reject; decider roles), `APPROVED → IN_IMPLEMENTATION → COMPLETED` (system, from the linked workflow). Roles: `canCreateRequirement` (engineer, approver, administrator) for create/submit; `canDecide` (approver, administrator) for approve/reject; viewer read-only (FR-032). The pure `requirementActions(state, role)` drives both API enforcement and web affordances

**Routes** (data-model §23–§26; all Problems are `application/problem+json`): `GET /requirements`, `POST /requirements`, `GET /requirements/{id}`, `POST /requirements/{id}/submit`, `POST /requirements/{id}/approve`, `POST /requirements/{id}/reject` (session, `preHandler: app.requireUser`); `PUT /ingest/requirements/{externalId}/analysis` (`app.requirePrincipal`); `POST /integrations/jira/webhook` (signature, no session); `GET /workflows` (session). `contracts/openapi.yaml` is regenerated in Phase 9a from `src/openapi.ts`

**Testing**: Vitest — `contracts` (Zod schemas incl. rejects; pure rules: transitions, actions per role × state, resulting state from analysis, cursor encode/decode, hrefs, Jira event mapping and ADF → text, signature helper; OpenAPI snapshot), `db` (0005 objects, RLS policies, grants, append-only trigger, follow-workflow trigger, `EXPLAIN` on the list filters; seed requirements and `EXPECTED_REQUIREMENTS`; S-500 / dashboard-demo invariants and the `audit_events = 0` seed assertions unchanged; exactly two existing `schema.test.ts` assertions — the `inbox_changed_%` trigger list and the 0004 `pg_tables` list — are updated for 0005's objects, quickstart §5.5), `api` (integration on real Postgres, fixed clock: every route × role × state, exactly-once approve under concurrency, one-transaction workflow creation with seven stages, ingest idempotency and `ingestion_log`, webhook signature (valid / wrong / missing / replayed) and event mapping, BLOCKED edge case, `GET /workflows` filters and cursor, `Server-Timing` at the SC-007 fixture), `web` (component + axe in every ui-requirements.md §5 state; role/state gating of actions; exactly one `.cd-saffron` where allowed and zero elsewhere; AI-generated labels; refetch on `inbox.changed`; design-system `RequirementStatePill` behaviour + axe + gallery). Playwright `apps/web/tests/e2e/requirements.spec.ts` = the Independent Test (create → submit → analysis with open questions → resubmit → analysis without → approve → workflow visible at `/workflows/{id}`, on the Dashboard and in `GET /api/workflows?requirement=`; list filters; live update ≤ 5 s; keyboard walk; page axe; initial content ≤ 2 s). Test names start with the FR/SC id; red → green order in tasks.md Phase 9

**Target Platform / Project Type**: unchanged (web app in the existing monorepo; CI `ci.yml` unchanged; `JIRA_WEBHOOK_SECRET` added to `.env.example` with a placeholder — never a real value)

**Performance Goals** (Principle IV; workload = SC-007 organization extended with 2 000 requirements / 20 000 analysis items; measured on CI `ubuntu-latest` with the Postgres service; and the seeded database for e2e):
- Requirements list initial content (filters + first rows visible) ≤ 2 s p95 (SC-007) — Playwright trace over 10 runs in `requirements.spec.ts`; server first paint carries the first page
- `GET /api/requirements` ≤ 200 ms p95 at the fixture — `Server-Timing` asserted over 20 calls; one index-backed statement + one count, one transaction, ≤ 50 rows
- `GET /api/requirements/{id}` ≤ 150 ms p95 — one `REPEATABLE READ` transaction, ≤ 6 statements, analysis items ≤ 120 rows, audit ≤ 20 rows
- `GET /api/workflows` ≤ 200 ms p95 at the SC-007 fixture (500 workflows) — `Server-Timing` over 20 calls; keyset on `workflows_list_idx`; ≤ 50 rows
- `POST …/approve` ≤ 300 ms p95 — one transaction: lock, 1 workflow + 7 stages + 8 transitions + 1 audit row
- Ingest analysis `PUT` ≤ 200 ms p95 for ≤ 120 items — one transaction, delete + batch insert
- Webhook ≤ 100 ms p95 excluding network — signature check O(body), one transaction
- `inbox.changed` → refetched list/detail rendered ≤ 5 s p95, ≤ 1 s median (SC-003, FR-034) — `requirements.spec.ts` measures the state pill after an ingested analysis; debounce 300 ms
- Payloads: list ≤ 40 KB (50 rows), detail ≤ 32 KB, workflow list ≤ 40 KB — asserted on `content-length`
- Route JS ≤ 200 KB gzip (`check:size`; browser imports only `@cdevi/contracts/requirement-rules`, `/vocabulary`, `/read-model`)
- Seed growth: 8 requirements, 28 analysis items, 1 mapping, 0 new workflows — no change to any Inbox, Approval Center or Dashboard figure (R44)

**Constraints**: at most one `Button variant="saffron"` per screen — list: none; detail: *Approve* (READY, decider) or *Resubmit for analysis* (NEEDS_CLARIFICATION, creator), otherwise none; create form: *Create requirement* (R41, ui-requirements.md §7); every requirement state a word in `RequirementStatePill`, every workflow state a `StatePill`; `Needs Clarification` (needs-you) is never hidden or collapsed; AI-generated items carry a visible "AI-generated" label and sit in `Message variant="summary"` (not evidence, DR-03); HIGH/CRITICAL nowhere on these screens (no risk vocabulary in US4); WCAG 2.2 AA; Problems without internals; webhook secret from the environment only; `.env` never committed

**Scale/Scope**: 3 screens, 9 routes (8 new + 1 ingest), 1 migration with 4 tables, 1 design-system component, ~14 pure functions, ≈ 95 tests

## Constitution Check

| Principle | Check | Result |
|-----------|-------|--------|
| I — Specification and contracts first | `Requirement*`, `WorkflowList*`, `JiraWebhookEvent`, `RequirementAnalysisIngest` Zod schemas + pure `requirement-rules` in `@cdevi/contracts` → OpenAPI fragment (snapshot-tested) → API validation → web types; ui-requirements.md written before code; `0005_requirements.sql` hand-written and mirrored in `schema.ts` | PASS |
| II — Tests before behaviour | Every task in tasks.md Phase 9 has a failing test first (9a–9e); pure rules tested without a DB; live suites identified (`db`, `api`, e2e); exactly-once and one-transaction properties are tests; fixed clock; signature tests use a test secret from the test env, never the repo | PASS |
| III — Design system, defined states, accessibility | Every region maps to a component (below); the missing pattern (`RequirementStatePill`) is added to the package per DESIGN.md §8 before it is consumed; §5 of the screen contract defines loading / populated / empty / error / submitting / disabled per screen; axe in component tests and Playwright; keyboard/focus contract §6; one saffron per screen justified in §7 | PASS |
| IV — Performance budgets | Eleven numeric budgets with measurement methods above; every list bounded to 50 with a keyset cursor; one transaction per read/write; indexes proven by `EXPLAIN` in a test | PASS |
| Security (constitution §Security) | Session auth + `visibleProjects` on every read; role checks on every mutating route (`canCreateRequirement`, `canDecide`); ingestion principal scoped to the project; webhook: HMAC over the raw body, `timingSafeEqual`, secret from env, unmapped keys ignored without leaking existence, body size capped at 256 KB, rate-limited; Problems carry no SQL/stack/body; Jira URLs rendered with `rel="noopener noreferrer"` and only `https:` accepted | PASS |

**Gate result (pre-design)**: PASS — no violations to justify.

## Project Structure

### Documentation (this feature)

```
specs/001-sdlc-control-plane-mvp/
├── plan.md              # Part A (US1) + Part B (US2) + Part C (US3) + Part D (US4, this section)
├── research.md          # R1–R10 (US1) + R11–R20 (US2) + R21–R30 (US3) + R31–R45 (US4)
├── data-model.md        # §1–9 (US1) + §10–17 (US2) + §18–21 (US3) + §22–30 (US4)
├── quickstart.md        # §2 US1 + §3 US2 + §4 US3 + §5 US4
├── tasks.md             # Phases 1–4 (US1) + 5–6 (US2) + 7–8 (US3) + 9–10 (US4)
└── contracts/
    ├── openapi.yaml               # generated fragment: US1–US3 routes + the nine US4 routes (regenerated in Phase 9a)
    ├── ui-workflow-detail-screen.md
    ├── ui-approval-center.md
    ├── decision-rules.md
    ├── ui-dashboard.md
    └── ui-requirements.md         # US4 screens (NEW)
```

### Source Code (repository root) — NEW vs EXTENDED

```
packages/contracts/
├── src/requirements.ts          # NEW: RequirementState, RequirementSource, ExternalFlag, ExternalRef, AnalysisItem, Requirement, RequirementDetail, RequirementListQuery, RequirementListPage, CreateRequirementRequest, RejectRequirementRequest, RequirementActions, RequirementIdParams (Zod)
├── src/workflow-list.ts         # NEW: WorkflowListQuery, WorkflowListItem, WorkflowListPage (Zod; FR-003 shape)
├── src/integrations.ts          # NEW: JiraWebhookEvent, JiraWebhookResult (Zod)
├── src/ingest.ts                # EXTENDED: RequirementAnalysisIngest, RequirementIngestResult
├── src/approval-center.ts       # EXTENDED: AUDIT_ACTIONS += requirement.submitted / approved / rejected / flagged / workflow_created
├── src/requirement-rules.ts     # NEW (zod-free): REQUIREMENT_STATES, REQUIREMENT_TRANSITIONS, canTransitionRequirement, requirementActions, stateAfterAnalysis, requirementStateForWorkflow, requirementHrefs, encodeRequirementCursor/decodeRequirementCursor, encodeWorkflowCursor/decodeWorkflowCursor, REQUIREMENTS_PAGE_SIZE, WORKFLOWS_PAGE_SIZE, mapJiraEvent, adfToPlainText, isSafeExternalUrl
├── src/index.ts                 # EXTENDED: export * from './requirements', './workflow-list', './integrations', './requirement-rules'
├── src/openapi.ts               # EXTENDED: nine paths + schemas (title "… (specs/001 US1–US4)", tags requirements, integrations, workflows)
├── package.json                 # EXTENDED: exports["./requirement-rules"]
└── tests/requirement-rules.test.ts (NEW), tests/schemas.test.ts (EXTENDED), tests/openapi.test.ts (EXTENDED)

packages/design-system/
├── css/components.css                                   # EXTENDED: none required — RequirementStatePill reuses .cd-pill variants (no new pair)
├── src/tokens.ts                                        # EXTENDED: RequirementState, REQUIREMENT_STATES, requirementStateToPill: Record<RequirementState, StatePresentation>
├── src/components/Pill/RequirementStatePill.tsx         # NEW
├── src/components/Pill/RequirementStatePill.test.tsx    # NEW (behaviour + expectAccessible)
├── src/index.ts                                         # EXTENDED: export RequirementStatePill
├── gallery/entries.tsx, tests/visual/entries.ts         # EXTENDED: requirement-state-pill entry
├── DESIGN.md                                            # EXTENDED: §3 row, §4 requirement-state table, §5 glossary row
├── CHANGELOG.md, package.json                           # EXTENDED: 1.4.0
└── specs/002-adopt-design-system/contracts/components.md # EXTENDED: RequirementStatePill

packages/db/
├── migrations/0005_requirements.sql   # NEW (data-model §22)
├── src/schema.ts                      # EXTENDED: enums, four tables, workflows.requirementId, inboxChangeLog.requirementId, indexes
├── src/migrate.ts                     # EXTENDED: RLS_TABLES += integration_project_mappings, requirements, requirement_analysis_items, requirement_transitions
├── src/seed/requirements.ts           # NEW: buildRequirements(base), EXPECTED_REQUIREMENTS, REQUIREMENT_SHOWCASE, JIRA_MAPPING
├── src/seed/index.ts                  # EXTENDED: TRUNCATE list; insert mapping + requirements + analysis items + transitions after dashboard-demo; link three S-500 workflows (requirement_id); export EXPECTED_REQUIREMENTS
└── tests/schema.test.ts (EXTENDED: 0005), tests/seed.test.ts (EXTENDED: requirements; S-500/dashboard totals unchanged)

apps/api/
├── src/services/requirements.ts        # NEW: listRequirements, requirementDetail, createRequirement, submitRequirement, approveRequirement (workflow + 7 stages), rejectRequirement
├── src/services/requirement-analysis.ts # NEW: ingestRequirementAnalysis (principal path, stale/accepted)
├── src/services/jira-webhook.ts        # NEW: verifyJiraSignature, handleJiraEvent (create/update/flag → BLOCKED)
├── src/services/workflow-list.ts       # NEW: listWorkflows (keyset)
├── src/routes/requirements.ts          # NEW: six session routes
├── src/routes/integrations.ts          # NEW: POST /integrations/jira/webhook (raw-body parser, encapsulated)
├── src/routes/ingest.ts                # EXTENDED: PUT /ingest/requirements/:externalId/analysis
├── src/routes/workflows.ts             # EXTENDED: GET /workflows
├── src/routes/inbox.ts, src/plugins/notify.ts # EXTENDED: InboxChange.requirementId (nullable) in NOTIFY parsing, replay and SSE frame
├── src/app.ts                          # EXTENDED: register requirementsRoutes, integrationsRoutes; schemas in swagger components
└── tests/requirements.test.ts, tests/ingest-requirements.test.ts, tests/jira-webhook.test.ts, tests/workflows-list.test.ts (NEW); tests/helpers.ts (EXTENDED: seedSc007Org grows requirements; signJira)

apps/web/
├── app/(app)/requirements/page.tsx                    # NEW: server — cookie + filters → apiFetch('/api/requirements…')
├── app/(app)/requirements/RequirementsListScreen.tsx  # NEW: client — filters, list, cursor, SSE refetch
├── app/(app)/requirements/[id]/page.tsx               # NEW
├── app/(app)/requirements/[id]/RequirementDetailScreen.tsx # NEW: client — analysis, actions, SSE refetch
├── app/(app)/requirements/new/page.tsx                # REPLACED: the stub becomes the create form page
├── app/(app)/requirements/new/CreateRequirementForm.tsx # NEW: client — validation, submit, redirect to /requirements/{id}
├── lib/navigation.ts                                  # EXTENDED: BUILT_SECTIONS += '/requirements'
├── lib/session.ts                                     # EXTENDED: getRequirementList(filters), getRequirementDetail(id) (cached)
├── lib/inbox-stream.ts                                # EXTENDED: `requirementId` filter option (frameId(data, key))
├── lib/ds.ts                                          # EXTENDED: re-export RequirementStatePill
├── tests/fixtures/requirements.ts                     # NEW: typed RequirementListPage / RequirementDetail fixtures per state
├── tests/components/requirements-list.test.tsx, requirement-detail.test.tsx, requirement-create.test.tsx # NEW
├── tests/components/new-requirement.test.tsx          # UNCHANGED (Inbox button)
└── tests/e2e/requirements.spec.ts                     # NEW; tests/e2e/inbox-a11y.spec.ts UNCHANGED (/requirements/new still axe-clean)

docs/architecture.md   # EXTENDED: §4 Requirements landed, §6 requirements/integrations query contracts, §8 layout
AGENTS.md              # EXTENDED: US4 routes in "Backend and web app work"; requirement-rules subpath; JIRA_WEBHOOK_SECRET
.env.example           # EXTENDED: JIRA_WEBHOOK_SECRET=change-me (placeholder)
```

**Structure Decision**: the existing monorepo; no new package, no new workspace script. The requirements seed is data in `packages/db/src/seed/requirements.ts`, not a fixture file. The webhook lives under `routes/integrations.ts` so US8 (Integrations screen, outbound Jira) extends the same module.

## Design System Compliance

- **Components used** (1.3.0 → 1.4.0): `Topbar`, `PageMeta`, `Crumbs`, `Field`, `Select`, `Input`, `TextArea`, `Help`, `ActionBar`, `Button` (`primary`, `ghost`, `saffron`), `Card`, `List`, `ListRow`, `KeyValue`, `Pill`, `StatePill`, `Message` (`variant="summary"`), `Notice`, `Mono`, `AuditTable`, **`RequirementStatePill` (NEW)**.
- **Components proposed**: `RequirementStatePill` — `StatePill` is typed on `WorkflowState` and its words/pulse are normative for workflow states only; requirement states have their own DESIGN.md §4 mapping (`Needs Clarification` → needs-you, `Analyzing`/`In Implementation` → run, `Approved`/`Completed` → done, `Rejected` → fail, `Draft`/`Ready` → neutral). Rendering `Pill` with an app-side switch would put vocabulary in the app (against `tokens.ts` being the single mapping) and miss the pulse rule. Added per DESIGN.md §8: no new CSS (existing `.cd-pill` variants), `requirementStateToPill: Record<RequirementState, StatePresentation>` in `src/tokens.ts` (same shape as `stateToPill`), component + test + gallery entry + §3/§4/§5 rows + CHANGELOG 1.4.0 (R41). Lives in tasks 9d.
- **Saffron rule (DR-02)**: list — none (no direct action; "New requirement" is a `primary` link here because the Inbox already carries the saffron entry point). Detail — exactly one when a person is needed: *Approve* when `READY` and `canDecide`; *Resubmit for analysis* when `NEEDS_CLARIFICATION` and `canCreateRequirement`; otherwise none (*Submit for analysis* on a `DRAFT` is `primary`, *Reject* is `ghost`, disabled actions carry `ActionBar help`). Create form — *Create requirement* is the single saffron control (the action that turns a person's input into new work; the Inbox's "New requirement" that leads here is saffron for the same reason). Tests assert `.cd-saffron` count per state (ui-requirements.md §7).
- **Vocabulary mapping**: requirement state via `RequirementStatePill` everywhere (list rows, detail header, live updates); linked workflow state via `StatePill`; `Needs Clarification` is never collapsed; no risk vocabulary on these screens.
- **Claims vs evidence (DR-03)**: AI-generated acceptance criteria, rules and open questions render inside `Message who="{agent} · analysis" variant="summary"` (labelled "not evidence") with a `Pill variant="neutral"` "AI-generated" on every AI item; human-authored acceptance criteria render in a plain `Card` list with the author's name; the platform facts (state, dates, decider, linked workflow) render as `KeyValue` and are never inside a `Message`.
- **States**: contract §5 — list: loading / populated / empty (with and without filters) / error (+ Retry); detail: loading / populated / not-available / submitting (`aria-busy`) / action-disabled (with help) / error; create: idle / invalid (field errors) / submitting / error — each with a component and copy.
- **Accessibility verification**: component axe in every §5 state; Playwright page axe on the three screens; keyboard contract §6 (Tab order filters → rows → pager; row title is the link; actions reachable; focus moves to the field error on invalid submit and to the `Notice` on error); names asserted per §8.
- **UI performance budgets**: see Performance Goals.

## Complexity Tracking

| Item | Why it is needed | Simpler alternative rejected because |
|------|------------------|--------------------------------------|
| `inbox_change_log.workflow_id` becomes nullable + `requirement_id` column | FR-034: an analysis arriving must reach the open Requirement Detail without a page refresh; the only live channel is `inbox_changed` | A second NOTIFY channel would duplicate the LISTEN client, replay table and SSE endpoint; polling would break SC-003 |
| Trigger `requirements_follow_workflow()` | `Approved → In Implementation → Completed` must follow the linked workflow whoever writes it (ingestion, US2 decisions, US1 actions) | Calling a service from three writers couples 9c to every existing path and can be forgotten by the next writer |
| Design-system minor (1.4.0) | DR-01 for requirement states; DESIGN.md §4 already prescribes the mapping | App-side `Pill` switch violates DR-09/`tokens.ts` single-mapping rule (R41) |

## Post-Design Constitution Re-check

Re-evaluated after Phase 1 (research R31–R45, data-model §22–§30, contracts/ui-requirements.md, quickstart §5):

| Principle | Re-check |
|-----------|----------|
| I | One source: Zod + pure `requirement-rules` → OpenAPI fragment (snapshot test) → API → web. Every transition, action gate, resulting state, cursor and href is a pure function with a test; the SQL only stores and lists. Migration mirrored in `schema.ts`. **PASS** |
| II | tasks.md Phase 9 lists the failing test before each implementation task in every layer (9a–9e); exactly-once approve, one-transaction creation, ingest idempotency, signature verification and the BLOCKED edge case are tests; the Independent Test is one Playwright spec; seed invariants of US1–US3 are asserted unchanged. **PASS** |
| III | Every region in ui-requirements.md §2–§4 names a component; the one missing pattern is added to the package first (9d, DESIGN.md §8); DR-02 justified per screen and per state in §7; defined states in §5; axe + keyboard contract. **PASS** |
| IV | Eleven budgets with methods; lists ≤ 50 with cursors, analysis items ≤ 120, audit ≤ 20; one transaction per operation; indexes proven by `EXPLAIN`. **PASS** |

**Gate result (post-design)**: PASS.
