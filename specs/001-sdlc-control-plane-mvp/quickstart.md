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

---

## 4. User Story 3 — Dashboard

### 4.1 Prerequisites

Same as §3.1: `.env`, `docker compose up -d`, `pnpm db:migrate` (now applies `0004_dashboard.sql`, indexes only), `pnpm db:seed`, `pnpm dev`. The seed prints the demo credentials once; the Dashboard Independent Test uses the **administrator** (`admin@cdevi.demo`) because the `Dashboard Demo` project has no memberships and is visible only through the administrator rule.

### 4.2 Independent Test (spec lines 62–63)

Automated as `apps/web/tests/e2e/dashboard.spec.ts` (`FR-023 …`, `SC-007 …`, `SC-010 …`); by hand:

1. Sign in as the administrator. Open **Dashboard** (nav). The screen renders server-side with **All projects** and **Last 7 days**.
2. In the **Project** select choose **Dashboard Demo**. Every figure refetches (`GET /api/dashboard?project=<uuid>&window=7d`) and the screen shows:

| Region | Figure | Expected | Link opens |
|--------|--------|----------|------------|
| Header | active workflows | **18** | `/workflows?state=QUEUED,RUNNING,RETRYING,WAITING,WAITING_FOR_HUMAN,BLOCKED,FAILED` |
| Header | running agents | 7 | `/workflows?state=RUNNING,RETRYING` |
| Header | PRs generated · Last 7 days | 6 | `/workflows?hasPr=true&window=7d` |
| Header | open failures | 2 | `/workflows?state=FAILED,BLOCKED` |
| Pipeline | Requirement · Analysis · Architecture · Implementation · Testing · Review · PR | 3 · 2 · 1 · 4 · 3 · 3 · 2 | `/workflows?stage=1` … `/workflows?stage=7` |
| What needs me | approvals | **4** | `/approvals` |
| What needs me | clarifications | **2** | `/approvals?kind=clarification` |
| What needs me | failed workflows | 1 | `/workflows?state=FAILED` |
| What needs me | blocked workflows | 1 | `/workflows?state=BLOCKED` |
| Health | Test pass rate | **97.4 %** (974 / 1000) | `/testing?window=7d` |
| Health | Agent success rate | 94.6 % (35 / 37) | `/agents?window=7d` |
| Health | Human intervention rate | 33.3 % (8 / 24) | `/workflows?intervention=human&window=7d` |
| Risk | HIGH / CRITICAL pending approvals | 2 (badges HIGH, CRITICAL) | `/approvals?risk=HIGH,CRITICAL` |
| Risk | HIGH / CRITICAL audit events · Last 7 days | 0 | `/audit?risk=HIGH,CRITICAL&window=7d` |
| Risk | security findings | **—** with the neutral notice "Not connected yet — review findings arrive with PR Review (User Story 6)." (no saffron, no green) | `/reviews` |
| Active workflows (18) | 12 cards, newest state change first | each shows `s500-dNN`, title, "Stage n of 7 · {stage}", a Progress meter, agent, elapsed, a state pill | `/workflows/{id}`; "Show all 18" → active workflows href |

3. Click **Requirement** (pipeline) — the browser opens `/workflows?stage=1` (placeholder section today; the query string is preserved). Use Back. Click **4 approvals** → the Approval Center lists the four `Dashboard Demo` items (the project cookie is shared). Back. Click a card → Workflow Detail.
4. Switch **Window** to **Last 30 days**: PRs generated stays 6, the three rates are unchanged (all dashboard-demo evidence lies within 3 days), the labels read "Last 30 days". Switch to **Last 24 hours**: test pass rate and agent success rate show **—** with "No test runs in this window" / "No finished agent runs in this window" (nothing finished in the last day); PRs generated drops to 1 (the pending PR-merge workflow observed today).
5. Live update (FR-034, SC-003): in a terminal move one running workflow to a human gate —

