import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const skip = Boolean(process.env['CDEVI_SKIP_DB_TESTS']);
const admin = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
const app = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });

const enumValuesFrom = (pool: pg.Pool) => async (name: string) =>
  (
    await pool.query(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1 order by e.enumsortorder`,
      [name],
    )
  ).rows.map((r) => r.enumlabel);
const enumValues = enumValuesFrom(admin);

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
      'inbox_changed_agent_runs',
      'inbox_changed_approvals',
      'inbox_changed_artifacts',
      'inbox_changed_clarifications',
      'inbox_changed_test_runs',
      'inbox_changed_workflow_stages',
      'inbox_changed_workflows',
    ]);
  });
});

describe.skipIf(skip)('migration 0002_workflow_detail (specs/001 data-model.md §2–§4)', () => {
  const admin2 = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
  const app2 = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  beforeAll(async () => {
    const { migrate } = await import('../src/migrate');
    await migrate({ log: () => {} });
  });
  afterAll(async () => {
    await admin2.end();
    await app2.end();
  });

  const columns = async (table: string) =>
    (
      await admin2.query(`select column_name from information_schema.columns where table_name=$1`, [
        table,
      ])
    ).rows.map((r) => r.column_name as string);
  const constraints = async (table: string) =>
    (
      await admin2.query(
        `select conname, contype from pg_constraint where conrelid = $1::regclass`,
        [table],
      )
    ).rows as { conname: string; contype: string }[];

  /** Inserts an org, project, workflow and one stage inside the caller's transaction. */
  async function fixture(client: pg.PoolClient, stageState = 'RUNNING') {
    const org = (
      await client.query(`insert into organizations(name) values ('t-org') returning id`)
    ).rows[0].id as string;
    const project = (
      await client.query(
        `insert into projects(organization_id, key, name) values ($1,'t','T') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const workflow = (
      await client.query(
        `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at) values ($1,$2,'w1','W','RUNNING',now()) returning id`,
        [org, project],
      )
    ).rows[0].id as string;
    const stage = (
      await client.query(
        `insert into workflow_stages(organization_id, project_id, workflow_id, position, name, state, state_observed_at) values ($1,$2,$3,1,'Requirement',$4,now()) returning id`,
        [org, project, workflow, stageState],
      )
    ).rows[0].id as string;
    return { org, project, workflow, stage };
  }

  it('FR-004 enums artifact_type and test_run_status have the exact values', async () => {
    const enumValues = enumValuesFrom(admin2);
    expect(await enumValues('artifact_type')).toEqual([
      'requirement_spec',
      'impact_analysis',
      'implementation_plan',
      'test_results',
      'code_diff',
      'pull_request',
    ]);
    expect(await enumValuesFrom(admin2)('test_run_status')).toEqual([
      'RUNNING',
      'PASSED',
      'FAILED',
    ]);
  });

  it('FR-001 workflow_stages has position CHECK 1..20, UNIQUE(workflow_id, position), organization_id + project_id NOT NULL', async () => {
    const cols = await columns('workflow_stages');
    for (const c of [
      'organization_id',
      'project_id',
      'workflow_id',
      'position',
      'name',
      'state',
      'state_observed_at',
      'state_reason',
      'agent',
      'started_at',
      'finished_at',
      'error_summary',
      'requires_approval',
      'approval_id',
      'clarification_id',
      'updated_at',
    ])
      expect(cols, c).toContain(c);
    const cons = await constraints('workflow_stages');
    expect(cons.map((c) => c.conname)).toContain('workflow_stages_workflow_position_key');
    const client = await app2.connect();
    try {
      await client.query('BEGIN');
      const f = await fixture(client);
      await expect(
        client.query(
          `insert into workflow_stages(organization_id, project_id, workflow_id, position, name, state, state_observed_at) values ($1,$2,$3,21,'X','QUEUED',now())`,
          [f.org, f.project, f.workflow],
        ),
      ).rejects.toThrow(/check/i);
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      const g = await fixture(client);
      await expect(
        client.query(
          `insert into workflow_stages(organization_id, project_id, workflow_id, position, name, state, state_observed_at) values ($1,$2,$3,1,'Dup','QUEUED',now())`,
          [g.org, g.project, g.workflow],
        ),
      ).rejects.toThrow(/workflow_stages_workflow_position_key/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('FR-001 agent_runs, artifacts, test_runs exist with organization_id, project_id, workflow_id, stage_id and UNIQUE(organization_id, external_id)', async () => {
    for (const t of ['agent_runs', 'artifacts', 'test_runs']) {
      const cols = await columns(t);
      for (const c of ['organization_id', 'project_id', 'workflow_id', 'stage_id', 'external_id'])
        expect(cols, `${t}.${c}`).toContain(c);
      const cons = await constraints(t);
      expect(
        cons.map((c) => c.conname),
        `${t} unique`,
      ).toContain(`${t}_organization_id_external_id_key`);
    }
    expect(await columns('artifacts')).not.toContain('updated_at');
    const idx = (
      await admin2.query(
        `select indexname from pg_indexes where tablename in ('workflow_stages','agent_runs','artifacts','test_runs','workflow_transitions')`,
      )
    ).rows.map((r) => r.indexname);
    for (const name of [
      'workflow_stages_workflow_idx',
      'workflow_stages_attention_idx',
      'agent_runs_workflow_idx',
      'agent_runs_stage_idx',
      'artifacts_workflow_idx',
      'test_runs_workflow_idx',
      'workflow_transitions_stage_idx',
    ])
      expect(idx, name).toContain(name);
  });

  it('FR-002 workflow_transitions has stage_id and user_id columns', async () => {
    const cols = await columns('workflow_transitions');
    expect(cols).toContain('stage_id');
    expect(cols).toContain('user_id');
  });

  it('FR-034 inserting or updating a stage, run, artifact or test run writes inbox_change_log', async () => {
    const client = await app2.connect();
    try {
      await client.query('BEGIN');
      const before = (await client.query(`select coalesce(max(seq),0) as m from inbox_change_log`))
        .rows[0].m;
      const f = await fixture(client);
      await client.query(
        `insert into agent_runs(organization_id, project_id, workflow_id, stage_id, external_id, agent, state, started_at) values ($1,$2,$3,$4,'r1','coder','RUNNING',now())`,
        [f.org, f.project, f.workflow, f.stage],
      );
      await client.query(
        `insert into artifacts(organization_id, project_id, workflow_id, stage_id, external_id, type, title, produced_at) values ($1,$2,$3,$4,'a1','requirement_spec','Spec',now())`,
        [f.org, f.project, f.workflow, f.stage],
      );
      await client.query(
        `insert into test_runs(organization_id, project_id, workflow_id, stage_id, external_id, category, status, total, passed, started_at) values ($1,$2,$3,$4,'t1','unit','PASSED',3,3,now())`,
        [f.org, f.project, f.workflow, f.stage],
      );
      await client.query(`update workflow_stages set state='COMPLETED' where id=$1`, [f.stage]);
      const rows = (
        await client.query(`select workflow_id from inbox_change_log where seq > $1`, [before])
      ).rows;
      // workflow insert + stage insert + run + artifact + test run + stage update
      expect(rows).toHaveLength(6);
      expect(new Set(rows.map((r) => r.workflow_id))).toEqual(new Set([f.workflow]));
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('FR-001 artifacts_immutable rejects UPDATE when the producing stage is COMPLETED and allows it while RUNNING', async () => {
    const client = await app2.connect();
    try {
      await client.query('BEGIN');
      const f = await fixture(client, 'RUNNING');
      const a = (
        await client.query(
          `insert into artifacts(organization_id, project_id, workflow_id, stage_id, external_id, type, title, produced_at) values ($1,$2,$3,$4,'a1','code_diff','Diff',now()) returning id`,
          [f.org, f.project, f.workflow, f.stage],
        )
      ).rows[0].id;
      await client.query(`update artifacts set title='Diff v2' where id=$1`, [a]);
      await client.query(`update workflow_stages set state='COMPLETED' where id=$1`, [f.stage]);
      await expect(
        client.query(`update artifacts set title='Diff v3' where id=$1`, [a]),
      ).rejects.toThrow(/artifact_immutable/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('FR-001 updated_at triggers fire on workflow_stages, agent_runs and test_runs', async () => {
    const trg = (
      await admin2.query(
        `select tgname from pg_trigger where tgname like '%_updated_at' and not tgisinternal`,
      )
    ).rows.map((r) => r.tgname);
    for (const t of ['workflow_stages_updated_at', 'agent_runs_updated_at', 'test_runs_updated_at'])
      expect(trg).toContain(t);
    const client = await app2.connect();
    try {
      await client.query('BEGIN');
      const f = await fixture(client);
      const past = (
        await client.query(
          `insert into workflow_stages(organization_id, project_id, workflow_id, position, name, state, state_observed_at, updated_at) values ($1,$2,$3,2,'Analysis','QUEUED',now(),now() - interval '1 hour') returning id, updated_at`,
          [f.org, f.project, f.workflow],
        )
      ).rows[0] as { id: string; updated_at: Date };
      await client.query(`update workflow_stages set agent='x' where id=$1`, [past.id]);
      const t1 = (
        await client.query(`select updated_at from workflow_stages where id=$1`, [past.id])
      ).rows[0].updated_at as Date;
      expect(t1.getTime()).toBeGreaterThan(past.updated_at.getTime());
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('FR-033 every new table has an org-isolation RLS policy and app_user grants', async () => {
    for (const t of ['workflow_stages', 'agent_runs', 'artifacts', 'test_runs']) {
      const pol = await admin2.query(`select policyname from pg_policies where tablename=$1`, [t]);
      expect(pol.rows.map((r) => r.policyname)).toContain(`${t}_org_isolation`);
      const privs = (
        await admin2.query(
          `select privilege_type from information_schema.role_table_grants where grantee='app_user' and table_name=$1`,
          [t],
        )
      ).rows.map((r) => r.privilege_type);
      expect(privs, t).toEqual(expect.arrayContaining(['SELECT', 'INSERT', 'UPDATE']));
      expect(privs, t).not.toContain('DELETE');
    }
  });
});
