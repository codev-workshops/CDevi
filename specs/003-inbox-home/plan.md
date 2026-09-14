# Implementation Plan: Inbox Home Page

**Branch**: `003-inbox-home` | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-inbox-home/spec.md`

## Summary

Build CDevi's first product surface and its first backend in one feature: a signed-in home page (**Inbox**) that lists every workflow needing a human (`WAITING_FOR_HUMAN`, `BLOCKED`, `FAILED`) with the exact ask, risk badge, age and expiry, plus **Running** and **Done** tabs, a **Today** side panel and one saffron **New requirement** action — scoped by the global project selector and refreshed within 5 s over Server-Sent Events. Behind it: PostgreSQL persistence for Workflow / Approval / Clarification (the `specs/001` definitions, first materialised here), CDevi-managed email/password accounts with roles and project memberships, an authenticated **ingestion API** through which the future agent orchestrator (and tests) create and transition records, a deterministic seed, and read services that compute the Inbox read model server-side. The stack follows `docs/architecture.md` defaults — `apps/web` (Next.js, `@cdevi/design-system` only), `apps/api` (Fastify), `packages/db` (Drizzle + SQL migrations), `packages/contracts` (Zod schemas → OpenAPI) — and the only deviations (email/password instead of an identity provider; an ingestion path in place of the not-yet-built orchestrator) are recorded in research.md and fed back into the architecture document.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `tsconfig.base.json`), Node.js 26 (`.nvmrc`), ES modules; React 19.2 (already pinned in `apps/web-scratch`)

**Primary Dependencies**: pnpm 10 workspaces · **web**: Next.js 16 (App Router, server components for data reads, route handlers only for the SSE proxy), `@cdevi/design-system` 1.2.0 (bumped by this feature) · **api**: Fastify 5, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/swagger` (+ `fastify-type-provider-zod`), `pino` (bundled) · **db**: `drizzle-orm` + `drizzle-kit` (SQL migrations), `pg` (node-postgres, also used for `LISTEN`/`NOTIFY`) · **contracts**: `zod` 4 · **auth**: `node:crypto` `scrypt` (no native dependency), server-side sessions · all versions pinned at install to the newest release published ≥ 7 days earlier (see research R13)

**Storage**: PostgreSQL 17 (local via `docker compose`, CI via GitHub Actions `services:`); every table carries `organization_id`; RLS policies written but flag-disabled per architecture §6; migrations run by a separate `migrator` role

**Testing**: Vitest 4 — projects `design-system`, `tools` (existing) + `contracts` (schema/OpenAPI snapshot), `api` (integration against a real Postgres, identified suite, `DATABASE_URL` required), `web` (component tests + axe via `@testing-library/react`) · Playwright 1.6x — `apps/web/tests/e2e` for sign-in → Inbox → tab → row → return, keyboard walk-through, page-level axe, LCP budget · `tsc --noEmit` everywhere · existing `pnpm check` gates (ESLint DR-06/07/08, Stylelint, class-prefix scan, token drift, contrast, size)

**Target Platform**: Evergreen desktop browsers (last 2 versions Chrome/Edge/Firefox/Safari) at ≥ 1200 px, with the design-system shell's 768–1199 px rail and < 768 px stacked modes; Node 26 on Linux containers (one image, `CMD` selects `web` or `api`); GitHub Actions `ubuntu-latest`

**Project Type**: Web application — `apps/web` (frontend) + `apps/api` (backend) + shared packages, within the existing monorepo

**Performance Goals** (Principle IV; workload = seed **S-500**: 500 workflows — 50 needing a human, 100 running, 350 finished over 7 days; 4 projects; 20 users; measured on CI `ubuntu-latest` with Postgres service, no throttling):
- Inbox first meaningful content ≤ 2 s at p95 (spec SC-003) — Playwright trace, LCP metric over 20 runs
- `GET /api/inbox` (counts + first 50 rows of one tab, one project or all) ≤ 300 ms at p95, ≤ 600 ms at p99 — `autocannon` 30 s, 20 connections, asserted in the `api:perf` script
- Ingestion write → SSE event received by the browser ≤ 5 s at p95 (spec SC-007), target ≤ 1 s median — e2e test with timestamps
- `POST /api/ingest/*` ≤ 200 ms at p95 — autocannon
- Sign-in ≤ 500 ms at p95 including scrypt (N = 2^15, r = 8, p = 1 ≈ 60–100 ms) — integration test timing
- Web JS shipped to the Inbox route ≤ 200 KB gzip; `GET /api/inbox` payload ≤ 64 KB for 50 rows — `tools/check-size.mjs` extended
- SSE fan-out: 50 concurrent browser sessions per API instance without missed events — integration test