```bash
curl -s -X PUT localhost:3001/api/ingest/workflows/s500-d05 -H "authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"state":"WAITING_FOR_HUMAN","observedAt":"'"$(date -u +%FT%TZ)"'","reason":"needs sign-off"}'
```

Within 5 s and without reloading: running agents 7 → 6, the `s500-d05` card's pill reads `waiting for human`, and (once an approval is ingested for it) approvals 4 → 5 in both the Dashboard and the header count.

6. Select **All projects**: the figures now include S-500 (active workflows 118, approvals 28, clarifications 14 …) — the same header counts the Inbox shows.

### 4.3 How the seed produces the figures — and what it does not touch (research R30, data-model §21)

`pnpm db:seed` runs `buildS500(base)` unchanged, then `buildDashboardShowcase(base)` which adds one project **`dashboard-demo`** ("Dashboard Demo", no memberships) with 24 workflows `s500-d01…s500-d24`:

- **18 active** = 2 QUEUED + 6 RUNNING + 1 RETRYING + 1 WAITING + 6 WAITING_FOR_HUMAN + 1 BLOCKED + 1 FAILED, with `stage_index` 3/2/1/4/3/3/2 across stages 1–7. The other 6 are 5 COMPLETED (each with a `pull_request_ref`, finished 1–3 days before the clock) + 1 CANCELLED.
- **4 pending approvals** (CRITICAL, HIGH, MEDIUM, LOW) and **2 pending clarifications** on the six WAITING_FOR_HUMAN workflows; two COMPLETED workflows carry a *decided* approval (counted by the intervention rate, not by "pending").
- **97.4 %** = 974 passed / 1 000 (passed + failed): five test runs `180 / 177 / 3` on the COMPLETED workflows + one `100 / 89 / 11` on the FAILED workflow, all `finished_at` inside the last 3 days.
- **Security findings**: no table, no row — the API returns `connected: false` and the screen renders the neutral state.
- Determinism: the module draws from its own `mulberry32(SEED_RNG + 1)` stream and uses the fixed clock of `pnpm test:api` / `pnpm test:e2e`; S-500 draws are unaffected, so `EXPECTED_BUCKETS`, `EXPECTED_SHOWCASE`, `DECISION_SHOWCASE`, `s500-001`, `s500-045`, `s500-apr-req`, `s500-apr-pr` and `s500-clr-01` are byte-for-byte what they were.

**The S-500 dataset cannot itself produce 18 / 4 / 2**: US1/US2 tests pin 100 running, 24 pending approvals and 12 pending clarifications for the whole organization (`EXPECTED_BUCKETS`, `seed.test.ts`, the Inbox e2e `toHaveCount(100)`), so the Independent Test figures are met **per selected project** (FR-023, FR-025), which is what the story tests. Exact consequences for existing tests, all additive:

| Existing assertion | Change |
|--------------------|--------|
| `packages/db/tests/seed.test.ts` — `SC-005 seed inserts …` DB totals: `workflows` 500 (×2), pending approvals 24, pending clarifications 12, `workflow_stages`/`agent_runs`/`test_runs` = `EXPECTED_SHOWCASE.*` | add the new constant `EXPECTED_DASHBOARD = { workflows: 24, active: 18, approvals: 4, clarifications: 2, stages: 43, runs: 44, testRuns: 6 }` and assert `EXPECTED_BUCKETS.total + EXPECTED_DASHBOARD.workflows` (524), `24 + 4`, `12 + 2`, `EXPECTED_SHOWCASE.stages + 43`, `.runs + 44`, `.testRuns + 6`; `artifacts` unchanged (10); `audit_events` still 0 |
| Pure tests on `buildS500()` (`EXPECTED_BUCKETS`, `EXPECTED_SHOWCASE`, US2 `DECISION_SHOWCASE`) | unchanged — `buildS500` is not modified |
| `apps/api/tests/*` (`≥ 24`, `≥ 12`, `s500-001`, `s500-045`, `s500-apr-*`, `s500-clr-01`) | unchanged |
| `apps/web/tests/e2e/inbox-journey.spec.ts` — administrator Running tab `toHaveCount(100)` after one Load more, last row `queued`; approver/engineer/viewer project and membership counts | unchanged: page size 50, the tab now holds 110 rows (88 started before 22 queued in `started_at DESC NULLS LAST`), non-administrators have no `dashboard-demo` membership |
| `apps/web/tests/e2e/00-inbox-visual.spec.ts` — administrator "Needs you" screenshots (`__screenshots__/…/inbox-needs-you-{light,dark}.png`) | **must be refreshed** in the same commit as the seed (`pnpm -F @cdevi/web exec playwright test 00-inbox-visual --update-snapshots`): 8 new needs-you rows (CRITICAL, HIGH, MEDIUM, LOW approvals, 2 clarifications, 1 blocked, 1 failed) enter the risk-ordered first page; `toHaveCount(50)` still holds (first page) |

