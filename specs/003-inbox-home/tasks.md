---
description: 'Task list for 003-inbox-home'
---

# Tasks: Inbox Home Page

**Input**: Design documents from `/specs/003-inbox-home/` — plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/{openapi.yaml, inbox-read-model.md, ui-inbox-screen.md}, quickstart.md

**Tests**: Tests are REQUIRED for every behaviour change (Constitution Principle II): the failing test task precedes its implementation task in every phase below. Live Postgres is used only by the identified Vitest project `api`, the `packages/db` schema test and Playwright.

**Organization**: Phase 1 Setup → Phase 2 Foundational (design-system additions, contracts, database, auth, ingestion, SSE, web shell — everything every story needs) → Phase 3–6 one phase per user story (US1 P1, US2 P2, US3 P3, US4 P3) → Phase 7 Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on unfinished tasks)
- **[Story]**: US1 (Needs you), US2 (Running/Done), US3 (New requirement), US4 (Today panel)
- Exact file paths in every task. Application tasks MUST NOT introduce local styling or `cd-` classes (`pnpm check` fails otherwise).

## Path Conventions

Monorepo per plan.md: `apps/web` (Next.js 16), `apps/api` (Fastify 5), `packages/contracts` (`@cdevi/contracts`), `packages/db` (`@cdevi/db`), `packages/design-system` (1.1.0 → 1.2.0), root tooling in `tools/`, CI in `.github/workflows/ci.yml`. Dependency versions: newest release published ≥ 7 days before install (`npm view <pkg> time --json`), exact pins, `pnpm-lock.yaml` committed (research R13).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspace packages, local database, test projects and CI wiring that every later task assumes.

