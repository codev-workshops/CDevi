# Research: Inbox Home Page

**Feature**: 003-inbox-home | **Date**: 2026-09-14 | **Plan**: [plan.md](plan.md)

Inputs: `spec.md` (FR-001…FR-030, SC-001…SC-009, Clarifications), `docs/architecture.md` (defaults a plan must follow or explicitly deviate from), `.specify/memory/constitution.md` v1.1.0, `packages/design-system/DESIGN.md`, current repo state (design system 1.1.0 + `apps/web-scratch`; no backend). Each decision below resolves an unknown from the plan's Technical Context or a dependency/integration choice. Package versions were checked on the npm registry on 2026-09-14; exact pins are chosen at install time (R13).

---

## R1 — Web framework and rendering model

**Decision**: Next.js 16 (App Router) in `apps/web`. Server components fetch `GET /api/inbox` for the initial render (fast first content, no client waterfall); a small client component (`InboxScreen`) owns tab state, the project selector, the SSE subscription and refetches. `next.config.ts` rewrites `/api/*` to the API origin so the session cookie is first-party.

**Rationale**: `docs/architecture.md` §2 names Next.js for `web`; server rendering gives the Inbox its content in the first response, which is what SC-003 (≤ 2 s p95 first meaningful content) measures. The rewrite keeps cookies `SameSite=Lax` without CORS. Next 16 supports React 19.2 already pinned in the repo.

**Alternatives considered**: Vite SPA (what `apps/web-scratch` uses) — simplest, but every page load becomes fetch-after-hydrate and it contradicts the architecture default; would need justification the feature does not have. Remix/React Router framework mode — comparable, but a second opinion versus the architecture doc for no gain.

**Risk noted**: Server-Sent Events through the Next rewrite must stream, not buffer. quickstart §5 verifies it; fallback is a direct browser → API origin connection with `credentials: 'include'` and a CORS allow-list of the web origin (both paths are implemented behind `NEXT_PUBLIC_API_STREAM_URL`).

## R2 — Authentication: CDevi-managed email/password (architecture deviation)

**Decision**: `POST /api/auth/sign-in` verifies `scrypt` hashes (`node:crypto`, N = 2^15, r = 8, p = 1, 32-byte salt, constant-time compare), creates a **server-side session** row (random 256-bit id, SHA-256 stored) and sets cookie `cdevi_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`; 12 h idle, 7 d absolute). Errors are one generic message; `@fastify/rate-limit` caps sign-in at 5/min per IP+email. Sign-out deletes the session. No self-service sign-up or reset (FR-005); accounts are created by the seed or `pnpm db:user:create`.

**Rationale**: Clarification Q5 chose email/password. `scrypt` is in Node core (no native build, OWASP-accepted); server-side sessions can be revoked and carry `role` + `organization_id` for `SET LOCAL app.user_id/app.organization_id` (architecture §6). `Secure` is relaxed only when `NODE_ENV=development` on `http://localhost`.

**Alternatives considered**: argon2id via `@node-rs/argon2` — stronger memory-hardness but a native binary in the image; revisit if password policy tightens. JWT in cookie — stateless, but no revocation and larger cookies; unnecessary at tens of users. External identity provider (architecture §4 default) — explicitly declined by the product owner for this feature; architecture §4/§6 are updated to say "email/password now; SSO later without changing roles or memberships".

## R3 — Authorization model

**Decision**: One `role` per user (`administrator | approver | engineer | viewer`) and a `project_memberships` table. **Administrators implicitly see all projects**; everyone else sees only projects they are members of. `New requirement` is enabled for `engineer | approver | administrator`. All filtering is done in SQL (`WHERE project_id IN (visible projects)`) inside the API; the web never receives rows it may not show (FR-027, SC-008).

**Rationale**: Matches `specs/001` FR-032 roles and keeps permission logic in one place. Implicit admin visibility avoids seeding memberships for admins and matches "Administrator" semantics.

**Alternatives considered**: Per-project roles — richer, but `specs/001` defines organisation-level roles; deferred. Row-level security as the only filter — RLS policies are *written* (architecture §6) but flag-disabled in MVP, so the API filter is the enforced path and RLS is defence in depth later.

## R4 — API framework and validation