If reviewers prefer `pnpm db:seed` to stay identical, the fallback is an opt-in `pnpm db:seed --dashboard` used by `test:api`/`test:e2e` global-setup — same test changes, one more flag (R30 alternatives).

### 4.4 Performance budgets (plan Part C)

| Budget | Method |
|--------|--------|
| Initial content ≤ 2 s p95 at 500 workflows / 5 000 agent runs / 50 000 audit events (SC-007) | Playwright trace, 10 runs (`dashboard.spec.ts`) |
| `GET /api/dashboard` ≤ 300 ms p95 at the SC-007 fixture; payload ≤ 8 KB | `Server-Timing` and `content-length` asserted in `apps/api/tests/dashboard.test.ts` over 20 calls; the fixture is inserted by the test with `generate_series` |
| `inbox.changed` → refreshed figure ≤ 5 s p95, ≤ 1 s median (SC-002, SC-003) | e2e measures after the step-5 ingest |
| Refetch re-render ≤ 100 ms; cards ≤ 12 | component test (fake timers); pure `ACTIVE_CARD_LIMIT` test |
| Route JS ≤ 200 KB gzip | `pnpm check:size` |

## 5. User Story 4 — Requirements

### 5.1 Prerequisites

Same as §3.1/§4.1: `.env` (now also `JIRA_WEBHOOK_SECRET=<any local value>` — the placeholder in `.env.example` is `change-me`; never commit a real one), `docker compose up -d`, `pnpm db:migrate` (applies `0005_requirements.sql` — the first migration with tables), `pnpm db:seed`, `pnpm dev`. The seed prints the demo credentials and the ingestion token (`principal e2e-tests`) once — export it as `INGEST_TOKEN`. The US4 Independent Test uses **engineer1** (`engineer1@cdevi.demo`, may create/submit — FR-032) and **approver1** (`approver1@cdevi.demo`, may approve/reject); both are members of `payments-api`.

### 5.2 Red → green order (Principle II)

tasks.md Phase 9: 9a contracts tests → 9a implementation → (9b database tests → 9b migration/seed) **in parallel with** (9d design-system + web component tests → 9d implementation on typed fixtures) → 9c API tests → 9c services/routes → 9e Playwright → Phase 10 polish. Every test name starts with the FR/SC id it proves.

### 5.3 Independent Test (spec line 82)

Automated as `apps/web/tests/e2e/requirements.spec.ts` (`FR-007 …`, `FR-009 …`, `FR-010 …`, `SC-003 …`, `SC-007 …`, `SC-008 …`, `SC-010 …`); by hand:

