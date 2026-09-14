# Data Model: Inbox Home Page

**Feature**: 003-inbox-home | **Plan**: [plan.md](plan.md) | **Research**: R2, R3, R5, R7, R8, R12

Conventions: PostgreSQL 17; columns `snake_case`, JSON `camelCase`; ids are `uuid` (v7 generated in the API for time-ordering); timestamps `timestamptz`; every table carries `organization_id` and has an RLS policy written (`USING (organization_id = current_setting('app.organization_id')::uuid)`) but disabled behind `ALTER TABLE … ENABLE ROW LEVEL SECURITY` being run only when `CDEVI_RLS=on` (architecture §6). Enumerations are Postgres `enum` types whose values are exactly the `specs/001` vocabulary. Each rule names the test that guards it.

## 1. Entity overview

```
organizations 1──* projects 1──* workflows 1──* workflow_transitions
      │                │              ├──0..* approvals
      │                │              └──0..* clarifications
      ├──* users ──* project_memberships ──> projects
      │      └──* sessions
      ├──* ingestion_principals (scoped to projects[])
      ├──* ingestion_log
      └──* inbox_change_log            (SSE replay buffer)
```

## 2. Tables

### organizations
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | shown in navigation (FR-003) |
| timezone | text NOT NULL default 'UTC' | IANA name; Today window (FR-017) |
| policy_summary | text NOT NULL | one line; default "Pull request merges and all HIGH/CRITICAL actions require human approval." (FR-018) |
| is_demo | boolean NOT NULL default false | set by the seed → demonstration-data label (FR-022) |
| created_at | timestamptz | |

Exactly one row in MVP (`specs/001` FR-033). Test: `api/permissions.test.ts › every query is organisation-scoped`.

### projects
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| key | text NOT NULL | unique per organization (`payments-api`) |
| name | text NOT NULL | |
| created_at | timestamptz | |

### users
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| email | citext NOT NULL | unique per organization; lower-cased on write |
| display_name | text NOT NULL | shown in navigation (FR-003) |
| password_hash | text NOT NULL | `scrypt$N$r$p$<salt b64>$<hash b64>`; never selected by list queries |
| role | enum user_role NOT NULL | `administrator, approver, engineer, viewer` — exactly one (FR-004) |
| disabled_at | timestamptz NULL | disabled users cannot sign in |
| created_at | timestamptz | |

Rules: password hash format validated on write; `email` never appears in logs. Tests: `api/auth.test.ts › sign-in hashes are scrypt`, `› wrong password and unknown email return the same problem`, `› disabled user cannot sign in`.

### project_memberships
| column | type | rules |
|---|---|---|
| user_id | uuid FK | PK (user_id, project_id) |
| project_id | uuid FK | |
| organization_id | uuid | |
| created_at | timestamptz | |

Visibility rule (R3): `visible_projects(user) = all projects` when `role = administrator`, else memberships. Test: `api/permissions.test.ts › viewer sees only member projects`, `› administrator sees all projects`.

### sessions
| column | type | rules |
|---|---|---|
| id_hash | bytea PK | SHA-256 of the 256-bit random cookie value |
| user_id | uuid FK | |
| organization_id | uuid | |
| created_at | timestamptz | absolute expiry = created_at + 7 d |
| last_seen_at | timestamptz | idle expiry = last_seen_at + 12 h; updated at most once per minute |
| revoked_at | timestamptz NULL | sign-out |

Tests: `api/auth.test.ts › expired session is rejected and cookie cleared`, `› sign-out revokes`.

### ingestion_principals
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| name | text NOT NULL | e.g. "agent-orchestrator", "e2e-tests" |
| token_hash | bytea NOT NULL UNIQUE | SHA-256 of the Bearer token; token shown once at creation |
| project_ids | uuid[] NOT NULL | scope; empty array = no access (never "all") |
| disabled_at | timestamptz NULL | |
| created_at | timestamptz | |

Tests: `api/ingest.test.ts › unknown token → 401`, `› project outside scope → 403`, `› disabled principal → 401`.

### workflows
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| project_id | uuid FK | |
| external_id | text NOT NULL | unique per organization; ingestion key (`PUT /ingest/workflows/{externalId}`) |
| title | text NOT NULL | ≤ 200 chars |
| agent | text NULL | display name of the agent role ("Implementation Agent") |
| state | enum workflow_state NOT NULL | `QUEUED, RUNNING, RETRYING, WAITING, WAITING_FOR_HUMAN, BLOCKED, FAILED, COMPLETED, CANCELLED` |
| state_observed_at | timestamptz NOT NULL | time of the transition that produced `state` (ordering key, out-of-order guard) |
| state_reason | text NULL | blocking reason / failure reason (ask for BLOCKED/FAILED) |
| stage_index | smallint NULL | 1-based |
| stage_count | smallint NULL | default 7 |
| stage_name | text NULL | "Implementation" |
| pull_request_ref | text NULL | e.g. "PR #412" or URL |
| started_at | timestamptz NULL | first transition into RUNNING (Running ordering, Today "started") |
| finished_at | timestamptz NULL | transition into COMPLETED/CANCELLED (Done ordering, 7-day window, Today "completed") |
| created_at, updated_at | timestamptz | trigger maintains `updated_at` |

