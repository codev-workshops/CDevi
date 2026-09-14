# Quickstart: Inbox Home Page — run and verify

**Feature**: 003-inbox-home | **Plan**: [plan.md](plan.md) | Contracts: [openapi.yaml](contracts/openapi.yaml), [inbox-read-model.md](contracts/inbox-read-model.md), [ui-inbox-screen.md](contracts/ui-inbox-screen.md)

This is the evidence guide for the feature: what to run, in what order, and what must be true. Commands are the ones the implementation adds to `package.json` (root) — `/speckit-tasks` creates them; names here are the contract.

## 1. Prerequisites

- Node 26 (`nvm use`), pnpm 10, Docker (for PostgreSQL 17).
- `pnpm i` (frozen lockfile in CI).
- Copy `.env.example` → `.env` (`DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `SESSION_SECRET`, `API_ORIGIN`, `WEB_ORIGIN`, `CDEVI_ENV=development`). `.env*` is git-ignored.

```bash
docker compose up -d postgres          # postgres:17 on 5432, roles migrator + app_user created by init script
pnpm db:migrate                        # packages/db migrations as migrator (idempotent)
pnpm db:seed                           # S-500 deterministic seed; refuses when CDEVI_ENV/NODE_ENV=production
pnpm dev                               # api on :3001, web on :3000 (rewrites /api/* → :3001)
```

`pnpm db:seed` prints the demo credentials once (admin, one approver, one engineer, one viewer) and the `e2e-tests` ingestion token. Nothing else ever prints secrets.

## 2. Red → green order (Principle II)

1. **Design-system additions** — write `Notice.test.tsx`, `List.test.tsx › loading`, `FocusLayout.test.tsx` (fail) → implement → gallery entries → `pnpm check` + `pnpm test:visual -- --update-snapshots` → CHANGELOG 1.2.0.
2. **Contracts** — `packages/contracts/tests/read-model.test.ts` from the examples in `inbox-read-model.md` (fail) → implement pure functions; `openapi.test.ts` snapshot against `contracts/openapi.yaml` (fail until schemas match).
3. **DB** — migration `0001_init.sql`; `packages/db/tests/schema.test.ts` asserts enums, indexes, triggers, `NOTIFY` fire.
4. **API** — `apps/api/tests/*.test.ts` named after spec scenarios (fail) → routes/services until green; `pnpm test:api` requires `DATABASE_URL`.
5. **Web** — component tests with fixture snapshots + axe (fail) → screens.
6. **E2E** — Playwright journey/keyboard/axe/LCP/SSE (fail) → wire-up until green.

## 3. Unit, contract and API tests

```bash
pnpm check                                  # lint (DR-06/07/08), stylelint, typecheck, class-prefix, unit (all Vitest projects), size
pnpm test -- --project contracts            # pure read model + schema examples + OpenAPI snapshot
pnpm test:api                               # Vitest project "api": real Postgres, transaction rollback per test, fixed clock
```

Expected: every test in `apps/api/tests` maps to a spec id in its name, e.g. `FR-010 orders needsYou by risk then age`, `FR-021 out-of-order transition is stale`, `SC-004 counts equal rows under project filter`, `SC-008 viewer sees no rows outside memberships`. `pnpm test:api` prints the sign-in p95 (< 500 ms) and fails above it.

## 4. Manual walk-through (matches e2e `inbox-journey.spec.ts`)

1. Open http://localhost:3000 → redirected to `/sign-in`. Wrong password and unknown email show the same message; 6th attempt in a minute shows the rate-limit notice.
2. Sign in as the **approver** → lands on `/inbox`, **Needs you** selected, `NavItem` shows "Inbox, 50 pending" (S-500 has 50 needs-you items across 4 projects; the approver sees the subset for their 2–4 projects — the number in nav, tab and Today agree).
3. First rows: CRITICAL approvals (saffron-strong badge, red border), then HIGH, MEDIUM, LOW, then failed/blocked/clarifications oldest first. One approval shows **expired**, three show **stale**. Clarification rows show "recommended answer available".
4. Press Tab until the tab list; → moves to **Running**; rows show `stage n of 7 · <name>` and elapsed; QUEUED rows last. → **Done**: completed rows carry PR refs; cancelled rows are struck through; nothing older than 7 days.
5. Select project **payments-api** in the project `Select`: every count and the Today block shrink to that project; clear to **All projects**.
6. Open the first needs-you row (Enter) → `/approvals/{id}` stub with the same facts and the info `Notice`; **Back to Inbox** returns with focus on the tab list.
7. Sign in as the **viewer** in a second browser: **New requirement** is disabled with the help text; rows limited to memberships.
8. Freshness: with the Inbox open, run the ingestion call below; the new row appears in **Needs you** within 5 s without reload and the counts increase together.

```bash
TOKEN=<printed by seed>
curl -s -X PUT localhost:3001/api/ingest/workflows/demo-live-1 \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"projectKey":"payments-api","title":"Live: rotate signing keys","agent":"Implementation Agent","state":"RUNNING","stage":{"index":3,"count":7,"name":"Implementation"},"observedAt":"'"$(date -u +%FT%TZ)"'"}'
curl -s -X PUT localhost:3001/api/ingest/approvals/demo-live-1-a1 \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"workflowExternalId":"demo-live-1","ask":"Approve: rotate production signing keys","riskLevel":"CRITICAL","requestedAt":"'"$(date -u +%FT%TZ)"'","expiresAt":"'"$(date -u -v+4H +%FT%TZ 2>/dev/null || date -u -d '+4 hours' +%FT%TZ)"'"}'
curl -s -X POST localhost:3001/api/ingest/workflows/demo-live-1/transitions \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"toState":"WAITING_FOR_HUMAN","observedAt":"'"$(date -u +%FT%TZ)"'"}'
```

Negative checks (each returns `application/problem+json`, changes nothing, and appears in `ingestion_log`): repeat the last call with an older `observedAt` → `200 {"outcome":"stale"}`; `toState: "QUEUED"` from `WAITING_FOR_HUMAN` → `409 invalid-transition`; `projectKey` outside the token's scope → `403`; no token → `401`.

## 5. End-to-end, accessibility, visual

```bash
pnpm test:e2e            # Playwright: migrates + seeds a fresh DB, starts api+web, runs apps/web/tests/e2e
pnpm test:visual         # design-system gallery + reference screens + /inbox baseline (light/dark)
```

`test:e2e` specs and what they prove:
- `inbox-journey.spec.ts` — sign-in → Inbox → tabs → project filter → row → stub → back (US1–US3, SC-005 focus).
- `inbox-keyboard.spec.ts` — the §6 walk-through of `ui-inbox-screen.md`; asserts names ("Inbox, n pending", "Needs you, n", badge ends with "risk").
- `inbox-a11y.spec.ts` — axe zero violations on every route × state (uses `?state=` test hooks that force loading/error via a blocked route).
- `inbox-freshness.spec.ts` — ingests via API, measures event-to-row latency over 10 iterations; asserts p95 ≤ 5 s (SC-007) and that a reconnect with `Last-Event-ID` replays exactly the missed events.
- `inbox-perf.spec.ts` — 20 cold loads of `/inbox` with S-500; asserts LCP p95 ≤ 2 s (SC-003) and route JS ≤ 200 KB gzip.
- `sse-through-rewrite.spec.ts` — proves the Next rewrite streams (first event < 1 s after connect); if it fails, switch `NEXT_PUBLIC_API_STREAM_URL` to the direct origin (research R1).

## 6. Performance budgets (Principle IV)

```bash
pnpm perf:api            # autocannon: GET /api/inbox (all projects, needsYou) 30 s × 20 conns → p95 ≤ 300 ms, p99 ≤ 600 ms
                         #             PUT /api/ingest/workflows/{id} 30 s × 10 conns → p95 ≤ 200 ms
pnpm check:size          # design-system CSS ≤ 40 KB, fonts ≤ 200 KB, web /inbox route JS ≤ 200 KB gzip, /api/inbox payload (50 rows) ≤ 64 KB
```

Both run in the CI `e2e` job after seeding; a breach fails the job. `Server-Timing` on `GET /api/inbox` and the `pino` `responseTime` field are the in-production measurements.

## 7. Definition of done for this feature

- `pnpm check`, `pnpm test:api`, `pnpm test:e2e`, `pnpm test:visual`, `pnpm perf:api` green locally and in CI (`lint`, `unit`, `build`, `visual`, `e2e` jobs).
- `@cdevi/design-system` at 1.2.0 with CHANGELOG, DESIGN.md §3 rows for `Notice`, `List loading`, `FocusLayout`, gallery entries and visual baselines.
- `docs/architecture.md` §2/§4/§6/§8 updated per research.md; `AGENTS.md` lists the new commands; `apps/web-scratch` removed.
- Every spec FR-001…FR-030 has at least one named automated test; SC-002 (10-second triage) is verified by a recorded 5-person hallway test noted in the PR.
