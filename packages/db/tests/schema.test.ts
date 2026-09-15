import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe.skipIf(skip)('migration 0003_approval_center (specs/001 data-model.md §11–§12)', () => {
  const admin3 = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
  const app3 = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  beforeAll(async () => {
    const { migrate } = await import('../src/migrate');
    await migrate({ log: () => {} });
  });
  afterAll(async () => {
    await admin3.end();
    await app3.end();
  });

  const columns = async (table: string) =>
    (
      await admin3.query(`select column_name from information_schema.columns where table_name=$1`, [
        table,
      ])
    ).rows.map((r) => r.column_name as string);
  const constraintNames = async (table: string) =>
    (
      await admin3.query(`select conname from pg_constraint where conrelid = $1::regclass`, [table])
    ).rows.map((r) => r.conname as string);
  const indexNames = async (table: string) =>
    (await admin3.query(`select indexname from pg_indexes where tablename=$1`, [table])).rows.map(
      (r) => r.indexname as string,
    );

  async function fixture(client: pg.PoolClient) {
    const org = (
      await client.query(`insert into organizations(name) values ('t-org') returning id`)
    ).rows[0].id as string;
    const project = (
      await client.query(
        `insert into projects(organization_id, key, name) values ($1,'t','T') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const user = (
      await client.query(
        `insert into users(organization_id, email, display_name, role, password_hash) values ($1,'t@t.io','Tess','approver','x') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const workflow = (
      await client.query(
        `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at) values ($1,$2,'w1','W','WAITING_FOR_HUMAN',now()) returning id`,
        [org, project],
      )
    ).rows[0].id as string;
    const approval = (
      await client.query(
        `insert into approvals(organization_id, project_id, workflow_id, external_id, ask, risk_level, requested_at) values ($1,$2,$3,'a1','Ask','HIGH',now()) returning id`,
        [org, project, workflow],
      )
    ).rows[0].id as string;
    return { org, project, user, workflow, approval };
  }

  it('FR-012 approvals has context, links, rejection_reason, rejection_target, decided_by_user_id with the rejection CHECKs', async () => {
    const cols = await columns('approvals');
    for (const c of [
      'context',
      'links',
      'rejection_reason',
      'rejection_target',
      'decided_by_user_id',
    ])
      expect(cols).toContain(c);
    const cons = await constraintNames('approvals');
    expect(cons).toContain('approvals_rejection_target_check');
    expect(cons).toContain('approvals_rejection_reason_check');
    const client = await app3.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      await expect(
        client.query(`update approvals set rejection_target='FAILED' where id=$1`, [f.approval]),
      ).rejects.toThrow();
      await client.query('rollback');
      await client.query('begin');
      const g = await fixture(client);
      await expect(
        client.query(
          `update approvals set decision='rejected', decided_at=now(), decided_by='Tess', decided_by_user_id=$2 where id=$1`,
          [g.approval, g.user],
        ),
      ).rejects.toThrow();
      await client.query('rollback');
      await client.query('begin');
      const h = await fixture(client);
      await client.query(
        `update approvals set decision='rejected', decided_at=now(), decided_by='Tess', decided_by_user_id=$2, rejection_reason='no', rejection_target='BLOCKED' where id=$1`,
        [h.approval, h.user],
      );
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('FR-014 clarifications has why_it_matters, options, links, answer_option, answer_text, answered_by_user_id and the one-answer CHECK', async () => {
    const cols = await columns('clarifications');
    for (const c of [
      'why_it_matters',
      'options',
      'links',
      'answer_option',
      'answer_text',
      'answered_by_user_id',
    ])
      expect(cols).toContain(c);
    expect(await constraintNames('clarifications')).toContain('clarifications_answer_check');
    const client = await app3.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      const clar = (
        await client.query(
          `insert into clarifications(organization_id, project_id, workflow_id, external_id, question, requested_at) values ($1,$2,$3,'c1','Q?',now()) returning id, options, links`,
          [f.org, f.project, f.workflow],
        )
      ).rows[0];
      expect(clar.options).toEqual([]);
      expect(clar.links).toEqual({});
      await expect(
        client.query(
          `update clarifications set answered_at=now(), answered_by='Tess', answered_by_user_id=$2 where id=$1`,
          [clar.id, f.user],
        ),
      ).rejects.toThrow();
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('FR-029 audit_events exists with the listed columns, actor_type CHECK and indexes', async () => {
    const cols = await columns('audit_events');
    for (const c of [
      'id',
      'organization_id',
      'project_id',
      'workflow_id',
      'actor_type',
      'actor_id',
      'actor_name',
      'action',
      'target_type',
      'target_id',
      'risk_level',
      'policy',
      'result',
      'details',
      'occurred_at',
    ])
      expect(cols).toContain(c);
    expect(await constraintNames('audit_events')).toContain('audit_events_actor_type_check');
    const idx = await indexNames('audit_events');
    for (const i of [
      'audit_events_org_time_idx',
      'audit_events_target_idx',
      'audit_events_workflow_idx',
    ])
      expect(idx).toContain(i);
  });

  it('FR-029 UPDATE and DELETE on audit_events raise "audit_events is append-only"', async () => {
    const client = await admin3.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      const ev = (
        await client.query(
          `insert into audit_events(organization_id, project_id, workflow_id, actor_type, actor_id, actor_name, action, target_type, target_id, risk_level, result, details)
           values ($1,$2,$3,'user',$4,'Tess','approval.approved','approval',$5,'HIGH','RUNNING','{}') returning id`,
          [f.org, f.project, f.workflow, f.user, f.approval],
        )
      ).rows[0].id as string;
      await expect(
        client.query(`update audit_events set result='x' where id=$1`, [ev]),
      ).rejects.toThrow(/append-only/);
      await client.query('rollback');
      await client.query('begin');
      const g = await fixture(client);
      const ev2 = (
        await client.query(
          `insert into audit_events(organization_id, project_id, workflow_id, actor_type, actor_id, actor_name, action, target_type, target_id, risk_level, result, details)
           values ($1,$2,$3,'user',$4,'Tess','approval.approved','approval',$5,'HIGH','RUNNING','{}') returning id`,
          [g.org, g.project, g.workflow, g.user, g.approval],
        )
      ).rows[0].id as string;
      await expect(client.query(`delete from audit_events where id=$1`, [ev2])).rejects.toThrow(
        /append-only/,
      );
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('FR-033 audit_events has an org-isolation RLS policy and app_user has SELECT, INSERT but not UPDATE/DELETE', async () => {
    const pol = await admin3.query(
      `select policyname from pg_policies where tablename='audit_events'`,
    );
    expect(pol.rows.map((r) => r.policyname)).toContain('audit_events_org_isolation');
    const privs = (
      await admin3.query(
        `select privilege_type from information_schema.role_table_grants where grantee='app_user' and table_name='audit_events'`,
      )
    ).rows.map((r) => r.privilege_type);
    expect(privs).toEqual(expect.arrayContaining(['SELECT', 'INSERT']));
    expect(privs).not.toContain('UPDATE');
    expect(privs).not.toContain('DELETE');
  });

  it('FR-034 updating approvals.decision still writes inbox_change_log', async () => {
    const client = await app3.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      const before = Number(
        (
          await client.query(`select count(*) c from inbox_change_log where workflow_id=$1`, [
            f.workflow,
          ])
        ).rows[0].c,
      );
      await client.query(
        `update approvals set decision='approved', decided_at=now(), decided_by='Tess', decided_by_user_id=$2 where id=$1`,
        [f.approval, f.user],
      );
      const after = Number(
        (
          await client.query(`select count(*) c from inbox_change_log where workflow_id=$1`, [
            f.workflow,
          ])
        ).rows[0].c,
      );
      expect(after).toBe(before + 1);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe.skipIf(skip)('migration 0004_dashboard (specs/001 data-model.md §18)', () => {
  const admin4 = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
  const DASHBOARD_INDEXES = {
    test_runs: 'test_runs_org_project_finished_idx',
    agent_runs: 'agent_runs_org_project_finished_idx',
    audit_events: 'audit_events_org_risk_time_idx',
    approvals: 'approvals_workflow_idx',
    clarifications: 'clarifications_workflow_idx',
  } as const;
  const TABLES_AFTER_0003 = [
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
    'workflow_stages',
    'agent_runs',
    'artifacts',
    'test_runs',
    'audit_events',
    'schema_migrations',
  ];
  beforeAll(async () => {
    const { migrate } = await import('../src/migrate');
    await migrate({ log: () => {} });
  });
  afterAll(async () => {
    await admin4.end();
  });

  const indexDef = async (name: string) =>
    (await admin4.query(`select tablename, indexdef from pg_indexes where indexname=$1`, [name]))
      .rows[0] as { tablename: string; indexdef: string } | undefined;

  it('SC-007 0004 creates the five dashboard indexes on their tables and records itself', async () => {
    for (const [table, name] of Object.entries(DASHBOARD_INDEXES)) {
      const def = await indexDef(name);
      expect(def, name).toBeDefined();
      expect(def?.tablename, name).toBe(table);
    }
    const applied = (
      await admin4.query(`select name from schema_migrations where name='0004_dashboard.sql'`)
    ).rowCount;
    expect(applied).toBe(1);
  });

  it('SC-007 test_runs and agent_runs indexes are partial on finished_at IS NOT NULL over (organization_id, project_id, finished_at)', async () => {
    for (const name of [DASHBOARD_INDEXES.test_runs, DASHBOARD_INDEXES.agent_runs]) {
      const def = (await indexDef(name))?.indexdef ?? '';
      expect(def, name).toMatch(/\(organization_id, project_id, finished_at\)/);
      expect(def, name).toMatch(/WHERE \(finished_at IS NOT NULL\)/);
    }
  });

  it('SC-007 audit_events_org_risk_time_idx is partial on HIGH/CRITICAL over (organization_id, project_id, occurred_at DESC)', async () => {
    const def = (await indexDef(DASHBOARD_INDEXES.audit_events))?.indexdef ?? '';
    expect(def).toMatch(/\(organization_id, project_id, occurred_at DESC\)/);
    expect(def).toMatch(
      /WHERE \(risk_level = ANY \(ARRAY\['HIGH'::risk_level, 'CRITICAL'::risk_level\]\)\)/,
    );
  });

  it('SC-007 approvals_workflow_idx and clarifications_workflow_idx are plain (workflow_id) indexes', async () => {
    for (const name of [DASHBOARD_INDEXES.approvals, DASHBOARD_INDEXES.clarifications]) {
      const def = (await indexDef(name))?.indexdef ?? '';
      expect(def, name).toMatch(/\(workflow_id\)$/);
      expect(def, name).not.toContain('WHERE');
    }
  });

  it('SC-007 0004 adds no tables, columns, triggers, policies or grants (indexes only)', async () => {
    const tables = (
      await admin4.query(
        `select tablename from pg_tables where schemaname='public' order by tablename`,
      )
    ).rows.map((r) => r.tablename as string);
    expect(tables).toEqual([...TABLES_AFTER_0003].sort());
    const columnCounts = Object.fromEntries(
      (
        await admin4.query(
          `select table_name, count(*)::int n from information_schema.columns where table_schema='public' and table_name = any($1) group by table_name`,
          [Object.keys(DASHBOARD_INDEXES)],
        )
      ).rows.map((r) => [r.table_name, r.n]),
    );
    expect(columnCounts).toEqual({
      test_runs: 17,
      agent_runs: 15,
      audit_events: 15,
      approvals: 20,
      clarifications: 19,
    });
    const sql = readFileSync(
      resolve(import.meta.dirname, '../migrations/0004_dashboard.sql'),
      'utf8',
    )
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(
      /CREATE TABLE|ALTER TABLE|CREATE TRIGGER|CREATE POLICY|GRANT|CREATE FUNCTION/i,
    );
    expect(sql.match(/CREATE INDEX/g)).toHaveLength(5);
  });

  it('SC-007 windowed test-run, agent-run and HIGH/CRITICAL audit aggregates use the 0004 indexes at 500 workflows / 5 000 agent runs / 50 000 audit events', async () => {
    const client = await admin4.connect();
    try {
      await client.query('begin');
      const org = (
        await client.query(`insert into organizations(name) values ('sc7-org') returning id`)
      ).rows[0].id as string;
      const projects = (
        await client.query(
          `insert into projects(organization_id, key, name) select $1, 'sc7-'||g, 'SC7 '||g from generate_series(1,4) g returning id`,
          [org],
        )
      ).rows.map((r) => r.id as string);
      await client.query(
        `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at, started_at, finished_at)
         select $1, ($2::uuid[])[(g % 4) + 1], 'sc7-w'||g, 'W '||g, 'COMPLETED', now() - (g % 60) * interval '1 day', now() - (g % 60) * interval '1 day' - interval '2 hours', now() - (g % 60) * interval '1 day'
         from generate_series(1,500) g`,
        [org, projects],
      );
      await client.query(
        `insert into workflow_stages(organization_id, project_id, workflow_id, position, name, state, state_observed_at)
         select organization_id, project_id, id, 1, 'Implementation', 'COMPLETED', state_observed_at from workflows where organization_id=$1`,
        [org],
      );
      await client.query(
        `with s as (select id, project_id, workflow_id, row_number() over (order by id) rn from workflow_stages where organization_id=$1)
         insert into agent_runs(organization_id, project_id, workflow_id, stage_id, external_id, agent, state, started_at, finished_at)
         select $1, s.project_id, s.workflow_id, s.id, 'sc7-r'||g, 'Implementation Agent',
                case when g % 10 = 0 then 'FAILED' else 'COMPLETED' end::workflow_state,
                now() - (g % 60) * interval '1 day' - interval '1 hour', now() - (g % 60) * interval '1 day'
         from generate_series(1,5000) g join s on s.rn = (g % 500) + 1`,
        [org],
      );
      await client.query(
        `with s as (select id, project_id, workflow_id, row_number() over (order by id) rn from workflow_stages where organization_id=$1)
         insert into test_runs(organization_id, project_id, workflow_id, stage_id, external_id, category, status, total, passed, failed, started_at, finished_at)
         select $1, s.project_id, s.workflow_id, s.id, 'sc7-t'||g, 'unit', 'PASSED', 100, 97, 3,
                now() - (g % 60) * interval '1 day' - interval '1 hour', now() - (g % 60) * interval '1 day'
         from generate_series(1,5000) g join s on s.rn = (g % 500) + 1`,
        [org],
      );
      await client.query(
        `insert into audit_events(organization_id, project_id, actor_type, actor_name, action, target_type, target_id, risk_level, result, occurred_at)
         select $1, ($2::uuid[])[(g % 4) + 1], 'user', 'Tess', 'approval.approved', 'approval', gen_random_uuid(),
                (array['LOW','MEDIUM','HIGH','CRITICAL']::risk_level[])[(g % 4) + 1], 'RUNNING', now() - (g % 60) * interval '1 day'
         from generate_series(1,50000) g`,
        [org, projects],
      );
      await client.query('analyze workflows, workflow_stages, agent_runs, test_runs, audit_events');

      const from = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const plans: Record<string, { sql: string; params: unknown[] }> = {
        [DASHBOARD_INDEXES.test_runs]: {
          sql: `select coalesce(sum(passed),0) p, coalesce(sum(passed+failed),0) t from test_runs where organization_id=$1 and project_id = any($2) and finished_at >= $3 and finished_at < $4`,
          params: [org, projects, from, new Date()],
        },
        [DASHBOARD_INDEXES.agent_runs]: {
          sql: `select count(*) filter (where state='COMPLETED') c, count(*) f from agent_runs where organization_id=$1 and project_id = any($2) and finished_at >= $3 and finished_at < $4`,
          params: [org, projects, from, new Date()],
        },
        [DASHBOARD_INDEXES.audit_events]: {
          sql: `select count(*) from audit_events where organization_id=$1 and project_id = any($2) and risk_level in ('HIGH','CRITICAL') and occurred_at >= $3 and occurred_at < $4`,
          params: [org, projects, from, new Date()],
        },
      };
      const walk = (node: Record<string, unknown>, out: Record<string, unknown>[]) => {
        out.push(node);
        for (const child of (node['Plans'] as Record<string, unknown>[] | undefined) ?? [])
          walk(child, out);
        return out;
      };
      for (const [index, { sql, params }] of Object.entries(plans)) {
        const res = await client.query(`explain (format json) ${sql}`, params);
        const nodes = walk(res.rows[0]['QUERY PLAN'][0]['Plan'], []);
        const scans = nodes.filter((n) => String(n['Node Type']).includes('Scan'));
        expect(
          scans.some((n) => n['Index Name'] === index),
          `${index}: ${scans.map((n) => `${n['Node Type']}(${n['Index Name'] ?? n['Relation Name']})`).join(', ')}`,
        ).toBe(true);
        expect(scans.some((n) => n['Node Type'] === 'Seq Scan')).toBe(false);
      }
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
