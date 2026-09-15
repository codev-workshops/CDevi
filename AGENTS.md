# AGENTS.md — working in the CDevi repository

CDevi (සීදේවි) is an SDLC Control Plane: an enterprise web app for supervising autonomous engineering agents through requirement → analysis → implementation → testing → review → PR, with humans intervening at approval and clarification points. Product intent: `docs/SDLC Control Plane — High-Level UI Specification.md`. Specifications: `specs/`. Governance: `.specify/memory/constitution.md` (v1.1.0) — it wins over anything else in this file.

## Toolchain

- Node 26 (`.nvmrc`), pnpm 10 (`npm i -g pnpm`). Monorepo: `packages/*`, `apps/*` (`pnpm-workspace.yaml`).
- TypeScript strict (`tsconfig.base.json`), ESLint 9 flat config (`eslint.config.js`), Stylelint (`.stylelintrc.json`), Prettier (`.prettierrc.json`), Vitest (`vitest.config.ts` runs the `design-system` and `tools` projects), Playwright for visual/a11y.

## Commands

```bash
pnpm i                      # install (frozen lockfile in CI)
pnpm check                  # lint + lint:css + typecheck + check:classes + test + check:size — run before every commit
pnpm test                   # unit + component axe + token drift + contrast + lint fixtures
pnpm test:visual            # Playwright: page-level axe + screenshots for gallery and reference screens, LCP budget
pnpm build                  # tokens → css bundle → library dist
pnpm format                 # Prettier
pnpm -F @cdevi/design-system gallery   # component gallery at http://127.0.0.1:5173/gallery/
pnpm -F @cdevi/design-system build:tokens   # after editing tokens/tokens.json (never edit generated files)

# Application (specs/003 onwards) — needs PostgreSQL and a .env (copy .env.example)
docker compose up -d        # postgres:17 with roles migrator + app_user
pnpm db:migrate             # packages/db/migrations/*.sql as migrator (CDEVI_RLS=on enables RLS)
pnpm db:seed                # deterministic S-500 demo data + administrator-only `dashboard-demo` project (Dashboard figures) + eight `req-seed-001…008` requirements in payments-api (one per requirement state, req-seed-003 imported from Jira PAY-231) and the `PAY` → payments-api Jira mapping + steps and five agent decisions on runs `s500-001-r7` (3, one restricted evidence) and `s500-001-r4` (2) + US6 pull request `pr-1821` (#1821 "PAY-1391 Refund processing") on `s500-001` with its COMPLETE cycle-3 review (7 lanes: security FAIL, correctness WARN), findings `find-1821-1…7` (5 OPEN, 1 FIXED, 1 DISMISSED, `find-1821-2` restricted evidence) and review cycles #1–#3; prints demo credentials once; refuses in production
pnpm dev                    # api on :3001 and web on :3000 (web rewrites /api/* to the api)
pnpm test:api               # Vitest projects `db` + `api`: real Postgres, re-seeds the database at a fixed clock
pnpm test:e2e               # Playwright in apps/web: migrates + seeds, builds and starts api (:3101) + web (:3100)
pnpm perf:api               # autocannon budgets (GET /api/inbox p95 ≤ 300 ms, ingest p95 ≤ 200 ms)
pnpm -F @cdevi/contracts openapi        # regenerate specs/003-inbox-home and specs/001-sdlc-control-plane-mvp contracts/openapi.yaml from the Zod schemas
pnpm -F @cdevi/design-system exec playwright test --update-snapshots all   # refresh visual baselines intentionally
```

`pnpm test:api` and `pnpm test:e2e` truncate and re-seed the configured database — do not point `DATABASE_URL` at data you want to keep. Without `DATABASE_URL` those projects skip locally; in CI they fail.

CI (`.github/workflows/ci.yml`) runs four required jobs on every PR: `lint`, `unit`, `build`, `visual`. A red job blocks merge; do not weaken a rule to get green — fix the code or, if a rule is wrong, change it in the package with a CHANGELOG entry.

## Spec Kit workflow

