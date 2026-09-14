import { resolve } from 'node:path';
import pg from 'pg';
import { hashPassword } from '../password';
import { generateToken, hashToken } from '../token';
import { buildS500, PROJECTS } from './s500';

export class SeedRefusedError extends Error {}

export interface SeedOptions {
  connectionString?: string | undefined;
  base?: Date | undefined;
  password?: string | undefined;
  ingestToken?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  log?: ((msg: string) => void) | undefined;
}

export interface SeedResult {
  organizationId: string;
  password: string;
  ingestToken: string;
  counts: { users: number; workflows: number; approvals: number; clarifications: number };
}

/** Truncates every table and loads S-500. Refuses to run in production (FR-022). */
export async function seed(opts: SeedOptions = {}): Promise<SeedResult> {
  const env = opts.env ?? process.env;
  if (env['NODE_ENV'] === 'production' || env['CDEVI_ENV'] === 'production') {
    throw new SeedRefusedError('Refusing to seed: NODE_ENV or CDEVI_ENV is production');
  }
  const connectionString = opts.connectionString ?? env['DATABASE_MIGRATOR_URL'];
  if (!connectionString) throw new Error('DATABASE_MIGRATOR_URL is not set');
  const log = opts.log ?? ((m: string) => console.log(m));
  const base =
    opts.base ?? (env['CDEVI_SEED_BASE'] ? new Date(env['CDEVI_SEED_BASE']) : new Date());
  const password =
    opts.password ?? env['CDEVI_SEED_PASSWORD'] ?? generateToken('cdevi-demo-').slice(0, 24);
  const ingestToken = opts.ingestToken ?? env['CDEVI_SEED_INGEST_TOKEN'] ?? generateToken('cdvi_');

  const { users, workflows } = buildS500(base);
  const passwordHash = await hashPassword(password);

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE inbox_change_log, ingestion_log, workflow_transitions, approvals, clarifications, workflows, sessions, project_memberships, ingestion_principals, users, projects, organizations RESTART IDENTITY CASCADE`,
    );
    const org = (
      await client.query<{ id: string }>(
        `INSERT INTO organizations (name, timezone, is_demo) VALUES ('Acme Engineering', 'Asia/Colombo', true) RETURNING id`,
      )
    ).rows[0]!.id;

    const projectIds = new Map<string, string>();
    for (const p of PROJECTS) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO projects (organization_id, key, name) VALUES ($1,$2,$3) RETURNING id`,
        [org, p.key, p.name],
      );
      projectIds.set(p.key, r.rows[0]!.id);
    }

    for (const u of users) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, display_name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org, u.email, u.displayName, passwordHash, u.role],
      );
      for (const key of u.projects) {
        await client.query(
          `INSERT INTO project_memberships (user_id, project_id, organization_id) VALUES ($1,$2,$3)`,
          [r.rows[0]!.id, projectIds.get(key), org],
        );
      }
    }

    const principal = (
      await client.query<{ id: string }>(
        `INSERT INTO ingestion_principals (organization_id, name, token_hash, project_ids) VALUES ($1,'e2e-tests',$2,$3) RETURNING id`,
        [org, hashToken(ingestToken), [...projectIds.values()]],
      )
    ).rows[0]!.id;

    let approvals = 0;
    let clarifications = 0;
    for (const w of workflows) {
      const projectId = projectIds.get(w.project)!;
      const r = await client.query<{ id: string }>(
        `INSERT INTO workflows (organization_id, project_id, external_id, title, agent, state, state_observed_at, state_reason, stage_index, stage_count, stage_name, pull_request_ref, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,7,$10,$11,$12,$13) RETURNING id`,
        [
          org,
          projectId,
          w.externalId,
          w.title,
          w.agent,
          w.state,
          w.stateObservedAt,
          w.stateReason,
          w.stageIndex,
          w.stageName,
          w.pullRequestRef,
          w.startedAt,
          w.finishedAt,
        ],
      );
      const id = r.rows[0]!.id;
      const created = w.startedAt ?? w.stateObservedAt;
      await client.query(
        `INSERT INTO workflow_transitions (organization_id, workflow_id, from_state, to_state, observed_at, principal_id) VALUES ($1,$2,NULL,'QUEUED',$3,$4)`,
        [org, id, new Date(created.getTime() - 60_000), principal],
      );
      if (w.state !== 'QUEUED') {
        await client.query(
          `INSERT INTO workflow_transitions (organization_id, workflow_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,'QUEUED',$3,$4,$5,$6)`,
          [org, id, w.state, w.stateObservedAt, w.stateReason, principal],
        );
      }
      if (w.approval) {
        approvals++;
        await client.query(
          `INSERT INTO approvals (organization_id, project_id, workflow_id, external_id, ask, risk_level, requested_by_agent, requested_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            org,
            projectId,
            id,
            w.approval.externalId,
            w.approval.ask,
            w.approval.riskLevel,
            w.agent,
            w.approval.requestedAt,
            w.approval.expiresAt,
          ],
        );
      }
      if (w.decidedApproval) {
        const d = w.decidedApproval;
        await client.query(
          `INSERT INTO approvals (organization_id, project_id, workflow_id, external_id, ask, risk_level, requested_by_agent, requested_at, decision, decided_at, decided_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Approver 1')`,
          [
            org,
            projectId,
            id,
            d.externalId,
            d.ask,
            d.riskLevel,
            w.agent,
            d.requestedAt,
            d.outcome,
            d.decidedAt,
          ],
        );
      }
      if (w.clarification) {
        clarifications++;
        await client.query(
          `INSERT INTO clarifications (organization_id, project_id, workflow_id, external_id, question, requested_by_agent, requested_at, has_recommended_answer) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            org,
            projectId,
            id,
            w.clarification.externalId,
            w.clarification.question,
            w.agent,
            w.clarification.requestedAt,
            w.clarification.hasRecommendedAnswer,
          ],
        );
      }
    }
    // The seed's own inserts should not count as "changes" for SSE replay.
    await client.query(`TRUNCATE inbox_change_log RESTART IDENTITY`);
    await client.query('COMMIT');

    log(`Seeded S-500 into organization ${org} (base ${base.toISOString()})`);
    log(
      `  users: ${users.length}  workflows: ${workflows.length}  approvals: ${approvals}  clarifications: ${clarifications}`,
    );
    log(
      '  Demo credentials (shown once): admin@cdevi.demo, approver1@cdevi.demo, engineer1@cdevi.demo, viewer1@cdevi.demo',
    );
    log(`  Password (all demo users): ${password}`);
    log(`  Ingestion token (principal e2e-tests): ${ingestToken}`);
    return {
      organizationId: org,
      password,
      ingestToken,
      counts: { users: users.length, workflows: workflows.length, approvals, clarifications },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  seed().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
