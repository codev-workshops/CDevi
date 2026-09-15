# CDevi System Architecture

**Status**: Draft for MVP (rewritten 2026-09-11 for CDevi; updated 2026-09-14 by `specs/003-inbox-home`, the first feature to land `apps/web`, `apps/api`, `packages/contracts` and `packages/db`; updated 2026-09-15 by `specs/001` US3 Dashboard and US4 Requirements). **Reads**: constitution v1.1.0, `docs/SDLC Control Plane — High-Level UI Specification.md`, `specs/001-sdlc-control-plane-mvp`, `specs/002-adopt-design-system`, `specs/003-inbox-home`. Decisions here are defaults for `/speckit-plan`; a plan that needs to deviate records the reason in its research.md and updates this file in the same change.

## 1. In one paragraph

CDevi is one TypeScript monorepo shipped as one container image with a handful of start commands: the **web app** (what people see; built from `@cdevi/design-system`), the **API** (every read and write, the only thing that talks to the database on a person's behalf, and the place every policy decision is recorded), the **agent orchestrator** (drives the external agent runtime through workflow stages, records runs, decisions, artifacts and stream events), and the **integration worker** (webhooks and polling for the source-control and issue-tracker integrations, scheduled work). PostgreSQL is the system of record; every row carries `organization_id` so row-level security can be switched on when multi-organization tenancy arrives. Long-running work is durable through a workflow engine; events between services go through a Postgres outbox into that engine. Everything runs in one region on managed services.

**What this means for you.** One repository, one deploy, roughly five vendor accounts (hosting, database and auth, workflow engine, agent runtime / model providers, tracing). Nothing needs a server you maintain yourself.

## 2. Service map

| Service | Runs as | Responsibility | Talks to | Never does |
|---------|---------|----------------|----------|------------|
| **web** | Next.js app (server-rendered pages + browser client) | **Inbox home page (specs/003 — landed)**; **Dashboard (specs/001 US3 — landed)**; **Requirements list, detail and create (specs/001 US4 — landed, `app/(app)/requirements/`)**; Workflow Center and Detail, Approval Center, Agent Activity, Testing, PR Review, Integrations, Policies, Audit Log (specs/001). Subscribes to run streams. Renders only `@cdevi/design-system` components; Server Components import them through a `'use client'` boundary (`apps/web/lib/ds.ts`). `/api/*` is rewritten to the API so the session cookie is first-party. | api only (HTTP + SSE) | Touch the database, call a model, talk to the agent runtime |
| **api** | Node HTTP service (Fastify) | Authentication and roles (**landed: email/password, server-side sessions**), every CRUD path, requirement and workflow state machines (**landed: requirement state machine, specs/001 US4 — see §4 "Requirements"**), approvals and clarifications (**landed: Inbox read model + SSE `inbox.changed`**), **ingestion API** (`PUT/POST /api/ingest/*` — authenticated write path for workflow, approval, clarification and **requirement-analysis** records; until the orchestrator exists it is the only way agent output enters the system), **inbound Jira webhook** (`POST /api/integrations/jira/webhook`, landed — signed, inbound-only; the outbound half stays with the integration-worker), **policy engine** (`checkPermission`), audit log, artifact store, SSE fan-out of stream events, outbox relay, integration OAuth | Postgres (as `app_user`), object storage, workflow engine (publish), identity provider, GitHub/Jira APIs (read + write on behalf of a user or run) | Execute an agent step itself; hold a database role that bypasses RLS |
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
| Dashboard (specs/001 US3 — **landed**) | sync | web `app/(app)/dashboard/` → api `GET /api/dashboard?project=all\|<uuid>&window=24h\|7d\|30d` → Postgres. A pure **read model**: no table of its own; eight bounded aggregate statements (research R22) over `workflows`, `workflow_stages`, `agent_runs`, `artifacts`, `test_runs`, `approvals`, `clarifications`, `workflow_transitions` and `audit_events` inside one `REPEATABLE READ` transaction, composed by the zod-free `@cdevi/contracts/dashboard-model` (`buildDashboardSnapshot`) so every figure comes from the same snapshot. Scope is the caller's visible projects; an unknown or invisible project yields zeros, never 404. Indexes only in `packages/db/migrations/0004_dashboard.sql` (SC-007). Liveness reuses the Inbox stream: `inbox.changed` → one debounced refetch of the snapshot (SC-002/SC-003). Security findings are rendered as an explicit "not connected yet" figure until review findings (US6) land |
| Requirements (specs/001 US4 — **landed**) | sync | web `app/(app)/requirements/` → api `GET /api/requirements?project=&state=&assignee=&cursor=` (50 per page, keyset cursor; FR-009/FR-025), `GET /api/requirements/{id}`, `POST /api/requirements` (engineer/approver/administrator; FR-007), `POST /api/requirements/{id}/submit` (creators; `DRAFT`/`NEEDS_CLARIFICATION` → `ANALYZING`, records who/when), `POST /api/requirements/{id}/approve` and `POST /api/requirements/{id}/reject` (approver/administrator; FR-032) → Postgres (`apps/api/src/services/requirements.ts`, `routes/requirements.ts`). The state machine lives in the zod-free `@cdevi/contracts/requirement-rules` (`DRAFT → ANALYZING → READY \| NEEDS_CLARIFICATION → APPROVED → IN_IMPLEMENTATION → COMPLETED`, `REJECTED` from `DRAFT`/`NEEDS_CLARIFICATION`/`READY`); every transition is a `requirement_transitions` row (append-only by trigger) and mutations write `audit_events`. Requirement states are not workflow states: the web renders them with `RequirementStatePill` (design system 1.4.0), never `StatePill`. Rows fan out on the existing Inbox stream (`inbox_changed` NOTIFY now carries `requirementId`), so the list and detail refetch within SC-003 without a second stream |
| Agent runtime → requirement analysis (specs/001 US4 — **landed**) | sync | runtime (Bearer ingest token) → api `PUT /api/ingest/requirements/{externalId}/analysis` (`apps/api/src/services/requirement-analysis.ts`; same auth/idempotency conventions as the other `/api/ingest/*` routes) → replaces the AI-generated acceptance criteria, rules and open questions (`requirement_analysis_items`, `ai_generated = true`, `source`) → `ANALYZING → READY` when there are no open questions, otherwise `NEEDS_CLARIFICATION` → NOTIFY → web. The API produces no analysis itself and makes no model call; the seed and the e2e suite simulate the runtime through this endpoint |
| Issue tracker webhook (specs/001 US4 — **landed, inbound only**) | sync | Jira → api `POST /api/integrations/jira/webhook` (`apps/api/src/services/jira-webhook.ts`, `routes/integrations.ts`): `x-hub-signature = sha256=<HMAC-SHA256(JIRA_WEBHOOK_SECRET, raw body)>` verified with a constant-time compare over the exact bytes (encapsulated raw-buffer parser; unset secret ⇒ 401), the Jira project key mapped to a CDevi project through `integration_project_mappings` (unknown key ⇒ `202 ignored`), `jira:issue_created`/`jira:issue_updated` upsert the requirement with `external_ref` (key + url), `jira:issue_deleted` or an update whose status category is *done* set `external_flag` (`deleted`/`closed`) and move the linked active workflow and its current stage to `BLOCKED` (spec edge case); every other event is `202 ignored` (`mapJiraEvent` in `@cdevi/contracts/requirement-rules`). No outbound Jira calls, no OAuth, no Integrations screen — those remain US8 / integration-worker |
| Approve requirement → start workflow (specs/001 US4 — **landed**, sync part) | sync + async | web → api `POST /api/requirements/{id}/approve`: one transaction with `SELECT … FOR UPDATE` on the requirement (exactly once; a later caller gets 409 with the recorded outcome, as in US2), `READY → APPROVED`, the workflow with its seven stages created in the same transaction (`workflows.requirement_id`, stage 1 `QUEUED`), `audit_events` row, `inbox_changed` NOTIFY. The workflow's later `RUNNING` transition moves the requirement to `IN_IMPLEMENTATION` and a terminal workflow state to `COMPLETED` through the `workflows_follow_requirement` trigger. Outbox → engine → agent-orchestrator is still to come |
| Workflow list (specs/001 US4 — **landed** behind the `/workflows` placeholder) | sync | api `GET /api/workflows?project=&requirement=&state=&stage=&cursor=` (`apps/api/src/services/workflow-list.ts`; FR-003 shape, 50 per page, keyset cursor on `state_observed_at DESC, id DESC`). The Workflow Center page consumes it later; `hasPr` and `intervention` from the Dashboard link contract are deferred to that story |
| Pull requests / reviews (specs/001 US6 — **landed**) | sync + runtime-reported | web `app/(app)/reviews/` → api `GET /api/reviews?project=&state=&cursor=` (50 per page, keyset cursor) and `GET /api/reviews/{pullRequestId}` (`apps/api/src/services/review-center.ts`, `routes/reviews.ts`); `GET /api/workflows/{id}` carries `pullRequest {number, title, href, reviewHref, reviewStatus, blockingOpenCount, readyForMerge}` for the Workflow Detail card. The runtime reports reviews through `PUT /api/ingest/pull-requests/{externalId}`, `…/reviews/{cycle}` (exactly seven lanes; findings replaced whole by stable `externalId`, human states `DISMISSED`/`ISSUE_REQUESTED`/`FIX_REQUESTED` preserved) and `…/cycles/{n}` (counts, iteration, state; syncs the Review stage) under `observedAt` watermarks; the schemas are `.strict()` with no free-form reasoning field (FR-018). Human actions are a separate path (`services/finding-actions.ts`): `POST /api/reviews/{prId}/findings/{findingId}/dismiss|fix|issue` (engineer/approver/administrator; viewer → 403 problem+json), one transaction with `SELECT … FOR UPDATE` (exactly once → 409 with the recorded outcome), an `audit_events` row and `inbox_changed` NOTIFY. **Control plane triggers, runtime reports**: Apply Fix opens (or joins) the RUNNING `review_cycles` row at `iteration n+1` and sets the Review stage `RUNNING`; findings flip to `FIXED` only when the next review ingest says so. Create Issue records intent only (Jira stays inbound-only). `readyForMerge` = no `BLOCKING` finding in `OPEN`/`FIX_REQUESTED`, derived by `@cdevi/contracts/review-model`, never stored; shown as a notice on the Review Center and a marker on Workflow Detail only |
| Stage execution | async | orchestrator starts agent run → runtime events → run_events (`RUNNING`) → api SSE → web |
| Agent tool effect | sync inside async | orchestrator → api `checkPermission(run, tool, input)` → allowed / `approval_required` (run → `WAITING_FOR_HUMAN`, approval record created) / denied (audit event, run continues or `BLOCKED`) |
| Approve / reject / answer clarification | sync + resume | web → api records decision + audit event → engine resumes waiting run. **Landed in specs/001 US2**: `POST /api/approvals/{id}/approve`, `POST /api/approvals/{id}/reject` (reason + BLOCKED/CANCELLED), `POST /api/clarifications/{id}/answer` — session user, approver/administrator only, one `REPEATABLE READ` transaction with `SELECT … FOR UPDATE` on the item (exactly once: a later caller gets 409 with the recorded outcome), the workflow transition out of `WAITING_FOR_HUMAN` via the 0001 state machine, an `audit_events` row, and the existing `inbox_changed` NOTIFY. Distinct from the agent ingestion path |
| PR creation, CI results, review findings | async | orchestrator/integration-worker → api → Postgres → stream |
| Retry, cancel, escalate | sync + async | web → api state transition → outbox → engine |
| Cost / usage record | async | orchestrator → api ingest (batched) → Postgres |

### Streaming to the browser

Stream events are written to a `run_events` table as they happen (durable, replayable) and announced with Postgres `NOTIFY`. The API's SSE endpoint sends events after the client's `Last-Event-ID`, so a dropped connection resumes without loss or duplication (specs/001 FR-034). No Redis or pub/sub service. **Landed in specs/003** for the Inbox: `inbox_change_log` (24 h retention) + `NOTIFY inbox_changed`, `GET /api/inbox/stream` with replay, and `Cache-Control: no-transform` so the Next rewrite does not gzip-buffer the stream. **specs/001 US1** reuses the same plumbing: `workflow_stages`, `agent_runs`, `artifacts` and `test_runs` write to `inbox_change_log` through their triggers, and Workflow Detail subscribes to `GET /api/inbox/stream` filtering frames by `workflowId` before refetching `GET /api/workflows/{id}` — no second stream protocol.

### Dashboard link contracts

Every Dashboard figure carries an `href` computed by `dashboardHrefs(window)` (research R25). The selected project travels in the shared `cdevi_project` cookie, never as a query param. Several targets are still `[section]` placeholder pages; the query parameters below are the contract those screens must honour when they land, so the links become real without a Dashboard change:

| Target | Query contract |
|--------|----------------|
| Workflow Center `/workflows` | `?stage=1…7` or `?stage=none`; `?state=A,B` (comma list of workflow states, e.g. `FAILED`, `BLOCKED`); `?hasPr=true&window=`; `?intervention=human&window=` |
| Approval Center `/approvals` | `?kind=clarification`; `?risk=HIGH,CRITICAL` (additive filters; ignored until accepted by `ApprovalCenterQuery`, the list still opens) |
| Testing `/testing` | `?window=24h\|7d\|30d` |
| Agent Activity `/agents` | `?window=24h\|7d\|30d` |
| Audit Log `/audit` | `?risk=HIGH,CRITICAL&window=` |
| PR Review `/reviews` | no params; the security-findings figure links here labelled "not connected yet" until US6 |

## 5. Event bus

1. **Durable domain events** use the transactional outbox pattern: a service writes its business change and an `outbox` row in the same transaction; the API's relay publishes unsent rows to the workflow engine, which invokes consumers with retries and idempotency keys.
2. **Ephemeral notifications** use Postgres `LISTEN`/`NOTIFY` for UI liveness only.

Event names follow `<entity>.<past_tense_verb>` (`workflow.stage_started`, `approval.decided`, `finding.dismissed`). Every event carries `organization_id`, `actor_id` (user or agent), `occurred_at` and, where one exists, `workflow_id` and `run_id`. Every event that represents an autonomous action or a human decision also produces an **audit event** (specs/001 FR-029). **Landed in specs/001 US2**: the `audit_events` table (`packages/db/migrations/0003_approval_center.sql`) — actor, action, target, workflow, risk, result, `policy` (reserved for the policy engine), `details` — append-only by trigger (`UPDATE`/`DELETE` raise) with `app_user` holding only `SELECT, INSERT`; human decisions write it in the same transaction as the decision.

## 6. Tenancy

The MVP serves one organization per installation (specs/001 FR-033), but the model is multi-organization-ready:

- Every table carries `organization_id`; the API and workers connect as `app_user`, a role without `BYPASSRLS`, and set `app.organization_id` / `app.user_id` per transaction. Row-level security policies are written now (`packages/db/migrations/0001_init.sql`) and enabled behind a flag (`CDEVI_RLS=on`, applied by `packages/db/src/migrate.ts`) so turning on multi-organization tenancy is a configuration change, not a migration. Migrations run as the separate `migrator` role.
- Users are CDevi-managed accounts (email + scrypt password hash, one role, project memberships) with server-side sessions (12 h idle / 7 d absolute) — specs/003 decision; the identity-provider integration is a later feature. Administrators see every project; other roles see their memberships.
- Migrations run as a separate role from a deploy job, never from a running service.
- Object storage keys are prefixed `org/<organization_id>/…`; presigned URLs are issued only by the API after a permission check.
- Roles (Administrator, Approver, Engineer, Viewer — specs/001 FR-032) are enforced in the API on every mutation and reflected in the UI as disabled actions with an explanation.
- **Open item — reads before `app.organization_id` is set (specs/001 US4, research R36; plan Part D Complexity Tracking).** Two reads run on `app.pool` before the organization is known: the sessions bootstrap in `apps/api/src/plugins/db.ts` and the Jira webhook's `integration_project_mappings` lookup (the webhook carries no organization). With `CDEVI_RLS=on` the org-isolation policy hides every row, so the webhook would answer `202 ignored` for every event. Dev, test and CI run with RLS off. Before any deployment turns RLS on, the deployment/RLS story must either widen those policies (`OR current_setting('app.organization_id', true) IS NULL`) or give the bootstrap reads a dedicated bypass role; US4 deliberately did not change RLS semantics for an existing table.

## 7. Agent permissions and the runtime boundary

Every tool effect an agent wants to perform passes through one function in the API, `checkPermission(run, tool, input)`, which intersects: the requesting user's effective role, the workflow's mode, the applicable **policies** (organization → project → repository → environment → agent → workflow scope, versioned; specs/001 FR-027), the action's **risk level** (LOW/MEDIUM/HIGH/CRITICAL; FR-026) and the integration's granted scopes. The outcome — allowed, approval required, denied — is written to the run's decision record and to the audit log with the policy version applied (FR-028). There is no service account with broader reach than the person who started the run.

The **agent runtime** (OpenHands per the UI specification §44, or any equivalent) sits behind an adapter in `packages/agent-runtime`. The adapter exposes: start run, stream events, answer question, cancel. Nothing outside the orchestrator imports it, so the runtime is replaceable and its identity is not a product concept.

## 8. Repository layout

```text
cdevi/
├── apps/
│   ├── web/                # Next.js: Inbox (specs/003, landed), Workflow Detail (specs/001 US1, landed), Approval Center list + decision screens app/(app)/approvals/ (specs/001 US2, landed), Dashboard app/(app)/dashboard/ (specs/001 US3, landed), Requirements list/detail/create app/(app)/requirements/ (specs/001 US4, landed), Agent Run Inspector app/(app)/agents/runs/[id]/ (specs/001 US5, landed), Reviews list + Review Center app/(app)/reviews/ (specs/001 US6, landed) + remaining specs/001 screens, built only from @cdevi/design-system
│   ├── api/                # Fastify: auth, Inbox read model, ingestion API, SSE (specs/003, landed); Workflow Detail read model + retry/escalate/cancel actions + stage/run/artifact/test-run ingestion (specs/001 US1, landed); Approval Center read model + human decision path services/decisions.ts, routes/approvals.ts, routes/clarifications.ts, audit_events (specs/001 US2, landed); Dashboard read model services/dashboard.ts + routes/dashboard.ts (specs/001 US3, landed); Requirements services/requirements.ts + routes/requirements.ts, analysis ingest services/requirement-analysis.ts, signed Jira webhook services/jira-webhook.ts + routes/integrations.ts, GET /api/workflows list services/workflow-list.ts (specs/001 US4, landed); agent run read model services/agent-run-detail.ts + decisions ingest (specs/001 US5, landed); reviews read model services/review-center.ts, human fix-loop actions services/finding-actions.ts, review/cycle ingest services/review-ingestion.ts, routes/reviews.ts (specs/001 US6, landed); policy engine, outbox relay (specs/001)
│   ├── agent-orchestrator/ # durable functions: stage execution, runtime adapter calls, run events
│   └── integration-worker/ # durable functions: webhooks, sync, health probes, cron
├── packages/
│   ├── design-system/      # @cdevi/design-system — tokens, CSS, React components (incl. RequirementStatePill, 1.4.0), gallery, DESIGN.md (spec 002)
│   ├── db/                 # schema (Drizzle), hand-reviewed SQL migrations 0001–0007 (incl. append-only audit_events; 0004_dashboard.sql is indexes only; 0005_requirements.sql adds requirements, requirement_analysis_items, append-only requirement_transitions, integration_project_mappings, workflows.requirement_id), RLS policies, seed (+ seed/dashboard.ts: administrator-only dashboard-demo project; seed/requirements.ts: eight req-seed-* requirements + the PAY Jira mapping; 0006_agent_decisions.sql + seed decisions on s500-001 runs; 0007_reviews.sql: pull_requests, reviews, review_findings, review_cycles + seed/reviews.ts: PR pr-1821 with its cycle-3 review, findings find-1821-1…7 and cycles #1–#3), admin CLIs (specs/003 + specs/001 US1–US6, landed); outbox (specs/001)
│   ├── contracts/          # Zod schemas → OpenAPI (specs/003/contracts/openapi.yaml is generated from here) + pure Inbox read-model rules and zod-free dashboard-model, requirement-rules (requirement state machine, role gates, list cursor), agent-run-model and review-model (seven lanes in fixed order, finding/cycle state words, readyForMerge) (landed)
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