**Constraints**: All UI from `@cdevi/design-system` (DR-01…DR-10, enforced by `pnpm check`); exactly one saffron `Button` per screen; `WAITING_FOR_HUMAN`/`BLOCKED`/`FAILED` never hidden; WCAG 2.2 AA; no third-party network requests at runtime; cookies `HttpOnly; Secure; SameSite=Lax`; passwords scrypt-hashed, enumeration-safe errors, login rate-limited (5 / min per IP+email); ingestion tokens stored only as SHA-256 hashes; every list bounded (page size 50, stable ordering, keyset cursor); remote calls (web → api) have 5 s timeouts and no automatic retries except the SSE reconnect with `Last-Event-ID`; seed refuses to run when `NODE_ENV=production` or `CDEVI_ENV=production`

**Scale/Scope**: 1 organization per installation; tens of concurrent viewers; ≤ 10k workflows before pagination beyond keyset matters; 4 screens (Sign-in, Inbox, record stub for Approval/Workflow targets, placeholder for other nav entries); 11 API routes; 12 tables; 3 design-system additions; 65 tasks

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Requirement | How this plan complies | Status |
|-----------|-------------|------------------------|--------|
| I. Maintainable Code Quality | Follow conventions or establish them; pass formatter/lint/types/build; validate input at boundaries; docs updated with behaviour; no obsolete code left | Reuses repo conventions (TS strict, ESLint flat, Prettier, Stylelint, pnpm). **Establishes** the backend conventions in research.md: Fastify plugin-per-route-group, Zod schemas in `packages/contracts` as the single source for request/response types and the OpenAPI document, Drizzle schema + hand-reviewed SQL migrations, one `app_user` DB role. Every API input is validated by Zod before handlers run; errors use a common problem shape with no stack traces or SQL. Docs updated in the same change: `docs/architecture.md` §4/§6 (ingestion path, email/password), `DESIGN.md` + CHANGELOG for the three design-system additions, `AGENTS.md` (new commands). `apps/web-scratch` is deleted once `apps/web` exists (no two apps). | PASS |
| II. Risk-Based, Reliable Testing | Failing-then-passing tests for every behaviour; regression test first for bugs; deterministic/isolated; live deps in identified suites; required checks pass before merge | Read-model derivation (tab classification, ordering, ask, stale/expired) is pure and unit-tested against fixtures in `packages/contracts` before the API exists. API integration tests run in the identified `api` Vitest project against a real Postgres (transaction-per-test rollback, fixed clock via injected `now()`), covering every FR with acceptance-scenario names. Contract tests snapshot the OpenAPI document. Web component tests + axe per screen. Playwright e2e covers the critical journey (sign-in → Inbox → tab → row → back) and the keyboard walk-through; Playwright uses a fixed clock and the deterministic seed. All are required CI jobs (`lint`, `unit`, `build`, `visual`, **`e2e`**). No retries/skips for flaky tests. | PASS |
| III. Consistent and Accessible UX | Reuse components/tokens; define loading/empty/success/error/disabled states; WCAG 2.2 AA; viewports; destructive confirm; design-system mandatory; new patterns land in the package first | Every screen is composed from `@cdevi/design-system` (list below). States: loading (`List loading` — proposed), empty (`List empty`), error with retry (`Notice tone="error"` — proposed), disabled primary with explanation (`Button disabled` + `ActionBar help`), permission-restricted (rows excluded, explanation in empty state). Three proposed patterns (`Notice`, `List loading`, `FocusLayout`) go into the package with tests, gallery entries, DESIGN.md rows and a 1.2.0 CHANGELOG entry **before** `apps/web` consumes them. No destructive actions in this feature. Viewports covered by the shell's breakpoints and the reflow scenario. | PASS |
| IV. Measurable Performance | Numeric budgets with metric/threshold/workload/environment/method; bounded operations; timeouts and bounded retries; measurements exposed | Budgets in Technical Context, each with a verification method; workload S-500 is the deterministic seed. Lists are keyset-paginated at 50; `GET /api/inbox` is a bounded set of indexed queries (partial indexes on `(organization_id, project_id, state)`); SSE payloads are notifications, not data. Web→API timeout 5 s; SSE reconnect with exponential back-off capped at 30 s. API exposes per-request duration in structured logs and `Server-Timing`; a `/healthz` route reports DB round-trip. | PASS |
| Quality Requirements | Spec + plan identify criteria, journeys, failure scenarios, conventions, boundaries, UI/a11y criteria, budgets, checks, evidence; first stack establishes reproducible build/lint/test + CI | spec.md (criteria, journeys, edge cases) · this plan (conventions, boundaries, budgets) · contracts/ (API + read model + UI contract) · quickstart.md (evidence and commands). This is the first backend stack: research R1–R6 establish `pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:api`, `pnpm test:e2e`, and `.github/workflows/ci.yml` gains a Postgres service and an `e2e` job. | PASS |
| Governance | Constitution precedence; exceptions explicit | No exception requested. Deviations from `docs/architecture.md` (not the constitution) are recorded in research R2/R7 and the document is updated in the same change, as that document itself requires. | PASS |