Indexes: `(organization_id, project_id, state)`; partial `(organization_id, state_observed_at) WHERE state IN ('WAITING_FOR_HUMAN','BLOCKED','FAILED')`; partial `(organization_id, started_at DESC) WHERE state IN ('QUEUED','RUNNING','RETRYING','WAITING')`; partial `(organization_id, finished_at DESC) WHERE state IN ('COMPLETED','CANCELLED')`; unique `(organization_id, external_id)`.

### workflow_transitions
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid | |
| workflow_id | uuid FK | |
| from_state | enum workflow_state NULL | NULL for creation |
| to_state | enum workflow_state NOT NULL | |
| observed_at | timestamptz NOT NULL | supplied by the ingesting system |
| recorded_at | timestamptz NOT NULL default now() | |
| reason | text NULL | |
| principal_id | uuid FK ingestion_principals | attribution (FR-021) |

Append-only (no UPDATE/DELETE grants for `app_user`). Test: `api/ingest.test.ts › every accepted transition is appended with principal`.

### approvals
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id, project_id | uuid | denormalised from workflow for filtering |
| workflow_id | uuid FK | |
| external_id | text NOT NULL | unique per organization |
| ask | text NOT NULL | one line, ≤ 240 chars; e.g. "Approve: open a pull request against main" |
| risk_level | enum risk_level NOT NULL | `LOW, MEDIUM, HIGH, CRITICAL` |
| requested_by_agent | text NULL | |
| requested_at | timestamptz NOT NULL | age, stale flag, ordering |
| expires_at | timestamptz NULL | remaining time / "expired" |
| decision | enum approval_decision NULL | `approved, rejected` — NULL = pending |
| decided_at | timestamptz NULL | Today "approvals decided" |
| decided_by | text NULL | display name or user id (decision flows belong to specs/001) |
| created_at, updated_at | timestamptz | |

Index: partial `(organization_id, workflow_id) WHERE decision IS NULL`. Rule: **at most one pending approval or clarification per workflow** (unique partial index across a shared `pending_requests` view is not possible; enforced in the ingestion service in the same transaction with `SELECT … FOR UPDATE` on the workflow). Test: `api/ingest.test.ts › second pending request for a workflow → 409`.

### clarifications
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id, project_id, workflow_id | uuid | |
| external_id | text NOT NULL | unique per organization |
| question | text NOT NULL | one line shown as the ask, ≤ 240 chars |
| requested_by_agent | text NULL | |
| requested_at | timestamptz NOT NULL | |
| has_recommended_answer | boolean NOT NULL default false | "recommended answer" pill (FR-009) |
| answered_at | timestamptz NULL | NULL = pending |
| answered_by | text NULL | |
| created_at, updated_at | timestamptz | |

### ingestion_log
| column | type | rules |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid | |
| principal_id | uuid FK | |
| received_at | timestamptz | |
| route | text | e.g. `PUT /ingest/workflows/{externalId}` |
| target_external_id | text | |
| outcome | enum ingestion_outcome | `accepted, stale, rejected, forbidden` |
| detail | text NULL | reason (no request body echoed) |

Pruned to 30 days by a scheduled job later; MVP grows unbounded but is bounded by write rate. Test: `api/ingest.test.ts › stale and rejected writes are logged and change nothing`.

### inbox_change_log
| column | type | rules |
|---|---|---|
| seq | bigserial PK | SSE event id |
| organization_id, project_id, workflow_id | uuid | |
| occurred_at | timestamptz default now() | |

Inserted by the same trigger that emits `NOTIFY inbox_changed`; rows older than 24 h are deleted by the API on start-up and hourly. Replay: `WHERE seq > $lastEventId AND project_id IN visible`. Test: `api/stream.test.ts › reconnect with Last-Event-ID replays missed events exactly once`.

## 3. Workflow state machine (ingestion validation)

Allowed `from → to` transitions (anything else → `409 rejected`):

| from | to |
|---|---|
| ∅ (create) | `QUEUED`, `RUNNING` |
| `QUEUED` | `RUNNING`, `CANCELLED`, `BLOCKED` |
| `RUNNING` | `WAITING`, `WAITING_FOR_HUMAN`, `RETRYING`, `BLOCKED`, `FAILED`, `COMPLETED`, `CANCELLED` |
| `RETRYING` | `RUNNING`, `FAILED`, `CANCELLED`, `BLOCKED` |
| `WAITING` | `RUNNING`, `BLOCKED`, `CANCELLED`, `FAILED` |
| `WAITING_FOR_HUMAN` | `RUNNING`, `BLOCKED`, `CANCELLED` |
| `BLOCKED` | `RUNNING`, `QUEUED`, `CANCELLED` |
| `FAILED` | `RETRYING`, `RUNNING`, `CANCELLED` |
| `COMPLETED`, `CANCELLED` | — (terminal) |

