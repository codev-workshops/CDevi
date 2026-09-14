# Implementation Plan: SDLC Control Plane MVP — User Story 1 (Workflow Detail)

**Branch**: `feature/US1` | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md) — User Story 1 only

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