Features are specified before they are built: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`. The active feature is recorded in `.specify/feature.json`. Every plan must pass the Constitution Check and fill the **Design System Compliance** section. Every behaviour change ships with a failing-then-passing test; bug fixes start with a regression test (Principle II).

## UI work — read this first

All user interfaces are built from `@cdevi/design-system` (`packages/design-system`). The normative rules are in **`packages/design-system/DESIGN.md`**; the skill `.devin/skills/cdevi-design-system/SKILL.md` is the short form and loads automatically for UI tasks.

- Import components from `@cdevi/design-system` and the stylesheet from `@cdevi/design-system/css`. Do not hand-write `cd-` markup.
- State is always a word in a pill (`StatePill` for the nine workflow states; `RiskBadge` for the four risk levels). `WAITING_FOR_HUMAN` and `BLOCKED` are never hidden.
- Saffron is reserved for "a person is needed" and for exactly one primary `Button variant="saffron"` per screen.
- Agent claims (`Message`) and platform evidence (`GateCheck` + `source`) are visually separate; overrides are never green.
- No inline `style=`, no literal colours/sizes/spacing (tokens only), no `<div onClick>`; every control has an accessible name and visible focus. `pnpm check` enforces all of this and will fail otherwise.
- Missing a pattern? Add it to the package first (DESIGN.md §8: CSS → component + test → gallery entry → DESIGN.md row → CHANGELOG), then consume it.
- Reference screens in `packages/design-system/reference-screens/` are pattern references, not CDevi screens; the screen inventory comes from `specs/001-sdlc-control-plane-mvp/spec.md`.

## Backend and web app work

- `packages/contracts` (Zod) is the single source for request/response types, the OpenAPI document and the pure Inbox read-model rules; the API validates every input with it and the web imports types from it. Browser code imports only the zod-free subpaths (`@cdevi/contracts/read-model`, `/vocabulary`, `/decision-rules`, `/dashboard-model`, `/requirement-rules`, `/agent-run-model`) to stay inside the 200 KB route JS budget.
- `packages/db/migrations/*.sql` are hand-reviewed and are the source of truth (triggers, partial indexes, RLS, grants); `src/schema.ts` mirrors them for typed queries. Password hashing lives only in `packages/db/src/password.ts`.
- API routes are Fastify plugins under `apps/api/src/routes`; errors are `application/problem+json` and never carry SQL, stack traces or request bodies. Every list is bounded (50, keyset cursor). Remote calls have timeouts. Workflow Detail is `GET /api/workflows/{id}` + `POST /api/workflows/{id}/actions` (retry/escalate/cancel, role-gated); stages, agent runs, artifacts and test runs arrive through `PUT /api/ingest/workflows/{externalId}/stages/{position}`, `/api/ingest/agent-runs/{externalId}`, `/api/ingest/artifacts/{externalId}`, `/api/ingest/test-runs/{externalId}` and fan out on the existing inbox stream. Human decisions are a separate path from agent ingestion (`apps/api/src/services/decisions.ts`): `GET /api/approvals` + `GET /api/approvals/{id}` (Approval Center read model) and `POST /api/approvals/{id}/approve|reject`, `POST /api/clarifications/{id}/answer` — approver/administrator only, one transaction with `SELECT … FOR UPDATE` (exactly once; a later caller gets 409 with the recorded outcome), workflow transition out of `WAITING_FOR_HUMAN`, an append-only `audit_events` row and the same `inbox_changed` NOTIFY. The Dashboard is `GET /api/dashboard?project=all|<uuid>&window=24h|7d|30d` (`apps/api/src/services/dashboard.ts`, `routes/dashboard.ts`): a pure aggregate read model over the existing tables (workflows, workflow_stages, agent_runs, artifacts, test_runs, approvals, clarifications, workflow_transitions, audit_events) — no tables of its own, eight bounded statements in one `REPEATABLE READ` transaction, indexes only in `0004_dashboard.sql`; the project is the caller's visible projects (an unknown or invisible uuid returns zeros, not 404), hrefs and figures are composed by `@cdevi/contracts/dashboard-model`, and the screen (`apps/web/app/(app)/dashboard/`) refetches on `inbox.changed`. Requirements (`apps/api/src/services/requirements.ts`, `routes/requirements.ts`): `GET /api/requirements?project=&state=&assignee=&cursor=` and `GET /api/requirements/{id}` (session user, visible projects), `POST /api/requirements` and `POST /api/requirements/{id}/submit` (engineer/approver/administrator — `canCreateRequirement`), `POST /api/requirements/{id}/approve|reject` (approver/administrator — `canDecide`, `SELECT … FOR UPDATE`, exactly once → 409, `audit_events`, `inbox_changed`; approve creates the workflow with its seven stages in the same transaction, first stage `QUEUED`). Requirement states (`DRAFT`, `ANALYZING`, `NEEDS_CLARIFICATION`, `READY`, `APPROVED`, `IN_IMPLEMENTATION`, `COMPLETED`, `REJECTED`) are **not** workflow states: the state machine, role gates and words live in `@cdevi/contracts/requirement-rules`, the web renders them with `RequirementStatePill` (never `StatePill`), transitions are append-only `requirement_transitions` rows (`0005_requirements.sql`). Analysis is never produced by the API: the agent runtime delivers it through `PUT /api/ingest/requirements/{externalId}/analysis` (`services/requirement-analysis.ts`; Bearer ingest token, `observedAt` watermark like the other ingest routes) and the state becomes `READY` or `NEEDS_CLARIFICATION` by the open-question count; AI items carry `ai_generated`/`source` and the UI labels them. Jira is inbound-only: `POST /api/integrations/jira/webhook` (`services/jira-webhook.ts`, `routes/integrations.ts`) verifies `x-hub-signature = sha256=<HMAC-SHA256 over the raw body>` with a constant-time compare using **`JIRA_WEBHOOK_SECRET` from the environment only** (unset ⇒ 401; never in the repo — the e2e suite injects `E2E.jiraWebhookSecret` through `playwright.config.ts`), maps the Jira project key via `integration_project_mappings`, upserts `source = 'jira'` requirements with `external_ref` and flags deleted/done issues (linked workflow → `BLOCKED`). `GET /api/workflows?project=&requirement=&state=&stage=&cursor=` (`services/workflow-list.ts`) is the bounded FR-003 list the Workflow Center will consume; `/workflows` and `/integrations` remain placeholders.
- Agent runs and decisions (specs/001 US5; `apps/api/src/services/agent-run-detail.ts`, `routes/agent-runs.ts`): `GET /api/agent-runs/{id}` is the one read model (session user, visible projects, byte-identical for every role incl. viewer — nothing to act on, so the screen `apps/web/app/(app)/agents/runs/[id]/` has **no saffron button** and writes no `audit_events`), and `GET /api/workflows/{id}` lists each stage's runs in `stages[].agentRuns` for the "Inspect run" drill-down (`/agents` itself stays a placeholder; `DecisionLinks.agentRun` points straight at `/agents/runs/{id}`). The runtime owns everything shown: `PUT /api/ingest/agent-runs/{externalId}` carries `steps` (≤ 20 `{label, status}`, replace-whole like `timeline`; rendered with `Stepper`, never a spinner) and `PUT /api/ingest/agent-runs/{externalId}/decisions` replaces the run's whole decision set (`agent_decisions`, migration `0006`) under an `observedAt` watermark — older batches answer 200 `{result:'stale'}` and change nothing, every batch writes an `ingestion_log` row and one `inbox_changed` NOTIFY. FR-018: the decision schemas are `.strict()` and have no free-form reasoning field, so a payload carrying `reasoning`/`chainOfThought` is a 400 at the contract — do not add such a column, property or UI text. Evidence refs are typed (`kind`, `label`, `href?`, `locator?`, `accessible`); `accessible:false` or a missing href renders "access restricted" text, never a link. A RUNNING/RETRYING run quiet for > 30 min shows a stale `Notice` (`runFreshness`), not a state change. Pure rules and words live in `@cdevi/contracts/agent-run-model`.
- Web: Server Components fetch through `apps/web/lib/api.ts`/`session.ts` and import design-system components via `apps/web/lib/ds.ts` (client boundary). Client components own tabs, the project selector and the SSE subscription. No `style=`, no `cd-` classes.
- Test names start with the spec id they prove (`FR-010 …`, `SC-004 …`).

## Repository layout

```
apps/web/                 @cdevi/web — Next.js app (Inbox home page, Workflow Detail, Approval Center, Dashboard, Requirements, Agent Run Inspector; placeholders for the remaining specs/001 screens)
apps/api/                 @cdevi/api — Fastify API (auth, Inbox/Workflow Detail/Approval Center/Dashboard/Requirements/Agent Run read models, decisions, ingestion, Jira webhook, SSE)
packages/contracts/       @cdevi/contracts — Zod schemas, OpenAPI generator, pure read-model rules
packages/db/              @cdevi/db — Drizzle schema, SQL migrations, seed, admin CLIs
packages/design-system/   @cdevi/design-system — tokens, CSS, React components, gallery, reference screens, DESIGN.md
tools/                    repo checks: check-class-prefix.mjs, check-size.mjs, lint fixtures (must fail), governance tests
specs/                    Spec Kit features (001 control-plane MVP, 002 design-system adoption, 003 inbox home page)
docs/                     product and architecture documents
.specify/                 constitution, templates, scripts
.devin/skills/            agent skills (speckit-*, cdevi-design-system)
```

## Conventions

- Commit after each task or logical group; describe _why_. Update `CHANGELOG.md` in the same commit as a design-system change.
- Pin dependencies to versions published ≥ 7 days ago; commit `pnpm-lock.yaml`.
- Never commit secrets. `.env*` is ignored.
- Generated files (`css/tokens.css`, `css/cdevi.css`, `tailwind/preset.cjs`, `src/tokens.generated.ts`) are committed but never edited by hand; `pnpm check:tokens` catches drift.
