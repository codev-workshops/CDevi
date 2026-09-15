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
      'inbox_changed_agent_decisions',
      'inbox_changed_agent_decisions_deleted',
      'inbox_changed_agent_runs',
      'inbox_changed_agent_runs_updated',
      'inbox_changed_approvals',
      'inbox_changed_artifacts',
      'inbox_changed_clarifications',
      'inbox_changed_pull_requests',
      'inbox_changed_pull_requests_updated',
      'inbox_changed_requirements',
      'inbox_changed_review_cycles',
      'inbox_changed_review_cycles_updated',
      'inbox_changed_review_findings',
      'inbox_changed_review_findings_deleted',
      'inbox_changed_review_findings_updated',
      'inbox_changed_reviews',
      'inbox_changed_reviews_updated',
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
  const TABLES_ADDED_BY_0005 = [
    'integration_project_mappings',
    'requirements',
    'requirement_analysis_items',
    'requirement_transitions',
  ];
  const TABLES_ADDED_BY_0006 = ['agent_decisions'];
  const TABLES_ADDED_BY_0007 = ['pull_requests', 'reviews', 'review_findings', 'review_cycles'];
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
    expect(tables).toEqual(
      [
        ...TABLES_AFTER_0003,
        ...TABLES_ADDED_BY_0005,
        ...TABLES_ADDED_BY_0006,
        ...TABLES_ADDED_BY_0007,
      ].sort(),
    );
    const columnCounts = Object.fromEntries(
      (
        await admin4.query(
          `select table_name, count(*)::int n from information_schema.columns where table_schema='public' and table_name = any($1) group by table_name`,
          [Object.keys(DASHBOARD_INDEXES)],
        )
      ).rows.map((r) => [r.table_name, r.n]),
    );
    // agent_runs is 15 columns after 0002 + `steps` and `decisions_observed_at` from 0006 (the only later columns on these tables)
    expect(columnCounts).toEqual({
      test_runs: 17,
      agent_runs: 17,
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

describe.skipIf(skip)('migration 0005_requirements (specs/001 data-model.md §22)', () => {
  const admin5 = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
  const app5 = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  beforeAll(async () => {
    const { migrate } = await import('../src/migrate');
    await migrate({ log: () => {} });
  });
  afterAll(async () => {
    await admin5.end();
    await app5.end();
  });

  const columns = async (table: string) =>
    (
      await admin5.query(`select column_name from information_schema.columns where table_name=$1`, [
        table,
      ])
    ).rows.map((r) => r.column_name as string);
  const constraintNames = async (table: string) =>
    (
      await admin5.query(`select conname from pg_constraint where conrelid = $1::regclass`, [table])
    ).rows.map((r) => r.conname as string);
  const indexDef = async (name: string) =>
    (await admin5.query(`select tablename, indexdef from pg_indexes where indexname=$1`, [name]))
      .rows[0] as { tablename: string; indexdef: string } | undefined;
  const walkPlan = (node: Record<string, unknown>, out: Record<string, unknown>[]) => {
    out.push(node);
    for (const child of (node['Plans'] as Record<string, unknown>[] | undefined) ?? [])
      walkPlan(child, out);
    return out;
  };
  const expectIndexScan = async (
    client: pg.PoolClient,
    index: string,
    sql: string,
    params: unknown[],
  ) => {
    const res = await client.query(`explain (format json) ${sql}`, params);
    const nodes = walkPlan(res.rows[0]['QUERY PLAN'][0]['Plan'], []);
    const scans = nodes.filter((n) => String(n['Node Type']).includes('Scan'));
    expect(
      scans.some((n) => n['Index Name'] === index),
      `${index}: ${scans.map((n) => `${n['Node Type']}(${n['Index Name'] ?? n['Relation Name']})`).join(', ')}`,
    ).toBe(true);
    expect(scans.some((n) => n['Node Type'] === 'Seq Scan')).toBe(false);
  };

  /** Org, project, an engineer, a QUEUED workflow and one manual requirement inside the caller's transaction. */
  async function fixture(client: pg.PoolClient, state = 'DRAFT') {
    const org = (
      await client.query(`insert into organizations(name) values ('r-org') returning id`)
    ).rows[0].id as string;
    const project = (
      await client.query(
        `insert into projects(organization_id, key, name) values ($1,'r','R') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const user = (
      await client.query(
        `insert into users(organization_id, email, display_name, role, password_hash) values ($1,'e@r.io','Eng','engineer','x') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const workflow = (
      await client.query(
        `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at) values ($1,$2,'w1','W','QUEUED',now()) returning id`,
        [org, project],
      )
    ).rows[0].id as string;
    const requirement = (
      await client.query(
        `insert into requirements(organization_id, project_id, external_id, title, business_objective, state, created_by_user_id)
         values ($1,$2,'req-1','Retry queue','Retry declined cards without double charging.',$3,$4) returning id`,
        [org, project, state, user],
      )
    ).rows[0].id as string;
    return { org, project, user, workflow, requirement };
  }
  const item = (
    client: pg.PoolClient,
    f: { org: string; project: string; requirement: string },
    kind: string,
    position: number,
    ai: boolean,
  ) =>
    client.query(
      `insert into requirement_analysis_items(organization_id, project_id, requirement_id, kind, position, text, ai_generated, source)
       values ($1,$2,$3,$4,$5,'text',$6,$7)`,
      [
        f.org,
        f.project,
        f.requirement,
        kind,
        position,
        ai,
        ai ? 'agent:Requirement Agent' : 'user:Eng',
      ],
    );

  it('FR-009 0005 creates enums requirement_state (8 values), requirement_source, analysis_item_kind, external_flag and tables integration_project_mappings, requirements, requirement_analysis_items, requirement_transitions with the §22 columns and CHECK constraints', async () => {
    const enumValues = enumValuesFrom(admin5);
    expect(await enumValues('requirement_state')).toEqual([
      'DRAFT',
      'ANALYZING',
      'NEEDS_CLARIFICATION',
      'READY',
      'APPROVED',
      'IN_IMPLEMENTATION',
      'COMPLETED',
      'REJECTED',
    ]);
    expect(await enumValues('requirement_source')).toEqual(['manual', 'jira']);
    expect(await enumValues('analysis_item_kind')).toEqual([
      'acceptance_criterion',
      'rule',
      'open_question',
    ]);
    expect(await enumValues('external_flag')).toEqual(['deleted', 'closed']);

    const expected: Record<string, string[]> = {
      integration_project_mappings: [
        'id',
        'organization_id',
        'project_id',
        'provider',
        'external_project_key',
        'external_base_url',
        'created_at',
      ],
      requirements: [
        'id',
        'organization_id',
        'project_id',
        'external_id',
        'title',
        'business_objective',
        'state',
        'source',
        'external_ref',
        'external_flag',
        'external_flagged_at',
        'created_by_user_id',
        'assignee_user_id',
        'submitted_by_user_id',
        'submitted_at',
        'analysis_observed_at',
        'analysis_agent',
        'analysis_summary',
        'approved_by_user_id',
        'approved_at',
        'rejected_by_user_id',
        'rejected_at',
        'rejection_reason',
        'created_at',
        'updated_at',
      ],
      requirement_analysis_items: [
        'id',
        'organization_id',
        'project_id',
        'requirement_id',
        'kind',
        'position',
        'text',
        'ai_generated',
        'source',
        'created_at',
      ],
      requirement_transitions: [
        'id',
        'organization_id',
        'requirement_id',
        'from_state',
        'to_state',
        'actor_type',
        'actor_id',
        'actor_name',
        'reason',
        'occurred_at',
      ],
    };
    for (const [table, cols] of Object.entries(expected)) {
      expect((await columns(table)).sort(), table).toEqual([...cols].sort());
    }
    const reqCons = await constraintNames('requirements');
    for (const c of [
      'requirements_external_ref_check',
      'requirements_flag_check',
      'requirements_organization_id_external_id_key',
    ])
      expect(reqCons).toContain(c);
    const itemCons = await constraintNames('requirement_analysis_items');
    expect(itemCons).toContain('requirement_analysis_items_human_check');
    expect(itemCons).toContain('requirement_analysis_items_position_key');
    const mapCons = await constraintNames('integration_project_mappings');
    expect(mapCons).toContain('integration_project_mappings_provider_external_project_key_key');
    expect(mapCons).toContain('integration_project_mappings_project_provider_key');
    const trCons = await constraintNames('requirement_transitions');
    expect(trCons).toContain('requirement_transitions_actor_type_check');
    const triggers = (
      await admin5.query(
        `select tgname from pg_trigger where tgrelid='requirements'::regclass and not tgisinternal order by tgname`,
      )
    ).rows.map((r) => r.tgname);
    expect(triggers).toEqual(['inbox_changed_requirements', 'requirements_updated_at']);

    const client = await app5.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      await expect(
        client.query(
          `insert into requirements(organization_id, project_id, external_id, title, business_objective) values ($1,$2,'req-2','ab','Long enough objective.')`,
          [f.org, f.project],
        ),
      ).rejects.toThrow(/check/i);
      await client.query('rollback');
      await client.query('begin');
      const g = await fixture(client);
      await expect(
        client.query(
          `insert into requirements(organization_id, project_id, external_id, title, business_objective, external_flag) values ($1,$2,'req-2','Title','Long enough objective.','closed')`,
          [g.org, g.project],
        ),
      ).rejects.toThrow(/requirements_flag_check/);
      await client.query('rollback');
      await client.query('begin');
      const h = await fixture(client);
      await expect(
        client.query(
          `insert into requirement_transitions(organization_id, requirement_id, from_state, to_state, actor_type, actor_name) values ($1,$2,null,'DRAFT','integration','Jira')`,
          [h.org, h.requirement],
        ),
      ).rejects.toThrow(/requirement_transitions_actor_type_check/);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
    const mapping = await admin5.connect();
    try {
      await mapping.query('begin');
      const f = await fixture(mapping);
      await expect(
        mapping.query(
          `insert into integration_project_mappings(organization_id, project_id, provider, external_project_key, external_base_url) values ($1,$2,'github','PAY','https://jira.example.invalid')`,
          [f.org, f.project],
        ),
      ).rejects.toThrow(/provider_check/);
      await mapping.query('rollback');
      await mapping.query('begin');
      const g = await fixture(mapping);
      await expect(
        mapping.query(
          `insert into integration_project_mappings(organization_id, project_id, provider, external_project_key, external_base_url) values ($1,$2,'jira','PAY','http://jira.example.invalid')`,
          [g.org, g.project],
        ),
      ).rejects.toThrow(/external_base_url_check/);
      await mapping.query('rollback');
    } finally {
      await mapping.query('rollback').catch(() => undefined);
      mapping.release();
    }
  });

  it('FR-009 requirement_analysis_items UNIQUE (requirement_id, kind, ai_generated, position) lets a human criterion and an AI criterion both hold position 1, rejects a duplicate AI position and rejects a human row of kind rule or position 21', async () => {
    const client = await app5.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      await item(client, f, 'acceptance_criterion', 1, false);
      await item(client, f, 'acceptance_criterion', 1, true);
      await item(client, f, 'rule', 1, true);
      await item(client, f, 'open_question', 1, true);
      expect(
        Number(
          (
            await client.query(
              `select count(*) c from requirement_analysis_items where requirement_id=$1`,
              [f.requirement],
            )
          ).rows[0].c,
        ),
      ).toBe(4);
      await expect(item(client, f, 'acceptance_criterion', 1, true)).rejects.toThrow(
        /requirement_analysis_items_position_key/,
      );
      await client.query('rollback');
      await client.query('begin');
      const g = await fixture(client);
      await expect(item(client, g, 'rule', 1, false)).rejects.toThrow(
        /requirement_analysis_items_human_check/,
      );
      await client.query('rollback');
      await client.query('begin');
      const h = await fixture(client);
      await item(client, h, 'acceptance_criterion', 20, false);
      await item(client, h, 'acceptance_criterion', 21, true);
      await expect(item(client, h, 'acceptance_criterion', 21, false)).rejects.toThrow(
        /requirement_analysis_items_human_check/,
      );
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('FR-010 0005 adds workflows.requirement_id with a partial unique index and workflows_list_idx', async () => {
    expect(await columns('workflows')).toContain('requirement_id');
    const fk = (
      await admin5.query(
        `select confdeltype from pg_constraint where conrelid='workflows'::regclass and contype='f' and confrelid='requirements'::regclass`,
      )
    ).rows;
    expect(fk).toHaveLength(1);
    expect(fk[0].confdeltype).toBe('n');
    const unique = await indexDef('workflows_requirement_idx');
    expect(unique?.tablename).toBe('workflows');
    expect(unique?.indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(unique?.indexdef).toMatch(/\(requirement_id\) WHERE \(requirement_id IS NOT NULL\)/);
    const list = await indexDef('workflows_list_idx');
    expect(list?.tablename).toBe('workflows');
    expect(list?.indexdef).toMatch(/\(organization_id, state_observed_at DESC, id DESC\)/);
    const client = await app5.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      await client.query(`update workflows set requirement_id=$1 where id=$2`, [
        f.requirement,
        f.workflow,
      ]);
      await expect(
        client.query(
          `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at, requirement_id) values ($1,$2,'w2','W2','QUEUED',now(),$3)`,
          [f.org, f.project, f.requirement],
        ),
      ).rejects.toThrow(/workflows_requirement_idx/);
      await client.query('rollback');
      await client.query('begin');
      const g = await fixture(client);
      await client.query(`update workflows set requirement_id=$1 where id=$2`, [
        g.requirement,
        g.workflow,
      ]);
      await client.query(`delete from requirements where id=$1`, [g.requirement]);
      expect(
        (await client.query(`select requirement_id from workflows where id=$1`, [g.workflow]))
          .rows[0].requirement_id,
      ).toBeNull();
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('FR-008 requirements enforce one Jira key per organization (requirements_jira_key_idx) and external_ref/source consistency', async () => {
    const idx = await indexDef('requirements_jira_key_idx');
    expect(idx?.indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(idx?.indexdef).toMatch(/WHERE \(source = 'jira'::requirement_source\)/);
    const client = await app5.connect();
    const jira = (f: { org: string; project: string }, externalId: string, key: string) =>
      client.query(
        `insert into requirements(organization_id, project_id, external_id, title, business_objective, source, external_ref)
         values ($1,$2,$3,'Jira title','Imported from Jira with objective.','jira',$4::jsonb)`,
        [
          f.org,
          f.project,
          externalId,
          JSON.stringify({
            provider: 'jira',
            key,
            url: `https://jira.example.invalid/browse/${key}`,
          }),
        ],
      );
    try {
      await client.query('begin');
      const f = await fixture(client);
      await jira(f, 'req-j1', 'PAY-231');
      await expect(jira(f, 'req-j2', 'PAY-231')).rejects.toThrow(/requirements_jira_key_idx/);
      await client.query('rollback');
      await client.query('begin');
      const g = await fixture(client);
      await jira(g, 'req-j1', 'PAY-231');
      const other = (
        await client.query(`insert into organizations(name) values ('r-org-2') returning id`)
      ).rows[0].id as string;
      const otherProject = (
        await client.query(
          `insert into projects(organization_id, key, name) values ($1,'r2','R2') returning id`,
          [other],
        )
      ).rows[0].id as string;
      await jira({ org: other, project: otherProject }, 'req-j1', 'PAY-231');
      await client.query('rollback');
      await client.query('begin');
      const h = await fixture(client);
      await expect(
        client.query(
          `insert into requirements(organization_id, project_id, external_id, title, business_objective, source, external_ref)
           values ($1,$2,'req-m','Manual','Manual rows carry no external_ref.','manual','{"provider":"jira","key":"PAY-1","url":"https://j/x"}')`,
          [h.org, h.project],
        ),
      ).rejects.toThrow(/requirements_external_ref_check/);
      await client.query('rollback');
      await client.query('begin');
      const i = await fixture(client);
      await expect(
        client.query(
          `insert into requirements(organization_id, project_id, external_id, title, business_objective, source, external_ref)
           values ($1,$2,'req-j','Jira','Jira rows need key and url.','jira','{"provider":"jira","key":"PAY-1"}')`,
          [i.org, i.project],
        ),
      ).rejects.toThrow(/requirements_external_ref_check/);
      await client.query('rollback');
      await client.query('begin');
      const j = await fixture(client);
      await expect(
        client.query(
          `insert into requirements(organization_id, project_id, external_id, title, business_objective, source)
           values ($1,$2,'req-j','Jira','Jira rows need an external_ref.','jira')`,
          [j.org, j.project],
        ),
      ).rejects.toThrow(/requirements_external_ref_check/);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it("FR-002 requirement_transitions rejects UPDATE and DELETE with 'requirement_transitions is append-only' (requirement_transitions_append_only trigger)", async () => {
    const trg = await admin5.query(
      `select tgname from pg_trigger where tgrelid='requirement_transitions'::regclass and not tgisinternal`,
    );
    expect(trg.rows.map((r) => r.tgname)).toEqual(['requirement_transitions_append_only']);
    const client = await admin5.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      const id = (
        await client.query(
          `insert into requirement_transitions(organization_id, requirement_id, from_state, to_state, actor_type, actor_id, actor_name)
           values ($1,$2,null,'DRAFT','user',$3,'Eng') returning id`,
          [f.org, f.requirement, f.user],
        )
      ).rows[0].id as string;
      await expect(
        client.query(`update requirement_transitions set reason='x' where id=$1`, [id]),
      ).rejects.toThrow('requirement_transitions is append-only');
      await client.query('rollback');
      await client.query('begin');
      const g = await fixture(client);
      const id2 = (
        await client.query(
          `insert into requirement_transitions(organization_id, requirement_id, from_state, to_state, actor_type, actor_name)
           values ($1,$2,null,'DRAFT','system','jira') returning id`,
          [g.org, g.requirement],
        )
      ).rows[0].id as string;
      await expect(
        client.query(`delete from requirement_transitions where id=$1`, [id2]),
      ).rejects.toThrow('requirement_transitions is append-only');
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('FR-010 updating a linked workflow QUEUED→RUNNING moves an APPROVED requirement to IN_IMPLEMENTATION and →COMPLETED to COMPLETED, writing a system requirement_transitions row; QUEUED→CANCELLED and QUEUED→BLOCKED leave APPROVED', async () => {
    const client = await app5.connect();
    const run = async (
      states: readonly string[],
      initial = 'APPROVED',
    ): Promise<{ state: string; transitions: Record<string, unknown>[] }> => {
      await client.query('begin');
      const f = await fixture(client, initial);
      await client.query(`update workflows set requirement_id=$1 where id=$2`, [
        f.requirement,
        f.workflow,
      ]);
      for (const s of states)
        await client.query(
          `update workflows set state=$1, state_observed_at=now(), state_reason='r' where id=$2`,
          [s, f.workflow],
        );
      const state = (
        await client.query(`select state from requirements where id=$1`, [f.requirement])
      ).rows[0].state as string;
      const transitions = (
        await client.query(
          `select from_state, to_state, actor_type, actor_id, actor_name, reason from requirement_transitions where requirement_id=$1 order by id`,
          [f.requirement],
        )
      ).rows;
      await client.query('rollback');
      return { state, transitions };
    };
    try {
      const running = await run(['RUNNING']);
      expect(running.state).toBe('IN_IMPLEMENTATION');
      expect(running.transitions).toEqual([
        {
          from_state: 'APPROVED',
          to_state: 'IN_IMPLEMENTATION',
          actor_type: 'system',
          actor_id: null,
          actor_name: 'workflow',
          reason: 'workflow w1 → RUNNING',
        },
      ]);
      // Later stage moves while IN_IMPLEMENTATION write nothing more.
      const waiting = await run(['RUNNING', 'WAITING_FOR_HUMAN', 'RUNNING']);
      expect(waiting.state).toBe('IN_IMPLEMENTATION');
      expect(waiting.transitions).toHaveLength(1);
      const completed = await run(['RUNNING', 'COMPLETED']);
      expect(completed.state).toBe('COMPLETED');
      expect(completed.transitions.map((t) => t.to_state)).toEqual([
        'IN_IMPLEMENTATION',
        'COMPLETED',
      ]);
      expect(completed.transitions[1]).toMatchObject({
        from_state: 'IN_IMPLEMENTATION',
        actor_type: 'system',
        actor_name: 'workflow',
        reason: 'workflow w1 → COMPLETED',
      });
      const direct = await run(['COMPLETED']);
      expect(direct.state).toBe('COMPLETED');
      expect(direct.transitions).toEqual([
        expect.objectContaining({
          from_state: 'APPROVED',
          to_state: 'COMPLETED',
          actor_type: 'system',
        }),
      ]);
      for (const s of ['CANCELLED', 'BLOCKED']) {
        const r = await run([s]);
        expect(r.state, s).toBe('APPROVED');
        expect(r.transitions, s).toEqual([]);
      }
      // Only the trigger's state list matters: a READY requirement is never moved by its workflow.
      const ready = await run(['RUNNING'], 'READY');
      expect(ready.state).toBe('READY');
      expect(ready.transitions).toEqual([]);
      // Updating a column other than state (or an unlinked workflow) does not fire the trigger.
      await client.query('begin');
      const f = await fixture(client, 'APPROVED');
      await client.query(`update workflows set requirement_id=$1 where id=$2`, [
        f.requirement,
        f.workflow,
      ]);
      await client.query(`update workflows set title='renamed' where id=$1`, [f.workflow]);
      const unlinked = (
        await client.query(
          `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at) values ($1,$2,'w9','W9','QUEUED',now()) returning id`,
          [f.org, f.project],
        )
      ).rows[0].id as string;
      await client.query(`update workflows set state='RUNNING' where id=$1`, [unlinked]);
      expect(
        (await client.query(`select state from requirements where id=$1`, [f.requirement])).rows[0]
          .state,
      ).toBe('APPROVED');
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
    const trg = (
      await admin5.query(
        `select tgname from pg_trigger where tgrelid='workflows'::regclass and not tgisinternal order by tgname`,
      )
    ).rows.map((r) => r.tgname);
    expect(trg).toContain('workflows_follow_requirement');
  });

  it('FR-034 inserting or updating a requirement writes exactly one inbox_change_log row with requirement_id and NULL workflow_id and NOTIFYs inbox_changed with requirementId; inserting or deleting requirement_analysis_items writes no inbox_change_log row (no trigger on that table)', async () => {
    const cons = await constraintNames('inbox_change_log');
    expect(cons).toContain('inbox_change_log_target_check');
    const nullable = (
      await admin5.query(
        `select column_name, is_nullable from information_schema.columns where table_name='inbox_change_log' and column_name in ('workflow_id','requirement_id') order by column_name`,
      )
    ).rows;
    expect(nullable).toEqual([
      { column_name: 'requirement_id', is_nullable: 'YES' },
      { column_name: 'workflow_id', is_nullable: 'YES' },
    ]);
    const itemTriggers = await admin5.query(
      `select tgname from pg_trigger where tgrelid='requirement_analysis_items'::regclass and not tgisinternal`,
    );
    expect(itemTriggers.rows).toEqual([]);

    const client = await app5.connect();
    try {
      await client.query('begin');
      const f = await fixture(client);
      const rows = async () =>
        (
          await client.query(
            `select workflow_id, requirement_id, project_id from inbox_change_log where requirement_id=$1`,
            [f.requirement],
          )
        ).rows;
      expect(await rows()).toEqual([
        { workflow_id: null, requirement_id: f.requirement, project_id: f.project },
      ]);
      await item(client, f, 'acceptance_criterion', 1, true);
      await item(client, f, 'open_question', 1, true);
      await client.query(`delete from requirement_analysis_items where requirement_id=$1`, [
        f.requirement,
      ]);
      expect(await rows()).toHaveLength(1);
      await client.query(
        `update requirements set state='ANALYZING', submitted_at=now() where id=$1`,
        [f.requirement],
      );
      expect(await rows()).toHaveLength(2);
      await expect(
        client.query(`insert into inbox_change_log(organization_id, project_id) values ($1,$2)`, [
          f.org,
          f.project,
        ]),
      ).rejects.toThrow(/inbox_change_log_target_check/);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }

    // NOTIFY is transactional, so delivery needs a committed insert; the rows are removed afterwards.
    const listener = await admin5.connect();
    const writer = await admin5.connect();
    try {
      const payloads: string[] = [];
      listener.on('notification', (n) => {
        if (n.payload) payloads.push(n.payload);
      });
      await listener.query('listen inbox_changed');
      await writer.query('begin');
      const f = await fixture(writer);
      await writer.query('commit');
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !payloads.some((p) => p.includes(f.requirement)))
        await new Promise((r) => setTimeout(r, 50));
      const mine = payloads
        .map((p) => JSON.parse(p))
        .filter((p) => p.requirementId === f.requirement);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        organizationId: f.org,
        projectId: f.project,
        workflowId: null,
        requirementId: f.requirement,
      });
      expect(typeof mine[0].seq).toBe('number');
      await writer.query(`delete from inbox_change_log where organization_id=$1`, [f.org]);
      await writer.query(`delete from requirements where id=$1`, [f.requirement]);
      await writer.query(`delete from workflows where id=$1`, [f.workflow]);
      await writer.query(`delete from inbox_change_log where organization_id=$1`, [f.org]);
      await writer.query(`delete from users where id=$1`, [f.user]);
      await writer.query(`delete from projects where id=$1`, [f.project]);
      await writer.query(`delete from organizations where id=$1`, [f.org]);
      await listener.query('unlisten inbox_changed');
    } finally {
      listener.release();
      writer.release();
    }
  });

  it('FR-032 RLS policies exist on the four tables and app_user has SELECT/INSERT/UPDATE/DELETE on requirements and requirement_analysis_items, SELECT on integration_project_mappings, SELECT/INSERT on requirement_transitions', async () => {
    const grants: Record<string, string[]> = {
      requirements: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      requirement_analysis_items: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      integration_project_mappings: ['SELECT'],
      requirement_transitions: ['SELECT', 'INSERT'],
    };
    for (const [table, expected] of Object.entries(grants)) {
      expect(await columns(table), table).toContain('organization_id');
      const pol = (
        await admin5.query(`select policyname, qual from pg_policies where tablename=$1`, [table])
      ).rows;
      expect(
        pol.map((p) => p.policyname),
        table,
      ).toEqual([`${table}_org_isolation`]);
      expect(pol[0].qual, table).toContain("current_setting('app.organization_id'");
      const privs = (
        await admin5.query(
          `select privilege_type from information_schema.role_table_grants where grantee='app_user' and table_name=$1`,
          [table],
        )
      ).rows.map((r) => r.privilege_type as string);
      expect(privs.sort(), table).toEqual([...expected].sort());
    }
    // 0005 does not toggle RLS itself: the CDEVI_RLS loop in migrate.ts owns it (off by default here).
    const sql = readFileSync(
      resolve(import.meta.dirname, '../migrations/0005_requirements.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    const seq = (
      await admin5.query(
        `select privilege_type from information_schema.role_usage_grants where grantee='app_user' and object_name='requirement_transitions_id_seq'`,
      )
    ).rows.map((r) => r.privilege_type);
    expect(seq).toContain('USAGE');
  });

  it('SC-007 EXPLAIN of the list query filtered by project, by state (READY and also the terminal COMPLETED) and by assignee uses requirements_list_idx / requirements_state_idx / requirements_assignee_idx at 2 000 requirements', async () => {
    const client = await admin5.connect();
    try {
      await client.query('begin');
      const org = (
        await client.query(`insert into organizations(name) values ('sc7-req') returning id`)
      ).rows[0].id as string;
      const projects = (
        await client.query(
          `insert into projects(organization_id, key, name) select $1, 'sc7r-'||g, 'SC7R '||g from generate_series(1,4) g returning id`,
          [org],
        )
      ).rows.map((r) => r.id as string);
      const users = (
        await client.query(
          `insert into users(organization_id, email, display_name, role, password_hash) select $1, 'u'||g||'@sc7.io', 'U '||g, 'engineer', 'x' from generate_series(1,20) g returning id`,
          [org],
        )
      ).rows.map((r) => r.id as string);
      await client.query(
        `insert into requirements(organization_id, project_id, external_id, title, business_objective, state, assignee_user_id, created_at)
         select $1, ($2::uuid[])[(g % 4) + 1], 'sc7-req-'||g, 'Requirement '||g, 'Objective for requirement '||g,
                (enum_range(null::requirement_state))[(g % 8) + 1],
                case when g % 3 = 0 then null else ($3::uuid[])[(g % 20) + 1] end,
                now() - (g % 400) * interval '1 hour'
         from generate_series(1,2000) g`,
        [org, projects, users],
      );
      await client.query('analyze requirements');
      const select = `select id, external_id, title, state, created_at from requirements`;
      const order = `order by created_at desc, id desc limit 51`;
      await expectIndexScan(
        client,
        'requirements_list_idx',
        `${select} where organization_id=$1 and project_id=$2 ${order}`,
        [org, projects[0]],
      );
      for (const state of ['READY', 'COMPLETED'])
        await expectIndexScan(
          client,
          'requirements_state_idx',
          `${select} where organization_id=$1 and state=$2 ${order}`,
          [org, state],
        );
      await expectIndexScan(
        client,
        'requirements_assignee_idx',
        `${select} where organization_id=$1 and assignee_user_id=$2 ${order}`,
        [org, users[0]],
      );
      const assignee = await indexDef('requirements_assignee_idx');
      expect(assignee?.indexdef).toMatch(/WHERE \(assignee_user_id IS NOT NULL\)/);
      const state = await indexDef('requirements_state_idx');
      expect(state?.indexdef).not.toContain('WHERE');
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('FR-003 EXPLAIN of GET /workflows ordering uses workflows_list_idx at 500 workflows', async () => {
    const client = await admin5.connect();
    try {
      await client.query('begin');
      const org = (
        await client.query(`insert into organizations(name) values ('sc7-wf') returning id`)
      ).rows[0].id as string;
      const project = (
        await client.query(
          `insert into projects(organization_id, key, name) values ($1,'sc7w','SC7W') returning id`,
          [org],
        )
      ).rows[0].id as string;
      await client.query(
        `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at)
         select $1, $2, 'sc7-wl'||g, 'W '||g, (enum_range(null::workflow_state))[(g % 9) + 1], now() - g * interval '1 minute'
         from generate_series(1,500) g`,
        [org, project],
      );
      await client.query('analyze workflows');
      await expectIndexScan(
        client,
        'workflows_list_idx',
        `select id, external_id, state, state_observed_at from workflows where organization_id=$1 order by state_observed_at desc, id desc limit 51`,
        [org],
      );
      await expectIndexScan(
        client,
        'workflows_list_idx',
        `select id, external_id, state, state_observed_at from workflows where organization_id=$1 and (state_observed_at, id) < ($2, $3) order by state_observed_at desc, id desc limit 51`,
        [org, new Date(), '00000000-0000-0000-0000-000000000000'],
      );
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });
});

describe.skipIf(skip)(
  'migration 0006_agent_decisions (specs/001 data-model.md §31–§37, US5)',
  () => {
    const admin6 = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    const app6 = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
    beforeAll(async () => {
      const { migrate } = await import('../src/migrate');
      await migrate({ log: () => {} });
    });
    afterAll(async () => {
      await admin6.end();
      await app6.end();
    });

    const columns = async (table: string) =>
      (
        await admin6.query(
          `select column_name, is_nullable, column_default from information_schema.columns where table_name=$1`,
          [table],
        )
      ).rows as { column_name: string; is_nullable: 'YES' | 'NO'; column_default: string | null }[];
    const constraintNames = async (table: string) =>
      (
        await admin6.query(`select conname from pg_constraint where conrelid = $1::regclass`, [
          table,
        ])
      ).rows.map((r) => r.conname as string);

    /** org, project, workflow, stage and one RUNNING agent run inside the caller's transaction. */
    async function fixture(client: pg.PoolClient) {
      const org = (
        await client.query(`insert into organizations(name) values ('t-org-0006') returning id`)
      ).rows[0].id as string;
      const project = (
        await client.query(
          `insert into projects(organization_id, key, name) values ($1,'t6','T6') returning id`,
          [org],
        )
      ).rows[0].id as string;
      const workflow = (
        await client.query(
          `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at) values ($1,$2,'w6','W6','RUNNING',now()) returning id`,
          [org, project],
        )
      ).rows[0].id as string;
      const stage = (
        await client.query(
          `insert into workflow_stages(organization_id, project_id, workflow_id, position, name, state, state_observed_at) values ($1,$2,$3,4,'Implementation','RUNNING',now()) returning id`,
          [org, project, workflow],
        )
      ).rows[0].id as string;
      const run = (
        await client.query(
          `insert into agent_runs(organization_id, project_id, workflow_id, stage_id, external_id, agent, state, started_at) values ($1,$2,$3,$4,'r6','implementer','RUNNING',now()) returning id`,
          [org, project, workflow, stage],
        )
      ).rows[0].id as string;
      return { org, project, workflow, stage, run };
    }
    const insertDecision = (
      client: pg.PoolClient,
      f: { org: string; project: string; workflow: string; stage: string; run: string },
      position: number,
      over: Record<string, unknown> = {},
    ) =>
      client.query(
        `insert into agent_decisions(organization_id, project_id, workflow_id, stage_id, agent_run_id, position, decided_at, action, reason, confidence, policy_outcome, policy_ref, risk_level, evidence)
       values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12,$13::jsonb) returning id`,
        [
          f.org,
          f.project,
          f.workflow,
          f.stage,
          f.run,
          position,
          over['action'] ?? 'Chose token bucket',
          over['reason'] ?? 'Matches the gateway.',
          over['confidence'] ?? 'HIGH',
          over['policy_outcome'] ?? 'ALLOWED',
          over['policy_ref'] ?? null,
          over['risk_level'] ?? null,
          JSON.stringify(over['evidence'] ?? []),
        ],
      );

    it('FR-017 enums confidence_level and policy_outcome have the exact values and 0006 is recorded', async () => {
      const enumValues = enumValuesFrom(admin6);
      expect(await enumValues('confidence_level')).toEqual(['LOW', 'MEDIUM', 'HIGH']);
      expect(await enumValues('policy_outcome')).toEqual([
        'ALLOWED',
        'APPROVAL_REQUIRED',
        'DENIED',
      ]);
      const applied = (
        await admin6.query(
          `select name from schema_migrations where name='0006_agent_decisions.sql'`,
        )
      ).rowCount;
      expect(applied).toBe(1);
    });

    it('FR-036 agent_runs.decisions_observed_at is a nullable timestamptz watermark (NULL until the first decisions batch)', async () => {
      const col = (await columns('agent_runs')).find(
        (c) => c.column_name === 'decisions_observed_at',
      );
      expect(col).toBeDefined();
      expect(col?.is_nullable).toBe('YES');
      expect(col?.column_default).toBeNull();
      const type = (
        await admin6.query(
          `select data_type from information_schema.columns where table_name='agent_runs' and column_name='decisions_observed_at'`,
        )
      ).rows[0].data_type;
      expect(type).toBe('timestamp with time zone');
      const client = await app6.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        const row = (
          await client.query(`select decisions_observed_at from agent_runs where id=$1`, [f.run])
        ).rows[0];
        expect(row.decisions_observed_at).toBeNull();
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('AS-3 agent_runs.steps is jsonb NOT NULL DEFAULT [] and CHECKed as an array of at most 20 entries', async () => {
      const steps = (await columns('agent_runs')).find((c) => c.column_name === 'steps');
      expect(steps).toBeDefined();
      expect(steps?.is_nullable).toBe('NO');
      expect(steps?.column_default).toContain("'[]'");
      expect(await constraintNames('agent_runs')).toContain('agent_runs_steps_check');
      const client = await app6.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        const row = (await client.query(`select steps from agent_runs where id=$1`, [f.run]))
          .rows[0];
        expect(row.steps).toEqual([]);
        const many = (n: number) =>
          JSON.stringify(
            Array.from({ length: n }, (_, i) => ({ label: `S${i}`, status: 'pending' })),
          );
        await client.query(`update agent_runs set steps=$2::jsonb where id=$1`, [f.run, many(20)]);
        await expect(
          client.query(`update agent_runs set steps=$2::jsonb where id=$1`, [f.run, many(21)]),
        ).rejects.toThrow(/agent_runs_steps_check/);
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        const g = await fixture(client);
        await expect(
          client.query(`update agent_runs set steps=$2::jsonb where id=$1`, [g.run, '{"a":1}']),
        ).rejects.toThrow(/agent_runs_steps_check/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('FR-017 agent_decisions has the §33 columns, nullable policy_ref and risk_level (optional in US5), evidence DEFAULT [], UNIQUE(agent_run_id, position) and agent_decisions_run_idx', async () => {
      const cols = await columns('agent_decisions');
      const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
      for (const c of [
        'id',
        'organization_id',
        'project_id',
        'workflow_id',
        'stage_id',
        'agent_run_id',
        'position',
        'decided_at',
        'action',
        'reason',
        'confidence',
        'policy_outcome',
        'policy_ref',
        'risk_level',
        'evidence',
        'created_at',
      ])
        expect(byName, c).toHaveProperty(c);
      expect(Object.keys(byName)).toHaveLength(16);
      expect(byName['policy_ref']?.is_nullable).toBe('YES');
      expect(byName['risk_level']?.is_nullable).toBe('YES');
      expect(byName['evidence']?.is_nullable).toBe('NO');
      expect(byName['evidence']?.column_default).toContain("'[]'");
      for (const c of ['organization_id', 'project_id', 'workflow_id', 'stage_id', 'agent_run_id'])
        expect(byName[c]?.is_nullable, c).toBe('NO');
      const udt = (
        await admin6.query(
          `select column_name, udt_name from information_schema.columns where table_name='agent_decisions' and column_name in ('confidence','policy_outcome','risk_level','position')`,
        )
      ).rows.map((r) => [r.column_name, r.udt_name]);
      expect(Object.fromEntries(udt)).toEqual({
        confidence: 'confidence_level',
        policy_outcome: 'policy_outcome',
        risk_level: 'risk_level',
        position: 'int2',
      });
      expect(await constraintNames('agent_decisions')).toContain(
        'agent_decisions_run_position_key',
      );
      const idx = (
        await admin6.query(
          `select indexname, indexdef from pg_indexes where tablename='agent_decisions' and indexname='agent_decisions_run_idx'`,
        )
      ).rows[0] as { indexname: string; indexdef: string } | undefined;
      expect(idx?.indexdef).toMatch(/\(agent_run_id, "position"\)$/);
    });

    it('FR-017 FR-018 CHECKs bound position 1..50, action ≤ 200, reason ≤ 600, policy_ref ≤ 120 and evidence to an array of at most 20; a second decision at the same position is rejected', async () => {
      const client = await app6.connect();
      const rejects = async (
        f: Awaited<ReturnType<typeof fixture>>,
        position: number,
        over: Record<string, unknown>,
        pattern: RegExp,
      ) => {
        await client.query('SAVEPOINT s');
        await expect(insertDecision(client, f, position, over)).rejects.toThrow(pattern);
        await client.query('ROLLBACK TO SAVEPOINT s');
      };
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        await insertDecision(client, f, 1);
        await insertDecision(client, f, 50, { reason: 'x'.repeat(600), action: 'y'.repeat(200) });
        await rejects(f, 0, {}, /check/i);
        await rejects(f, 51, {}, /check/i);
        await rejects(f, 2, { action: 'x'.repeat(201) }, /check/i);
        await rejects(f, 2, { reason: 'x'.repeat(601) }, /check/i);
        await rejects(f, 2, { policy_ref: 'x'.repeat(121) }, /check/i);
        await rejects(f, 2, { evidence: { kind: 'file' } }, /check/i);
        await rejects(
          f,
          2,
          {
            evidence: Array.from({ length: 21 }, () => ({
              kind: 'url',
              label: 'x',
              accessible: true,
            })),
          },
          /check/i,
        );
        await rejects(
          f,
          2,
          { confidence: 'high' },
          /invalid input value for enum confidence_level/,
        );
        await rejects(
          f,
          2,
          { policy_outcome: 'BLOCKED' },
          /invalid input value for enum policy_outcome/,
        );
        await rejects(f, 1, {}, /agent_decisions_run_position_key/);
        await insertDecision(client, f, 2, {
          policy_outcome: 'APPROVAL_REQUIRED',
          risk_level: 'MEDIUM',
          policy_ref: 'POL-7',
          evidence: [{ kind: 'ticket', label: 'PAY-231', accessible: false }],
        });
        const rows = (
          await client.query(
            `select position, policy_outcome, risk_level, evidence from agent_decisions where agent_run_id=$1 order by position`,
            [f.run],
          )
        ).rows;
        expect(rows.map((r) => r.position)).toEqual([1, 2, 50]);
        expect(rows[1]).toMatchObject({
          policy_outcome: 'APPROVAL_REQUIRED',
          risk_level: 'MEDIUM',
          evidence: [{ kind: 'ticket', label: 'PAY-231', accessible: false }],
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('FR-017 deleting the agent run cascades to its decisions; replace-whole (DELETE + INSERT) leaves exactly the new set and reuses positions', async () => {
      const client = await app6.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        await insertDecision(client, f, 1);
        await insertDecision(client, f, 2);
        await insertDecision(client, f, 3);
        await client.query(`delete from agent_decisions where agent_run_id=$1`, [f.run]);
        await insertDecision(client, f, 1, { action: 'Replaced' });
        await insertDecision(client, f, 2, { action: 'Replaced' });
        const after = (
          await client.query(
            `select position, action from agent_decisions where agent_run_id=$1 order by position`,
            [f.run],
          )
        ).rows;
        expect(after).toEqual([
          { position: 1, action: 'Replaced' },
          { position: 2, action: 'Replaced' },
        ]);
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        const g = await fixture(client);
        await insertDecision(client, g, 1);
        await insertDecision(client, g, 2);
        // app_user has no DELETE on agent_runs; the cascade is exercised as the migrator below.
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      const m = await admin6.connect();
      try {
        await m.query('BEGIN');
        const f = await fixture(m);
        await insertDecision(m, f, 1);
        await insertDecision(m, f, 2);
        await m.query(`delete from agent_runs where id=$1`, [f.run]);
        const left = (
          await m.query(`select count(*)::int c from agent_decisions where agent_run_id=$1`, [
            f.run,
          ])
        ).rows[0].c;
        expect(left).toBe(0);
        await m.query('ROLLBACK');
      } finally {
        m.release();
      }
    });

    it('FR-032 agent_decisions has the org-isolation RLS policy (disabled while CDEVI_RLS=off) and app_user has exactly SELECT, INSERT, DELETE', async () => {
      expect((await columns('agent_decisions')).map((c) => c.column_name)).toContain(
        'organization_id',
      );
      const pol = (
        await admin6.query(
          `select policyname, qual from pg_policies where tablename='agent_decisions'`,
        )
      ).rows;
      expect(pol.map((p) => p.policyname)).toEqual(['agent_decisions_org_isolation']);
      expect(pol[0].qual).toContain("current_setting('app.organization_id'");
      const rls = await admin6.query(
        `select relrowsecurity from pg_class where relname='agent_decisions'`,
      );
      expect(rls.rows[0].relrowsecurity).toBe(false);
      const privs = (
        await admin6.query(
          `select privilege_type from information_schema.role_table_grants where grantee='app_user' and table_name='agent_decisions'`,
        )
      ).rows.map((r) => r.privilege_type as string);
      expect(privs.sort()).toEqual(['DELETE', 'INSERT', 'SELECT']);
      const client = await app6.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        const id = (await insertDecision(client, f, 1)).rows[0].id as string;
        await expect(
          client.query(`update agent_decisions set action='edited' where id=$1`, [id]),
        ).rejects.toThrow(/permission denied/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('FR-017 app_user may UPDATE only agent_decisions.stage_id (column grant), so decisions can follow their run to another stage without any content edit', async () => {
      const cols = (
        await admin6.query(
          `select column_name from information_schema.role_column_grants where grantee='app_user' and table_name='agent_decisions' and privilege_type='UPDATE'`,
        )
      ).rows.map((r) => r.column_name as string);
      expect(cols).toEqual(['stage_id']);
      const client = await app6.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        const id = (await insertDecision(client, f, 1)).rows[0].id as string;
        await expect(
          client.query(`update agent_decisions set stage_id=$2 where id=$1`, [id, f.stage]),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          client.query(`update agent_decisions set position=99 where id=$1`, [id]),
        ).rejects.toThrow(/permission denied/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it("FR-034 inbox_changed_agent_decisions(_deleted) are statement-level AFTER INSERT / AFTER DELETE triggers: a replace-whole (DELETE + batch INSERT) in one transaction writes exactly one inbox_change_log row carrying the run's workflow_id, an empty replacement (DELETE only) still writes one, and NOTIFYs inbox_changed once", async () => {
      const trg = (
        await admin6.query(
          `select tgname, tgtype from pg_trigger where tgrelid='agent_decisions'::regclass and not tgisinternal order by tgname`,
        )
      ).rows as { tgname: string; tgtype: number }[];
      expect(trg.map((t) => t.tgname)).toEqual([
        'inbox_changed_agent_decisions',
        'inbox_changed_agent_decisions_deleted',
      ]);
      // tgtype bit 0 (1) = FOR EACH ROW; bit 1 (2) = BEFORE; bit 2 (4) = INSERT; bit 3 (8) = DELETE; bit 4 (16) = UPDATE
      for (const t of trg) {
        expect(t.tgtype & 1, `${t.tgname} FOR EACH STATEMENT`).toBe(0);
        expect(t.tgtype & 2, `${t.tgname} AFTER`).toBe(0);
        expect(t.tgtype & 16, `${t.tgname} not UPDATE`).toBe(0);
      }
      expect(trg[0]!.tgtype & (4 | 8), 'INSERT only').toBe(4);
      expect(trg[1]!.tgtype & (4 | 8), 'DELETE only').toBe(8);

      const client = await app6.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        const before = (
          await client.query(`select coalesce(max(seq),0) as m from inbox_change_log`)
        ).rows[0].m;
        const values = Array.from(
          { length: 50 },
          (_, i) => `($1,$2,$3,$4,$5,${i + 1},now(),'a','r','HIGH','ALLOWED')`,
        );
        await client.query(
          `insert into agent_decisions(organization_id, project_id, workflow_id, stage_id, agent_run_id, position, decided_at, action, reason, confidence, policy_outcome) values ${values.join(',')}`,
          [f.org, f.project, f.workflow, f.stage, f.run],
        );
        const rows = (
          await client.query(
            `select organization_id, project_id, workflow_id, requirement_id from inbox_change_log where seq > $1`,
            [before],
          )
        ).rows;
        expect(rows).toEqual([
          {
            organization_id: f.org,
            project_id: f.project,
            workflow_id: f.workflow,
            requirement_id: null,
          },
        ]);
        await client.query(`delete from agent_decisions where agent_run_id=$1`, [f.run]);
        await insertDecision(client, f, 1);
        await client.query(`update agent_runs set decisions_observed_at = now() where id=$1`, [
          f.run,
        ]);
        const afterReplace = (
          await client.query(`select count(*)::int c from inbox_change_log where seq > $1`, [
            before,
          ])
        ).rows[0].c;
        expect(
          afterReplace,
          'DELETE + INSERT + watermark UPDATE in one transaction is one row',
        ).toBe(1);
        await client.query('ROLLBACK');

        // The 0002 agent_runs trigger still fires for rendered columns, not for the watermark alone.
        await client.query('BEGIN');
        const g = await fixture(client);
        const mark = (await client.query(`select coalesce(max(seq),0) as m from inbox_change_log`))
          .rows[0].m;
        await client.query(`update agent_runs set decisions_observed_at = now() where id=$1`, [
          g.run,
        ]);
        expect(
          (
            await client.query(`select count(*)::int c from inbox_change_log where seq > $1`, [
              mark,
            ])
          ).rows[0].c,
          'watermark-only UPDATE does not notify',
        ).toBe(0);
        await client.query(
          `update agent_runs set state = 'COMPLETED', finished_at = now() where id=$1`,
          [g.run],
        );
        await client.query(
          `update agent_runs set steps = '[{"label":"x","status":"completed"}]' where id=$1`,
          [g.run],
        );
        expect(
          (
            await client.query(`select count(*)::int c from inbox_change_log where seq > $1`, [
              mark,
            ])
          ).rows[0].c,
          'state and steps UPDATEs notify (one row each)',
        ).toBe(2);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Empty replacement: DELETE with no following INSERT still tells open pages the decisions are gone.
      // A DELETE that removes nothing, and a cascade from a workflow being deleted, write nothing.
      const c2 = await app6.connect();
      try {
        await c2.query('BEGIN');
        const f = await fixture(c2);
        await insertDecision(c2, f, 1);
        await insertDecision(c2, f, 2);
        await c2.query('COMMIT');
        const before = (await c2.query(`select coalesce(max(seq),0) as m from inbox_change_log`))
          .rows[0].m;
        await c2.query(`delete from agent_decisions where agent_run_id=$1`, [f.run]);
        const rows = (
          await c2.query(`select workflow_id from inbox_change_log where seq > $1`, [before])
        ).rows;
        expect(rows).toEqual([{ workflow_id: f.workflow }]);
        await c2.query(`delete from agent_decisions where agent_run_id=$1`, [f.run]);
        expect(
          (await c2.query(`select count(*)::int c from inbox_change_log where seq > $1`, [before]))
            .rows[0].c,
          'DELETE of nothing writes nothing',
        ).toBe(1);
        await c2.query('BEGIN');
        await insertDecision(c2, f, 1);
        await c2.query('COMMIT');
        const beforeCascade = (
          await c2.query(`select coalesce(max(seq),0) as m from inbox_change_log`)
        ).rows[0].m;
        await admin6.query(`delete from workflows where id=$1`, [f.workflow]);
        expect(
          (
            await c2.query(`select count(*)::int c from inbox_change_log where seq > $1`, [
              beforeCascade,
            ])
          ).rows[0].c,
          'cascade from a deleted workflow writes nothing',
        ).toBe(0);
        await admin6.query(`delete from inbox_change_log where organization_id=$1`, [f.org]);
        await admin6.query(`delete from projects where id=$1`, [f.project]);
        await admin6.query(`delete from organizations where id=$1`, [f.org]);
      } finally {
        c2.release();
      }

      // NOTIFY is transactional, so delivery needs a committed insert; the rows are removed afterwards.
      const listener = await admin6.connect();
      const writer = await admin6.connect();
      try {
        const payloads: string[] = [];
        listener.on('notification', (n) => {
          if (n.payload) payloads.push(n.payload);
        });
        await listener.query('listen inbox_changed');
        await writer.query('begin');
        const f = await fixture(writer);
        const seqBefore = (
          await writer.query(`select coalesce(max(seq),0) as m from inbox_change_log`)
        ).rows[0].m as number;
        await writer.query(
          `insert into agent_decisions(organization_id, project_id, workflow_id, stage_id, agent_run_id, position, decided_at, action, reason, confidence, policy_outcome)
         values ($1,$2,$3,$4,$5,1,now(),'a','r','HIGH','ALLOWED'), ($1,$2,$3,$4,$5,2,now(),'b','r','LOW','DENIED')`,
          [f.org, f.project, f.workflow, f.stage, f.run],
        );
        await writer.query('commit');
        const deadline = Date.now() + 5_000;
        const mine = () =>
          payloads
            .map((p) => JSON.parse(p))
            .filter((p) => p.workflowId === f.workflow && Number(p.seq) > Number(seqBefore));
        while (Date.now() < deadline && mine().length < 1)
          await new Promise((r) => setTimeout(r, 50));
        // seqBefore was read after the fixture rows, so only the decision batch is newer: exactly one frame for two rows
        await new Promise((r) => setTimeout(r, 200));
        expect(mine()).toHaveLength(1);
        expect(mine()[0]).toMatchObject({
          organizationId: f.org,
          projectId: f.project,
          workflowId: f.workflow,
        });
        await writer.query(`delete from inbox_change_log where organization_id=$1`, [f.org]);
        await writer.query(`delete from workflows where id=$1`, [f.workflow]);
        await writer.query(`delete from inbox_change_log where organization_id=$1`, [f.org]);
        await writer.query(`delete from projects where id=$1`, [f.project]);
        await writer.query(`delete from organizations where id=$1`, [f.org]);
        await listener.query('unlisten inbox_changed');
      } finally {
        listener.release();
        writer.release();
      }
    });
  },
);

describe.skipIf(skip)(
  'migration 0007_reviews (specs/001 US6 — pull request reviews, findings, fix cycles)',
  () => {
    const admin7 = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    const app7 = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
    beforeAll(async () => {
      const { migrate } = await import('../src/migrate');
      await migrate({ log: () => {} });
    });
    afterAll(async () => {
      await admin7.end();
      await app7.end();
    });

    const columns = async (table: string) =>
      (
        await admin7.query(
          `select column_name, is_nullable, column_default, udt_name from information_schema.columns where table_name=$1`,
          [table],
        )
      ).rows as {
        column_name: string;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
        udt_name: string;
      }[];
    const constraintNames = async (table: string) =>
      (
        await admin7.query(`select conname from pg_constraint where conrelid = $1::regclass`, [
          table,
        ])
      ).rows.map((r) => r.conname as string);
    const indexNames = async (table: string) =>
      (await admin7.query(`select indexname from pg_indexes where tablename=$1`, [table])).rows.map(
        (r) => r.indexname as string,
      );
    /** Column rows keyed by name; asserts the table has exactly `expected` columns. */
    async function columnsByName(table: string, expected: readonly string[]) {
      const byName = Object.fromEntries((await columns(table)).map((c) => [c.column_name, c]));
      expect(Object.keys(byName).sort(), table).toEqual([...expected].sort());
      return byName;
    }
    const maxSeq = async (client: pg.PoolClient) =>
      (await client.query(`select coalesce(max(seq),0) as m from inbox_change_log`)).rows[0]
        .m as number;
    /**
     * LISTEN inbox_changed on one connection and hand the test a writer plus `framesSince(workflow, seq, atLeast)`,
     * which waits (≤ 5 s, then settles 200 ms) for that many frames of the workflow newer than `seq`.
     */
    async function withInboxListener(
      pool: pg.Pool,
      run: (
        writer: pg.PoolClient,
        framesSince: (
          workflow: string,
          seq: number,
          atLeast: number,
        ) => Promise<Record<string, unknown>[]>,
      ) => Promise<void>,
    ) {
      const listener = await pool.connect();
      const writer = await pool.connect();
      try {
        const payloads: string[] = [];
        listener.on('notification', (n) => {
          if (n.payload) payloads.push(n.payload);
        });
        await listener.query('listen inbox_changed');
        const framesSince = async (workflow: string, seq: number, atLeast: number) => {
          const mine = () =>
            payloads
              .map((p) => JSON.parse(p) as Record<string, unknown>)
              .filter((p) => p['workflowId'] === workflow && Number(p['seq']) > Number(seq));
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline && mine().length < atLeast)
            await new Promise((r) => setTimeout(r, 50));
          await new Promise((r) => setTimeout(r, 200));
          return mine();
        };
        await run(writer, framesSince);
        await listener.query('unlisten inbox_changed');
      } finally {
        listener.release();
        writer.release();
      }
    }
    /** Remove a committed fixture (org → project → workflow cascade) and its inbox rows. */
    async function dropFixture(
      writer: pg.PoolClient,
      f: { org: string; project: string; workflow: string },
    ) {
      await writer.query(`delete from inbox_change_log where organization_id=$1`, [f.org]);
      await writer.query(`delete from workflows where id=$1`, [f.workflow]);
      await writer.query(`delete from inbox_change_log where organization_id=$1`, [f.org]);
      await writer.query(`delete from projects where id=$1`, [f.project]);
      await writer.query(`delete from organizations where id=$1`, [f.org]);
    }
    const SEVEN_LANES = JSON.stringify(
      [
        'correctness',
        'security',
        'dependencies',
        'edge_cases',
        'testing',
        'architecture',
        'general',
      ].map((lane) => ({ lane, status: 'PASS' })),
    );

    /** org, project, workflow and one OPEN pull request inside the caller's transaction. */
    async function fixture(client: pg.PoolClient) {
      const org = (
        await client.query(`insert into organizations(name) values ('t-org-0007') returning id`)
      ).rows[0].id as string;
      const project = (
        await client.query(
          `insert into projects(organization_id, key, name) values ($1,'t7','T7') returning id`,
          [org],
        )
      ).rows[0].id as string;
      const workflow = (
        await client.query(
          `insert into workflows(organization_id, project_id, external_id, title, state, state_observed_at) values ($1,$2,'w7','W7','RUNNING',now()) returning id`,
          [org, project],
        )
      ).rows[0].id as string;
      const pr = (
        await client.query(
          `insert into pull_requests(organization_id, project_id, workflow_id, external_id, number, title, href, status, observed_at)
         values ($1,$2,$3,'pr-7',7,'PR seven','https://git.example.com/pr/7','OPEN',now()) returning id`,
          [org, project, workflow],
        )
      ).rows[0].id as string;
      return { org, project, workflow, pr };
    }
    const insertReview = (
      client: pg.PoolClient,
      f: { org: string; project: string; workflow: string; pr: string },
      cycle: number,
      lanes: string = SEVEN_LANES,
    ) =>
      client.query(
        `insert into reviews(organization_id, project_id, workflow_id, pull_request_id, external_id, cycle_number, status, lanes, observed_at, started_at)
       values ($1,$2,$3,$4,$5,$6,'COMPLETE',$7::jsonb,now(),now()) returning id`,
        [f.org, f.project, f.workflow, f.pr, `rev-7-${cycle}`, cycle, lanes],
      );
    const insertFinding = (
      client: pg.PoolClient,
      f: { org: string; project: string; workflow: string; pr: string },
      review: string,
      position: number,
      over: Record<string, unknown> = {},
    ) =>
      client.query(
        `insert into review_findings(organization_id, project_id, workflow_id, pull_request_id, review_id, external_id, position, lane, severity, blocking, title, description, impact, evidence, recommended_fix, state)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) returning id`,
        [
          f.org,
          f.project,
          f.workflow,
          f.pr,
          review,
          over['external_id'] ?? `find-7-${position}`,
          over['position'] ?? position,
          over['lane'] ?? 'security',
          over['severity'] ?? 'CRITICAL',
          over['blocking'] ?? 'BLOCKING',
          over['title'] ?? 'Missing authorization check',
          over['description'] ?? 'The endpoint trusts the caller.',
          over['impact'] ?? 'Any user can refund any payment.',
          JSON.stringify(over['evidence'] ?? []),
          over['recommended_fix'] ?? 'Verify the owner.',
          over['state'] ?? 'OPEN',
        ],
      );
    const insertCycle = (
      client: pg.PoolClient,
      f: { org: string; project: string; workflow: string; pr: string },
      cycle: number,
      over: Record<string, unknown> = {},
    ) =>
      client.query(
        `insert into review_cycles(organization_id, project_id, workflow_id, pull_request_id, cycle_number, findings_count, fixed_count, remaining_count, iteration, state, observed_at, started_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now()) returning id`,
        [
          f.org,
          f.project,
          f.workflow,
          f.pr,
          cycle,
          over['findings_count'] ?? 7,
          over['fixed_count'] ?? 6,
          over['remaining_count'] ?? 1,
          over['iteration'] ?? cycle,
          over['state'] ?? 'COMPLETED',
        ],
      );

    /** Runs `fn` inside a SAVEPOINT and expects it to fail matching `re`; the transaction stays usable. */
    async function expectFail(client: pg.PoolClient, fn: () => Promise<unknown>, re: RegExp) {
      await client.query('SAVEPOINT sp');
      await expect(fn()).rejects.toThrow(re);
      await client.query('ROLLBACK TO SAVEPOINT sp');
    }
    /** BEGIN → fixture → body → ROLLBACK, always releasing the client and never leaving an aborted transaction. */
    async function tx(
      pool: pg.Pool,
      body: (client: pg.PoolClient, f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
    ) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        await body(client, f);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    it('FR-020 defines the seven US6 enums with the exact vocabulary and records 0007', async () => {
      const ev = enumValuesFrom(admin7);
      expect(await ev('review_lane')).toEqual([
        'correctness',
        'security',
        'dependencies',
        'edge_cases',
        'testing',
        'architecture',
        'general',
      ]);
      expect(await ev('lane_status')).toEqual(['PASS', 'WARN', 'FAIL']);
      expect(await ev('review_status')).toEqual(['RUNNING', 'COMPLETE', 'FAILED']);
      expect(await ev('finding_severity')).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
      expect(await ev('finding_blocking')).toEqual(['BLOCKING', 'NON_BLOCKING', 'SUGGESTION']);
      expect(await ev('finding_state')).toEqual([
        'OPEN',
        'FIX_REQUESTED',
        'FIXED',
        'DISMISSED',
        'ISSUE_REQUESTED',
      ]);
      expect(await ev('review_cycle_state')).toEqual([
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
      ]);
      expect(await ev('pull_request_status')).toEqual(['OPEN', 'MERGED', 'CLOSED']);
      expect(
        (await admin7.query(`select name from schema_migrations where name='0007_reviews.sql'`))
          .rowCount,
      ).toBe(1);
    });

    it('FR-036 pull_requests: one per workflow (UNIQUE workflow_id), UNIQUE (organization_id, external_id), title ≤ 200, http(s) href, nullable requirement_id and review_stage_id (ON DELETE SET NULL), observed_at watermark, created/updated_at', async () => {
      const byName = Object.fromEntries(
        (await columns('pull_requests')).map((c) => [c.column_name, c]),
      );
      expect(Object.keys(byName).sort()).toEqual(
        [
          'id',
          'organization_id',
          'project_id',
          'workflow_id',
          'requirement_id',
          'review_stage_id',
          'external_id',
          'number',
          'title',
          'href',
          'status',
          'observed_at',
          'created_at',
          'updated_at',
        ].sort(),
      );
      expect(byName['requirement_id']?.is_nullable).toBe('YES');
      expect(byName['review_stage_id']?.is_nullable).toBe('YES');
      expect(byName['review_stage_id']?.udt_name).toBe('uuid');
      expect(byName['status']?.udt_name).toBe('pull_request_status');
      expect(byName['number']?.udt_name).toBe('int4');
      const cons = await constraintNames('pull_requests');
      expect(cons).toContain('pull_requests_workflow_id_key');
      expect(cons).toContain('pull_requests_organization_id_external_id_key');
      expect(await indexNames('pull_requests')).toContain('pull_requests_list_idx');
      const trg = (
        await admin7.query(
          `select tgname from pg_trigger where tgrelid='pull_requests'::regclass and not tgisinternal order by tgname`,
        )
      ).rows.map((r) => r.tgname);
      expect(trg).toEqual([
        'inbox_changed_pull_requests',
        'inbox_changed_pull_requests_updated',
        'pull_requests_updated_at',
      ]);
      await tx(app7, async (client, f) => {
        await expectFail(
          client,
          () =>
            client.query(
              `insert into pull_requests(organization_id, project_id, workflow_id, external_id, number, title, href, status, observed_at)
             values ($1,$2,$3,'pr-8',8,'second','https://git.example.com/pr/8','OPEN',now())`,
              [f.org, f.project, f.workflow],
            ),
          /pull_requests_workflow_id_key/,
        );
        await expectFail(
          client,
          () =>
            client.query(`update pull_requests set title=$2 where id=$1`, [f.pr, 'x'.repeat(201)]),
          /pull_requests_title_check/,
        );
        await expectFail(
          client,
          () => client.query(`update pull_requests set href='ftp://nope' where id=$1`, [f.pr]),
          /pull_requests_href_check/,
        );
        await expectFail(
          client,
          () => client.query(`update pull_requests set number=0 where id=$1`, [f.pr]),
          /pull_requests_number_check/,
        );
        const stage = (
          await client.query(
            `insert into workflow_stages(organization_id, project_id, workflow_id, position, name, state, state_observed_at)
             values ($1,$2,$3,6,'Review','WAITING_FOR_HUMAN',now()) returning id`,
            [f.org, f.project, f.workflow],
          )
        ).rows[0].id as string;
        await client.query(`update pull_requests set review_stage_id=$2 where id=$1`, [
          f.pr,
          stage,
        ]);
        await expectFail(
          client,
          () =>
            client.query(`update pull_requests set review_stage_id=$2 where id=$1`, [
              f.pr,
              '00000000-0000-0000-0000-000000000000',
            ]),
          /pull_requests_review_stage_id_fkey/,
        );
      });
      const fk = (
        await admin7.query(
          `select confrelid::regclass::text rel, confdeltype from pg_constraint where conname='pull_requests_review_stage_id_fkey'`,
        )
      ).rows[0];
      expect(fk).toEqual({ rel: 'workflow_stages', confdeltype: 'n' });
    });

    it('FR-020 reviews: UNIQUE (pull_request_id, cycle_number), lanes jsonb CHECKed to exactly 7 entries, nullable finished_at / agent_run_id, observed_at watermark', async () => {
      const byName = await columnsByName('reviews', [
        'id',
        'organization_id',
        'project_id',
        'workflow_id',
        'pull_request_id',
        'external_id',
        'cycle_number',
        'status',
        'lanes',
        'observed_at',
        'started_at',
        'finished_at',
        'agent_run_id',
        'created_at',
        'updated_at',
      ]);
      expect(byName['status']?.udt_name).toBe('review_status');
      expect(byName['finished_at']?.is_nullable).toBe('YES');
      expect(byName['agent_run_id']?.is_nullable).toBe('YES');
      const cons = await constraintNames('reviews');
      expect(cons).toContain('reviews_pull_request_id_cycle_number_key');
      expect(cons).toContain('reviews_organization_id_external_id_key');
      expect(cons).toContain('reviews_lanes_check');
      await tx(app7, async (client, f) => {
        await insertReview(client, f, 1);
        await expectFail(
          client,
          () => insertReview(client, f, 1),
          /reviews_pull_request_id_cycle_number_key/,
        );
        await expectFail(
          client,
          () => insertReview(client, f, 2, JSON.stringify(JSON.parse(SEVEN_LANES).slice(0, 6))),
          /reviews_lanes_check/,
        );
      });
    });

    it('FR-020 FR-021 review_findings: denormalised pull_request_id, UNIQUE (review_id, position) and (review_id, external_id) so a finding keeps its runtime id across cycles, bounded text, evidence ≤ 10, state DEFAULT OPEN, dismissal / fix-cycle / issue columns, and the partial blocking index', async () => {
      const byName = await columnsByName('review_findings', [
        'id',
        'organization_id',
        'project_id',
        'workflow_id',
        'pull_request_id',
        'review_id',
        'external_id',
        'position',
        'lane',
        'severity',
        'blocking',
        'title',
        'description',
        'impact',
        'evidence',
        'recommended_fix',
        'state',
        'dismissed_reason',
        'dismissed_by_user_id',
        'dismissed_at',
        'fix_cycle_id',
        'issue_requested_by_user_id',
        'issue_requested_at',
        'created_at',
        'updated_at',
      ]);
      expect(byName['state']?.column_default).toContain("'OPEN'");
      expect(byName['evidence']?.column_default).toContain("'[]'");
      for (const c of [
        'dismissed_reason',
        'dismissed_by_user_id',
        'dismissed_at',
        'fix_cycle_id',
        'issue_requested_by_user_id',
        'issue_requested_at',
      ])
        expect(byName[c]?.is_nullable, c).toBe('YES');
      expect(byName['lane']?.udt_name).toBe('review_lane');
      expect(byName['severity']?.udt_name).toBe('finding_severity');
      expect(byName['blocking']?.udt_name).toBe('finding_blocking');
      expect(byName['state']?.udt_name).toBe('finding_state');
      const cons = await constraintNames('review_findings');
      expect(cons).toContain('review_findings_review_id_position_key');
      expect(cons).toContain('review_findings_review_id_external_id_key');
      expect(cons).not.toContain('review_findings_organization_id_external_id_key');
      const idx = (
        await admin7.query(
          `select indexname, indexdef from pg_indexes where tablename='review_findings' and indexname='review_findings_blocking_open_idx'`,
        )
      ).rows[0];
      expect(idx).toBeDefined();
      expect(idx.indexdef).toMatch(/WHERE .*blocking = 'BLOCKING'/);
      expect(idx.indexdef).toMatch(
        /state = ANY \(ARRAY\['OPEN'::finding_state, 'FIX_REQUESTED'::finding_state\]\)/,
      );
      await tx(app7, async (client, f) => {
        const review = (await insertReview(client, f, 3)).rows[0].id as string;
        const id = (await insertFinding(client, f, review, 1)).rows[0].id as string;
        const row = (
          await client.query(`select state, evidence from review_findings where id=$1`, [id])
        ).rows[0];
        expect(row).toEqual({ state: 'OPEN', evidence: [] });
        const bad = (over: Record<string, unknown>, re: RegExp) =>
          expectFail(client, () => insertFinding(client, f, review, 2, over), re);
        await bad({ position: 1, external_id: 'other' }, /review_findings_review_id_position_key/);
        await bad({ external_id: 'find-7-1' }, /review_findings_review_id_external_id_key/);
        const review2 = (await insertReview(client, f, 2)).rows[0].id as string;
        await insertFinding(client, f, review2, 1, { external_id: 'find-7-1' });
        await bad({ title: 'x'.repeat(201) }, /review_findings_title_check/);
        await bad({ description: 'x'.repeat(2001) }, /review_findings_description_check/);
        await bad({ impact: 'x'.repeat(1001) }, /review_findings_impact_check/);
        await bad({ recommended_fix: 'x'.repeat(1001) }, /review_findings_recommended_fix_check/);
        await bad(
          {
            evidence: Array.from({ length: 11 }, (_, i) => ({
              kind: 'file',
              label: `f${i}`,
              accessible: true,
            })),
          },
          /review_findings_evidence_check/,
        );
        await bad({ position: 0 }, /review_findings_position_check/);
        await expectFail(
          client,
          () =>
            client.query(
              `update review_findings set state='DISMISSED', dismissed_at=now(), dismissed_reason=$2 where id=$1`,
              [id, 'x'.repeat(241)],
            ),
          /review_findings_dismissed_reason_check/,
        );
      });
    });

    it('FR-036 0008: UNIQUE (review_id, position) is DEFERRABLE so a review snapshot can reorder findings in place (ids kept); still checked immediately by default', async () => {
      const con = (
        await admin7.query(
          `select condeferrable, condeferred from pg_constraint where conname='review_findings_review_id_position_key'`,
        )
      ).rows[0];
      expect(con).toEqual({ condeferrable: true, condeferred: false });
      expect(
        (await admin7.query(`select name from schema_migrations where name like '0008%'`)).rowCount,
      ).toBe(1);
      await tx(app7, async (client, f) => {
        const review = (await insertReview(client, f, 4)).rows[0].id as string;
        const a = (await insertFinding(client, f, review, 1, { external_id: 'swap-a' })).rows[0]
          .id as string;
        const b = (await insertFinding(client, f, review, 2, { external_id: 'swap-b' })).rows[0]
          .id as string;
        await expectFail(
          client,
          () => client.query(`update review_findings set position = 2 where id = $1`, [a]),
          /review_findings_review_id_position_key/,
        );
        await client.query(`set constraints review_findings_review_id_position_key deferred`);
        await client.query(`update review_findings set position = 2 where id = $1`, [a]);
        await client.query(`update review_findings set position = 1 where id = $1`, [b]);
        await client.query(`set constraints review_findings_review_id_position_key immediate`);
        const rows = (
          await client.query(
            `select id, position from review_findings where review_id = $1 order by position`,
            [review],
          )
        ).rows;
        expect(rows).toEqual([
          { id: b, position: 1 },
          { id: a, position: 2 },
        ]);
      });
    });

    it('AS-4 review_cycles: UNIQUE (pull_request_id, cycle_number), at most one RUNNING cycle per pull request (partial unique index), CHECK fixed + remaining ≤ findings_count, iteration ≤ max_iterations (default 5), requested_by user / agent nullable, observed_at watermark', async () => {
      const byName = await columnsByName('review_cycles', [
        'id',
        'organization_id',
        'project_id',
        'workflow_id',
        'pull_request_id',
        'cycle_number',
        'findings_count',
        'fixed_count',
        'remaining_count',
        'iteration',
        'max_iterations',
        'state',
        'requested_by_user_id',
        'requested_by_agent',
        'started_at',
        'finished_at',
        'agent_run_id',
        'observed_at',
        'created_at',
        'updated_at',
      ]);
      expect(byName['max_iterations']?.column_default).toBe('5');
      expect(byName['state']?.udt_name).toBe('review_cycle_state');
      for (const c of ['requested_by_user_id', 'requested_by_agent', 'finished_at', 'agent_run_id'])
        expect(byName[c]?.is_nullable, c).toBe('YES');
      const cons = await constraintNames('review_cycles');
      expect(cons).toContain('review_cycles_pull_request_id_cycle_number_key');
      expect(cons).toContain('review_cycles_counts_check');
      expect(cons).toContain('review_cycles_iteration_budget_check');
      const running = (
        await admin7.query(
          `select indexdef from pg_indexes where tablename='review_cycles' and indexname='review_cycles_one_running_idx'`,
        )
      ).rows[0]?.indexdef as string | undefined;
      expect(running).toMatch(/^CREATE UNIQUE INDEX/);
      expect(running).toMatch(
        /\(pull_request_id\) WHERE \(state = 'RUNNING'::review_cycle_state\)/,
      );
      await tx(app7, async (client, f) => {
        const running = { state: 'RUNNING', fixed_count: 0, remaining_count: 7, iteration: 4 };
        await insertCycle(client, f, 8, running);
        await expectFail(
          client,
          () => insertCycle(client, f, 9, running),
          /review_cycles_one_running_idx/,
        );
        await insertCycle(client, f, 9, { state: 'COMPLETED', iteration: 4 });
      });
      await tx(app7, async (client, f) => {
        const cycle = (
          await insertCycle(client, f, 1, { state: 'RUNNING', fixed_count: 0, remaining_count: 7 })
        ).rows[0].id as string;
        await expectFail(
          client,
          () => insertCycle(client, f, 1),
          /review_cycles_pull_request_id_cycle_number_key/,
        );
        await expectFail(
          client,
          () => insertCycle(client, f, 2, { fixed_count: 6, remaining_count: 2 }),
          /review_cycles_counts_check/,
        );
        await expectFail(
          client,
          () => insertCycle(client, f, 2, { iteration: 6 }),
          /review_cycles_iteration_budget_check/,
        );
        // fix_cycle_id on a finding references review_cycles
        const review = (await insertReview(client, f, 1)).rows[0].id as string;
        const fid = (await insertFinding(client, f, review, 1)).rows[0].id as string;
        await expect(
          client.query(
            `update review_findings set state='FIX_REQUESTED', fix_cycle_id=$2 where id=$1`,
            [fid, cycle],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expectFail(
          client,
          () =>
            client.query(`update review_findings set fix_cycle_id=gen_random_uuid() where id=$1`, [
              fid,
            ]),
          /review_findings_fix_cycle_id_fkey/,
        );
      });
    });

    it('FR-021 audit_events accepts the three US6 human actions (finding.dismissed, finding.fix_requested, finding.issue_requested) with target_type review_finding', async () => {
      await tx(app7, async (client, f) => {
        for (const action of [
          'finding.dismissed',
          'finding.fix_requested',
          'finding.issue_requested',
        ])
          await expect(
            client.query(
              `insert into audit_events(organization_id, project_id, workflow_id, actor_type, actor_id, actor_name, action, target_type, target_id, result, details)
             values ($1,$2,$3,'user','u','Priya',$4,'review_finding',gen_random_uuid(),'ok','{}'::jsonb)`,
              [f.org, f.project, f.workflow, action],
            ),
            action,
          ).resolves.toMatchObject({ rowCount: 1 });
      });
    });

    it('FR-032 the four US6 tables have the org-isolation RLS policy (disabled while CDEVI_RLS=off), are in RLS_TABLES, and app_user has SELECT, INSERT, UPDATE (+ DELETE on review_findings for replace-whole)', async () => {
      const migrateSrc = readFileSync(resolve(__dirname, '../src/migrate.ts'), 'utf8');
      for (const t of ['pull_requests', 'reviews', 'review_findings', 'review_cycles']) {
        expect(migrateSrc, `${t} in RLS_TABLES`).toContain(`'${t}'`);
        const pol = (
          await admin7.query(`select policyname, qual from pg_policies where tablename=$1`, [t])
        ).rows;
        expect(
          pol.map((p) => p.policyname),
          t,
        ).toEqual([`${t}_org_isolation`]);
        expect(pol[0].qual, t).toContain("current_setting('app.organization_id'");
        const rls = await admin7.query(`select relrowsecurity from pg_class where relname=$1`, [t]);
        expect(rls.rows[0].relrowsecurity, t).toBe(false);
        const privs = (
          await admin7.query(
            `select privilege_type from information_schema.role_table_grants where grantee='app_user' and table_name=$1`,
            [t],
          )
        ).rows.map((r) => r.privilege_type as string);
        expect(privs.sort(), t).toEqual(
          t === 'review_findings'
            ? ['DELETE', 'INSERT', 'SELECT', 'UPDATE']
            : ['INSERT', 'SELECT', 'UPDATE'],
        );
      }
    });

    it('FR-034 every US6 table has statement-level AFTER INSERT / UPDATE (and DELETE for review_findings) inbox_changed triggers: a review replace-whole (DELETE + 7 INSERTs + review UPDATE + cycle INSERT) in one transaction writes exactly one inbox_change_log row for the workflow and NOTIFYs once', async () => {
      const triggers = async (t: string) =>
        (
          await admin7.query(
            `select tgname, tgtype from pg_trigger where tgrelid=$1::regclass and not tgisinternal and tgname like 'inbox_changed_%' order by tgname`,
            [t],
          )
        ).rows as { tgname: string; tgtype: number }[];
      for (const t of ['pull_requests', 'reviews', 'review_findings', 'review_cycles']) {
        const trg = await triggers(t);
        const expected = [
          `inbox_changed_${t}`,
          ...(t === 'review_findings' ? [`inbox_changed_${t}_deleted`] : []),
          `inbox_changed_${t}_updated`,
        ];
        expect(
          trg.map((x) => x.tgname),
          t,
        ).toEqual(expected);
        for (const x of trg) {
          expect(x.tgtype & 1, `${x.tgname} FOR EACH STATEMENT`).toBe(0);
          expect(x.tgtype & 2, `${x.tgname} AFTER`).toBe(0);
        }
      }
      const client = await app7.connect();
      try {
        await client.query('BEGIN');
        const f = await fixture(client);
        const logRows = async () =>
          (
            await client.query(
              `select organization_id, project_id, workflow_id, requirement_id from inbox_change_log where workflow_id = $1 order by seq`,
              [f.workflow],
            )
          ).rows;
        const row = {
          organization_id: f.org,
          project_id: f.project,
          workflow_id: f.workflow,
          requirement_id: null,
        };
        // the workflow INSERT (0001 trigger) and the pull_requests INSERT each log once
        expect(await logRows(), 'workflow insert + PR insert').toEqual([row, row]);
        const review = (await insertReview(client, f, 3)).rows[0].id as string;
        for (let i = 1; i <= 7; i++)
          await insertFinding(client, f, review, i, { external_id: `find-7-${i}` });
        await client.query(`delete from review_findings where review_id=$1`, [review]);
        for (let i = 1; i <= 7; i++)
          await insertFinding(client, f, review, i, { external_id: `find-7-${i}` });
        await client.query(
          `update reviews set status='COMPLETE', finished_at=now(), observed_at=now() where id=$1`,
          [review],
        );
        await insertCycle(client, f, 3);
        expect(
          await logRows(),
          'whole review replacement adds no further row in the same transaction',
        ).toEqual([row, row]);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      await withInboxListener(admin7, async (writer, framesSince) => {
        await writer.query('begin');
        const f = await fixture(writer);
        await writer.query('commit');
        const seqBefore = await maxSeq(writer);
        await writer.query('begin');
        const review = (await insertReview(writer, f, 1)).rows[0].id as string;
        await insertFinding(writer, f, review, 1);
        await insertFinding(writer, f, review, 2, { external_id: 'find-7-2' });
        await writer.query('commit');
        const frames = await framesSince(f.workflow, seqBefore, 1);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({
          organizationId: f.org,
          projectId: f.project,
          workflowId: f.workflow,
        });
        // A human action after the transaction (dismiss) notifies again, once.
        await writer.query(
          `update review_findings set state='DISMISSED', dismissed_reason='dup', dismissed_at=now() where review_id=$1 and position=1`,
          [review],
        );
        expect(await framesSince(f.workflow, seqBefore, 2)).toHaveLength(2);
        await dropFixture(writer, f);
      });
    });
  },
);