1. **Create** (Scenario 1, FR-007). Sign in as engineer1. Inbox → **New requirement** (saffron) → `/requirements/new`. Choose project **Payments API**, title `Retry declined cards once`, business objective `Recover revenue lost to transient issuer declines by retrying once after 30 seconds`, one acceptance criterion `A declined card is retried at most once`. **Create requirement** (the only saffron control on the form). The browser opens `/requirements/{id}`: the pill reads **draft**, the Analysis card says "No analysis yet", the criterion shows **Authored by Engineer 1**, the action bar offers **Submit for analysis** (primary, not saffron) and a disabled **Reject…** with help "Only approvers and administrators can reject". Note the `req-…` external id shown in the meta line — export it as `REQ`.
2. **Submit.** Click **Submit for analysis**. Pill → **analyzing** (pulsing), the Analysis card says "Analysis in progress — results appear here automatically.", no action is enabled. `GET /api/requirements/{id}` shows `decision.submittedBy` = Engineer 1. History shows `draft → analyzing · Engineer 1`.
3. **Simulate the runtime — with open questions** (Scenario 3, FR-009, FR-036):

```bash
curl -s -X PUT localhost:3001/api/ingest/requirements/$REQ/analysis \
  -H "authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' -d '{
  "agent": "Requirement Agent", "observedAt": "'"$(date -u +%FT%TZ)"'",
  "summary": "Retry once for soft declines; hard declines are not retried.",
  "acceptanceCriteria": ["A soft-declined card is retried once after 30 s", "A hard decline is never retried"],
  "rules": ["Issuer response codes 05 and 51 are soft declines"],
  "openQuestions": ["Should the customer be notified before the retry?"] }'
# → {"outcome":"accepted","id":"…","state":"NEEDS_CLARIFICATION"}
```

Within 5 s and **without reloading** (FR-034, SC-003) the pill reads **needs clarification**, the Analysis card shows the summary, two acceptance criteria, one rule and one open question — every AI item carries the **AI-generated** pill and sits inside the "Requirement Agent · analysis" summary message (not evidence); the human criterion from step 1 still reads **Authored by Engineer 1**. The action bar now offers **Resubmit for analysis** (saffron — a person must resolve the question) and **Reject…** (disabled for engineer1). Repeating the same curl returns `{"outcome":"stale",…}` and changes nothing.
4. **Resubmit, then simulate — without open questions.** Click **Resubmit for analysis** (pill → **analyzing**), then send the same body with a newer `observedAt` and `"openQuestions": []` → `{"outcome":"accepted","state":"READY"}`. Pill → **ready** (neutral); the AI items are replaced wholesale (the open question is gone); engineer1 sees no enabled action ("Only approvers and administrators can approve").
5. **Approve** (Scenario 4, FR-010, SC-008). Sign in as approver1 in a second browser (or sign out/in). Open `/requirements/{id}`: **Approve** is the single saffron button; **Reject…** is ghost. Click **Approve**. Pill → **approved**; the Decision card shows "Approved · Approver 1" and **Workflow `wf-req-…` · stage 1 of 7** with a `StatePill` reading **queued**; History shows `ready → approved · Approver 1`; the audit table lists `requirement.approved` and `requirement.workflow_created`. A second **Approve** from a stale tab returns `409 This requirement was already decided.` (exactly once).
6. **Appears in the Workflow Center** (decision 3): click the workflow link → `/workflows/{id}` (Workflow Detail) shows 7 stages, stage 1 **Requirement** `queued`, title `Retry declined cards once`. Open **Dashboard**, project **Payments API**: active workflows grew by 1 and the new card `wf-req-…` shows "Stage 1 of 7 · Requirement" with pill `queued`. Then:

```bash
curl -s "localhost:3001/api/workflows?requirement=<requirement uuid>" -b "$COOKIE"
# → { "items": [ { "externalId": "wf-req-…", "state": "QUEUED", "stage": { "index": 1, "count": 7, "name": "Requirement" }, "requirement": { "id": "…", "href": "/requirements/…" }, … } ], "nextCursor": null, "total": 1 }
```

