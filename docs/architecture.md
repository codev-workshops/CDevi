# System Architecture

**Spec ID**: `002` | **Session**: S02 | **Status**: Complete (decisions are `default`, see decision-log.md)

**Loads**: constitution, glossary-core, prd.md, S01 handoff. **Related**: [deployment](deployment.md) ·
[nfr](nfr.md) · [ADRs](adr/) · [diagrams](diagrams/)

## 1. In one paragraph

Five services built from one TypeScript codebase and shipped as one container image with five
start commands: the **web app** (what people see), the **API** (every read and write, and the
only thing that talks to the database on a person's behalf), the **agent worker** (runs the agent
loop), the **workflow worker** (runs scheduled tasks), and the **query worker** (runs SQL over
workbook data). PostgreSQL is the system of record and enforces tenancy with row-level security.
Long-running work is made durable by a hosted workflow engine; events between services go through
a Postgres outbox into that engine. Everything runs in one region on managed services.

**What this means for you.** You will have one code repository, one deploy button, and about five
vendor accounts (hosting, database and auth, workflow engine, model providers, payments, tracing).
At MVP scale most of them are on free tiers. Nothing here needs a server you maintain yourself.

## 2. Service map

| Service | Runs as | Responsibility | Talks to | Never does |
|---------|---------|----------------|----------|------------|
| **web** | Next.js app (server-rendered pages + browser client) | Workspace shell, editors, plan and question cards, settings, checkout redirect. Subscribes to run streams. | api only (HTTP + SSE) | Touch the database or model providers |
| **api** | Node HTTP service (Fastify) | Authentication, permission checks, every CRUD path, the artifact contract, import intake, credit ledger, cost-record ingest, outbox relay, SSE fan-out of stream events | Postgres (as `app_user`), object storage, workflow engine (publish), Stripe, auth provider | Call a model. Run a query. Execute a tool |
| **agent-worker** | Durable functions invoked by the workflow engine | The agent loop: context assembly, model calls, tool execution through the tool registry, permission check per tool call, run record, stream events, evals harness | Postgres (as `app_user`, scoped per run), model providers, MCP servers, connectors, query-worker (via api-signed grants) | Accept a request from the browser directly. Hold a privileged database role |
| **workflow-worker** | Durable functions invoked by the workflow engine | Task runs: cron triggers, step execution and branching, idempotency, retries, run history, standing grants | Postgres (as `app_user`, scoped per run), agent-worker (as child runs), connectors | Call a model itself (it delegates to agent runs) |
| **query-worker** | Node service with embedded DuckDB, invoked by the workflow engine | CSV/XLSX schema inference and import, SQL queries and transforms over Parquet snapshots, query limits | Object storage (granted keys only), api (to write results) | Open a Postgres connection. Reach any object it was not granted |

Two supporting components are not services but appear in the diagrams: **Postgres** (system of
record, RLS, outbox, run events) and **object storage** (uploads, Parquet snapshots, exports).

### Why five and not one

One process would be simpler to start, but three things must be isolated: model calls (slow,
retried, budgeted), scheduled work (must survive restarts), and DuckDB (memory-hungry, must not
share a process with anything holding a database connection). Splitting along those lines costs
nothing extra at MVP scale because all five start from the same image (ADR-0001).

## 3. Spec ownership

Every MVP spec has exactly one owning service. Owning means the service's code is where the
spec's requirements are implemented and tested; other services may render or call it. Where a
spec has a UI half and a server half, the owner is the half that carries the correctness risk.

| Spec | Owner | Where the other half lives |
|------|-------|----------------------------|
| 000 Constitution | governance (no service) | Docs only; enforced by `/speckit-analyze` and CI |
| 001 Product | governance (no service) | Docs only |
| 002 Architecture | governance (no service) | This folder; `packages/` layout follows it |
| 003 Domain model & tenancy | api | `packages/db` migrations and RLS policies are api-owned |
| 004 Identity & access | api | web renders sign-in and settings screens |
| 006 Observability & metering | api | `packages/telemetry` is used by every service; api ingests cost records |
| 100 Agent loop & tool protocol | agent-worker | api exposes the SSE stream; `packages/tools` holds the registry |
| 101 Model routing & modes | agent-worker | Mode config stored by api |
| 102 Context & @mentions | agent-worker | web renders the mention picker |
| 105 Plans, questions & approvals | agent-worker | web renders the cards; api stores approvals |
| 110 Agent evals & safety | agent-worker | Eval harness runs in CI against agent-worker |
| 200 Workspace shell | web | api serves the data |
| 201 Artifact contract | api | `packages/artifact-contract` types shared with web and agent-worker |
| 202 Documents | web | Document patch ops applied by api through 201 |
| 203 Workbooks | api | web renders the grid and record sidebar |
| 204 Data engine | query-worker | api handles upload intake and result write-back |
| 400 Workflow engine | workflow-worker | web renders task setup and run history |
| 402 Connectors & secrets | api | agent-worker executes connector tools |
| 600 Billing & credits | api | web renders plan and top-up screens; Stripe hosts checkout |

Check: 19 rows, 16 with a runtime service, 3 governance. No spec appears twice.

## 4. Synchronous and asynchronous paths

**Rule.** A request is handled synchronously only if it needs no model call, touches under
5 MB, and finishes within 2 seconds at p95. Everything else becomes a run or a job: the API writes
a record with status `queued`, publishes an event, returns the record's ID immediately, and the
client follows progress over the stream.

