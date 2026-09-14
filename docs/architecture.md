# CDevi System Architecture

**Status**: Draft for MVP (rewritten 2026-09-11 for CDevi; updated 2026-09-14 by `specs/003-inbox-home`, the first feature to land `apps/web`, `apps/api`, `packages/contracts` and `packages/db`). **Reads**: constitution v1.1.0, `docs/SDLC Control Plane — High-Level UI Specification.md`, `specs/001-sdlc-control-plane-mvp`, `specs/002-adopt-design-system`, `specs/003-inbox-home`. Decisions here are defaults for `/speckit-plan`; a plan that needs to deviate records the reason in its research.md and updates this file in the same change.

## 1. In one paragraph

CDevi is one TypeScript monorepo shipped as one container image with a handful of start commands: the **web app** (what people see; built from `@cdevi/design-system`), the **API** (every read and write, the only thing that talks to the database on a person's behalf, and the place every policy decision is recorded), the **agent orchestrator** (drives the external agent runtime through workflow stages, records runs, decisions, artifacts and stream events), and the **integration worker** (webhooks and polling for the source-control and issue-tracker integrations, scheduled work). PostgreSQL is the system of record; every row carries `organization_id` so row-level security can be switched on when multi-organization tenancy arrives. Long-running work is durable through a workflow engine; events between services go through a Postgres outbox into that engine. Everything runs in one region on managed services.

**What this means for you.** One repository, one deploy, roughly five vendor accounts (hosting, database and auth, workflow engine, agent runtime / model providers, tracing). Nothing needs a server you maintain yourself.

## 2. Service map

| Service | Runs as | Responsibility | Talks to | Never does |
|---------|---------|----------------|----------|------------|
| **web** | Next.js app (server-rendered pages + browser client) | **Inbox home page (specs/003 — landed)**; Dashboard, Workflow Center and Detail, Requirements, Approval Center, Agent Activity, Testing, PR Review, Integrations, Policies, Audit Log (specs/001). Subscribes to run streams. Renders only `@cdevi/design-system` components; Server Components import them through a `'use client'` boundary (`apps/web/lib/ds.ts`). `/api/*` is rewritten to the API so the session cookie is first-party. | api only (HTTP + SSE) | Touch the database, call a model, talk to the agent runtime |
| **api** | Node HTTP service (Fastify) | Authentication and roles (**landed: email/password, server-side sessions**), every CRUD path, requirement and workflow state machines, approvals and clarifications (**landed: Inbox read model + SSE `inbox.changed`**), **ingestion API** (`PUT/POST /api/ingest/*` — authenticated write path for workflow, approval and clarification records; until the orchestrator exists it is the only way state enters the system), **policy engine** (`checkPermission`), audit log, artifact store, SSE fan-out of stream events, outbox relay, integration OAuth | Postgres (as `app_user`), object storage, workflow engine (publish), identity provider, GitHub/Jira APIs (read + write on behalf of a user or run) | Execute an agent step itself; hold a database role that bypasses RLS |
| **agent-orchestrator** | Durable functions invoked by the workflow engine | Stage execution: assembles context, starts an agent run in the runtime, translates runtime events into run events / decisions / artifacts, asks the API's `checkPermission` before every tool effect, pauses the run on `approval_required`, resumes on approval | Postgres (as `app_user`, scoped per run), agent runtime (replaceable — see §7), api | Accept a request from the browser directly; apply a policy locally |
| **integration-worker** | Durable functions invoked by the workflow engine | Inbound webhooks (issue created/updated, PR checks, CI results) → requirements and test runs; outbound sync (PR creation, comments, status); health probes for integrations; cron | Postgres (as `app_user`), GitHub/Jira, api | Call a model; make a policy decision |

Supporting components: **Postgres** (system of record, outbox, run events), **object storage** (artifacts, diffs, screenshots, exports), **workflow engine** (durable execution and retries), **agent runtime** (executes agents in isolation; behind an adapter).

### Why four and not one

Model-driven work is slow, retried and budgeted; webhook intake must be durable and idempotent; the web tier must stay stateless. Splitting along those lines costs nothing at MVP scale because all four start from the same image.

## 3. Spec ownership

Every specification has exactly one owning service; other services render or call it.

| Spec | Owner | Where the other half lives |
|------|-------|----------------------------|
| 000 Constitution | governance | Enforced by `/speckit-analyze`, `pnpm check`, CI |
| 001 SDLC Control Plane MVP — product surface | web | api serves data; orchestrator produces runs |
| 001 — workflows, requirements, approvals, policies, audit (FR-001…FR-035) | api | web renders; orchestrator/integration-worker emit events |
| 001 — agent runs, decisions, artifacts, stage execution (FR-016…FR-018, FR-036) | agent-orchestrator | api stores and streams; web renders |
| 001 — integrations (FR-030, FR-031) | integration-worker | api stores connection state; web renders status |
| 002 Design system | `packages/design-system` | web consumes; CI enforces (`tools/`) |

## 4. Synchronous and asynchronous paths

**Rule.** A request is handled synchronously only if it needs no agent or model call, touches under 5 MB, and finishes within 2 s at p95. Everything else becomes a run or a job: the API writes a record with state `QUEUED`, publishes an outbox event, returns the record's id immediately, and the client follows progress over the stream.

| Path | Mode | Sequence |
|------|------|----------|
| Sign in (email/password, specs/003) | sync | web server action → api `POST /auth/sign-in` (scrypt verify, session row, `cdevi_session` cookie) → Postgres. SSO can be added later without changing roles or memberships |
| Ingestion write (orchestrator / external system / tests, specs/003) | sync | principal (Bearer token) → api `/api/ingest/*` → validate state machine + `observedAt` ordering → Postgres → trigger `NOTIFY inbox_changed` + `inbox_change_log` → SSE → web refetches the Inbox snapshot |
| Read or list anything | sync | web → api → Postgres (organization- and role-scoped) |
| Create / edit a requirement (human) | sync | web → api → Postgres → outbox event `requirement.updated` |
| Issue tracker webhook | async | Jira → integration-worker → api upsert requirement → outbox → web stream |
| Approve requirement → start workflow | sync + async | web → api creates workflow + first stage `QUEUED` + outbox → engine → agent-orchestrator |
| Stage execution | async | orchestrator starts agent run → runtime events → run_events (`RUNNING`) → api SSE → web |
| Agent tool effect | sync inside async | orchestrator → api `checkPermission(run, tool, input)` → allowed / `approval_required` (run → `WAITING_FOR_HUMAN`, approval record created) / denied (audit event, run continues or `BLOCKED`) |
| Approve / reject / answer clarification | sync + resume | web → api records decision + audit event → engine resumes waiting run |
| PR creation, CI results, review findings | async | orchestrator/integration-worker → api → Postgres → stream |
| Retry, cancel, escalate | sync + async | web → api state transition → outbox → engine |
| Cost / usage record | async | orchestrator → api ingest (batched) → Postgres |

### Streaming to the browser

Stream events are written to a `run_events` table as they happen (durable, replayable) and announced with Postgres `NOTIFY`. The API's SSE endpoint sends events after the client's `Last-Event-ID`, so a dropped connection resumes without loss or duplication (specs/001 FR-034). No Redis or pub/sub service. **Landed in specs/003** for the Inbox: `inbox_change_log` (24 h retention) + `NOTIFY inbox_changed`, `GET /api/inbox/stream` with replay, and `Cache-Control: no-transform` so the Next rewrite does not gzip-buffer the stream. **specs/001 US1** reuses the same plumbing: `workflow_stages`, `agent_runs`, `artifacts` and `test_runs` write to `inbox_change_log` through their triggers, and Workflow Detail subscribes to `GET /api/inbox/stream` filtering frames by `workflowId` before refetching `GET /api/workflows/{id}` — no second stream protocol.

## 5. Event bus

1. **Durable domain events** use the transactional outbox pattern: a service writes its business change and an `outbox` row in the same transaction; the API's relay publishes unsent rows to the workflow engine, which invokes consumers with retries and idempotency keys.
2. **Ephemeral notifications** use Postgres `LISTEN`/`NOTIFY` for UI liveness only.

Event names follow `<entity>.<past_tense_verb>` (`workflow.stage_started`, `approval.decided`, `finding.dismissed`). Every event carries `organization_id`, `actor_id` (user or agent), `occurred_at` and, where one exists, `workflow_id` and `run_id`. Every event that represents an autonomous action or a human decision also produces an **audit event** (specs/001 FR-029).

## 6. Tenancy

The MVP serves one organization per installation (specs/001 FR-033), but the model is multi-organization-ready:

- Every table carries `organization_id`; the API and workers connect as `app_user`, a role without `BYPASSRLS`, and set `app.organization_id` / `app.user_id` per transaction. Row-level security policies are written now (`packages/db/migrations/0001_init.sql`) and enabled behind a flag (`CDEVI_RLS=on`, applied by `packages/db/src/migrate.ts`) so turning on multi-organization tenancy is a configuration change, not a migration. Migrations run as the separate `migrator` role.
- Users are CDevi-managed accounts (email + scrypt password hash, one role, project memberships) with server-side sessions (12 h idle / 7 d absolute) — specs/003 decision; the identity-provider integration is a later feature. Administrators see every project; other roles see their memberships.
- Migrations run as a separate role from a deploy job, never from a running service.
- Object storage keys are prefixed `org/<organization_id>/…`; presigned URLs are issued only by the API after a permission check.
- Roles (Administrator, Approver, Engineer, Viewer — specs/001 FR-032) are enforced in the API on every mutation and reflected in the UI as disabled actions with an explanation.

## 7. Agent permissions and the runtime boundary

Every tool effect an agent wants to perform passes through one function in the API, `checkPermission(run, tool, input)`, which intersects: the requesting user's effective role, the workflow's mode, the applicable **policies** (organization → project → repository → environment → agent → workflow scope, versioned; specs/001 FR-027), the action's **risk level** (LOW/MEDIUM/HIGH/CRITICAL; FR-026) and the integration's granted scopes. The outcome — allowed, approval required, denied — is written to the run's decision record and to the audit log with the policy version applied (FR-028). There is no service account with broader reach than the person who started the run.

The **agent runtime** (OpenHands per the UI specification §44, or any equivalent) sits behind an adapter in `packages/agent-runtime`. The adapter exposes: start run, stream events, answer question, cancel. Nothing outside the orchestrator imports it, so the runtime is replaceable and its identity is not a product concept.

## 8. Repository layout

```text
cdevi/
├── apps/
│   ├── web/                # Next.js: Inbox (specs/003, landed) + screens from specs/001, built only from @cdevi/design-system
│   ├── api/                # Fastify: auth, Inbox read model, ingestion API, SSE (specs/003, landed); Workflow Detail read model + retry/escalate/cancel actions + stage/run/artifact/test-run ingestion (specs/001 US1, landed); policy engine, audit, outbox relay (specs/001)
│   ├── agent-orchestrator/ # durable functions: stage execution, runtime adapter calls, run events
│   └── integration-worker/ # durable functions: webhooks, sync, health probes, cron
├── packages/
│   ├── design-system/      # @cdevi/design-system — tokens, CSS, React components, gallery, DESIGN.md (spec 002)
│   ├── db/                 # schema (Drizzle), hand-reviewed SQL migrations, RLS policies, seed, admin CLIs (specs/003, landed); outbox (specs/001)
│   ├── contracts/          # Zod schemas → OpenAPI (specs/003/contracts/openapi.yaml is generated from here) + pure Inbox read-model rules (landed)
│   ├── policy/             # checkPermission, risk classification, policy versioning
│   ├── agent-runtime/      # runtime adapter interface + OpenHands implementation
│   └── telemetry/          # OpenTelemetry setup, cost-record emitter
├── tools/                  # repo-wide checks (class prefix, size budgets, lint fixtures, governance tests)
├── specs/                  # Spec Kit features
├── docs/
├── .github/workflows/      # CI: lint, unit, build, visual
├── Dockerfile              # one image; CMD selects the app
└── pnpm-workspace.yaml
```

Plans cite paths from this tree. A plan that needs a new top-level package records it in its research.md and updates this section.

## 9. Future services (listed only)

| Service | Why it is not in the MVP | What the MVP reserves |
|---------|--------------------------|-----------------------|
| Multi-organization tenancy | One enterprise per installation (specs/001 FR-033) | `organization_id` on every row; RLS policies written, flag-enabled |
| Realtime co-editing of requirements | Optimistic concurrency covers a small team | Version field on requirement records |
| Sandbox fleet | Isolation for arbitrary customer code belongs to the runtime | The runtime adapter boundary in §7 |
| Deployment / incident centers | Out of MVP scope (UI spec §24–26) | Event names and audit shape accommodate deployment and incident entities |
| Multi-region | One team, one region | Region recorded in deployment configuration; vendors chosen support relocation |