7. **Follow the workflow** (R33). Ingest a transition `PUT /api/ingest/workflows/wf-$REQ` with `{"state":"RUNNING",…}` → within 5 s the requirement pill reads **in implementation**; `{"state":"COMPLETED"}` → **completed**.
8. **List and filters** (Scenario 5). Open **Requirements** (nav). Filters Project / State / Assignee; each row shows the state pill, the linked workflow's `StatePill` (link to `/workflows/{id}`), and for `req-seed-003` the Jira link **PAY-231** (opens in a new tab). Choose State = **needs clarification** → only `req-seed-003` (and yours from step 3 if you skipped step 4); Assignee = **Me** as approver1 → `req-seed-003`. The URL reflects the filters; "8 of 8 requirements" becomes "9 of 9" after your creation.
9. **Reject path**: as approver1 open `req-seed-004` (READY) → **Reject…** → reason `Superseded` → **Confirm rejection** → pill **rejected**, Decision shows the reason. (Do this last: it changes seed data until the next `pnpm db:seed`; the e2e never rejects seed rows.)

### 5.4 Jira webhook (Scenario 2, FR-008, edge case)

The seed maps Jira project **PAY** → **Payments API** (`integration_project_mappings`). Sign the raw body with the shared secret:

```bash
BODY='{"timestamp":1757900000000,"webhookEvent":"jira:issue_created","issue":{"id":"10042","key":"PAY-240","self":"https://jira.example.invalid/rest/api/3/issue/10042","fields":{"summary":"Chargeback evidence export","description":"Export chargeback evidence as PDF for the issuer portal.","updated":"2026-09-15T06:00:00.000+0000","project":{"key":"PAY"},"status":{"name":"To Do","statusCategory":{"key":"new"}},"assignee":{"emailAddress":"approver1@cdevi.demo"}}}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$JIRA_WEBHOOK_SECRET" | sed 's/^.* //')"
curl -s -X POST localhost:3001/api/integrations/jira/webhook -H "content-type: application/json" -H "x-hub-signature: $SIG" --data-binary "$BODY"
# → 202 {"outcome":"created","requirementId":"…"}
```

- The Requirements list shows **PAY-240** in `draft`, assignee Approver 1, with the Jira link `https://jira.example.invalid/browse/PAY-240` (`rel="noopener noreferrer"`, new tab).
- Send the same body with `"webhookEvent":"jira:issue_updated"`, a newer `updated` and `"summary":"Chargeback evidence export (PDF)"` → `202 {"outcome":"updated"}`; the title changes. The same `updated` again → `{"outcome":"stale"}`.
- Wrong signature (`-H "x-hub-signature: sha256=00"`) → `401` problem+json `urn:cdevi:problem:unauthenticated` with no body echo; unmapped project (`"key":"XYZ"`, `"project":{"key":"XYZ"}`) → `202 {"outcome":"ignored","requirementId":null}`.
- **Edge case**: for the requirement you approved in §5.3 step 5 there is no Jira link; instead create `PAY-241` via the webhook, submit → analyse (no questions) → approve it as above so it owns a `QUEUED` workflow, then send `"webhookEvent":"jira:issue_deleted"` for `PAY-241` → `202 {"outcome":"flagged"}`. The requirement shows the warning notice "The linked Jira issue PAY-241 was deleted…", its list row a **Jira deleted** pill, and the workflow at `/workflows/{id}` is **blocked** with reason "Jira PAY-241 deleted — human decision required"; the Inbox needs-you tab and the Dashboard "blocked workflows" figure include it within 5 s. A `jira:issue_updated` whose `statusCategory.key` is `done` flags **closed** the same way.

### 5.5 Seed requirements the e2e relies on — and what the seed does not touch (research R44, data-model §30)

| `external_id` | State | Used by |
|---------------|-------|---------|
| `req-seed-001` | draft | list row; `FR-032` engineer sees Submit, viewer sees nothing |
| `req-seed-002` | analyzing | list row; no enabled action |
| `req-seed-003` | needs clarification — **Jira PAY-231**, assignee approver1, 2 open questions | `FR-008` Jira link + `FR-009` AI labels + assignee filter |
| `req-seed-004` | ready | `FR-032` Approve offered to approver1/admin, not to engineer1/viewer1 (asserted without clicking) |
| `req-seed-005` | approved → first `QUEUED` S-500 workflow | `FR-010` linked workflow `queued` |
| `req-seed-006` | in implementation → `s500-001` (`SHOWCASE_WAITING`) | linked `StatePill` "waiting for human" + `/workflows/{id}` link |
| `req-seed-007` | completed → first `COMPLETED` S-500 workflow | state filter |
| `req-seed-008` | rejected, reason "Duplicate of req-seed-004" | Decision card |

