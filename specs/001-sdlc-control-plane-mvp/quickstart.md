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
3. **API** — `apps/api/tests/workflow-detail.test.ts`, `ingest.test.ts` (stage/run/artifact/test-run), `stream.test.ts` (new tables notify) fail → routes and services.
4. **Web** — `apps/web/tests/components/workflow-detail.test.tsx` (+ axe per state) fails → `WorkflowDetailScreen`, `page.tsx`, `workflow-stream.ts`.
5. **E2E** — `workflow-detail-journey`, `-freshness`, `-keyboard`, `-a11y` fail → wire-up until green.

### 2.2 Automated evidence

```bash
pnpm check        # lint, stylelint, typecheck, cd- class scan, all Vitest projects (contracts, db, web, …), size
pnpm test:api     # Vitest projects db + api against real Postgres (DATABASE_URL required)
pnpm test:e2e     # Playwright: apps/web/tests/e2e/workflow-detail-*.spec.ts + the 003 specs
```

Every US1 test name starts with the id it proves. The acceptance scenarios map to:

| Scenario | Proven by |
|----------|-----------|
| 1 — pipeline, current stage, agent, elapsed, activity description, progress (FR-001/FR-003/FR-004) | `contracts: FR-001 …`, `api: FR-001 GET /workflows/:id returns ordered stages …`, `web: FR-001 renders pipeline …`, `e2e: FR-001 workflow detail shows the ordered pipeline …` |
| 2 — ordered activity, every artifact tagged with its stage (FR-004) | `contracts: FR-004 orderActivity …`, `FR-004 groupArtifactsByStage …`, `api: FR-004 …`, `web: FR-004 …`, `e2e: FR-004 …` |
| 3 — WAITING_FOR_HUMAN / BLOCKED prominent, reason, direct action, never hidden (FR-005) | `contracts: FR-005 deriveAttention …`, `web: FR-005 …`, `e2e: FR-005 …` |
| 4 — change visible ≤ 5 s without refresh (FR-034 / SC-003) | `api: FR-034 stage change emits inbox.changed …`, `e2e: SC-003 stage transition appears within 5 s …` |
| 5 — failure reason, failing stage, last successful stage, retry/escalate/cancel (FR-006) | `contracts: FR-006 deriveFailure …`, `FR-006 allowedActions …`, `api: FR-006 …`, `web: FR-006 …`, `e2e: FR-006 …` |

### 2.3 Independent Test — the eight supervision questions (SC-001)

Seed data alone must let a user with no prior context answer all eight from Workflow Detail. Sign in as the **engineer** printed by `pnpm db:seed`, open **Inbox → Needs you → "Add rate limiting to /api/auth"** (`s500-001`; the approval record shows an **Open workflow** link) → `/workflows/<id>`. Failed and blocked rows in Needs you link to `/workflows/<id>` directly.

| # | Question | Where the answer is on the page (contract §2) |
|---|----------|-----------------------------------------------|
| 1 | What is the agent doing? | 2.7 Current stage card — agent, model, elapsed; `Message` summary "Waiting for a human decision on the approval…" |
| 2 | Why is it doing it? | 2.4 needs-you card reason (the approval's ask) and the **requirement spec** artifact in 2.9 |
| 3 | What changed? | 2.9 **code diff** artifact ("Stage 4 · Implementation") and the implementation-plan artifact |
| 4 | What evidence exists? | 2.10 Test runs (platform evidence) + 2.9 **test results** artifact |
| 5 | What was tested? | 2.10 rows: unit, integration, e2e, accessibility with pass/fail counts |
| 6 | What failed? | 2.8 Activity: "Testing failed — 3 unit tests failing" → "Retrying" → "Testing completed"; the first unit run row shows **failed** |
| 7 | What needs approval? | 2.4 `DecisionCard` "Review — needs you" with the saffron **Review approval** link |
| 8 | What happens next? | 2.7 "Next stage: 7. PR" and the pipeline's `queued` PR step |

Then open `s500-045` ("… failed at Testing") from **Needs you**: 2.5 shows Reason "3 unit tests failing", Failed at "Stage 5 · Testing", Last successful stage "Stage 4 · Implementation", Retry/Escalate/Cancel enabled for the engineer (disabled with the help text for the viewer).

### 2.4 Manual live-update check (matches `workflow-detail-freshness.spec.ts`)

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
| LCP ≤ 2 s p95 | `workflow-detail-journey.spec.ts` logs LCP for the showcase workflow |
| `GET /api/workflows/{id}` ≤ 150 ms p95 | `apps/api/tests/workflow-detail.test.ts` reads `Server-Timing` over 20 calls |
| change → DOM ≤ 5 s p95 | `workflow-detail-freshness.spec.ts`, 5 iterations |
| payload ≤ 96 KB worst case | api test with an ingested 200-event workflow |
| route JS ≤ 200 KB gzip | `pnpm check:size` |

### 2.6 Definition of done for US1

- `pnpm check`, `pnpm test:api`, `pnpm test:e2e` green; every US1 test named by FR/SC id.
- §2.3 answered from seed alone; §2.4 observed.
- `docs/architecture.md` §4/§8 and `AGENTS.md` mention the new routes; no design-system change was needed (plan: Design System Compliance).