Side effects on accepted transition: `state`, `state_observed_at = observedAt`, `state_reason = reason`; `started_at` set on first entry to `RUNNING`; `finished_at` set on entry to `COMPLETED`/`CANCELLED` (cleared if a terminal state is somehow re-entered — impossible by the table above, asserted by test). Ordering guard: `observedAt <= state_observed_at` → `stale` (logged, no change). Tests: `contracts/tests/read-model.test.ts › transition table` (pure), `api/ingest.test.ts › out-of-order transition is stale`, `› terminal states reject further transitions`.

## 4. Inbox read model (derived, not stored)

Normative rules are in [contracts/inbox-read-model.md](contracts/inbox-read-model.md); summary:

| field | derivation |
|---|---|
| `tab` | `needsYou` ← `WAITING_FOR_HUMAN, BLOCKED, FAILED`; `running` ← `QUEUED, RUNNING, RETRYING, WAITING`; `done` ← `COMPLETED, CANCELLED` with `finished_at ≥ now − 7 d` |
| `kind` | `approval` (pending approval exists), `clarification` (pending clarification exists), `blocked`, `failed`, `running`, `done` |
| `ask` | approval → `approvals.ask`; clarification → `question`; blocked → `"Blocked: " + state_reason`; failed → `"Failed at <stage_name>: " + state_reason` |
| `riskLevel` | approval's `risk_level`, else `null` |
| `raisedAt` | approval `requested_at` / clarification `requested_at` / else `state_observed_at` |
| `isStale` | `tab = needsYou AND now − raisedAt > 24 h` |
| `expiry` | approval only: `{ expiresAt, isExpired }` |
| `hasRecommendedAnswer` | clarification only |
| `href` | approval/clarification → `/approvals/{approvalId or clarificationId}`; else `/workflows/{workflowId}` |
| `stage` | `{ index, count, name }` when present |
| `elapsed` | running: `now − started_at` (or `state_observed_at` for QUEUED) |

Ordering: **needsYou** `risk_rank ASC (CRITICAL 0, HIGH 1, MEDIUM 2, LOW 3, none 4), raisedAt ASC, id ASC`; **running** `started_at DESC NULLS LAST, id`; **done** `finished_at DESC, id`. Keyset cursors encode the ordering tuple. Test: `api/inbox.test.ts › paging over S-500 equals pure ordering`.

Counts: computed in the same request/transaction (`REPEATABLE READ`) as the rows so they never disagree (SC-004). Test: `api/inbox.test.ts › counts match rows under filter`.

## 5. Today summary (derived)

Window: `[start_of_day(now, org.timezone), now]`.
- `workflowsStarted` = workflows with `started_at` in window
- `workflowsCompleted` = `finished_at` in window AND `state = COMPLETED`
- `approvalsDecided` = approvals with `decided_at` in window
- `needsYou` = current needsYou count (same as tab)
All filtered by visible projects and the project selector. Each has an `href` to the filtered list (`/inbox?tab=…&project=…`; approvals decided links to `/approvals?decided=today` placeholder). Test: `api/inbox.test.ts › today counts respect timezone boundary`.

## 6. Validation rules (Zod, `packages/contracts`)

- `externalId`: `^[A-Za-z0-9._:-]{1,128}$`
- `title`, `ask`, `question`: trimmed, non-empty, ≤ 200 / 240 / 240 chars, single line (no `\n`)
- `state`: enum of the nine values; `riskLevel`: enum of four
- `observedAt`, `requestedAt`, `expiresAt`: ISO-8601 with offset; `expiresAt > requestedAt`
- `stageIndex` 1..`stageCount` ≤ 20
- `email`: RFC 5322 simple, ≤ 254; `password`: 8..256 chars (no composition rules; enumeration-safe errors)
- Query: `tab ∈ {needsYou, running, done}`, `project` uuid or `all`, `cursor` opaque base64url ≤ 200 chars, `limit` fixed 50 (not client-settable)

Tests: `contracts/tests/schemas.test.ts` (one failing example per rule).

## 7. Seed S-500 shape (see research R12)

| bucket | count | notes |
|---|---|---|
| needsYou · approvals | 24 | 6 per risk level; 4 with expiry (1 expired), 3 stale (> 24 h) |
| needsYou · clarifications | 12 | 6 with recommended answer |
| needsYou · blocked | 8 | reasons: integration unreachable, ticket closed externally |
| needsYou · failed | 6 | failure at Testing / Implementation with reason |
| running | 100 | 20 QUEUED, 60 RUNNING (stages 1–7), 10 RETRYING, 10 WAITING |
| done | 350 | 300 COMPLETED (with PR refs), 50 CANCELLED; `finished_at` spread over 8 days (≈ 45 fall outside the 7-day window) |
| projects | 4 | viewers/engineers are members of 1–3 projects; approvers 2–4; admin implicit |
| users | 20 | 1 administrator, 4 approvers, 10 engineers, 5 viewers |
| ingestion principals | 1 | `e2e-tests`, all projects |
