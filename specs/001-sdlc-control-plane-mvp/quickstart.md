# Quickstart: SDLC Control Plane MVP — run and verify

**Feature**: 001-sdlc-control-plane-mvp | **Plan**: [plan.md](plan.md) (User Story 1) | Contracts: [openapi.yaml](contracts/openapi.yaml), [ui-workflow-detail-screen.md](contracts/ui-workflow-detail-screen.md)

This is the evidence guide: what to run, in what order, and what must be true. Later user stories append their own sections.

## 1. Prerequisites

Same as `specs/003-inbox-home/quickstart.md` §1: Node 26 (`nvm use`), pnpm 10, Docker for PostgreSQL 17, `.env` copied from `.env.example`.

```bash
docker compose up -d postgres
pnpm i --frozen-lockfile
pnpm db:migrate            # applies 0001_init.sql and 0002_workflow_detail.sql (idempotent)
pnpm db:seed               # S-500 + the two US1 showcase workflows (research R8); prints demo credentials once
pnpm dev                   # api :3001, web :3000
```

## 2. User Story 1 — Workflow Detail

### 2.1 Red → green order (Principle II)

1. **Contracts** — `packages/contracts/tests/workflow-detail.test.ts` (pure derivations, data-model.md §6) and the ingestion/action schema examples in `schemas.test.ts` fail → implement `workflow-detail.ts`, `workflow-detail-model.ts`, `ingest.ts` extensions → `openapi.test.ts` fragment snapshot fails until `pnpm -F @cdevi/contracts openapi` regenerates `contracts/openapi.yaml`.
2. **DB** — `packages/db/tests/schema.test.ts › migration 0002` asserts tables, columns, indexes, triggers, immutability; `seed.test.ts › showcase` asserts determinism and the Independent-Test invariants → write `0002_workflow_detail.sql`, `schema.ts`, seed.
3. **API** — `apps/api/tests/workflows.test.ts` (read model, actions, role gating) and `ingest-detail.test.ts` (stage/run/artifact/test-run, immutability, notify) fail → `routes/workflows.ts`, `routes/ingest.ts`, `services/workflow-detail.ts`, `services/workflow-actions.ts`, `services/ingestion.ts`.
4. **Web** — `apps/web/tests/components/workflow-detail.test.tsx` (+ axe per state) fails → `WorkflowDetailScreen.tsx`, `page.tsx`, the `workflowId` filter in `lib/inbox-stream.ts`.
5. **E2E** — `apps/web/tests/e2e/workflow-detail.spec.ts` (journey, prominence, failure + keyboard, viewer, ≤ 5 s live update, safe 404, page-level axe) fails → wire-up until green.

### 2.2 Automated evidence

```bash
pnpm check        # lint, stylelint, typecheck, cd- class scan, all Vitest projects (contracts, db, web, …), size
pnpm test:api     # Vitest projects db + api against real Postgres (DATABASE_URL required)
pnpm test:e2e     # Playwright: apps/web/tests/e2e/workflow-detail.spec.ts + the 003 specs
```

Every US1 test name starts with the id it proves. The acceptance scenarios map to:

| Scenario | Proven by |
|----------|-----------|
| 1 — pipeline, current stage, agent, elapsed, activity description, progress (FR-001/FR-003/FR-004) | `packages/contracts/tests/workflow-detail.test.ts › FR-001 …`, `apps/api/tests/workflows.test.ts › FR-001 …`, `apps/web/tests/components/workflow-detail.test.tsx › FR-001 FR-003 …`, `apps/web/tests/e2e/workflow-detail.spec.ts › FR-001 FR-003 FR-004 …` |
| 2 — ordered activity, every artifact tagged with its stage (FR-004) | `contracts › FR-004 …`, `api workflows.test.ts › FR-004 …`, `web component › FR-004 …`, `e2e › FR-001 FR-003 FR-004 …` |
| 3 — WAITING_FOR_HUMAN / BLOCKED prominent, reason, direct action, never hidden (FR-005) | `contracts › FR-005 …`, `api workflows.test.ts › FR-005 …`, `web component › FR-005 …`, `e2e › FR-005 …` |
| 4 — change visible ≤ 5 s without refresh (FR-034 / SC-003) | `api ingest-detail.test.ts › FR-034 …`, `web component › FR-034 …`, `e2e › FR-034 SC-003 …` |
| 5 — failure reason, failing stage, last successful stage, retry/escalate/cancel (FR-006) | `contracts › FR-006 …`, `api workflows.test.ts › FR-006 …`, `web component › FR-006 …`, `e2e › FR-006 …` (engineer + viewer) |