- [X] T001 Create workspace packages with `package.json`, `tsconfig.json` (extends `tsconfig.base.json`), `src/index.ts` and a `typecheck` script for `packages/contracts` (`@cdevi/contracts`, deps: `zod`), `packages/db` (`@cdevi/db`, deps: `drizzle-orm`, `pg`; dev: `drizzle-kit`), `apps/api` (`@cdevi/api`, deps: `fastify`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/cors`, `fastify-type-provider-zod`, `zod`, `pg`, `@cdevi/contracts`, `@cdevi/db`; dev: `autocannon`, `tsx`), `apps/web` (`@cdevi/web`, deps: `next`, `react`, `react-dom`, `@cdevi/design-system`, `@cdevi/contracts`; dev: `@playwright/test`, `@testing-library/react`, `axe-core`, `jsdom`) — versions per R13; run `pnpm i` and commit `pnpm-lock.yaml`
- [X] T002 [P] Add `docker-compose.yml` (service `postgres`, image `postgres:17`, port 5432, volume, `POSTGRES_DB=cdevi`) and `packages/db/docker/init-roles.sql` creating roles `migrator` (owner) and `app_user` (`NOBYPASSRLS`, `LOGIN`) mounted at `/docker-entrypoint-initdb.d/`; add `.env.example` at repo root with `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `SESSION_SECRET`, `API_ORIGIN=http://localhost:3001`, `WEB_ORIGIN=http://localhost:3000`, `CDEVI_ENV=development`, `CDEVI_RLS=off`
- [X] T003 [P] Register Vitest projects in `vitest.config.ts`: `contracts` (node, `packages/contracts/tests/**/*.test.ts`), `db` (node, `packages/db/tests/**/*.test.ts`, skipped with a clear message when `DATABASE_URL` is unset), `api` (node, `apps/api/tests/**/*.test.ts`, same skip rule, `setupFiles: apps/api/tests/setup.ts`), `web` (jsdom, `apps/web/tests/components/**/*.test.tsx`, `setupFiles: apps/web/tests/setup.ts`); keep `design-system` and `tools`
- [X] T004 [P] Add root scripts to `package.json`: `dev` (`pnpm -r --parallel --filter @cdevi/api --filter @cdevi/web run dev`), `db:migrate`, `db:seed`, `db:user:create`, `db:ingest-key:create` (delegating to `@cdevi/db`), `test:api` (`vitest run --project api --project db`), `test:e2e` (`pnpm -F @cdevi/web run test:e2e`), `perf:api` (`pnpm -F @cdevi/api run perf`); extend `typecheck` filters to include `packages/*` and `apps/*` (already covered — verify)
- [X] T005 [P] Extend `.github/workflows/ci.yml`: add `services: postgres: image: postgres:17` with `DATABASE_URL`/`DATABASE_MIGRATOR_URL` env to the `unit` job and run `pnpm db:migrate` before `pnpm test`; add a new required job `e2e` (checkout, pnpm i, postgres service, `pnpm db:migrate`, `pnpm db:seed`, `pnpm build`, `pnpm test:e2e`, `pnpm perf:api`, `pnpm check:size`, upload Playwright report on failure)
- [X] T006 [P] Extend `eslint.config.js` and `.stylelintrc.json` scopes so `apps/web/**`, `apps/api/**`, `packages/contracts/**`, `packages/db/**` are linted with the existing rule sets (DR-06/07/08 rules apply to `apps/web`); add `apps/web/.next`, `apps/web/test-results`, `apps/web/playwright-report` to `.gitignore` and `.prettierignore`

**Checkpoint**: `pnpm i && docker compose up -d && pnpm typecheck` succeeds with empty packages.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Design-system additions, shared contracts, database, authentication, ingestion, SSE plumbing and the web shell. No story renders without these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### 2a. Design-system additions (1.1.0 → 1.2.0; research R10, DESIGN.md §8)

- [X] T007 [P] Write failing tests `packages/design-system/src/components/Notice/Notice.test.tsx`: renders `role="status"` for `tone="info"` and `role="alert"` for `tone="error"`, renders `action` slot, forwards `className`/ref, passes `expectAccessible`
- [X] T008 [P] Write failing tests in `packages/design-system/src/components/Card/Card.test.tsx` for `List loading`: sets `aria-busy="true"`, renders exactly 3 `.cd-row.cd-skeleton` placeholders, does NOT render the `empty` text while loading, passes axe
- [X] T009 [P] Write failing tests `packages/design-system/src/components/AppShell/FocusLayout.test.tsx`: renders a `<main>` landmark with class `cd-root cd-focus`, renders `brand` slot and children inside one `Card`, passes axe
- [X] T010 Add `Notice` to the design system: CSS `.cd-notice`, `.cd-notice.cd-info`, `.cd-notice.cd-error`, `.cd-notice .cd-notice-action` in `packages/design-system/css/components.css` (tokens only; new pairs `notice-info`, `notice-error` for both themes in `tokens/pairs.json`), component `packages/design-system/src/components/Notice/Notice.tsx` (`tone: 'info' | 'error'`, `action?: ReactNode`, role per tone), export in `src/index.ts`, gallery entry in `gallery/entries.tsx` + name in `tests/visual/entries.ts`, row in `DESIGN.md` §3 (T007 passes)
- [X] T011 Add `List loading` to the design system: CSS `.cd-row.cd-skeleton` (surface/line tokens, shimmer disabled under `prefers-reduced-motion`) in `packages/design-system/css/components.css`, pair `skeleton-on-surface` in `tokens/pairs.json`, prop `loading?: boolean` in `packages/design-system/src/components/Card/Card.tsx` (`aria-busy`, 3 placeholders, suppress `empty`), gallery entry + visual entry, `DESIGN.md` §3 `List` row updated with state **L** (T008 passes)
- [X] T012 Add `FocusLayout` to the design system: CSS `.cd-root.cd-focus` (centred single column, canvas background, tokens only) in `packages/design-system/css/components.css`, component in `packages/design-system/src/components/AppShell/AppShell.tsx` (props `brand?: ReactNode`, `children`), export in `src/index.ts`, gallery + visual entries, `DESIGN.md` §3 row (T009 passes)
- [X] T013 Bump `packages/design-system/package.json` to `1.2.0`, add `## 1.2.0 — <date>` to `packages/design-system/CHANGELOG.md` (Added: `Notice`, `List loading`, `FocusLayout`; pairs added), run `pnpm -F @cdevi/design-system build`, `pnpm check`, `pnpm test:visual -- --update-snapshots` and commit the new baselines under `packages/design-system/tests/visual/__screenshots__/`

### 2b. Shared contracts (`packages/contracts`)

- [X] T014 [P] Write failing tests `packages/contracts/tests/schemas.test.ts` with one rejecting example per rule in data-model.md §6: `externalId` `^[A-Za-z0-9._:-]{1,128}$`; `title` ≤ 200, `ask`/`question` ≤ 240, all trimmed non-empty single-line; `state` ∈ nine values; `riskLevel` ∈ four; ISO-8601 with offset for `observedAt`/`requestedAt`/`expiresAt` and `expiresAt > requestedAt`; `stage.index` 1..`count` ≤ 20; `email` ≤ 254; `password` 8..256; query `tab ∈ {needsYou, running, done}`, `project` uuid|`all`, `cursor` ≤ 200
- [X] T015 [P] Write failing tests `packages/contracts/tests/read-model.test.ts` from contracts/inbox-read-model.md: `classifyTab` (incl. `COMPLETED` finished 8 d ago → `null`), `deriveKind` order §2 (incl. WAITING_FOR_HUMAN without request → `blocked` with fallback ask), `deriveAsk` §3, `riskRank` + `orderNeedsYou` §4 worked example, `isStale` strict > 24 h, `expiryLabel`/`humanDuration`/`humanAgo` §5–6, cursor encode/decode §7 including shape mismatch, and the transition table of data-model.md §3 (`canTransition(from, to)`)
- [X] T016 Implement Zod schemas in `packages/contracts/src/{problem,auth,inbox,ingest}.ts` matching contracts/openapi.yaml (`Problem`, `SignInRequest`, `Me`, `InboxSnapshot`, `InboxItem`, `TodaySummary`, `LinkedCount`, `WorkflowUpsert`, `Transition`, `ApprovalUpsert`, `ClarificationUpsert`, `IngestResult`, query schema) with exported TS types; export from `packages/contracts/src/index.ts` (T014 passes)
- [X] T017 Implement pure read-model functions in `packages/contracts/src/read-model.ts`: `WORKFLOW_TRANSITIONS`, `canTransition`, `classifyTab`, `deriveKind`, `deriveAsk`, `riskRank`, `orderNeedsYou`, `orderRunning`, `orderDone`, `isStale`, `expiryLabel`, `humanDuration`, `humanAgo`, `encodeCursor`, `decodeCursor` (T015 passes)
- [X] T018 Write failing snapshot test `packages/contracts/tests/openapi.test.ts` asserting the document built by `packages/contracts/src/openapi.ts` deep-equals `specs/003-inbox-home/contracts/openapi.yaml`; implement `openapi.ts` (zod → OpenAPI 3.1 via `fastify-type-provider-zod`'s `jsonSchemaTransform` or `zod-to-json-schema`) and script `pnpm -F @cdevi/contracts openapi` that regenerates the yaml; adjust schemas until the test passes

### 2c. Database (`packages/db`)

- [X] T019 [P] Write failing test `packages/db/tests/schema.test.ts` (project `db`): after `pnpm db:migrate`, enums `workflow_state`, `risk_level`, `user_role`, `approval_decision`, `ingestion_outcome` exist with exact values; tables of data-model.md §2 exist with `organization_id`; indexes listed for `workflows` exist; `app_user` has no `UPDATE`/`DELETE` on `workflow_transitions`; updating a `workflows` row emits `NOTIFY inbox_changed` with `{organizationId, projectId, workflowId, seq}` and inserts into `inbox_change_log`; RLS policies exist but `relrowsecurity = false` when `CDEVI_RLS=off`
- [X] T020 Write Drizzle schema `packages/db/src/schema.ts` for every table in data-model.md §2 (`organizations`, `projects`, `users` with `citext` email, `project_memberships`, `sessions` with `id_hash bytea`, `ingestion_principals` with `token_hash bytea UNIQUE` + `project_ids uuid[]`, `workflows`, `workflow_transitions`, `approvals`, `clarifications`, `ingestion_log`, `inbox_change_log`) with the enums, nullability, defaults and unique constraints quoted there
- [X] T021 Write migration `packages/db/migrations/0001_init.sql` (generate with `drizzle-kit generate` via `packages/db/drizzle.config.ts`, then hand-add): `CREATE EXTENSION citext`; partial indexes from data-model.md `workflows`; `updated_at` trigger; trigger `inbox_changed_notify` on `workflows`, `approvals`, `clarifications` (INSERT/UPDATE) inserting into `inbox_change_log` and `pg_notify('inbox_changed', json)`; RLS policies `USING (organization_id = current_setting('app.organization_id', true)::uuid)` on every table (not enabled); grants for `app_user` (no UPDATE/DELETE on `workflow_transitions`, `ingestion_log`); runner `packages/db/src/migrate.ts` using `DATABASE_MIGRATOR_URL` (T019 passes)
- [X] T022 Implement deterministic seed `packages/db/src/seed/s500.ts` + `packages/db/src/seed/index.ts` per data-model.md §7 and research R12: `mulberry32(20260914)`, base time `2026-09-14T09:00:00Z`, 4 projects, 20 users (roles/memberships as specified, scrypt hashes via `apps/api` shared helper moved to `packages/db/src/password.ts`), 1 ingestion principal `e2e-tests`, 24 approvals (6 per risk; 4 with expiry incl. 1 expired; 3 stale), 12 clarifications (6 recommended), 8 blocked, 6 failed, 100 running (20/60/10/10), 350 done (300 completed with PR refs, 50 cancelled, spread over 8 days), `organizations.is_demo = true`, `policy_summary` default; **refuse** with exit 1 when `NODE_ENV` or `CDEVI_ENV` is `production`; print credentials + token exactly once; add `packages/db/tests/seed.test.ts` asserting bucket counts and the refusal
- [X] T023 [P] Implement CLIs `packages/db/src/cli/user-create.ts` (`--email --name --role --projects key,key --password-stdin`) and `packages/db/src/cli/ingest-key-create.ts` (`--name --projects key,key`, prints token once, stores SHA-256) with tests `packages/db/tests/cli.test.ts`

### 2d. API skeleton, auth, ingestion, SSE (`apps/api`)

- [X] T024 Create `apps/api/src/server.ts` (`buildApp({ now })` + `listen`), `apps/api/src/plugins/db.ts` (pg `Pool` as `app_user`; `request.tx()` helper running `BEGIN; SET LOCAL app.organization_id/app.user_id`), `apps/api/src/lib/problem.ts` (`application/problem+json`, `urn:cdevi:problem:*` types, Zod errors → `errors[]`, never includes stack/SQL), `apps/api/src/routes/health.ts` (`GET /healthz` → `{status, dbRoundTripMs, listenerConnected}`), register `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/swagger` (serving the T018 document), `fastify-type-provider-zod`, `pino` request logging with `responseTime`; test harness `apps/api/tests/setup.ts` (transaction-per-test rollback, injected fixed clock) and `apps/api/tests/health.test.ts`
- [X] T025 [P] Write failing tests `apps/api/tests/auth.test.ts`: `FR-004 sign-in sets HttpOnly Secure SameSite=Lax cookie`; `FR-004 wrong password and unknown email return identical 401 Problem`; `FR-004 6th attempt within a minute → 429`; `FR-004 expired (idle > 12 h / absolute > 7 d) session → 401 and cookie cleared`; `sign-out revokes`; `GET /auth/me returns role, organization.isDemo, visible projects (admin = all, viewer = memberships) and canCreateRequirement`; `sign-in p95 < 500 ms over 20 runs`; `disabled user cannot sign in`
- [X] T026 Implement `apps/api/src/services/auth.ts` (scrypt `N=2^15,r=8,p=1`, 32-byte salt, `timingSafeEqual`; session id 256-bit random, SHA-256 stored; idle 12 h / absolute 7 d; `last_seen_at` throttled to 1/min), `apps/api/src/plugins/auth.ts` (cookie → `request.user`; Bearer → `request.principal` via SHA-256 lookup; `requireUser`/`requirePrincipal` hooks), `apps/api/src/routes/auth.ts` (`POST /auth/sign-in` rate-limited 5/min per IP+email, `POST /auth/sign-out`, `GET /auth/me` per `Me` schema; `Secure` relaxed only for `CDEVI_ENV=development` on localhost) (T025 passes)
- [X] T027 [P] Write failing tests `apps/api/tests/ingest.test.ts`: `FR-021 unknown token → 401`, `disabled principal → 401`, `project outside scope → 403`, `unknown project → 404`; `PUT /ingest/workflows/{ext}` creates with state QUEUED|RUNNING and appends a transition with principal_id; `FR-021 out-of-order transition (observedAt ≤ state_observed_at) → 200 outcome=stale, state unchanged, ingestion_log outcome=stale`; `terminal states reject further transitions → 409 invalid-transition, ingestion_log rejected`; `every transition in data-model.md §3 table accepted, every other pair 409`; `started_at set on first RUNNING; finished_at on COMPLETED/CANCELLED`; `PUT /ingest/approvals` second pending request for the same workflow → 409; `decision` resolves approval; `PUT /ingest/clarifications` with `answer` resolves; `FR-021 invalid body → 400 Problem with errors[] and nothing written`
- [X] T028 Implement `apps/api/src/services/ingestion.ts` (upsert workflow by `(organization_id, external_id)` with `SELECT … FOR UPDATE`; apply `canTransition` from `@cdevi/contracts`; ordering guard; side effects on `started_at`/`finished_at`/`state_reason`/stage; at-most-one pending request per workflow; write `ingestion_log` for every outcome incl. `forbidden`) and `apps/api/src/routes/ingest.ts` (`PUT /ingest/workflows/{externalId}`, `POST /ingest/workflows/{externalId}/transitions`, `PUT /ingest/approvals/{externalId}`, `PUT /ingest/clarifications/{externalId}`) per contracts/openapi.yaml (T027 passes)
- [X] T029 [P] Write failing tests `apps/api/tests/stream.test.ts`: `GET /inbox/stream` requires session; emits `event: inbox.changed` with `id` = `inbox_change_log.seq` within 1 s of an ingestion write to a visible project; does NOT emit for a project the user cannot see; heartbeat comment every 25 s (fake timers); `SC-007 reconnect with Last-Event-ID replays exactly the missed events once`; 50 concurrent clients all receive one event
- [X] T030 Implement `apps/api/src/plugins/notify.ts` (dedicated `pg.Client` `LISTEN inbox_changed`, reconnect with back-off, in-process `EventEmitter`, `listenerConnected` for `/healthz`; prune `inbox_change_log` older than 24 h on start and hourly) and `GET /inbox/stream` in `apps/api/src/routes/inbox.ts` (`text/event-stream`, replay from `inbox_change_log WHERE seq > lastEventId AND project_id IN visible`, filter live events by `visibleProjects(request.user)`, 25 s heartbeat, cleanup on close) (T029 passes)

### 2e. Web shell (`apps/web`)

- [X] T031 Create `apps/web/next.config.ts` (rewrite `/api/:path*` → `${API_ORIGIN}/api/:path*`; `reactStrictMode`), `apps/web/app/layout.tsx` (imports `@cdevi/design-system/css`, wraps in `ThemeProvider theme="system"`, `lang="en"`), `apps/web/lib/api.ts` (typed `apiFetch` with 5 s `AbortSignal.timeout`, cookie forwarding in server components via `headers()`, `Problem` parsing, redirect to `/sign-in?next=` on 401), `apps/web/lib/session.ts` (`getMe()` cached per request), `apps/web/tests/setup.ts` (jsdom + axe helper `expectAccessible` mirroring the design-system one)
- [X] T032 [P] Write failing component test `apps/web/tests/components/sign-in.test.tsx`: renders `FocusLayout` + `Field`s with `autoComplete="username"`/`"current-password"`; exactly one `Button variant="saffron"`; error shows on the password `Field` with `role="alert"` text `Email or password is incorrect.`; rate-limit renders `Notice tone="error"`; `?next=` limited to same-origin paths; axe clean
- [X] T033 Implement `apps/web/app/(auth)/sign-in/page.tsx` + `SignInForm.tsx` (server action posting `SignInRequest` to `/api/auth/sign-in`, forwarding `Set-Cookie`, redirect to `next` or `/inbox`; `Button loading` while pending) per contracts/ui-inbox-screen.md §3 (T032 passes)
- [X] T034 [P] Write failing component test `apps/web/tests/components/app-shell.test.tsx`: `AppShell variant="full"` with `Side`/`Brand`/`Nav`; first `NavItem` is Inbox with `count` announced as `Inbox, n pending` and `aria-current="page"` on `/inbox`; the nine other `NavItem`s + `NavGroup "Administration"` present; footer shows `organization.name · user.displayName` and a **Sign out** button; no `position: sticky|fixed` in computed styles; axe clean
- [X] T035 Implement `apps/web/app/(app)/layout.tsx` (server: `getMe()`; renders shell from ui-inbox-screen.md §1; Inbox `count` read from a `GET /api/inbox?tab=needsYou&project=<scope>` `counts.needsYou` fetched in the layout and passed down — the same snapshot is reused by the Inbox page via React `cache`), `apps/web/app/(app)/SignOutButton.tsx` (`Button variant="ghost"` → `POST /api/auth/sign-out` → `/sign-in`), placeholder `apps/web/app/(app)/[section]/page.tsx` (`Topbar` + `Card` "This screen arrives with specs/001.", no saffron) (T034 passes)

**Checkpoint**: `pnpm check`, `pnpm test:api` green; `pnpm dev` → `/sign-in` works, `/inbox` renders the shell with a placeholder main; ingestion `curl`s from quickstart §4 return `IngestResult`s and `/api/inbox/stream` emits events.

---

## Phase 3: User Story 1 — See what needs me, decide what to open first (Priority: P1) 🎯 MVP

**Goal**: The **Needs you** tab lists every `WAITING_FOR_HUMAN`/`BLOCKED`/`FAILED` workflow the user may see, with state word, ask, risk badge, age, expiry, stale flag and recommended-answer marker, ordered risk-then-oldest, scoped by the project selector, refreshed within 5 s, each row opening its target screen.

**Independent Test**: Seed S-500 (or the five-item fixture of spec US1), sign in as an approver: all needs-you items appear with correct words, asks, badges and order (CRITICAL/HIGH/MEDIUM/LOW approvals, then risk-less items oldest first); empty/filter/error states render; selecting a row lands on `/approvals/{id}` or `/workflows/{id}`; an ingestion write appears within 5 s.

### Tests for User Story 1

- [X] T036 [P] [US1] Write failing API tests `apps/api/tests/inbox.test.ts` (needsYou scope): `FR-006 lists WAITING_FOR_HUMAN, BLOCKED, FAILED only`; `FR-010 orders by risk rank then raisedAt then id` (spec US1 scenario 6 example); `FR-007/FR-008/FR-009 item fields: ask, riskLevel, expiry.isExpired, isStale (> 24 h strict), hasRecommendedAnswer, href` per contracts/inbox-read-model.md §2–5; `FR-026 page size 50 with nextCursor; invalid cursor shape → 400 invalid-cursor`; `FR-028 project=<id> filters rows and counts; project not visible → 404`; `SC-008 viewer receives only membership projects`; `SC-004 counts equal rows across pages`; `paging over S-500 equals pure orderNeedsYou`; `Server-Timing header present`
- [X] T037 [P] [US1] Write failing component tests `apps/web/tests/components/inbox-needs-you.test.tsx` using an `InboxSnapshot` fixture (`apps/web/tests/fixtures/snapshot-needs-you.ts` covering approval per risk level incl. expired + stale, clarification with recommended answer, blocked, failed): each row is a gate `ListRow` with `href`, `StatePill` word ∈ {needs you, blocked, failed}, `RiskBadge` name ends with "risk" only for approvals, `Pill` "stale"/"expired"/"recommended answer" where flagged, `aria-describedby` resolves to the ask, backtick fragments render as `Mono`; meta shows `project.key · agent · asked 4 min ago · times out in 3 h 56 m`; loading → `List loading` with `aria-busy`; empty (all projects) and empty (project selected) texts per ui-inbox-screen.md §2.4; error → `Notice tone="error"` with Retry; exactly one saffron button on the page; axe clean for every state
- [X] T038 [P] [US1] Write failing Playwright specs `apps/web/tests/e2e/inbox-journey.spec.ts` (sign-in → `/inbox` Needs you selected → first rows are CRITICAL then HIGH → project filter shrinks counts together → Enter on first row → stub page shows same facts → Back to Inbox restores focus on the tab list), `apps/web/tests/e2e/inbox-freshness.spec.ts` (ingest workflow + approval + transition via API with the seeded token; row appears within 5 s p95 over 10 iterations without reload; counts increase together; reconnect replays), `apps/web/tests/e2e/inbox-a11y.spec.ts` (axe zero violations on `/inbox` × {populated, empty, loading, error} via `?e2e-state=` hook enabled only when `CDEVI_ENV=test`) and `apps/web/playwright.config.ts` (`webServer` for api + web, fresh migrate + seed in `globalSetup`, `page.clock` fixed)

### Implementation for User Story 1

- [X] T039 [US1] Implement `apps/api/src/services/inbox-query.ts` for tab `needsYou`: single `REPEATABLE READ` transaction returning `counts` (all three, via one grouped `COUNT` over visible projects/scope), `items` (SQL `CASE` for `risk_rank`, `LEFT JOIN LATERAL` pending approval/clarification, `ORDER BY risk_rank, raised_at, id`, keyset `WHERE (risk_rank, raised_at, id) > ($1,$2,$3)`, `LIMIT 50`), `generatedAt`, computing `ask`/`kind`/`isStale`/`expiry`/`href` with the `@cdevi/contracts` functions on the fetched rows; `visibleProjects(user)` helper in `apps/api/src/services/permissions.ts`
- [X] T040 [US1] Implement `GET /inbox` in `apps/api/src/routes/inbox.ts` per `InboxSnapshot` (query schema from `@cdevi/contracts`; `project` not visible → 404; `Server-Timing: db;dur, total;dur`; `today` and `policySummary` may return zeros/default text until US4) (T036 passes)
- [X] T041 [P] [US1] Implement `apps/web/lib/inbox-stream.ts` (`EventSource('/api/inbox/stream')` or `NEXT_PUBLIC_API_STREAM_URL`; on `inbox.changed` debounce 250 ms → callback; back-off 1 s → 30 s; `Last-Event-ID` handled natively) and `apps/web/lib/format.ts` re-exporting `humanAgo`/`humanDuration`/`expiryLabel` from `@cdevi/contracts`
- [X] T042 [US1] Implement `apps/web/app/(app)/inbox/page.tsx` (server: parse `?tab&project`, fetch snapshot via `apiFetch`, render `InboxScreen`) and `apps/web/app/(app)/inbox/InboxScreen.tsx` (client) for the Needs you tab per contracts/ui-inbox-screen.md §2.1–2.4 and §2.6: `Topbar` h1 + saffron **New requirement** (enabled/disabled per `me.canCreateRequirement`, wrapped in `ActionBar help` when disabled), `PageMeta` with `Field`+`Select` project scope (updates URL, refetch) and demo `Pill`, `Tabs`/`Tab count` (Running/Done tabs render `List empty` placeholders until US2), `TabPanel` → `List loading|empty` → `ListRow`s (`InboxRowNeedsYou.tsx`), **Load more** ghost button appending the next page and moving focus to the first new row, SSE-triggered refetch replacing the whole snapshot, focus fallback to tab list when the focused row disappears (T037 passes)
- [X] T043 [P] [US1] Implement record stubs `apps/web/app/(app)/approvals/[id]/page.tsx` and `apps/web/app/(app)/workflows/[id]/page.tsx` per ui-inbox-screen.md §4, backed by `GET /api/inbox/records/{kind}/{id}` — add that read-only route to `apps/api/src/routes/inbox.ts` (returns the `InboxItem` plus `decision`/`answer` facts; 403 and 404 both → 404 Problem) with tests appended to `apps/api/tests/inbox.test.ts` (`record route hides items outside visible projects`); stub shows `Notice tone="info"`, `KeyValue` facts, resolved marker, **Back to Inbox** link carrying `tab`/`project`
- [X] T044 [US1] Add `/inbox` to the visual baseline: `packages/design-system/tests/visual/inbox.spec.ts` (or `apps/web/tests/e2e/inbox-visual.spec.ts`) screenshot of Needs you with S-500 at 1440×900, light and dark; commit baselines; run T038 specs until green

**Checkpoint**: US1 independently demonstrable: `pnpm test:api`, `pnpm test -- --project web`, `pnpm test:e2e -- inbox-journey inbox-freshness inbox-a11y` green.

---

## Phase 4: User Story 2 — See running and recently finished work (Priority: P2)

**Goal**: **Running** lists `QUEUED/RUNNING/RETRYING/WAITING` with stage and elapsed time, newest started first; **Done** lists `COMPLETED/CANCELLED` from the last 7 days with PR reference, newest finished first; tab counts are true totals; keyboard tab behaviour verified.

**Independent Test**: With S-500, Running shows 100 (QUEUED rows last, `stage n of 7 · name`, elapsed), Done shows ~305 (COMPLETED with PR refs, CANCELLED struck through, none older than 7 days); Load more pages both; selecting a row opens `/workflows/{id}`.

### Tests for User Story 2

- [X] T045 [P] [US2] Extend `apps/api/tests/inbox.test.ts`: `FR-014 running lists QUEUED, RUNNING, RETRYING, WAITING ordered started_at DESC NULLS LAST, id`; `FR-015 done lists COMPLETED, CANCELLED with finished_at ≥ now − 7 d ordered finished_at DESC, id; older rows excluded and not counted`; `stage {index,count,name}, startedAt, finishedAt, pullRequestRef populated`; `paging over S-500 equals pure orderRunning/orderDone`; `counts.running/done true totals under project filter`
- [X] T046 [P] [US2] Write failing component tests `apps/web/tests/components/inbox-running-done.test.tsx` with fixtures `snapshot-running.ts`/`snapshot-done.ts`: rows are non-gate `ListRow`s (no `ask`, no `aria-describedby`), `StatePill` words ∈ {queued, running, retrying, waiting} / {completed, cancelled} with cancelled struck through, meta `project.key · agent · stage 2 of 7 · Implementation · 12 min` / `… · completed 2 h ago · PR #412`, QUEUED meta `queued 5 min ago`; empty texts "No workflows are running." / "Nothing finished in the last 7 days."; tab names announced `Running, 100` / `Done, 305`; axe clean
- [X] T047 [P] [US2] Write failing Playwright spec `apps/web/tests/e2e/inbox-keyboard.spec.ts` implementing ui-inbox-screen.md §6 walk-through: Tab order Sign out → project Select → tab list; ←/→/Home/End move and select; Enter opens first row; **Back to Inbox** returns focus to the tab list of the same tab; focus visible at every stop; asserts names `Inbox, n pending`, `Needs you, n`, `Running, n`, `Done, n`

### Implementation for User Story 2

- [X] T048 [US2] Extend `apps/api/src/services/inbox-query.ts` with tabs `running` (`ORDER BY started_at DESC NULLS LAST, id`, keyset on `(started_at, id)`) and `done` (`WHERE state IN ('COMPLETED','CANCELLED') AND finished_at >= now − interval '7 days'`, `ORDER BY finished_at DESC, id`), populating `stage`, `startedAt`, `finishedAt`, `pullRequestRef`; `counts.done` uses the same 7-day predicate (T045 passes)
- [X] T049 [US2] Implement `apps/web/app/(app)/inbox/InboxRowRunning.tsx` and `InboxRowDone.tsx` and wire the Running/Done `TabPanel`s in `InboxScreen.tsx` (URL `?tab=` source of truth, `Load more` per tab, empty texts) (T046 passes); run T047 until green

**Checkpoint**: US1 + US2 work independently; all three tabs deep-linkable.

---

## Phase 5: User Story 3 — Start new work from the home page (Priority: P3)

**Goal**: **New requirement** is the single saffron action, enabled for engineer/approver/administrator and disabled-with-explanation for viewers, leading to the requirement-creation placeholder.

**Independent Test**: Sign in as engineer → button enabled → opens `/requirements/new`; sign in as viewer → button disabled, help text explains the role, `/requirements/new` by URL shows the role notice.

### Tests for User Story 3

- [X] T050 [P] [US3] Extend `apps/api/tests/auth.test.ts`: `FR-002 canCreateRequirement true for engineer, approver, administrator; false for viewer`
- [X] T051 [P] [US3] Write failing component test `apps/web/tests/components/new-requirement.test.tsx`: enabled saffron `Button` with `href="/requirements/new"` for `canCreateRequirement=true`; for `false` the button is `disabled`, wrapped in `ActionBar help="Your role (Viewer) cannot create requirements."` and `aria-describedby` points at the help; the page still has exactly one saffron button; `/requirements/new` placeholder renders `Notice tone="info"` for viewers; axe clean
- [X] T052 [P] [US3] Extend `apps/web/tests/e2e/inbox-journey.spec.ts` with a viewer session: button disabled with help text; rows limited to memberships (`SC-008`)

### Implementation for User Story 3

- [X] T053 [US3] Implement `canCreateRequirement` in `apps/api/src/routes/auth.ts` `GET /auth/me` (T050 passes) and `apps/web/app/(app)/inbox/NewRequirementButton.tsx` consuming `me.canCreateRequirement`; implement placeholder `apps/web/app/(app)/requirements/new/page.tsx` per ui-inbox-screen.md §5 (T051, T052 pass)

**Checkpoint**: Role-gated primary action verified for all four roles.

---

## Phase 6: User Story 4 — See today's numbers at a glance (Priority: P3)

**Goal**: The right panel shows **Today** (workflows started, completed, approvals decided, needs you — each a link, zeros shown) in the organisation's time zone and the one-line workspace policy linking to `/policies`, all scoped by the project selector.

**Independent Test**: With S-500 and a fixed clock, the four figures match SQL over the seed for the org time zone window; each links to the filtered list; a project filter changes them; with no activity they show 0.

### Tests for User Story 4

- [X] T054 [P] [US4] Extend `apps/api/tests/inbox.test.ts`: `FR-017 today counts (workflowsStarted, workflowsCompleted, approvalsDecided, needsYou) computed from startOfDay(now, organization.timezone)`; `timezone boundary: an event at 23:30 local yesterday is excluded, 00:30 today included (use timezone Asia/Colombo)`; `today.needsYou.value === counts.needsYou`; `hrefs per inbox-read-model.md §10`; `policySummary.text from organizations.policy_summary, href /policies`; `zeros when no activity`; `project filter applies`
- [X] T055 [P] [US4] Write failing component test `apps/web/tests/components/inbox-today.test.tsx`: `Panel` → `PanelBlock "Today"` → `KeyValue` with four rows whose values are links with the snapshot `href`s and render `0`; `PanelBlock "Workspace policy"` → `Card` with the text and a link to `/policies`; below 960 px (jsdom `matchMedia` mock) the panel still renders after the list; axe clean

### Implementation for User Story 4

- [X] T056 [US4] Implement `todaySummary()` in `apps/api/src/services/inbox-query.ts` (window from `organizations.timezone` via `date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz`, filtered by scope) and `policySummary` in `GET /inbox` (T054 passes)
- [X] T057 [US4] Implement `apps/web/app/(app)/inbox/InboxPanel.tsx` (Today `KeyValue` links, policy `Card`) and render it in `InboxScreen.tsx` inside `Panel`; add `/policies` to the placeholder routes (T055 passes)

**Checkpoint**: All four stories independently functional; nav count, tab count and Today agree under both scopes (SC-004).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Budgets, documentation, cleanup and final evidence (quickstart §6–7).

- [X] T058 [P] Add `apps/api/scripts/perf.ts` (`autocannon`: `GET /api/inbox?tab=needsYou&project=all` 30 s × 20 conns → assert p95 ≤ 300 ms, p99 ≤ 600 ms; `PUT /api/ingest/workflows/{id}` 30 s × 10 conns → p95 ≤ 200 ms; exit 1 on breach) wired as `pnpm -F @cdevi/api perf` and run in CI `e2e`
- [X] T059 [P] Extend `tools/check-size.mjs` with budgets: `apps/web/.next` first-load JS for route `/inbox` ≤ 200 KB gzip (read `.next/app-build-manifest.json`), `GET /api/inbox` payload for 50 rows ≤ 64 KB (read a fixture produced by `apps/api/tests/inbox.test.ts`), design-system CSS still ≤ 40 KB after 1.2.0; add tests in `tools/tests/check-size.test.mjs` for the new rules
- [X] T060 [P] Write Playwright `apps/web/tests/e2e/inbox-perf.spec.ts` (20 cold loads of `/inbox` with S-500 → LCP p95 ≤ 2 s) and `apps/web/tests/e2e/sse-through-rewrite.spec.ts` (first SSE event < 1 s after connect through the Next rewrite; documents the direct-origin fallback via `NEXT_PUBLIC_API_STREAM_URL`)
- [X] T061 [P] Update `docs/architecture.md` per research.md "Architecture document updates required": §2 (`api` ingestion API, `web` Inbox), §4 (ingestion row; sign-in row → email/password server-side session), §6 (email/password now, SSO later; `app_user`/`migrator`), §8 (`packages/contracts`, `packages/db` landed by specs/003; `apps/web-scratch` removed)
- [X] T062 [P] Update `AGENTS.md` Commands section with `pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:api`, `pnpm test:e2e`, `pnpm perf:api`, `docker compose up -d`, and a "Backend work" paragraph (Zod contracts are the single source; migrations are hand-reviewed SQL; the `api` Vitest project needs `DATABASE_URL`)
- [X] T063 Remove `apps/web-scratch/` (its US1 conformance trial from specs/002 is superseded by `apps/web`); update `specs/002-adopt-design-system/quickstart.md` reference to it and any `pnpm-workspace`/CI mention; run `pnpm i` to refresh the lockfile
- [X] T064 Security pass: verify `apps/api` logs contain no `email`, `ask`, `question` or token values (add `apps/api/tests/logging.test.ts` capturing pino output during sign-in and ingestion); confirm `Problem.detail` never contains SQL (test with a forced DB error); confirm seed refusal under `CDEVI_ENV=production` in `packages/db/tests/seed.test.ts`; add `Cache-Control: no-store` on `/api/auth/*` and `/api/inbox*`
- [X] T065 Run the full quickstart (done 2026-09-14: pnpm check 294 tests, test:e2e 17, test:visual 67, perf p97.5 13 ms / 4 ms, check:size 154 KB gzip; SC-002 hallway test still to be recorded in the PR): `pnpm check`, `pnpm test:api`, `pnpm test:e2e`, `pnpm test:visual`, `pnpm perf:api`, `pnpm check:size`, the manual walk-through of quickstart §4 (record results in the PR description), and confirm every FR-001…FR-030 has a named test (grep test titles for `FR-0` and list gaps)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002–T006 in parallel after it.
- **Foundational (Phase 2)**: depends on Phase 1. Internal order: 2a (T007–T009 parallel → T010–T012 → T013), 2b (T014, T015 parallel → T016, T017 → T018), 2c (T019 → T020 → T021 → T022; T023 parallel with T022), 2d (T024 → {T025→T026, T027→T028, T029→T030}; T028 needs T017 + T021; T030 needs T021), 2e (T031 → {T032→T033, T034→T035}; T033 needs T012 + T026; T035 needs T010/T011 exports and T040's route shape — use the `InboxSnapshot` type from T016 and a stub count until US1). 2a, 2b, 2c can proceed in parallel; 2d after 2b + 2c; 2e after 2a + 2b.
- **US1 (Phase 3)**: after Phase 2. T036–T038 parallel first; T039 → T040; T041 parallel with T039; T042 after T040 + T041; T043 parallel with T042 (after T040); T044 last.
- **US2 (Phase 4)**: after US1 (extends `inbox-query.ts` and `InboxScreen.tsx`). T045–T047 parallel; T048 → T049.
- **US3 (Phase 5)**: after Phase 2 for the API part (T050 → T053 auth half); web half needs T042. T050–T052 parallel.
- **US4 (Phase 6)**: after T040 (API) and T042 (web). T054/T055 parallel; T056 → T057.
- **Polish (Phase 7)**: T058–T062 parallel after all stories; T063, T064 after T035; T065 last.

### User Story Dependencies

- **US1 (P1)**: only Phase 2. Delivers the MVP.
- **US2 (P2)**: builds on US1's `GET /inbox` and `InboxScreen`; independently testable via its own tabs and tests.
- **US3 (P3)**: API part independent; button lives in US1's Topbar but is testable via `NewRequirementButton` alone.
- **US4 (P3)**: adds fields to US1's snapshot; independently testable via `InboxPanel` and the `today` tests.

### Within Each User Story

- Failing tests (`[P]`) first, then services → routes → web components → e2e green.
- Never add `cd-` classes or `style=` in `apps/web`; if a pattern is missing, add a design-system task before the consumer (as in 2a).

### Parallel Opportunities

- Phase 1: T002–T006 (5 tasks) in parallel.
- Phase 2: three tracks (design system 2a · contracts 2b · database 2c) fully parallel; then 2d and 2e in parallel; within 2d the three test/impl pairs are parallel.
- US1: T036/T037/T038 in parallel; T039 ∥ T041; T042 ∥ T043.
- Polish: T058–T062 in parallel.

---

## Parallel Example: User Story 1

```bash
# Failing tests together:
Task: "T036 API tests apps/api/tests/inbox.test.ts (needsYou scope)"
Task: "T037 component tests apps/web/tests/components/inbox-needs-you.test.tsx + fixtures"
Task: "T038 Playwright specs inbox-journey / inbox-freshness / inbox-a11y + playwright.config.ts"

# Then implementation in two lanes:
Lane A: T039 inbox-query.ts (needsYou) → T040 GET /inbox → T043 record stubs + records route
Lane B: T041 inbox-stream.ts + format.ts → (after T040) T042 InboxScreen needs-you tab
Finally: T044 visual baseline + run e2e until green
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup (T001–T006).
2. Phase 2 Foundational (T007–T035) — this is the bulk of the feature: design-system 1.2.0, contracts, database + seed, auth, ingestion, SSE, shell + sign-in.
3. Phase 3 US1 (T036–T044).
4. **STOP and VALIDATE**: quickstart §4 steps 1–3, 5–6, 8 and `pnpm test:e2e -- inbox-journey inbox-freshness inbox-a11y`.
5. Demo: sign in, triage Needs you, open a row, watch a live ingestion appear.

### Incremental Delivery

1. Setup + Foundational → API and shell usable (`/healthz`, sign-in, ingestion, stream).
2. US1 → MVP Inbox (Needs you).
3. US2 → Running and Done tabs + keyboard proof.
4. US3 → role-gated New requirement.
5. US4 → Today panel and policy line.
6. Polish → budgets enforced in CI, docs, cleanup.

### Parallel Team Strategy

- Developer A: 2a design-system + 2e web shell → US1 web (T037, T041, T042) → US2 web → US3/US4 web.
- Developer B: 2b contracts + 2c database → 2d API → US1 API (T036, T039, T040, T043) → US2/US4 API → perf.
- Developer C (optional): T038 Playwright harness + e2e specs, T005 CI, Polish T058–T062.

---

## Notes

- Constraints quoted in tasks (lengths, enums, cookie flags, scrypt parameters, page size 50, 7-day window, 24 h stale, 25 s heartbeat, back-off caps) are normative — do not relax them to pass a test; fix the code.
- Every API test title starts with the spec id it proves (`FR-…`/`SC-…`) so T065 can audit coverage.
- Commit after each task or logical group; design-system changes carry their CHANGELOG line in the same commit (DR-10).
- Stop at any checkpoint to validate the story independently.
