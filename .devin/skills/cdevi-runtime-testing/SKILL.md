---
name: cdevi-runtime-testing
description: Run CDevi locally and verify Workflow Detail, role-gated actions, and ingestion-driven live updates without resetting another tester's database.
---

# CDevi runtime testing

## Devin Secrets Needed

For the disposable seeded demo, no external secret is required: obtain the deterministic E2E password and ingestion token from `apps/web/playwright.config.ts`. Outside that demo, provide `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, a test-user credential, and `INGEST_TOKEN` through the approved secret mechanism. Never copy secret values into this skill.

## Local startup and database safety

- Read the repository blueprint first. Use Node 26 and the pinned pnpm version.
- Source root `.env` into the environment, then start `pnpm dev` for API :3001 and web :3000. Web rewrites `/api/*` to the API.
- PostgreSQL runs under Docker Compose. If host `psql` is unavailable, use the database container's `psql` rather than installing another client.
- `pnpm db:seed`, API tests, and E2E setup truncate data and invalidate sessions. Coordinate with other agents; never reset a database under active UI testing.
- For a fresh disposable seed, set `CDEVI_SEED_PASSWORD` and `CDEVI_SEED_INGEST_TOKEN` explicitly using the checked-in E2E constants. A preexisting database may have different credentials.
- To preserve existing records when login credentials are unknown, create isolated test users through `pnpm db:user:create --email ... --name ... --role engineer --projects payments-api --password-stdin`; repeat for viewer. Supply the password via stdin and source the migrator connection first.
- Seeded external IDs are stable (`s500-001` waiting, `s500-045` failed), but internal workflow/approval UUIDs change after reseeding. Resolve new IDs from Inbox or a database query.

## UI journey

- Inbox's waiting showcase opens the approval record; its `Open workflow` link opens Workflow Detail.
- Check the needs-you card above the seven-stage pipeline, one saffron approval action, stage pills/current-stage context, chronological activity, and stage-tagged artifacts.
- Verify viewer actions before an engineer retries the same failed record. Retry changes workflow state; use a separate disposable failed record for confirmed Cancel so the retry scenario remains available.
- Keyboard Cancel takes two activations. Escape or blur abandons confirmation. Escalate opens an inline input; verify its visible value before Send and then inspect the activity entry.

## Live updates

- Ingestion bearer authentication is the intended API path; do not extract browser session cookies.
- New stages may need a legal transition path (e.g. RUNNING before COMPLETED/FAILED).
- Each stage observation must have an `observedAt` newer than the stored observation, including same-state updates.
- Workflow state and stage state are separate ingestion records: a stage-only RETRYING observation can leave a FAILED workflow header/failure panel. Verify the panel anchors to the relevant stage rather than assuming it disappears. The engineer Retry action updates both.
- For a <5-second assertion, attach a passive MutationObserver before the ingestion request, compare DOM-change epoch time with request-send time, and verify `performance.timeOrigin` and navigation count are unchanged. Pair instrumentation with a visible screenshot/recording; do not rely on reaction time.
- Workspace packages may export source directly; inspect package exports and the watcher when a lead changes contracts mid-run. Only restart servers if the change was not picked up.