### 2.3 Independent Test — the eight supervision questions (SC-001)

Seed data alone must let a user with no prior context answer all eight from Workflow Detail. Sign in as the **engineer** printed by `pnpm db:seed`, open **Inbox → Needs you → "Add rate limiting to /api/auth"** (`s500-001`; the approval record shows an **Open workflow** link) → `/workflows/<id>`. Failed and blocked rows in Needs you link to `/workflows/<id>` directly.

| # | Question | Where the answer is on the page (contract §2) |
|---|----------|-----------------------------------------------|
| 1 | What is the agent doing? | 2.7 Current stage card — agent, model, elapsed; `Message` summary "… Review is waiting for a human decision. …" (agent claim, not evidence) |
| 2 | Why is it doing it? | 2.4 needs-you card reason (the approval's ask) and the **requirement spec** artifact in 2.9 |
| 3 | What changed? | 2.9 **code diff** artifact ("Stage 4 · Implementation") and the implementation-plan artifact |
| 4 | What evidence exists? | 2.10 Test runs (platform evidence) + 2.9 **test results** artifact |
| 5 | What was tested? | 2.10 rows: unit, integration, e2e, accessibility with pass/fail counts |
| 6 | What failed? | 2.8 Activity: "Testing failed — 3 unit tests failing" → "Retrying" → "Testing completed"; the first unit run row shows **failed** |
| 7 | What needs approval? | 2.4 `DecisionCard` "Review — needs you" with the saffron **Review approval** link |
| 8 | What happens next? | 2.7 "Next stage: 7. PR" and the pipeline's `queued` PR step |

Then open `s500-045` ("… failed at Testing") from **Needs you**: 2.5 shows Reason "3 unit tests failing", Failed at "Stage 5 · Testing", Last successful stage "Stage 4 · Implementation", Retry/Escalate/Cancel enabled for the engineer (disabled with the help text for the viewer).

### 2.4 Manual live-update check (matches `workflow-detail.spec.ts › FR-034 SC-003`)

With `s500-045` open, transition its stage 5 from a second terminal (token printed by the seed):

```bash
curl -s -X PUT http://localhost:3001/api/ingest/workflows/s500-045/stages/5 \
  -H "authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Testing","state":"RETRYING","observedAt":"'"$(date -u +%FT%TZ)"'","reason":"Retry requested"}'
```

Within 5 s and without reloading: the Testing step's pill reads **retrying**, the failure panel disappears, and Activity gains the transition row.

### 2.5 Performance budgets (Principle IV)

| Budget | Method |
|--------|--------|
| LCP ≤ 2 s p95 | manual: Chrome Performance panel on the showcase workflow (no automated gate yet) |
| `GET /api/workflows/{id}` ≤ 150 ms p95 | manual: `time curl` against a local API with the seed loaded |
| change → DOM ≤ 5 s | `workflow-detail.spec.ts › FR-034 SC-003` (asserts inside a 5 s window) |
| payload bounded | activity and artifact lists are capped server-side (`services/workflow-detail.ts`) |
| route JS ≤ 200 KB gzip | `pnpm check:size` |

### 2.6 Definition of done for US1

- `pnpm check`, `pnpm test:api`, `pnpm test:e2e` green; every US1 test named by FR/SC id.
- §2.3 answered from seed alone; §2.4 observed.
- `docs/architecture.md` §4/§8 and `AGENTS.md` mention the new routes; no design-system change was needed (plan: Design System Compliance).

## 3. User Story 2 — Approval Center

**Plan**: [plan.md Part B](plan.md) | Contracts: [openapi.yaml](contracts/openapi.yaml) (approvals / clarifications routes), [decision-rules.md](contracts/decision-rules.md), [ui-approval-center.md](contracts/ui-approval-center.md) | Branch `feature/US2` → PR into `develop`.

### 3.1 Red → green order (Principle II)

1. **Contracts** — `packages/contracts/tests/decision-rules.test.ts` (pure rules, decision-rules.md §1–§7) and the `ApproveRequest` / `RejectRequest` / `AnswerRequest` / ingestion-extension examples in `schemas.test.ts` fail → implement `decision-rules.ts`, `decisions.ts`, `approval-center.ts`, `ingest.ts` extensions → `openapi.test.ts` fails until `pnpm -F @cdevi/contracts openapi` regenerates `contracts/openapi.yaml`.
2. **DB** — `packages/db/tests/schema.test.ts › migration 0003` asserts the new columns, CHECKs, `audit_events`, its append-only trigger, RLS and grants; `seed.test.ts › decision showcase` asserts the three Independent-Test items → write `0003_approval_center.sql`, `schema.ts`, seed.
3. **API** — `apps/api/tests/approval-center.test.ts` (list order, project scope, detail, 404s, `Server-Timing`) and `decisions.test.ts` (approve / confirm / reject / answer, roles, persistence, transition + audit rows, `inbox_change_log`, two concurrent callers) fail → `services/decisions.ts`, `services/approval-center.ts`, `routes/approvals.ts`, `routes/clarifications.ts`, `lib/problem.ts`, ingestion context fields.
4. **Web** — `apps/web/tests/components/approval-center.test.tsx` and `approval-decision.test.tsx` (+ axe per state) fail → `ApprovalCenterScreen.tsx`, `ApprovalDecisionScreen.tsx`, the two `page.tsx`, removal of the approvals record stub.
5. **E2E** — `apps/web/tests/e2e/approval-center.spec.ts` (Independent Test, ≤ 5 s header count, keyboard confirmation, viewer, page axe) fails → wire-up until green.

### 3.2 Automated evidence

```bash
pnpm check        # includes contracts (decision rules, schemas, OpenAPI snapshot) and web (component + axe)
pnpm test:api     # db (0003 shape, seed) + api (approval-center, decisions incl. concurrency and roles)
pnpm test:e2e     # Playwright: approval-center.spec.ts + the US1 and 003 specs
```

| Scenario | Proven by |
|----------|-----------|
| 1 — one list: identifier, ask, requester, time, risk; highest risk then oldest (FR-011) | `contracts › FR-011 orderApprovalCenter …`, `api approval-center.test.ts › FR-011 …`, `web approval-center.test.tsx › FR-011 …`, `e2e › FR-011 …` |
| 2 — question, why it matters, links, option or free text (FR-014) | `contracts › FR-014 answerIsValid …`, `api approval-center.test.ts › FR-014 detail …`, `web approval-decision.test.tsx › FR-014 …`, `e2e › FR-014 …` |
| 3 — answer recorded with author + time, workflow leaves WAITING_FOR_HUMAN, appears in record and audit (FR-014, FR-029) | `api decisions.test.ts › FR-014 …`, `› FR-029 …`, `web › FR-014 resolved …`, `e2e › FR-014 FR-029 …` |
| 4 — HIGH/CRITICAL approve requires explicit confirmation restating action + risk (FR-013) | `contracts › FR-013 requiresConfirmation`, `api decisions.test.ts › FR-013 …`, `web › FR-013 …`, `e2e › FR-013 …` |
| 5 — reject requires reason; BLOCKED or CANCELLED; agent run records it (FR-012, FR-013) | `contracts › FR-013 RejectRequest …`, `api decisions.test.ts › FR-013 reject …`, `web › FR-013 reject …`, `e2e › FR-013 …` |
| 6 — header shows pending count linking to the Approval Center (FR-011, FR-034) | `api decisions.test.ts › FR-034 …`, `web app-shell tests (existing) + approval-center.test.tsx › FR-011 …`, `e2e › FR-034 SC-003 …` |
| Edge — two users, first writer wins, second sees the outcome (FR-015) | `api decisions.test.ts › FR-015 …`, `web approval-decision.test.tsx › FR-015 already resolved …` |
| Roles — engineer/viewer refused (FR-032) | `contracts › FR-032 canDecide`, `api decisions.test.ts › FR-032 …`, `web › FR-032 permission-disabled …`, `e2e › FR-032 viewer …` |

### 3.3 Independent Test (spec US2)

Automated as `apps/web/tests/e2e/approval-center.spec.ts`; by hand against `pnpm dev`:

1. Sign in as the **approver** printed by `pnpm db:seed`. The header "Approvals" item shows the pending count.
2. Ingest three items on three `WAITING_FOR_HUMAN` workflows (token printed by the seed) — or use the seeded ones: `s500-apr-req` (requirement approval, LOW), `s500-apr-pr` (PR merge, MEDIUM), `s500-clr-01` (clarification):

```bash
curl -s -X PUT localhost:3001/api/ingest/approvals/it-req -H "authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"workflowExternalId":"s500-003","ask":"Approve requirement spec","riskLevel":"LOW","requestedByAgent":"spec-agent","requestedAt":"'"$(date -u +%FT%TZ)"'"}'
curl -s -X PUT localhost:3001/api/ingest/approvals/it-pr -H "authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"workflowExternalId":"s500-005","ask":"Approve PR merge #212","riskLevel":"MEDIUM","requestedByAgent":"pr-agent","requestedAt":"'"$(date -u +%FT%TZ)"'","links":{"pullRequest":"https://github.com/acme/api/pull/212"}}'
curl -s -X PUT localhost:3001/api/ingest/clarifications/it-clr -H "authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"workflowExternalId":"s500-007","question":"Which auth provider?","requestedByAgent":"spec-agent","requestedAt":"'"$(date -u +%FT%TZ)"'","whyItMatters":"Determines the SDK and the session model.","options":[{"value":"oidc","label":"OIDC","recommended":true},{"value":"saml","label":"SAML","recommended":false}],"links":{"externalTicket":"https://jira.example/PLAT-42"}}'
```

3. Open **Approvals**. The list shows the MEDIUM PR merge before the LOW requirement approval, and the clarification last (§3 of decision-rules.md).
4. Open the requirement approval → **Approve** (one click, LOW). The resolved notice appears; Workflow Detail for `s500-003` shows `running`.
5. Open the PR-merge approval → **Approve** (one click, MEDIUM) — same outcome for `s500-005`. (Open a HIGH item to see the **Confirm approval** step restating the ask and risk.)
6. Open the clarification → pick **OIDC** (recommended) → **Submit answer**. The notice reads "Answered by <you> just now", the Audit panel gains `clarification.answered`, and `s500-007` shows `running`.
7. The header count dropped by three without a reload. Each of the three workflows is no longer `WAITING_FOR_HUMAN`.

Concurrency check: open the same pending approval in two browsers (approver and administrator) and approve in both — the second shows "Already resolved — approved by … just now" and no controls.

### 3.4 Performance budgets (plan Part B)

| Budget | Method |
|--------|--------|
| Initial content ≤ 2 s p95 | Playwright trace, 10 runs (`approval-center.spec.ts`) |
| `GET /api/approvals` ≤ 200 ms p95, `GET /api/approvals/{id}` ≤ 150 ms p95, decision POST ≤ 250 ms p95 | `Server-Timing` / duration asserted in the api tests over 20 calls |
| Decision → header count ≤ 5 s p95 | e2e measures after each of the three decisions |
| Route JS ≤ 200 KB gzip | `pnpm check:size` |