**Decision**: Fastify 5 in `apps/api` with `fastify-type-provider-zod`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/swagger` (serving the OpenAPI document generated from the same Zod schemas). Routes are grouped as plugins (`auth`, `inbox`, `ingest`, `health`). Errors use a fixed problem shape `{ type, title, status, detail?, errors? }` with no stack or SQL text.

**Rationale**: Architecture §2 names Fastify. Zod 4 schemas in `packages/contracts` become the single source for request/response types (web and API), runtime validation at the trust boundary (Principle I) and the committed `contracts/openapi.yaml` (snapshot-tested so drift fails CI).

**Alternatives considered**: Hono — lighter, but the architecture already standardises Fastify. tRPC — excellent for web↔api types but the **ingestion API is consumed by external systems**, which need a plain, documented HTTP contract.

## R5 — Persistence: PostgreSQL + Drizzle + SQL migrations

**Decision**: PostgreSQL 17. `packages/db` holds a Drizzle schema (types for queries), **hand-reviewed SQL migrations** generated by `drizzle-kit generate` then edited to add triggers, partial indexes and RLS policies (Drizzle does not model those). Two DB roles: `migrator` (runs migrations from a job) and `app_user` (no `BYPASSRLS`, used by the API). Every table has `organization_id`. `updated_at` and `NOTIFY inbox_changed` are triggers. Read queries for the Inbox are written in SQL (Drizzle `sql` tag) because the ordering/derivation is set-based and must match the pure read-model functions (R8).

**Rationale**: Architecture §1/§6. Drizzle is TypeScript-first, SQL-transparent and has no runtime engine; migrations as SQL files keep triggers and RLS reviewable in diffs. Postgres `LISTEN/NOTIFY` also removes the need for a message broker for SSE (R6).

**Alternatives considered**: Prisma — good DX but a query engine binary and weaker raw-SQL ergonomics for triggers/RLS. Kysely — comparable to Drizzle; Drizzle chosen for its migration tooling and wider community. SQLite for MVP — would make `LISTEN/NOTIFY` and RLS impossible and contradicts the architecture.

## R6 — Freshness: SSE notifications over Postgres LISTEN/NOTIFY

**Decision**: Row-level triggers on `workflows`, `approvals`, `clarifications` `NOTIFY inbox_changed` with payload `{organizationId, projectId, workflowId, seq}`. The API keeps one dedicated `pg` client per process in `LISTEN`, fans out to connected `GET /api/inbox/stream` clients whose session's visible projects include `projectId`. Events are `id: <seq>`, `event: inbox.changed`, `data: {projectId, workflowId}`. The browser, on any event, **refetches `GET /api/inbox` once** (debounced 250 ms) so counts, tabs and Today all come from the same snapshot (spec assumption "counts and lists are refreshed together"). On reconnect the client sends `Last-Event-ID`; the API replays from `inbox_change_log` (a small table the trigger also inserts into, pruned to 24 h) so nothing is missed (SC-007, `specs/001` FR-034). Heartbeat comment every 25 s; client back-off 1 s → 30 s.

**Rationale**: Architecture §4 "Streaming to the browser" prescribes exactly this. Notification-only payloads keep the stream free of authorisation logic — the refetch is a normal permission-filtered query.

**Alternatives considered**: Polling every 5 s — simplest, but 500 workflows × tens of viewers is needless load and p95 freshness would sit near the 5 s limit rather than comfortably under it. WebSockets — bidirectional not needed; SSE works through the Next rewrite and with plain cookies. Redis pub/sub — an extra service the architecture explicitly avoids.

## R7 — Ingestion API for records (architecture addition)

**Decision**: An authenticated write path for the future agent orchestrator and for tests:
- `PUT /api/ingest/workflows/{externalId}` — create or update the workflow's descriptive fields (title, project, agent, stage, PR reference) and, if `state` is included, apply a transition.
- `POST /api/ingest/workflows/{externalId}/transitions` — append a transition `{toState, observedAt, reason?, stageIndex?, stageName?}`.
- `PUT /api/ingest/approvals/{externalId}` and `PUT /api/ingest/clarifications/{externalId}` — raise/update/resolve; resolving implies the workflow leaves `WAITING_FOR_HUMAN` only when the ingesting system says so via a transition (the API does not infer).
- Authentication: `Authorization: Bearer <token>`; the token is issued once (`pnpm db:ingest-key:create --project ...`), stored as SHA-256, scoped to a set of project ids (FR-021).
- **Idempotency & ordering**: every write carries `observedAt`. A transition whose `observedAt` ≤ the workflow's `state_observed_at` is stored in `ingestion_log` with `outcome='stale'` and does **not** change state (spec edge case "out of order"). Illegal transitions (see data-model state machine) → `409` with `outcome='rejected'`. Unknown project or project outside the principal's scope → `404`/`403`. All outcomes are logged with the principal id.

**Rationale**: Clarification Q4 chose "ingestion interface + seed". It is the seam the architecture's `agent-orchestrator` will call, so `docs/architecture.md` §4 gains a row "Ingestion (orchestrator / external system) → api → Postgres → NOTIFY → web stream" and §2 notes that until the orchestrator exists this is the only write path for workflow state.

**Alternatives considered**: Direct DB writes from tests — no production write path, and permission logic untested. Message-queue intake — the architecture's outbox/engine are not in this feature; HTTP is sufficient and simpler to call from tests and shell.

## R8 — Inbox read model: computed in SQL, specified as pure functions

**Decision**: `packages/contracts/src/read-model.ts` holds pure functions — `classifyTab(state)`, `orderNeedsYou(a, b)`, `deriveAsk(item)`, `isStale(raisedAt, now)`, `expiryLabel(expiresAt, now)` — that are the **normative** definition (contracts/inbox-read-model.md) and are unit-tested with fixtures. `apps/api/src/services/inbox-query.ts` implements the same rules in SQL (`CASE` for tab and risk rank; `ORDER BY risk_rank, raised_at, id` for Needs you; `started_at DESC, id` / `finished_at DESC, id` for the others) with **keyset pagination** on the same keys. An API test loads the S-500 seed, fetches every page, and asserts the concatenation equals the pure-function ordering of the same rows — the two implementations cannot drift silently.

**Rationale**: Ordering over 500+ rows must happen in the database (Principle IV); correctness must be testable without a database (Principle II). The web reuses the pure functions only to stably re-sort the current page after an SSE refresh.

**Alternatives considered**: Materialised view — unnecessary at this size and complicates freshness. Ordering in the API after fetching all rows — unbounded.

## R9 — Navigation targets that do not exist yet

**Decision**: Rows link to `/approvals/{approvalId}` (approvals, clarifications) and `/workflows/{workflowId}` (blocked, failed, running, done). Both routes render a **read-only record stub** — `PageMeta` + `Card` + `KeyValue` with the same facts as the row plus a `Notice tone="info"` "Decisions are made here once the Approval Center / Workflow Detail (specs/001) ships." Other navigation entries render a placeholder page. **New requirement** links to `/requirements/new`, also a placeholder. No dead links, no fake decision controls (FR-012 forbids inline decisions anyway).

**Rationale**: Spec FR-012/FR-016 require navigation to exist; `specs/001` owns the real screens. Stubs make the journey testable end to end and are replaced, not extended, later.

**Alternatives considered**: Disabling row links until 001 ships — violates "selecting a row takes the user to…" and makes the e2e journey untestable. Building a partial Approval Center here — scope creep the product owner rejected (Q2).

## R10 — Design-system additions

**Decision**: Bump `@cdevi/design-system` 1.1.0 → **1.2.0** with three additive changes, each following DESIGN.md §8 before `apps/web` consumes it:
1. **`Notice`** (`tone: 'info' | 'error'`, `action?: ReactNode`, `role` = `status` for info, `alert` for error) — load error with retry, session expired, demonstration-data banner.
2. **`List loading?: boolean`** — `aria-busy`, three `.cd-row.cd-skeleton` placeholders (no animation under reduced motion), never renders the `empty` text while loading.
3. **`FocusLayout`** — `<main class="cd-root cd-focus">` centring one `Card` with a `Brand` slot, for sign-in.

Everything else in the spec maps to existing components (see plan "Components used"): stale/expired/recommended/demo are `Pill variant="neutral"` words; the project selector is `Field` + `Select`; disabled primary uses `Button disabled` + `ActionBar help`.

**Rationale**: DR-09 — no local styling; the reference `inbox.html` is a pattern, and the React `ListRow` already carries `ask`/`meta`/`trailing`/`href` and `Tab` carries `count`, so the row and tabs need no new component.

**Alternatives considered**: Rendering skeletons/notices with app CSS — forbidden by the constitution. A dedicated `InboxRow` component — premature; `ListRow` gate rows were designed for exactly this.

## R11 — Testing strategy and CI shape

**Decision**:
- Vitest projects: existing `design-system`, `tools`; new `contracts` (pure), `web` (jsdom, `@testing-library/react`, axe), `api` (node, real Postgres, `DATABASE_URL`; each test runs inside a transaction that is rolled back; clock injected via `app.decorate('now', ...)`).
- Playwright in `apps/web/tests/e2e`: web + api started by `webServer` against a database freshly migrated and seeded with S-500; fixed clock via `page.clock`; specs for the journey, keyboard, axe per state, LCP, SSE freshness (ingest via API → row appears).
- CI: `unit` job gets a `postgres:17` service; new required `e2e` job (migrate, seed, build, Playwright); `visual` job unchanged plus new gallery entries; `perf` runs `autocannon` in the `e2e` job and fails on budget breach.
- Local: `docker-compose.yml` with Postgres; `pnpm dev` runs api + web; `pnpm db:migrate`, `pnpm db:seed`.

**Rationale**: Principle II — live dependency (Postgres) confined to identified suites with reproducible setup; determinism through transaction rollback, fixed RNG seed and fixed clocks; e2e covers the critical journey. Same seed for tests, perf and demo keeps budgets and behaviour on one workload.

**Alternatives considered**: `pg-mem` for API tests — does not support triggers/NOTIFY/partial indexes faithfully; would test a different database. Testcontainers — fine locally but Docker-in-CI is slower than a service container.

## R12 — Seed design (S-500)

**Decision**: `packages/db/src/seed/s500.ts` builds 500 workflows deterministically (seeded PRNG `mulberry32(20260914)`, base time `2026-09-14T09:00:00Z`) across 4 projects (`payments-api`, `web-app`, `storefront`, `platform`), 5 agents, 20 users (1 admin, 4 approvers, 10 engineers, 5 viewers, password `cdevi-demo-…` printed once), 1 ingestion key. Needs-you mix covers every spec kind: approvals at each risk level (with and without expiry, one expired), clarifications with and without recommended answer, blocked, failed, one item > 24 h (stale). Running mix covers `QUEUED/RUNNING/RETRYING/WAITING`; Done covers `COMPLETED` (with PR refs) and `CANCELLED`, spread over 8 days so the 7-day window is exercised. The organization row gets `is_demo = true` → demonstration-data `Pill`/`Notice`. The seed **refuses** to run when `NODE_ENV` or `CDEVI_ENV` is `production` (FR-022).

**Rationale**: FR-022 and the perf workload need one reproducible dataset; covering every row kind makes the visual baselines and e2e assertions exhaustive.

**Alternatives considered**: Faker-style random data — non-deterministic screenshots and flaky ordering assertions.

## R13 — Dependency pinning

**Decision**: Every new dependency is pinned to an exact version whose publish date is ≥ 7 days before the install date (checked with `npm view <pkg> time --json` during the setup task); `pnpm-lock.yaml` committed. Registry state on 2026-09-14 (latest publish dates): `next` 16.3.x (12 Sep — pick the prior 16.3 patch), `fastify` 5.12.x (11 Sep — prior patch), `drizzle-orm` 0.45.x / `drizzle-kit` 0.31.x (9 Sep — prior patch), `zod` 4.6.x (13 Sep — prior patch), `pg` 8.23.0 (Aug), `@fastify/cookie` 11.1.x, `@fastify/rate-limit` 11.2.x, `@fastify/swagger` 9.8.x, `@fastify/cors` 11.3.x (4 Sep — prior patches), `fastify-type-provider-zod` 7.0.0 (Jun), `@playwright/test` 1.63.0 (14 Sep — use 1.62.x), `autocannon` (dev only).

**Rationale**: AGENTS.md rule and supply-chain hygiene.

## R14 — Observability sufficient for the budgets

**Decision**: Fastify's `pino` request logging with `reqId`, route, status, `responseTime`; `Server-Timing: db;dur=…, total;dur=…` on `GET /api/inbox`; `/healthz` returns `{status, dbRoundTripMs, listenerConnected}`; the SSE plugin logs connect/disconnect and replay counts. No user emails or asks in logs (only ids). OpenTelemetry (`packages/telemetry`) is deferred to a later feature; the log fields are named to match its semantic conventions so migration is mechanical.

**Rationale**: Principle IV requires measurements sufficient to verify budgets without sensitive data; FR-023 asks for latency and item counts.

**Alternatives considered**: Full OTel now — an extra package and a collector to run; not needed to verify this feature's budgets.

---

## Resolved unknowns summary

| Unknown (Technical Context) | Resolved by |
|-----------------------------|-------------|
| Web framework / rendering | R1 |
| Authentication mechanism | R2 |
| Permission model (admin visibility, who may create requirements) | R3 |
| API framework, validation, error shape | R4 |
| Database, ORM, migrations, roles | R5 |
| 5 s freshness mechanism | R6 |
| How records enter the system | R7 |
| Where ordering/classification lives | R8 |
| Row navigation targets before specs/001 | R9 |
| Missing design-system patterns | R10 |
| Test projects, CI jobs, determinism | R11 |
| Workload for performance budgets | R12 |
| Version pinning | R13 |
| Measurement exposure | R14 |

## Architecture document updates required (same change)

- §2 service map: `api` gains "ingestion API (workflow/approval/clarification writes by authorised principals) — until the orchestrator exists this is the only write path"; `web` gains "Inbox (specs/003)".
- §4 table: add "Ingestion write | sync | orchestrator/test → api → Postgres → NOTIFY → SSE → web" and change "Sign in" to "web → api (email/password, server-side session) → Postgres".
- §6: note email/password sessions now, SSO later; `app_user` / `migrator` roles as decided in R5.
- §8: `packages/contracts` and `packages/db` marked as landed by specs/003; `apps/web-scratch` removed.