**Gate result (pre-research)**: PASS — no violations to justify. Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-inbox-home/
├── plan.md                      # This file
├── research.md                  # Phase 0 — decisions R1–R14
├── data-model.md                # Phase 1 — tables, read model, state machine, validation
├── quickstart.md                # Phase 1 — run, seed, verify end to end
├── contracts/
│   ├── openapi.yaml             # HTTP API: auth, inbox, ingestion, health (source for packages/contracts)
│   ├── inbox-read-model.md      # Normative derivation: tab, ordering, ask, stale/expired, counts, project scope
│   └── ui-inbox-screen.md       # Screen contract: components per region, states, keyboard, a11y names
├── checklists/requirements.md
└── tasks.md                     # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/
├── web/                                  # Next.js 16 App Router — built only from @cdevi/design-system
│   ├── app/
│   │   ├── layout.tsx                    # ThemeProvider + design-system CSS import
│   │   ├── (auth)/sign-in/page.tsx       # FocusLayout + Field/Input/Button; server action → POST /api/auth/sign-in
│   │   ├── (app)/layout.tsx              # AppShell variant="full": Side (Brand, Nav, NavItem count), Main, Panel
│   │   ├── (app)/inbox/page.tsx          # Server component: fetch /api/inbox → InboxScreen
│   │   ├── (app)/inbox/InboxScreen.tsx   # Client: Tabs, List/ListRow, SSE subscription, project selector
│   │   ├── (app)/approvals/[id]/page.tsx # Record stub (read-only facts) until specs/001 Approval Center
│   │   ├── (app)/workflows/[id]/page.tsx # Record stub until specs/001 Workflow Detail
│   │   ├── (app)/requirements/new/page.tsx  # Placeholder target of "New requirement" (Engineer+)
│   │   └── (app)/[section]/page.tsx      # Placeholder for the other specs/001 nav entries
│   ├── lib/api.ts                        # typed fetch wrapper (5 s timeout, cookie forwarding, problem parsing)
│   ├── lib/inbox-stream.ts               # EventSource with Last-Event-ID + capped back-off
│   ├── next.config.ts                    # rewrites /api/* → API origin (same-site cookies)
│   ├── tests/
│   │   ├── components/*.test.tsx         # Vitest project "web": screens with fixtures + axe
│   │   └── e2e/*.spec.ts                 # Playwright: journey, keyboard, axe, LCP, SSE freshness
│   ├── package.json  tsconfig.json  playwright.config.ts
├── api/                                  # Fastify 5
│   ├── src/
│   │   ├── server.ts                     # build(app) + listen; plugins: cookie, rate-limit, swagger, zod provider
│   │   ├── plugins/auth.ts               # session cookie → request.user; ingestion Bearer → request.principal
│   │   ├── plugins/db.ts                 # pg Pool (app_user), per-request SET LOCAL app.organization_id / app.user_id
│   │   ├── plugins/notify.ts             # LISTEN inbox_changed → in-process emitter for SSE
│   │   ├── routes/auth.ts                # sign-in, sign-out, me
│   │   ├── routes/inbox.ts               # GET /inbox, GET /inbox/stream (SSE)
│   │   ├── routes/ingest.ts              # PUT workflows/{ext}, POST transitions, PUT approvals/{ext}, PUT clarifications/{ext}
│   │   ├── routes/health.ts              # /healthz
│   │   ├── services/inbox-query.ts       # SQL for rows, counts, today summary (keyset paging)
│   │   ├── services/ingestion.ts         # validation, out-of-order rule, ingestion_log, NOTIFY
│   │   ├── services/auth.ts              # scrypt verify, session create/rotate/expire
│   │   └── lib/problem.ts                # error shape, no internals leaked
│   ├── tests/                            # Vitest project "api" (Postgres required, transaction rollback per test)
│   │   ├── auth.test.ts  inbox.test.ts  ingest.test.ts  stream.test.ts  permissions.test.ts  perf.autocannon.ts
│   ├── package.json  tsconfig.json
packages/
├── design-system/                        # 1.1.0 → 1.2.0: Notice, List loading, FocusLayout (+ tests, gallery, DESIGN.md, CHANGELOG)
├── contracts/                            # @cdevi/contracts — Zod schemas + pure read-model logic shared by api and web
│   ├── src/
│   │   ├── auth.ts  inbox.ts  ingest.ts  problem.ts   # request/response schemas
│   │   ├── read-model.ts                 # classifyTab, orderNeedsYou, deriveAsk, isStale, expiryLabel (pure)
│   │   └── openapi.ts                    # builds openapi.yaml from schemas (snapshot-tested against contracts/openapi.yaml)
│   └── tests/read-model.test.ts  openapi.test.ts
├── db/                                   # @cdevi/db — Drizzle schema, migrations, seed
│   ├── src/schema.ts                     # tables in data-model.md
│   ├── src/seed/{index.ts,s500.ts}       # deterministic seed (fixed RNG seed, fixed base time); refuses production
│   ├── migrations/0001_init.sql          # tables, indexes, triggers (updated_at, NOTIFY), RLS policies (disabled)
│   ├── drizzle.config.ts  package.json
tools/
├── check-size.mjs                        # + web route JS budget, /api/inbox payload budget
docker-compose.yml                        # postgres:17 for local dev/test
.github/workflows/ci.yml                  # unit job gains postgres service; new e2e job
docs/architecture.md                      # §4 + §6 + §8 updated (ingestion path, email/password, packages/contracts + db land)
AGENTS.md                                 # new commands
```

**Structure Decision**: Follows `docs/architecture.md` §8 exactly for the pieces this feature needs (`apps/web`, `apps/api`, `packages/db`, `packages/contracts`); `agent-orchestrator`, `integration-worker`, `policy`, `agent-runtime`, `telemetry` are not created — the ingestion API is the seam they will call later. `apps/web-scratch` (a `specs/002` conformance scratch) is removed in this feature to keep one web app. Pure read-model logic lives in `packages/contracts` so the same classification/ordering code is unit-tested once and used by the API (SQL ordering mirrors it and a test asserts equivalence over the seed) and by the web for optimistic re-sorting after SSE refreshes.

## Design System Compliance

_Required by Constitution Principle III. Rules: `packages/design-system/DESIGN.md`._

- **Components used**: `ThemeProvider`, `AppShell variant="full"`, `Side`, `Brand`, `Nav`, `NavGroup`, `NavItem` (with `count` for Inbox), `Main`, `Topbar` (h1 + the single saffron `Button`), `PageMeta` (project scope, demonstration-data `Pill`), `Select` (project selector, labelled via `Field`), `Tabs`/`Tab count`/`TabPanel`, `List`/`ListRow` (`title`+`href`, `trailing` = `StatePill` [+ `RiskBadge` | `Pill` stale/expired], `ask`, `meta`), `StatePill` (all nine states via `stateToPill`), `RiskBadge` (`riskToVariant`), `Pill variant="neutral"` for "stale", "expired", "recommended answer", "demonstration data", `Mono` for branch/endpoint fragments inside asks, `Button variant="ghost"` "Load more", `Panel`/`PanelBlock`/`KeyValue` (Today block, each value an `<a>`), `Card` (policy line, record stubs), `ActionBar help` (explains disabled **New requirement**), `Field`/`Input`/`Button` (sign-in), `Help` (sign-in error text is `role=alert` via `Field error`).
- **Components proposed** (each is a design-system task completed before its consumer; version 1.1.0 → 1.2.0):
  1. `Notice` — `<div role="status"|"alert">` with `tone: "info" | "error"`, optional `action` slot (a `Button`), used for load errors with retry, session-expired message, demonstration-data banner. Tokens only; contrast pairs added to `pairs.json`.
  2. `List loading` prop — renders `aria-busy="true"` and 3 placeholder rows (`.cd-row.cd-skeleton`, reduced-motion safe) so loading is never mistaken for empty (FR-025).
  3. `FocusLayout` — single centred `Card` on canvas for sign-in (`<main>` landmark, `Brand` slot); keeps the sign-in page off hand-written layout CSS.
- **Vocabulary mapping**: workflow states `QUEUED RUNNING RETRYING WAITING` (Running tab), `WAITING_FOR_HUMAN BLOCKED FAILED` (Needs you), `COMPLETED CANCELLED` (Done) — all via `StatePill`/`stateToPill`; risk `LOW MEDIUM HIGH CRITICAL` via `RiskBadge`/`riskToVariant`; no finding or policy-outcome vocabulary on these screens. "needs you"/"blocked"/"failed" words come from the mapping, never typed in app code.
- **Accessibility verification**: component axe tests for the three new components and for `InboxScreen`, `SignIn`, record stub (Vitest `web` project); page-level axe in Playwright on `/sign-in`, `/inbox` (each tab, empty, error, filtered), `/approvals/[id]`, `/workflows/[id]`; keyboard walk-through spec: Tab to project selector → tab list (←/→/Home/End) → first row link → Enter → back → focus restored; screen-reader names asserted: NavItem "Inbox, 5 pending", tab "Needs you, 5", row link = title, `aria-describedby` = ask, RiskBadge ends in "risk"; new contrast pairs (`notice` fg/bg × tones, skeleton on surface) added to `tokens/pairs.json`.
- **UI performance budgets**: Inbox LCP ≤ 2 s p95 (S-500, Playwright trace, 20 runs); route JS ≤ 200 KB gzip (`check-size`); design-system CSS budget unchanged (≤ 40 KB) and re-checked after the three additions; SSE-triggered refresh re-renders ≤ 100 ms for 50 rows (React Profiler assertion in component test).

## Complexity Tracking

No constitution violations; nothing to justify. Two **architecture-document** deviations (not constitution violations) are recorded in research R2 and R7 and the document is updated in this feature.

## Post-Design Constitution Re-check

Re-evaluated after Phase 1 artifacts (research.md, data-model.md, contracts/, quickstart.md):

- **I** — Conventions are concrete: contracts/openapi.yaml is generated from Zod (one source), data-model.md fixes naming (`snake_case` columns, `camelCase` JSON), problem shape defined; docs to update are listed by path. PASS.
- **II** — data-model.md names the test that guards each rule (state transitions, out-of-order writes, permission filters); contracts/inbox-read-model.md is written as executable examples; quickstart.md shows the red→green order (contract tests → api → web → e2e). PASS.
- **III** — contracts/ui-inbox-screen.md gives every region its component, every state its rendering, and the accessible names; the three new components are specified with their a11y contracts before any app code. PASS.
- **IV** — every budget has a command in quickstart.md §6; indexes and keyset paging are in data-model.md; SSE is notification-only. PASS.

**Gate result (post-design)**: PASS. Ready for `/speckit-tasks`.