The Independent Test creates its own requirement (`uniq('e2e-req')`) and Jira issue key (`E2E-<n>` is **not** mapped — the e2e uses `PAY-9<nnn>` keys) so seed rows are never mutated by the e2e. **What the seed does not touch**: no workflow, stage, run, test run, approval, clarification or `audit_events` row is added (requirement history is seeded into `requirement_transitions` only, 26 rows), so `EXPECTED_BUCKETS`, `EXPECTED_SHOWCASE`, `EXPECTED_DASHBOARD`, the Inbox counts, the Approval Center showcase, the Dashboard figures (18 / 4 / 2 / 97.4 %), the two `count(*) from audit_events = 0` seed assertions (`seed.test.ts` lines 270 and 551) and every existing e2e assertion are unchanged. The only S-500 rows touched are three `workflows.requirement_id` values (nullable column added by 0005), which no existing test reads. The seed's `TRUNCATE` list gains the four new tables; the requirement inserts run before the final `TRUNCATE inbox_change_log`, so the change log is still empty after seeding.

**Exactly two existing assertions change**, both in `packages/db/tests/schema.test.ts`, both because that file applies every migration (including 0005) before asserting, and both edited tests-first in T092: (1) ≈ line 149, in `changing a workflow emits NOTIFY inbox_changed and appends to inbox_change_log` — the exact `inbox_changed_%` trigger list gains `'inbox_changed_requirements'` (eight names, sorted); (2) ≈ line 741 `SC-007 0004 adds no tables, columns, triggers, policies or grants (indexes only)` — the `pg_tables` expectation becomes `[...TABLES_AFTER_0003, ...TABLES_ADDED_BY_0005].sort()` where `TABLES_ADDED_BY_0005 = ['integration_project_mappings', 'requirements', 'requirement_analysis_items', 'requirement_transitions']`; the column-count map in that test is untouched (0005 adds columns only to `workflows` and `inbox_change_log`). `packages/db/tests/seed.test.ts` only *gains* tests (`FR-009 seed has one requirement per state and EXPECTED_REQUIREMENTS …`, `FR-009 seed writes no audit_events …`) and re-asserts the US1–US3 totals in the same run. Visual baselines (`00-inbox-visual.spec.ts`) are unaffected (the Inbox does not render requirements).

### 5.6 Performance budgets (plan Part D)

| Budget | Method |
|--------|--------|
| Requirements list initial content ≤ 2 s p95 (SC-007) | Playwright trace, 10 runs (`requirements.spec.ts`) |
| `GET /api/requirements` ≤ 200 ms p95, `GET /api/requirements/{id}` ≤ 150 ms p95, `GET /api/workflows` ≤ 200 ms p95 at the SC-007 fixture (+ 2 000 requirements / 20 000 items) | `Server-Timing` over 20 calls in `apps/api/tests/requirements.test.ts` / `workflows-list.test.ts`; fixture by `seedSc007Org` |
| `POST …/approve` ≤ 300 ms p95; analysis `PUT` ≤ 200 ms p95; webhook ≤ 100 ms p95 | `Server-Timing` over 20 calls |
| `inbox.changed` → updated pill ≤ 5 s p95, ≤ 1 s median (SC-003) | e2e measures after the §5.3 step-3 ingest |
| Payloads: list ≤ 40 KB, detail ≤ 32 KB, workflow list ≤ 40 KB | `content-length` asserted |
| Route JS ≤ 200 KB gzip | `pnpm check:size` |