| Path | Mode | Sequence |
|------|------|----------|
| Sign in, invite, role change | sync | web → api → auth provider / Postgres |
| Read or list anything | sync | web → api → Postgres (RLS filters) |
| Edit a document or workbook (human) | sync | web → api `artifact.patch` with base version → Postgres → checkpoint if due → outbox event |
| Send a message to the agent | async | web → api creates agent run `queued` + outbox event → engine invokes agent-worker → stream events to `run_events` → api SSE → web |
| Agent edits an artifact | sync inside async | agent-worker → api `artifact.patch` (same path as a human, same permission check) |
| Approve a plan card | sync + resume | web → api records approval → engine resumes the waiting run |
| Upload a file | async | web asks api for a presigned URL → browser uploads to object storage → api records upload → outbox event → query-worker infers schema → preview → user confirms → import job |
| Query or transform | async | agent-worker or web → api creates job + signed grant → engine invokes query-worker → result written back through api |
| Scheduled task | async | engine cron → workflow-worker → child agent runs and steps → run history |
| Cost record | async | any service → `packages/telemetry` → api ingest endpoint (batched) → Postgres → ledger debit |
| Stripe checkout | sync + webhook | web → Stripe hosted page → Stripe webhook → api credits ledger |

### Streaming to the browser

Stream events are written to a `run_events` table as they happen (durable, replayable) and
announced with Postgres `NOTIFY` (fast). The API's SSE endpoint sends events after the client's
`Last-Event-ID`, so a dropped connection resumes without loss. No Redis or pub/sub service.

## 5. Event bus

The event bus is two things, chosen so there is no message broker to run:

1. **Durable domain events** use the transactional outbox pattern. A service writes its business
   change and an `outbox` row in the same Postgres transaction. The API's relay loop publishes
   unsent rows to the workflow engine, which invokes the consuming function with retries and
   idempotency keys. Events cannot be lost or emitted for a rolled-back change.
2. **Ephemeral notifications** use Postgres `LISTEN`/`NOTIFY` for UI liveness only. Losing one is
   harmless because the durable record is in a table.

Event names follow `<entity>.<past_tense_verb>` (`artifact.checkpoint_created`,
`task_run.completed`). Spec 006 owns the catalogue; metrics.md lists the ones the funnel needs.
Every event carries `workspace_id`, `actor_id`, `occurred_at` and, where one exists, `run_id`.

## 6. Tenancy in this architecture (Article III)

- The API and both workers connect to Postgres as `app_user`, a role without `BYPASSRLS`. Each
  transaction starts with `set_config('app.workspace_id', …)` and `set_config('app.user_id', …)`
  from the verified auth session or run record; every RLS policy reads them. Spec 003 writes the
  policies.
- Migrations run as a separate role from a deploy job, never from a running service.
- The query worker holds no database connection at all. It receives a **signed grant** from the
  API naming the exact object-storage keys (Parquet snapshots) the requester may read and the
  sheet it may write to. It downloads only those, opens DuckDB with external access disabled, and
  returns results through the API. A cross-tenant query is impossible rather than merely forbidden
  (ADR-0003).
- Object storage keys are prefixed `ws/<workspace_id>/…`; presigned URLs are issued only by the
  API after a permission check.
- Public read-only links resolve to a single artifact read through the API with a link token in
  place of a session; the RLS context is set to that artifact's workspace with a `public_link`
  flag that policies restrict to read.

## 7. Agent permissions in this architecture (Article IV)

Every tool call inside the agent worker passes through one function, `checkPermission(run,
tool, input)`, which intersects the requester's effective permissions (from spec 004), the
mode's allowlist (spec 101) and the connector's OAuth scopes (spec 402). Tools that need data go
through the API with the run's credentials, so RLS applies to the agent exactly as it applies to
the person. There is no service account with broader reach.

## 8. Repository layout

```text
obvious/
├── apps/
│   ├── web/                # Next.js: shell, editors, cards (specs 200, 202; renders 105, 400, 600)
│   ├── api/                # Fastify: auth, permissions, artifact contract, ledger, SSE, outbox relay
│   ├── agent-worker/       # durable functions: agent loop, tools, modes, context, evals harness
│   ├── workflow-worker/    # durable functions: task runs, cron, branching, standing grants
│   └── query-worker/       # DuckDB: inference, import, query, transform
├── packages/
│   ├── db/                 # schema, migrations, RLS policies (spec 003)
│   ├── contracts/          # types generated from specs/*/contracts (OpenAPI, AsyncAPI, JSON Schema)
│   ├── artifact-contract/  # spec 201 interface + type registry
│   ├── tools/              # tool registry, tool schema validation, side-effect classes (spec 100)
│   ├── model-provider/     # provider abstraction and routing config (spec 101)
│   ├── telemetry/          # OpenTelemetry setup, cost-record emitter (spec 006)
│   └── ui/                 # shared components and design tokens
├── specs/                  # this spec set
├── docs/
├── Dockerfile              # one image; CMD selects the app
└── turbo.json, pnpm-workspace.yaml
```

Plans cite paths from this tree. A plan that needs a new top-level package records it in its
research.md and the session handoff so this file is updated.

## 9. Future services (listed only, NG-01, NG-07, NG-10)

| Service | Why it is not in the MVP | What the MVP reserves |
|---------|--------------------------|-----------------------|
| Realtime sync server | Live co-editing needs a CRDT and a websocket fan-out; optimistic concurrency covers a small team | The artifact contract's version field and patch envelope (spec 201) |
| Sandbox fleet | Running customer code needs isolation the MVP does not have; JS transforms and PDF extraction wait for it | The `external_irreversible` side-effect class and the job pattern in §4 |
| Multi-region | One team, one region; a second region doubles operating cost | Region recorded in deployment.md; all vendors chosen support relocation |
