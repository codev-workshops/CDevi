import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const skip = Boolean(process.env['CDEVI_SKIP_DB_TESTS']);
const admin = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
const app = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });

const enumValues = async (name: string) =>
  (
    await admin.query(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1 order by e.enumsortorder`,
      [name],
    )
  ).rows.map((r) => r.enumlabel);

describe.skipIf(skip)('migration 0001_init (data-model.md §2)', () => {
  beforeAll(async () => {
    const { migrate } = await import('../src/migrate');
    await migrate({ log: () => {} });
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it('defines the enums with the exact specs/001 vocabulary', async () => {
    expect(await enumValues('workflow_state')).toEqual([
      'QUEUED',
      'RUNNING',
      'RETRYING',
      'WAITING',
      'WAITING_FOR_HUMAN',
      'BLOCKED',
      'FAILED',
      'COMPLETED',
      'CANCELLED',
    ]);
    expect(await enumValues('risk_level')).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    expect(await enumValues('user_role')).toEqual([
      'administrator',
      'approver',
      'engineer',
      'viewer',
    ]);
    expect(await enumValues('approval_decision')).toEqual(['approved', 'rejected']);
    expect(await enumValues('ingestion_outcome')).toEqual([
      'accepted',
      'stale',
      'rejected',
      'forbidden',
    ]);
  });

  it('every table carries organization_id and has a (disabled) RLS policy', async () => {
    const tables = [
      'organizations',
      'projects',
      'users',
      'project_memberships',
      'sessions',
      'ingestion_principals',
      'workflows',
      'workflow_transitions',
      'approvals',
      'clarifications',
      'ingestion_log',
      'inbox_change_log',
    ];
    for (const t of tables) {
      const col = await admin.query(
        `select 1 from information_schema.columns where table_name=$1 and column_name='organization_id'`,
        [t],
      );
      expect(col.rowCount, `${t}.organization_id`).toBe(1);
      const pol = await admin.query(`select 1 from pg_policies where tablename=$1`, [t]);
      expect(pol.rowCount, `${t} policy`).toBeGreaterThan(0);
      const rls = await admin.query(`select relrowsecurity from pg_class where relname=$1`, [t]);
      expect(rls.rows[0].relrowsecurity, `${t} rls disabled while CDEVI_RLS=off`).toBe(false);
    }
  });

  it('has the workflow indexes from data-model.md', async () => {
    const idx = (
      await admin.query(`select indexname from pg_indexes where tablename='workflows'`)
    ).rows.map((r) => r.indexname);
    for (const name of [
      'workflows_org_project_state_idx',
      'workflows_needs_you_idx',
      'workflows_running_idx',
      'workflows_done_idx',
      'workflows_org_external_id_key',
    ])
      expect(idx, name).toContain(name);
  });

  it('app_user cannot update or delete transitions or the ingestion log', async () => {
    for (const t of ['workflow_transitions', 'ingestion_log']) {
      const privs = (
        await admin.query(
          `select privilege_type from information_schema.role_table_grants where grantee='app_user' and table_name=$1`,
          [t],
        )
      ).rows.map((r) => r.privilege_type);
      expect(privs).toContain('INSERT');
      expect(privs).toContain('SELECT');
      expect(privs).not.toContain('UPDATE');
      expect(privs).not.toContain('DELETE');
    }
  });

  it('changing a workflow emits NOTIFY inbox_changed and appends to inbox_change_log', async () => {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      const org = (
        await client.query(`insert into organizations(name) values ('t-org') returning id`)
      ).rows[0].id;
      const project = (
        await client.query(
          `insert into projects(organization_id, key, name) values ($1,'t','T') returning id`,
          [org],
        )
      ).rows[0].id;
      const before = (await client.query(`select coalesce(max(seq),0) as m from inbox_change_log`))
        .rows[0].m;
      await client.query(
        `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at) values ($1,$2,'w1','W','QUEUED',now())`,
        [org, project],
      );
      const rows = (
        await client.query(
          `select organization_id, project_id from inbox_change_log where seq > $1`,
          [before],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].project_id).toBe(project);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // NOTIFY delivery is asserted end to end in apps/api/tests/stream.test.ts; here we assert the trigger exists.
    const trg = await admin.query(
      `select tgname from pg_trigger where tgname like 'inbox_changed_%' and not tgisinternal`,
    );
    expect(trg.rows.map((r) => r.tgname).sort()).toEqual([
      'inbox_changed_approvals',
      'inbox_changed_clarifications',
      'inbox_changed_workflows',
    ]);
  });
});
