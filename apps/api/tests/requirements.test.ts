import type {
  DashboardSnapshot,
  Problem,
  RequirementDetail,
  RequirementListPage,
} from '@cdevi/contracts';
import { encodeWorkflowCursor } from '@cdevi/contracts/requirement-rules';
import { REQUIREMENT_SHOWCASE } from '@cdevi/db/seed';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InboxChange } from '../src/plugins/notify';
import {
  asIngest,
  asUser,
  iso,
  MIN,
  plus,
  seedSc007Org,
  signIn,
  skipDb,
  testApp,
  uniq,
} from './helpers';

const objective =
  'Recover revenue from soft card declines by retrying the charge on a schedule instead of failing immediately.';

describe.skipIf(skipDb)(
  'Requirements API (specs/001 US4, FR-007/FR-009/FR-010/FR-032/FR-034, SC-007)',
  () => {
    let app: FastifyInstance;
    let admin: string;
    let approver: string;
    let engineer: string;
    let viewer: string;
    let payments: string;
    let platform: string;
    let engineerId: string;

    beforeAll(async () => {
      app = await testApp();
      admin = await signIn(app, 'admin@cdevi.demo');
      approver = await signIn(app, 'approver1@cdevi.demo');
      engineer = await signIn(app, 'engineer1@cdevi.demo');
      viewer = await signIn(app, 'viewer1@cdevi.demo');
      const projects = await app.pool.query<{ id: string; key: string }>(
        `SELECT id, key FROM projects WHERE key IN ('payments-api', 'platform')`,
      );
      payments = projects.rows.find((p) => p.key === 'payments-api')!.id;
      platform = projects.rows.find((p) => p.key === 'platform')!.id;
      engineerId = (
        await app.pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
          'engineer1@cdevi.demo',
        ])
      ).rows[0]!.id;
    });
    afterAll(() => app.close());

    const post = (cookie: string, url: string, payload?: unknown) =>
      app.inject(asUser(cookie, { method: 'POST', url, ...(payload ? { payload } : {}) }));
    const get = (cookie: string, url: string) => app.inject(asUser(cookie, { method: 'GET', url }));
    const detailOf = async (cookie: string, id: string): Promise<RequirementDetail> => {
      const r = await get(cookie, `/api/requirements/${id}`);
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };
    async function create(
      cookie = engineer,
      over: Record<string, unknown> = {},
    ): Promise<RequirementDetail> {
      const r = await post(cookie, '/api/requirements', {
        projectId: payments,
        title: `Requirement ${uniq('t')}`,
        businessObjective: objective,
        ...over,
      });
      expect(r.statusCode, r.body).toBe(201);
      return r.json();
    }
    const seededId = async (externalId: string) =>
      (
        await app.pool.query<{ id: string }>(`SELECT id FROM requirements WHERE external_id = $1`, [
          externalId,
        ])
      ).rows[0]!.id;
    /** Drives a fresh requirement to READY (or NEEDS_CLARIFICATION) through submit + the runtime's analysis. */
    async function readyRequirement(openQuestions: string[] = []): Promise<RequirementDetail> {
      const d = await create();
      expect(
        (await post(engineer, `/api/requirements/${d.requirement.id}/submit`)).statusCode,
      ).toBe(200);
      const r = await app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/requirements/${d.requirement.externalId}/analysis`,
          payload: {
            agent: 'Requirement Agent',
            observedAt: iso(plus(-MIN)),
            summary: 'Looks feasible.',
            acceptanceCriteria: ['Retries stop after three attempts.'],
            rules: ['Never retry a hard decline.'],
            openQuestions,
          },
        }),
      );
      expect(r.statusCode, r.body).toBe(200);
      return detailOf(engineer, d.requirement.id);
    }
    const count = async (sql: string, params: unknown[]) =>
      Number((await app.pool.query<{ n: string }>(sql, params)).rows[0]!.n);
    const riskFigure = async () => {
      const r = await get(admin, `/api/dashboard?project=${payments}&window=30d`);
      expect(r.statusCode).toBe(200);
      return (r.json() as DashboardSnapshot).risk.auditHighCritical.value;
    };

    it('FR-007 POST /requirements as engineer1 returns 201 RequirementDetail in DRAFT with Location, human criteria labelled aiGenerated:false source user:Engineer 1, a req- external id and a NULL→DRAFT transition', async () => {
      const r = await post(engineer, '/api/requirements', {
        projectId: payments,
        title: 'Retry queue for card declines',
        businessObjective: objective,
        acceptanceCriteria: ['Retried at most three times.', 'Customer emailed once.'],
      });
      expect(r.statusCode, r.body).toBe(201);
      const d = r.json() as RequirementDetail;
      expect(r.headers.location).toBe(`/api/requirements/${d.requirement.id}`);
      expect(d.requirement.state).toBe('DRAFT');
      expect(d.requirement.source).toBe('manual');
      expect(d.requirement.externalId).toMatch(/^req-[0-9a-f]{12}$/);
      expect(d.requirement.project).toMatchObject({ id: payments, key: 'payments-api' });
      expect(d.requirement.createdBy).toMatchObject({ id: engineerId, name: 'Engineer 1' });
      expect(d.requirement.href).toBe(`/requirements/${d.requirement.id}`);
      expect(d.requirement.workflow).toBeNull();
      expect(d.businessObjective).toBe(objective);
      expect(d.analysis).not.toBeNull();
      expect(
        d.analysis!.acceptanceCriteria.map((c) => [c.position, c.aiGenerated, c.source]),
      ).toEqual([
        [1, false, 'user:Engineer 1'],
        [2, false, 'user:Engineer 1'],
      ]);
      expect(d.transitions).toEqual([
        expect.objectContaining({ fromState: null, toState: 'DRAFT', actorType: 'user' }),
      ]);
      expect(d.actions).toMatchObject({ canSubmit: true, canApprove: false, canReject: false });
      expect(d.actions.submitLabel).toBe('Submit for analysis');
    });

    it('FR-032 POST /requirements as viewer1 returns 403 problem+json forbidden and for an invisible project 404', async () => {
      const forbidden = await post(viewer, '/api/requirements', {
        projectId: payments,
        title: 'Viewer attempt',
        businessObjective: objective,
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.headers['content-type']).toMatch(/application\/problem\+json/);
      expect((forbidden.json() as Problem).type).toBe('urn:cdevi:problem:forbidden');
      // engineer1 is a member of payments-api only
      const invisible = await post(engineer, '/api/requirements', {
        projectId: platform,
        title: 'Invisible project',
        businessObjective: objective,
      });
      expect(invisible.statusCode).toBe(404);
      expect((invisible.json() as Problem).type).toBe('urn:cdevi:problem:not-found');
    });

    it('FR-007 POST /requirements with a 2-char title or 21 criteria returns 400 with field pointers and no body echo', async () => {
      const short = await post(engineer, '/api/requirements', {
        projectId: payments,
        title: 'ab',
        businessObjective: objective,
      });
      expect(short.statusCode).toBe(400);
      const p = short.json() as Problem;
      expect(p.type).toBe('urn:cdevi:problem:validation');
      expect(p.errors?.some((e) => e.path === 'title')).toBe(true);
      expect(short.body).not.toContain(objective);
      const many = await post(engineer, '/api/requirements', {
        projectId: payments,
        title: 'Too many criteria',
        businessObjective: objective,
        acceptanceCriteria: Array.from({ length: 21 }, (_, i) => `Criterion ${i}`),
      });
      expect(many.statusCode).toBe(400);
      expect((many.json() as Problem).errors?.some((e) => e.path === 'acceptanceCriteria')).toBe(
        true,
      );
      expect(many.body).not.toContain('Criterion 0');
    });

    it('FR-009 POST /requirements/{id}/submit moves DRAFT→ANALYZING recording submittedBy/submittedAt and an audit requirement.submitted with risk_level NULL; a second submit returns 409 invalid-transition', async () => {
      const d = await create();
      const r = await post(engineer, `/api/requirements/${d.requirement.id}/submit`);
      expect(r.statusCode, r.body).toBe(200);
      const s = r.json() as RequirementDetail;
      expect(s.requirement.state).toBe('ANALYZING');
      expect(s.submittedBy).toMatchObject({ id: engineerId, name: 'Engineer 1' });
      expect(s.submittedAt).toBe(iso(app.now()));
      expect(s.transitions.map((t) => t.toState)).toEqual(['DRAFT', 'ANALYZING']);
      expect(s.audit.map((a) => [a.action, a.riskLevel])).toEqual([
        ['requirement.submitted', null],
      ]);
      const audit = await app.pool.query<{ risk_level: string | null; result: string }>(
        `SELECT risk_level, result FROM audit_events WHERE action = 'requirement.submitted' AND target_id = $1`,
        [d.requirement.id],
      );
      expect(audit.rows).toEqual([{ risk_level: null, result: 'ANALYZING' }]);
      const again = await post(engineer, `/api/requirements/${d.requirement.id}/submit`);
      expect(again.statusCode).toBe(409);
      expect((again.json() as Problem).type).toBe('urn:cdevi:problem:invalid-transition');
    });

    it('FR-032 submit as viewer1 returns 403; approve as engineer1 returns 403', async () => {
      const d = await create();
      expect((await post(viewer, `/api/requirements/${d.requirement.id}/submit`)).statusCode).toBe(
        403,
      );
      const ready = await readyRequirement();
      const r = await post(engineer, `/api/requirements/${ready.requirement.id}/approve`);
      expect(r.statusCode).toBe(403);
      expect((r.json() as Problem).type).toBe('urn:cdevi:problem:forbidden');
      expect((await detailOf(engineer, ready.requirement.id)).requirement.state).toBe('READY');
    });

    it('FR-010 POST /requirements/{id}/approve on READY returns APPROVED with linkedWorkflow QUEUED stage 1 of 7 Requirement and creates the workflow, seven stages, eight transitions, READY→APPROVED and two audit rows in one transaction', async () => {
      const ready = await readyRequirement();
      expect(ready.requirement.state).toBe('READY');
      expect(ready.actions.canApprove).toBe(false); // engineer
      const r = await post(approver, `/api/requirements/${ready.requirement.id}/approve`);
      expect(r.statusCode, r.body).toBe(200);
      const d = r.json() as RequirementDetail;
      expect(d.requirement.state).toBe('APPROVED');
      expect(d.decidedBy?.name).toBe('Approver 1');
      expect(d.decidedAt).toBe(iso(app.now()));
      expect(d.requirement.workflow).toMatchObject({
        externalId: `wf-${d.requirement.externalId}`,
        state: 'QUEUED',
        stage: { index: 1, count: 7, name: 'Requirement' },
      });
      expect(d.requirement.workflow!.href).toBe(`/workflows/${d.requirement.workflow!.id}`);
      const wf = await app.pool.query<{ id: string; requirement_id: string; state: string }>(
        `SELECT id, requirement_id, state FROM workflows WHERE external_id = $1`,
        [`wf-${d.requirement.externalId}`],
      );
      expect(wf.rows).toHaveLength(1);
      expect(wf.rows[0]).toMatchObject({ requirement_id: d.requirement.id, state: 'QUEUED' });
      const wfId = wf.rows[0]!.id;
      const stages = await app.pool.query<{ position: number; name: string; state: string }>(
        `SELECT position, name, state FROM workflow_stages WHERE workflow_id = $1 ORDER BY position`,
        [wfId],
      );
      expect(stages.rows.map((s) => s.name)).toEqual([
        'Requirement',
        'Analysis',
        'Architecture',
        'Implementation',
        'Testing',
        'Review',
        'PR',
      ]);
      expect(stages.rows.every((s) => s.state === 'QUEUED')).toBe(true);
      expect(
        await count(`SELECT count(*) n FROM workflow_transitions WHERE workflow_id = $1`, [wfId]),
      ).toBe(8);
      expect(d.transitions.at(-1)).toMatchObject({
        fromState: 'READY',
        toState: 'APPROVED',
        actorType: 'user',
        actorName: 'Approver 1',
      });
      const audit = await app.pool.query<{
        action: string;
        risk_level: string | null;
        workflow_id: string;
      }>(
        `SELECT action, risk_level, workflow_id FROM audit_events
          WHERE action IN ('requirement.approved','requirement.workflow_created') AND (target_id = $1 OR target_id = $2) ORDER BY action`,
        [d.requirement.id, wfId],
      );
      expect(audit.rows).toEqual([
        { action: 'requirement.approved', risk_level: null, workflow_id: wfId },
        { action: 'requirement.workflow_created', risk_level: null, workflow_id: wfId },
      ]);
      expect(d.audit.map((a) => a.action)).toContain('requirement.workflow_created');
      // Workflow Detail sees it
      const detail = await get(approver, `/api/workflows/${wfId}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().stages).toHaveLength(7);
    });

    it('FR-010 a forced failure after the stages are written leaves no workflow, stage, transition or audit row and the requirement READY', async () => {
      const ready = await readyRequirement();
      const migrator = new pg.Client({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
      await migrator.connect();
      try {
        await migrator.query(`CREATE FUNCTION test_fail_workflow_created() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.action = 'requirement.workflow_created' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$`);
        await migrator.query(
          `CREATE TRIGGER test_fail_workflow_created BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_workflow_created()`,
        );
        const r = await post(approver, `/api/requirements/${ready.requirement.id}/approve`);
        expect(r.statusCode).toBe(500);
        expect(r.body).not.toContain('forced failure');
      } finally {
        await migrator.query(`DROP TRIGGER IF EXISTS test_fail_workflow_created ON audit_events`);
        await migrator.query(`DROP FUNCTION IF EXISTS test_fail_workflow_created()`);
        await migrator.end();
      }
      expect(
        await count(`SELECT count(*) n FROM workflows WHERE requirement_id = $1`, [
          ready.requirement.id,
        ]),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*) n FROM workflow_stages s JOIN workflows w ON w.id = s.workflow_id WHERE w.external_id = $1`,
          [`wf-${ready.requirement.externalId}`],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*) n FROM audit_events WHERE target_id = $1 AND action LIKE 'requirement.approved'`,
          [ready.requirement.id],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*) n FROM requirement_transitions WHERE requirement_id = $1 AND to_state = 'APPROVED'`,
          [ready.requirement.id],
        ),
      ).toBe(0);
      const after = await detailOf(approver, ready.requirement.id);
      expect(after.requirement.state).toBe('READY');
      expect(after.requirement.workflow).toBeNull();
    });

    it('FR-009 every audit_events row written by submit, approve and reject has risk_level NULL and GET /dashboard risk.auditHighCritical for payments-api is unchanged afterwards', async () => {
      const before = await riskFigure();
      const a = await readyRequirement();
      expect(
        (await post(approver, `/api/requirements/${a.requirement.id}/approve`)).statusCode,
      ).toBe(200);
      const b = await create();
      expect(
        (
          await post(approver, `/api/requirements/${b.requirement.id}/reject`, {
            reason: 'Duplicate',
          })
        ).statusCode,
      ).toBe(200);
      const rows = await app.pool.query<{ risk_level: string | null }>(
        `SELECT risk_level FROM audit_events WHERE action LIKE 'requirement.%' AND (target_id = $1 OR target_id = $2 OR details->>'requirementId' = $1::text)`,
        [a.requirement.id, b.requirement.id],
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(4);
      expect(rows.rows.every((r) => r.risk_level === null)).toBe(true);
      expect(await riskFigure()).toBe(before);
    });

    it('FR-010 two concurrent approves yield one 200 and one 409 and one workflow (SELECT … FOR UPDATE, exactly once)', async () => {
      const ready = await readyRequirement();
      const [x, y] = await Promise.all([
        post(approver, `/api/requirements/${ready.requirement.id}/approve`),
        post(admin, `/api/requirements/${ready.requirement.id}/approve`),
      ]);
      expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
      const lost = x.statusCode === 409 ? x : y;
      expect((lost.json() as Problem).type).toBe('urn:cdevi:problem:invalid-transition');
      expect(
        await count(`SELECT count(*) n FROM workflows WHERE requirement_id = $1`, [
          ready.requirement.id,
        ]),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) n FROM requirement_transitions WHERE requirement_id = $1 AND to_state = 'APPROVED'`,
          [ready.requirement.id],
        ),
      ).toBe(1);
    });

    it('FR-009 approve on DRAFT/ANALYZING/NEEDS_CLARIFICATION returns 409', async () => {
      const draft = await create();
      expect(
        (await post(approver, `/api/requirements/${draft.requirement.id}/approve`)).statusCode,
      ).toBe(409);
      expect(
        (await post(engineer, `/api/requirements/${draft.requirement.id}/submit`)).statusCode,
      ).toBe(200);
      expect(
        (await post(approver, `/api/requirements/${draft.requirement.id}/approve`)).statusCode,
      ).toBe(409);
      const needs = await readyRequirement(['Which card networks?']);
      expect(needs.requirement.state).toBe('NEEDS_CLARIFICATION');
      const r = await post(approver, `/api/requirements/${needs.requirement.id}/approve`);
      expect(r.statusCode).toBe(409);
      expect((r.json() as Problem).type).toBe('urn:cdevi:problem:invalid-transition');
      expect(needs.actions.submitLabel).toBe('Resubmit for analysis');
    });

    it('FR-009 POST /requirements/{id}/reject with a reason on DRAFT, NEEDS_CLARIFICATION and READY returns REJECTED with decisionReason and audit requirement.rejected; on ANALYZING and APPROVED returns 409; without a reason 400', async () => {
      const targets = [await create(), await readyRequirement(['Open?']), await readyRequirement()];
      expect(targets.map((t) => t.requirement.state)).toEqual([
        'DRAFT',
        'NEEDS_CLARIFICATION',
        'READY',
      ]);
      for (const t of targets) {
        const r = await post(approver, `/api/requirements/${t.requirement.id}/reject`, {
          reason: 'Out of scope',
        });
        expect(r.statusCode, r.body).toBe(200);
        const d = r.json() as RequirementDetail;
        expect(d.requirement.state).toBe('REJECTED');
        expect(d.decisionReason).toBe('Out of scope');
        expect(d.decidedBy?.name).toBe('Approver 1');
        expect(d.audit.map((a) => a.action)).toContain('requirement.rejected');
        expect(d.actions).toMatchObject({ canSubmit: false, canApprove: false, canReject: false });
      }
      const analyzing = await create();
      expect(
        (await post(engineer, `/api/requirements/${analyzing.requirement.id}/submit`)).statusCode,
      ).toBe(200);
      expect(
        (
          await post(approver, `/api/requirements/${analyzing.requirement.id}/reject`, {
            reason: 'x',
          })
        ).statusCode,
      ).toBe(409);
      const approved = await readyRequirement();
      expect(
        (await post(approver, `/api/requirements/${approved.requirement.id}/approve`)).statusCode,
      ).toBe(200);
      expect(
        (
          await post(approver, `/api/requirements/${approved.requirement.id}/reject`, {
            reason: 'x',
          })
        ).statusCode,
      ).toBe(409);
      const missing = await post(
        approver,
        `/api/requirements/${targets[0]!.requirement.id}/reject`,
        {},
      );
      expect(missing.statusCode).toBe(400);
      expect((missing.json() as Problem).errors?.some((e) => e.path === 'reason')).toBe(true);
      expect(
        (
          await post(engineer, `/api/requirements/${targets[0]!.requirement.id}/reject`, {
            reason: 'x',
          })
        ).statusCode,
      ).toBe(403);
    });

    it('FR-009 GET /requirements/{id} returns the analysis grouped by kind in position order with aiGenerated labels, actions computed for the caller role, ≤ 40 transitions and ≤ 20 audit rows; invisible id → 404', async () => {
      const id = await seededId(REQUIREMENT_SHOWCASE.needsClarification);
      const d = await detailOf(approver, id);
      expect(d.requirement.externalId).toBe('req-seed-003');
      expect(d.requirement.state).toBe('NEEDS_CLARIFICATION');
      expect(d.requirement.source).toBe('jira');
      expect(d.requirement.externalRef).toMatchObject({
        provider: 'jira',
        key: 'PAY-231',
        url: 'https://jira.example.invalid/browse/PAY-231',
      });
      expect(d.requirement.assignee?.name).toBe('Approver 1');
      expect(d.requirement.openQuestionCount).toBe(2);
      expect(d.analysis!.acceptanceCriteria.map((c) => c.position)).toEqual([1, 2, 3]);
      expect(d.analysis!.rules.map((c) => c.position)).toEqual([1, 2]);
      expect(d.analysis!.openQuestions.map((c) => c.position)).toEqual([1, 2]);
      const all = [
        ...d.analysis!.acceptanceCriteria,
        ...d.analysis!.rules,
        ...d.analysis!.openQuestions,
      ];
      expect(all.every((i) => i.aiGenerated && i.source === 'agent:Requirement Agent')).toBe(true);
      expect(d.analysis!.summary).not.toBeNull();
      expect(d.actions).toMatchObject({ canSubmit: true, canApprove: false, canReject: true });
      expect(d.actions.submitLabel).toBe('Resubmit for analysis');
      expect(d.transitions.length).toBeLessThanOrEqual(40);
      expect(d.transitions.length).toBe(3);
      expect(d.audit.length).toBeLessThanOrEqual(20);
      expect(d.audit).toEqual([]); // the seed records history in requirement_transitions only
      const asViewer = await detailOf(viewer, id);
      expect(asViewer.actions).toMatchObject({
        canSubmit: false,
        canApprove: false,
        canReject: false,
      });
      expect(asViewer.actions.reasons.length).toBeGreaterThan(0);
      // linked workflow on the seeded IN_IMPLEMENTATION row
      const linked = await detailOf(admin, await seededId(REQUIREMENT_SHOWCASE.inImplementation));
      expect(linked.requirement.workflow).toMatchObject({ externalId: 's500-001' });
      // viewer1 sees payments-api + web-app; a requirement in platform is invisible → 404
      const hidden = await app.pool.query<{ id: string }>(
        `INSERT INTO requirements (organization_id, project_id, external_id, title, business_objective)
         SELECT organization_id, id, $2, 'Hidden requirement', 'A requirement in a project the viewer cannot see.' FROM projects WHERE id = $1 RETURNING id`,
        [platform, uniq('req-hidden')],
      );
      const r = await get(viewer, `/api/requirements/${hidden.rows[0]!.id}`);
      expect(r.statusCode).toBe(404);
      expect(
        (await get(viewer, '/api/requirements/00000000-0000-0000-0000-000000000000')).statusCode,
      ).toBe(404);
    });

    it('FR-009 GET /requirements returns ≤ 50 rows newest first with nextCursor, total, linked workflow status and openQuestionCount; state/assignee/project filters', async () => {
      const r = await get(admin, `/api/requirements?project=${payments}`);
      expect(r.statusCode, r.body).toBe(200);
      const page = r.json() as RequirementListPage;
      expect(page.project).toBe(payments);
      expect(page.items.length).toBeLessThanOrEqual(50);
      expect(page.total).toBeGreaterThanOrEqual(8);
      const created = page.items.map((i) => i.createdAt);
      expect([...created].sort().reverse()).toEqual(created);
      const seeded = page.items.filter((i) => i.externalId.startsWith('req-seed-'));
      expect(seeded.find((i) => i.externalId === 'req-seed-005')?.workflow?.state).toBe('QUEUED');
      expect(seeded.find((i) => i.externalId === 'req-seed-006')?.workflow).toMatchObject({
        externalId: 's500-001',
        state: 'WAITING_FOR_HUMAN',
      });
      expect(seeded.find((i) => i.externalId === 'req-seed-003')?.openQuestionCount).toBe(2);
      expect(seeded.find((i) => i.externalId === 'req-seed-001')?.workflow).toBeNull();
      for (const i of page.items) expect(i.href).toBe(`/requirements/${i.id}`);
      if (page.total > 50) {
        expect(page.nextCursor).not.toBeNull();
        const next = await get(
          admin,
          `/api/requirements?project=${payments}&cursor=${encodeURIComponent(page.nextCursor!)}`,
        );
        expect(next.statusCode).toBe(200);
        const ids = new Set(page.items.map((i) => i.id));
        expect((next.json() as RequirementListPage).items.some((i) => ids.has(i.id))).toBe(false);
      }

      const needs = (
        await get(admin, '/api/requirements?state=NEEDS_CLARIFICATION')
      ).json() as RequirementListPage;
      expect(needs.filters.state).toEqual(['NEEDS_CLARIFICATION']);
      expect(needs.items.map((i) => i.externalId)).toContain('req-seed-003');
      expect(needs.items.every((i) => i.state === 'NEEDS_CLARIFICATION')).toBe(true);

      const me = (
        await get(approver, '/api/requirements?assignee=me')
      ).json() as RequirementListPage;
      expect(me.filters.assignee).toBe('me');
      expect(me.items.map((i) => i.externalId)).toContain('req-seed-003');
      const unassigned = (
        await get(approver, '/api/requirements?assignee=unassigned')
      ).json() as RequirementListPage;
      expect(unassigned.items.map((i) => i.externalId)).not.toContain('req-seed-003');
      expect(unassigned.items.every((i) => i.assignee === null)).toBe(true);
      const byId = (
        await get(admin, `/api/requirements?assignee=${engineerId}`)
      ).json() as RequirementListPage;
      expect(byId.items.map((i) => i.externalId)).toContain('req-seed-004');

      const invisible = await get(engineer, `/api/requirements?project=${platform}`);
      expect(invisible.statusCode, invisible.body).toBe(200);
      expect(invisible.json()).toMatchObject({ items: [], total: 0, nextCursor: null });
      // engineer1 never sees platform rows through project=all either
      const mine = (await get(engineer, '/api/requirements')).json() as RequirementListPage;
      expect(mine.items.every((i) => i.project.key === 'payments-api')).toBe(true);
      expect((await app.inject({ method: 'GET', url: '/api/requirements' })).statusCode).toBe(401);
    });

    it('FR-007 GET /requirements?cursor=<workflows cursor> returns 400 invalid-cursor', async () => {
      const cursor = encodeWorkflowCursor({ stateObservedAt: iso(app.now()), id: payments });
      const r = await get(admin, `/api/requirements?cursor=${encodeURIComponent(cursor)}`);
      expect(r.statusCode).toBe(400);
      expect((r.json() as Problem).type).toBe('urn:cdevi:problem:invalid-cursor');
      expect((await get(admin, '/api/requirements?state=BOGUS')).statusCode).toBe(400);
    });

    it('FR-034 approve, submit and ingest each produce inbox_changed notifications carrying requirementId (and workflowId for approve)', async () => {
      const changes: InboxChange[] = [];
      const off = app.notify.on((c) => changes.push(c));
      const waitFor = async (pred: (c: InboxChange) => boolean) => {
        const start = Date.now();
        while (Date.now() - start < 3000) {
          const hit = changes.find(pred);
          if (hit) return hit;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error(`no notification: ${JSON.stringify(changes)}`);
      };
      try {
        const d = await create();
        const id = d.requirement.id;
        await waitFor((c) => c.requirementId === id && c.workflowId === null);
        changes.length = 0;
        expect((await post(engineer, `/api/requirements/${id}/submit`)).statusCode).toBe(200);
        const submitted = await waitFor((c) => c.requirementId === id);
        expect(submitted).toMatchObject({ projectId: payments, workflowId: null });
        changes.length = 0;
        const ingest = await app.inject(
          asIngest({
            method: 'PUT',
            url: `/api/ingest/requirements/${d.requirement.externalId}/analysis`,
            payload: {
              agent: 'Requirement Agent',
              observedAt: iso(plus(-MIN)),
              acceptanceCriteria: ['A'],
              rules: [],
              openQuestions: [],
            },
          }),
        );
        expect(ingest.statusCode, ingest.body).toBe(200);
        await waitFor((c) => c.requirementId === id);
        changes.length = 0;
        const approved = await post(approver, `/api/requirements/${id}/approve`);
        expect(approved.statusCode, approved.body).toBe(200);
        const wfId = (approved.json() as RequirementDetail).requirement.workflow!.id;
        await waitFor((c) => c.requirementId === id);
        const wf = await waitFor((c) => c.workflowId === wfId);
        expect(wf.requirementId).toBeNull();
        expect(changes.every((c) => c.seq > 0 && c.projectId === payments)).toBe(true);
      } finally {
        off();
      }
    });

    it('SC-007 GET /requirements p95 ≤ 200 ms, GET /requirements/{id} ≤ 150 ms, POST approve ≤ 300 ms over 20 calls at 2 000 requirements / 20 000 items; payloads ≤ 40 KB / 32 KB', async () => {
      const org = await seedSc007Org(app);
      const cookie = await signIn(app, org.email, org.password);
      const first = await get(cookie, '/api/requirements');
      expect(first.statusCode, first.body).toBe(200);
      const page = first.json() as RequirementListPage;
      expect(page.total).toBe(2000);
      expect(page.items).toHaveLength(50);
      const timing = (r: { headers: Record<string, unknown> }, name: string) => {
        const m = new RegExp(`${name};dur=(\\d+(?:\\.\\d+)?)`).exec(
          String(r.headers['server-timing']),
        );
        expect(m, String(r.headers['server-timing'])).not.toBeNull();
        return Number(m![1]);
      };
      const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;
      const list: number[] = [];
      for (let i = 0; i < 20; i++) {
        const r = await get(
          cookie,
          `/api/requirements?project=${org.projectIds[i % 4]}&state=READY,DRAFT`,
        );
        expect(r.statusCode).toBe(200);
        expect(Buffer.byteLength(r.body)).toBeLessThanOrEqual(40 * 1024);
        list.push(timing(r, 'requirements'));
      }
      expect(p95(list), list.join(',')).toBeLessThanOrEqual(200);
      const detail: number[] = [];
      for (let i = 0; i < 20; i++) {
        const r = await get(cookie, `/api/requirements/${page.items[i]!.id}`);
        expect(r.statusCode).toBe(200);
        expect(Buffer.byteLength(r.body)).toBeLessThanOrEqual(32 * 1024);
        detail.push(timing(r, 'requirement'));
      }
      expect(p95(detail), detail.join(',')).toBeLessThanOrEqual(150);
      const ready = await app.pool.query<{ id: string }>(
        `SELECT id FROM requirements WHERE organization_id = $1 AND state = 'READY' ORDER BY created_at DESC LIMIT 20`,
        [org.organizationId],
      );
      const approve: number[] = [];
      for (const row of ready.rows) {
        const r = await post(cookie, `/api/requirements/${row.id}/approve`);
        expect(r.statusCode, r.body).toBe(200);
        approve.push(timing(r, 'approve'));
      }
      expect(p95(approve), approve.join(',')).toBeLessThanOrEqual(300);
    });
  },
);
