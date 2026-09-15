import type {
  AlreadyResolvedProblem,
  ApprovalCenterDetail,
  ApprovalCenterSnapshot,
  DecisionResult,
} from '@cdevi/contracts';
import { riskRank } from '@cdevi/contracts';
import { DECISION_SHOWCASE } from '@cdevi/db/seed';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, asUser, iso, MIN, plus, signIn, skipDb, testApp, uniq } from './helpers';

const wfBody = (over: Record<string, unknown> = {}) => ({
  projectKey: 'payments-api',
  title: 'Decision workflow',
  agent: 'Implementation Agent',
  state: 'RUNNING',
  stage: { index: 6, count: 7, name: 'Review' },
  observedAt: iso(plus(-10 * MIN)),
  ...over,
});

describe.skipIf(skipDb)('Approval Center API (specs/001 US2, FR-011..FR-015, FR-032)', () => {
  let app: FastifyInstance;
  let admin: string;
  let approver: string;
  let approver4: string;
  let engineer: string;
  let viewer: string;

  beforeAll(async () => {
    app = await testApp();
    admin = await signIn(app, 'admin@cdevi.demo');
    approver = await signIn(app, 'approver1@cdevi.demo');
    approver4 = await signIn(app, 'approver4@cdevi.demo');
    engineer = await signIn(app, 'engineer1@cdevi.demo');
    viewer = await signIn(app, 'viewer1@cdevi.demo');
  });
  afterAll(() => app.close());

  /** Creates a RUNNING workflow and parks it in WAITING_FOR_HUMAN (CREATE → WAITING_FOR_HUMAN is not a legal edge). */
  const put = async (ext: string, body: object) => {
    const created = await app.inject(
      asIngest({ method: 'PUT', url: `/api/ingest/workflows/${ext}`, payload: body }),
    );
    if (created.statusCode !== 200) return created;
    return app.inject(
      asIngest({
        method: 'POST',
        url: `/api/ingest/workflows/${ext}/transitions`,
        payload: { toState: 'WAITING_FOR_HUMAN', observedAt: iso(plus(-8 * MIN)) },
      }),
    );
  };
  async function raiseApproval(
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    over: Record<string, unknown> = {},
    wf: Record<string, unknown> = {},
  ) {
    const ext = uniq('dec');
    expect((await put(ext, wfBody(wf))).statusCode).toBe(200);
    const r = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/approvals/${ext}-a`,
        payload: {
          workflowExternalId: ext,
          ask: `Approve: merge PR #${risk}`,
          riskLevel: risk,
          requestedAt: iso(plus(-5 * MIN)),
          context: 'All checks passed.',
          links: { pullRequest: 'https://github.com/acme/payments-api/pull/1' },
          ...over,
        },
      }),
    );
    expect(r.statusCode, r.body).toBe(200);
    return { ext, id: r.json().id as string };
  }
  async function raiseClarification(over: Record<string, unknown> = {}) {
    const ext = uniq('clr');
    expect(
      (await put(ext, wfBody({ stage: { index: 2, count: 7, name: 'Analysis' } }))).statusCode,
    ).toBe(200);
    const r = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/clarifications/${ext}-c`,
        payload: {
          workflowExternalId: ext,
          question: 'Which sign-in method?',
          requestedAt: iso(plus(-4 * MIN)),
          whyItMatters: 'Changes the rollout plan.',
          options: [
            { value: 'oidc', label: 'OpenID Connect', recommended: true },
            { value: 'saml', label: 'SAML 2.0' },
          ],
          links: { requirement: '/requirements/x', externalTicket: 'https://jira.example/PAY-1' },
          ...over,
        },
      }),
    );
    expect(r.statusCode, r.body).toBe(200);
    return { ext, id: r.json().id as string };
  }
  const workflowState = async (ext: string) =>
    (
      await app.pool.query<{ state: string }>(
        `SELECT state FROM workflows WHERE external_id = $1`,
        [ext],
      )
    ).rows[0]!.state;
  const list = async (cookie: string, q = ''): Promise<ApprovalCenterSnapshot> => {
    const r = await app.inject(asUser(cookie, { method: 'GET', url: `/api/approvals${q}` }));
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const detail = async (cookie: string, id: string) =>
    app.inject(asUser(cookie, { method: 'GET', url: `/api/approvals/${id}` }));
  const approve = (cookie: string, id: string, body: object = {}) =>
    app.inject(
      asUser(cookie, { method: 'POST', url: `/api/approvals/${id}/approve`, payload: body }),
    );
  const reject = (cookie: string, id: string, body: object) =>
    app.inject(
      asUser(cookie, { method: 'POST', url: `/api/approvals/${id}/reject`, payload: body }),
    );
  const answer = (cookie: string, id: string, body: object) =>
    app.inject(
      asUser(cookie, { method: 'POST', url: `/api/clarifications/${id}/answer`, payload: body }),
    );

  it('FR-011 GET /api/approvals lists pending approvals and clarifications, highest risk then oldest first, within 200', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/approvals' })).statusCode).toBe(401);
    const snap = await list(admin);
    expect(snap.project).toBe('all');
    expect(snap.items.length).toBeLessThanOrEqual(200);
    expect(snap.items.length).toBe(snap.counts.approvals + snap.counts.clarifications);
    expect(snap.counts.approvals).toBeGreaterThanOrEqual(24);
    expect(snap.counts.clarifications).toBeGreaterThanOrEqual(12);
    for (let i = 1; i < snap.items.length; i++) {
      const a = snap.items[i - 1]!;
      const b = snap.items[i]!;
      const ra = riskRank(a.riskLevel);
      const rb = riskRank(b.riskLevel);
      expect(ra <= rb).toBe(true);
      if (ra === rb) expect(new Date(a.requestedAt) <= new Date(b.requestedAt)).toBe(true);
    }
    const first = snap.items[0]!;
    expect(first.riskLevel).toBe('CRITICAL');
    expect(first.href).toBe(`/approvals/${first.id}`);
    const clr = snap.items.find((i) => i.kind === 'clarification')!;
    expect(clr.riskLevel).toBeNull();
    expect(clr.href).toBe(`/approvals/${clr.id}`);
    const req = snap.items.find(
      (i) => i.workflowExternalId && i.ask.startsWith('Approve: requirement'),
    );
    expect(req?.riskLevel).toBe('LOW');
    const showcase = await app.pool.query<{ id: string }>(
      `SELECT id FROM clarifications WHERE external_id = $1`,
      [DECISION_SHOWCASE.clarification],
    );
    expect(snap.items.find((i) => i.id === showcase.rows[0]!.id)?.hasRecommendedAnswer).toBe(true);
  });

  it('FR-025 ?project= scopes the list to a visible project; invisible/unknown project → 404; non-admins see only their memberships', async () => {
    const me = (await app.inject(asUser(approver4, { method: 'GET', url: '/api/auth/me' }))).json();
    const visible = new Set<string>(me.projects.map((p: { id: string }) => p.id));
    const all = await list(approver4);
    for (const i of all.items) expect(visible.has(i.project.id)).toBe(true);
    const platform = (
      await app.pool.query<{ id: string }>(`SELECT id FROM projects WHERE key='platform'`)
    ).rows[0]!.id;
    expect(visible.has(platform)).toBe(false);
    const adminAll = await list(admin);
    expect(adminAll.items.some((i) => i.project.id === platform)).toBe(true);
    const scoped = await list(admin, `?project=${platform}`);
    expect(scoped.project).toBe(platform);
    expect(scoped.items.length).toBeGreaterThan(0);
    for (const i of scoped.items) expect(i.project.id).toBe(platform);
    const hidden = await app.inject(
      asUser(approver4, { method: 'GET', url: `/api/approvals?project=${platform}` }),
    );
    expect(hidden.statusCode).toBe(404);
    expect(
      (await app.inject(asUser(admin, { method: 'GET', url: '/api/approvals?project=nope' })))
        .statusCode,
    ).toBe(400);
  });

  it('FR-012 GET /api/approvals/:id returns approval detail with context, links, requiresConfirmation and canDecide per role', async () => {
    const { id } = await raiseApproval('HIGH');
    const d = await detail(approver, id);
    expect(d.statusCode, d.body).toBe(200);
    const body: ApprovalCenterDetail = d.json();
    expect(body.item.kind).toBe('approval');
    expect(body.item.riskLevel).toBe('HIGH');
    expect(body.workflowState).toBe('WAITING_FOR_HUMAN');
    expect(body.canDecide).toBe(true);
    expect(body.approval).toEqual({
      context: 'All checks passed.',
      links: { pullRequest: 'https://github.com/acme/payments-api/pull/1' },
      requiresConfirmation: true,
    });
    expect(body.clarification).toBeNull();
    expect(body.resolution).toBeNull();
    expect(body.audit).toEqual([]);
    const asEngineer: ApprovalCenterDetail = (await detail(engineer, id)).json();
    expect(asEngineer.canDecide).toBe(false);
    const asViewer: ApprovalCenterDetail = (await detail(viewer, id)).json();
    expect(asViewer.canDecide).toBe(false);
    expect((await detail(admin, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/approvals/${id}` })).statusCode).toBe(401);
  });

  it('FR-012 clarification detail carries whyItMatters, options and links; the same route serves both kinds', async () => {
    const { id } = await raiseClarification();
    const body: ApprovalCenterDetail = (await detail(approver, id)).json();
    expect(body.item.kind).toBe('clarification');
    expect(body.item.riskLevel).toBeNull();
    expect(body.item.hasRecommendedAnswer).toBe(true);
    expect(body.approval).toBeNull();
    expect(body.clarification).toEqual({
      whyItMatters: 'Changes the rollout plan.',
      options: [
        { value: 'oidc', label: 'OpenID Connect', recommended: true },
        { value: 'saml', label: 'SAML 2.0', recommended: false },
      ],
      links: { requirement: '/requirements/x', externalTicket: 'https://jira.example/PAY-1' },
    });
  });

  it('FR-032 engineers and viewers are refused every decision with 403; unauthenticated → 401', async () => {
    const a = await raiseApproval('LOW');
    const c = await raiseClarification();
    for (const cookie of [engineer, viewer]) {
      expect((await approve(cookie, a.id)).statusCode).toBe(403);
      expect((await reject(cookie, a.id, { reason: 'no', target: 'BLOCKED' })).statusCode).toBe(
        403,
      );
      expect((await answer(cookie, c.id, { option: 'oidc' })).statusCode).toBe(403);
    }
    expect(
      (await app.inject({ method: 'POST', url: `/api/approvals/${a.id}/approve`, payload: {} }))
        .statusCode,
    ).toBe(401);
    expect(await workflowState(a.ext)).toBe('WAITING_FOR_HUMAN');
    const { rows } = await app.pool.query(
      `SELECT count(*)::int c FROM audit_events WHERE target_id = $1`,
      [a.id],
    );
    expect(rows[0].c).toBe(0);
  });

  it('FR-025 an approver may not see or decide items in projects outside their memberships (404)', async () => {
    const a = await raiseApproval('LOW', {}, { projectKey: 'platform' });
    expect((await detail(approver4, a.id)).statusCode).toBe(404);
    expect((await approve(approver4, a.id)).statusCode).toBe(404);
    expect((await detail(admin, a.id)).statusCode).toBe(200);
  });

  it('Scenario 1/FR-014 approving a LOW approval records decision, decider, transition to RUNNING, an audit event and an inbox change', async () => {
    const a = await raiseApproval('LOW');
    const before = Number(
      (
        await app.pool.query(
          `SELECT count(*) c FROM inbox_change_log l JOIN workflows w ON w.id = l.workflow_id WHERE w.external_id = $1`,
          [a.ext],
        )
      ).rows[0].c,
    );
    const r = await approve(approver, a.id);
    expect(r.statusCode, r.body).toBe(200);
    const { detail: d }: DecisionResult = r.json();
    expect(d.workflowState).toBe('RUNNING');
    expect(d.resolution).toMatchObject({
      outcome: 'approved',
      by: { name: 'Approver 1' },
      reason: null,
      target: null,
      answer: null,
      workflowState: 'RUNNING',
    });
    expect(d.resolution!.by.id).toBeTruthy();
    expect(d.audit).toHaveLength(1);
    expect(d.audit[0]).toMatchObject({
      actor: { type: 'user', name: 'Approver 1' },
      action: 'approval.approved',
      target: { type: 'approval', id: a.id },
      riskLevel: 'LOW',
      result: 'RUNNING',
    });
    const row = (
      await app.pool.query(
        `SELECT a.decision, a.decided_by, a.decided_by_user_id, a.decided_at, u.email FROM approvals a JOIN users u ON u.id = a.decided_by_user_id WHERE a.id = $1`,
        [a.id],
      )
    ).rows[0];
    expect(row.decision).toBe('approved');
    expect(row.decided_by).toBe('Approver 1');
    expect(row.email).toBe('approver1@cdevi.demo');
    expect(await workflowState(a.ext)).toBe('RUNNING');
    const t = (
      await app.pool.query(
        `SELECT t.from_state, t.to_state, t.user_id FROM workflow_transitions t JOIN workflows w ON w.id = t.workflow_id WHERE w.external_id = $1 ORDER BY t.observed_at DESC, t.id DESC LIMIT 1`,
        [a.ext],
      )
    ).rows[0];
    expect(t).toMatchObject({ from_state: 'WAITING_FOR_HUMAN', to_state: 'RUNNING' });
    expect(t.user_id).toBe(row.decided_by_user_id);
    const after = Number(
      (
        await app.pool.query(
          `SELECT count(*) c FROM inbox_change_log l JOIN workflows w ON w.id = l.workflow_id WHERE w.external_id = $1`,
          [a.ext],
        )
      ).rows[0].c,
    );
    expect(after).toBeGreaterThan(before);
    const snap = await list(approver);
    expect(snap.items.some((i) => i.id === a.id)).toBe(false);
  });

  it('Scenario 4/FR-013 HIGH and CRITICAL approvals need confirmed=true (400 with path "confirmed"); MEDIUM does not', async () => {
    const high = await raiseApproval('HIGH');
    const r = await approve(approver, high.id);
    expect(r.statusCode).toBe(400);
    expect(r.json().type).toBe('urn:cdevi:problem:validation');
    expect(r.json().errors[0].path).toBe('confirmed');
    expect(await workflowState(high.ext)).toBe('WAITING_FOR_HUMAN');
    expect((await approve(approver, high.id, { confirmed: true })).statusCode).toBe(200);
    const crit = await raiseApproval('CRITICAL');
    expect((await approve(admin, crit.id, { confirmed: false })).statusCode).toBe(400);
    expect((await approve(admin, crit.id, { confirmed: true })).statusCode).toBe(200);
    const med = await raiseApproval('MEDIUM');
    expect((await approve(approver, med.id)).statusCode).toBe(200);
    expect(await workflowState(med.ext)).toBe('RUNNING');
  });

  it('Scenario 5 rejecting needs a reason and a BLOCKED|CANCELLED target; records rejection metadata, the transition and audit', async () => {
    const a = await raiseApproval('MEDIUM');
    expect((await reject(approver, a.id, { target: 'BLOCKED' })).statusCode).toBe(400);
    expect((await reject(approver, a.id, { reason: '   ', target: 'BLOCKED' })).statusCode).toBe(
      400,
    );
    expect((await reject(approver, a.id, { reason: 'no', target: 'FAILED' })).statusCode).toBe(400);
    const r = await reject(approver, a.id, {
      reason: 'Needs a rollback plan first.',
      target: 'BLOCKED',
    });
    expect(r.statusCode, r.body).toBe(200);
    const { detail: d }: DecisionResult = r.json();
    expect(d.workflowState).toBe('BLOCKED');
    expect(d.resolution).toMatchObject({
      outcome: 'rejected',
      reason: 'Needs a rollback plan first.',
      target: 'BLOCKED',
      workflowState: 'BLOCKED',
    });
    expect(d.audit[0]).toMatchObject({
      action: 'approval.rejected',
      result: 'BLOCKED',
      riskLevel: 'MEDIUM',
    });
    expect(d.audit[0]!.details).toMatchObject({
      reason: 'Needs a rollback plan first.',
      target: 'BLOCKED',
    });
    const row = (
      await app.pool.query(
        `SELECT decision, rejection_reason, rejection_target FROM approvals WHERE id = $1`,
        [a.id],
      )
    ).rows[0];
    expect(row).toEqual({
      decision: 'rejected',
      rejection_reason: 'Needs a rollback plan first.',
      rejection_target: 'BLOCKED',
    });
    const w = (
      await app.pool.query(`SELECT state, state_reason FROM workflows WHERE external_id = $1`, [
        a.ext,
      ])
    ).rows[0];
    expect(w.state).toBe('BLOCKED');
    expect(w.state_reason).toContain('Needs a rollback plan first.');
    const b = await raiseApproval('HIGH');
    const rc = await reject(admin, b.id, { reason: 'Out of scope.', target: 'CANCELLED' });
    expect(rc.statusCode, rc.body).toBe(200);
    expect(await workflowState(b.ext)).toBe('CANCELLED');
    const fin = (
      await app.pool.query(`SELECT finished_at FROM workflows WHERE external_id = $1`, [b.ext])
    ).rows[0];
    expect(fin.finished_at).not.toBeNull();
  });

  it('Scenario 2–3/FR-014 answering with an option or free text records answer text, answerer, transition to RUNNING and the audit event', async () => {
    const c = await raiseClarification();
    expect((await answer(approver, c.id, {})).statusCode).toBe(400);
    expect((await answer(approver, c.id, { option: 'oidc', text: 'both' })).statusCode).toBe(400);
    const bad = await answer(approver, c.id, { option: 'ldap' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0].path).toBe('option');
    const r = await answer(approver, c.id, { option: 'oidc' });
    expect(r.statusCode, r.body).toBe(200);
    const { detail: d }: DecisionResult = r.json();
    expect(d.workflowState).toBe('RUNNING');
    expect(d.resolution).toMatchObject({
      outcome: 'answered',
      by: { name: 'Approver 1' },
      answer: { option: 'oidc', text: 'OpenID Connect' },
      workflowState: 'RUNNING',
    });
    expect(d.audit[0]).toMatchObject({
      action: 'clarification.answered',
      target: { type: 'clarification', id: c.id },
      riskLevel: null,
      result: 'RUNNING',
    });
    expect(d.audit[0]!.details).toMatchObject({
      question: 'Which sign-in method?',
      answerOption: 'oidc',
      answerText: 'OpenID Connect',
    });
    const row = (
      await app.pool.query(
        `SELECT c.answer_option, c.answer_text, c.answered_by, u.email FROM clarifications c JOIN users u ON u.id = c.answered_by_user_id WHERE c.id = $1`,
        [c.id],
      )
    ).rows[0];
    expect(row).toEqual({
      answer_option: 'oidc',
      answer_text: 'OpenID Connect',
      answered_by: 'Approver 1',
      email: 'approver1@cdevi.demo',
    });
    expect(await workflowState(c.ext)).toBe('RUNNING');

    const f = await raiseClarification({ options: [] });
    const rf = await answer(admin, f.id, { text: '  Use OIDC, the gateway is being retired.  ' });
    expect(rf.statusCode, rf.body).toBe(200);
    const fd: DecisionResult = rf.json();
    expect(fd.detail.resolution!.answer).toEqual({
      option: null,
      text: 'Use OIDC, the gateway is being retired.',
    });
    const wt = (
      await app.pool.query(
        `SELECT t.reason FROM workflow_transitions t JOIN workflows w ON w.id = t.workflow_id WHERE w.external_id = $1 ORDER BY t.observed_at DESC, t.id DESC LIMIT 1`,
        [f.ext],
      )
    ).rows[0];
    expect(wt.reason).toContain('Use OIDC');
  });

  it('FR-015 an item is resolvable exactly once: a second caller gets 409 already-resolved with the recorded outcome', async () => {
    const a = await raiseApproval('LOW');
    expect((await approve(approver, a.id)).statusCode).toBe(200);
    const again = await reject(admin, a.id, { reason: 'changed my mind', target: 'BLOCKED' });
    expect(again.statusCode).toBe(409);
    expect(again.headers['content-type']).toMatch(/application\/problem\+json/);
    const p: AlreadyResolvedProblem = again.json();
    expect(p.type).toBe('urn:cdevi:problem:already-resolved');
    expect(p.resolution).toMatchObject({
      outcome: 'approved',
      by: { name: 'Approver 1' },
      workflowState: 'RUNNING',
    });
    const row = (
      await app.pool.query(`SELECT decision, decided_by FROM approvals WHERE id = $1`, [a.id])
    ).rows[0];
    expect(row).toEqual({ decision: 'approved', decided_by: 'Approver 1' });
    expect(await workflowState(a.ext)).toBe('RUNNING');
    const audit = await app.pool.query(
      `SELECT count(*)::int c FROM audit_events WHERE target_id = $1`,
      [a.id],
    );
    expect(audit.rows[0].c).toBe(1);
    const d: ApprovalCenterDetail = (await detail(admin, a.id)).json();
    expect(d.canDecide).toBe(false);
    expect(d.resolution?.outcome).toBe('approved');
  });

  it("FR-015 edge case: two users resolving the same item concurrently — first writer wins, the loser receives the winner's outcome", async () => {
    for (let round = 0; round < 3; round++) {
      const a = await raiseApproval('MEDIUM');
      const [r1, r2] = await Promise.all([
        approve(approver, a.id),
        reject(admin, a.id, { reason: 'Concurrent rejection.', target: 'CANCELLED' }),
      ]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      expect(codes, `${r1.body}\n${r2.body}`).toEqual([200, 409]);
      const winner: DecisionResult = (r1.statusCode === 200 ? r1 : r2).json();
      const loser: AlreadyResolvedProblem = (r1.statusCode === 409 ? r1 : r2).json();
      expect(loser.resolution.outcome).toBe(winner.detail.resolution!.outcome);
      expect(loser.resolution.by.name).toBe(winner.detail.resolution!.by.name);
      expect(loser.resolution.workflowState).toBe(winner.detail.workflowState);
      expect(await workflowState(a.ext)).toBe(winner.detail.workflowState);
      const audit = await app.pool.query(
        `SELECT count(*)::int c FROM audit_events WHERE target_id = $1`,
        [a.id],
      );
      expect(audit.rows[0].c).toBe(1);
      const transitions = await app.pool.query(
        `SELECT count(*)::int c FROM workflow_transitions t JOIN workflows w ON w.id = t.workflow_id WHERE w.external_id = $1 AND t.user_id IS NOT NULL`,
        [a.ext],
      );
      expect(transitions.rows[0].c).toBe(1);
    }
  });

  it('FR-015 a pending item whose workflow is no longer WAITING_FOR_HUMAN cannot be decided (409 invalid-transition)', async () => {
    const a = await raiseApproval('LOW');
    await app.inject(
      asIngest({
        method: 'POST',
        url: `/api/ingest/workflows/${a.ext}/transitions`,
        payload: { toState: 'CANCELLED', observedAt: iso(plus(-1 * MIN)) },
      }),
    );
    const r = await approve(approver, a.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().type).toBe('urn:cdevi:problem:invalid-transition');
    const d: ApprovalCenterDetail = (await detail(approver, a.id)).json();
    expect(d.canDecide).toBe(false);
    expect(d.workflowState).toBe('CANCELLED');
  });

  it('FR-015 a workflow cancelled while a decision waits for the lock is not reverted: the decision sees the committed state', async () => {
    const a = await raiseApproval('LOW');
    const wf = (
      await app.pool.query<{ id: string }>(`SELECT id FROM workflows WHERE external_id = $1`, [
        a.ext,
      ])
    ).rows[0]!;
    const holder = await app.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM workflows WHERE id = $1 FOR UPDATE`, [wf.id]);
      const pending = approve(approver, a.id);
      await new Promise((r) => setTimeout(r, 150));
      await holder.query(
        `UPDATE workflows SET state = 'CANCELLED', state_observed_at = now(), finished_at = now() WHERE id = $1`,
        [wf.id],
      );
      await holder.query('COMMIT');
      const r = await pending;
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().type).toBe('urn:cdevi:problem:invalid-transition');
    } finally {
      holder.release();
    }
    expect(await workflowState(a.ext)).toBe('CANCELLED');
    const row = (await app.pool.query(`SELECT decision FROM approvals WHERE id = $1`, [a.id]))
      .rows[0];
    expect(row.decision).toBeNull();
  });

  it('FR-014 a decision resumes only the stage linked to the item (other waiting stages keep waiting) and stamps started_at', async () => {
    const a = await raiseApproval('MEDIUM');
    const stage = (position: number, body: Record<string, unknown>) =>
      app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/workflows/${a.ext}/stages/${position}`,
          payload: {
            name: `Stage ${position}`,
            state: 'RUNNING',
            observedAt: iso(plus(-7 * MIN)),
            count: 2,
            ...body,
          },
        }),
      );
    for (const [position, link] of [
      [1, { approvalExternalId: `${a.ext}-a` }],
      [2, {}],
    ] as const) {
      expect((await stage(position, link)).statusCode).toBe(200);
      const waiting = await stage(position, {
        state: 'WAITING_FOR_HUMAN',
        observedAt: iso(plus(-6 * MIN)),
        ...link,
      });
      expect(waiting.statusCode, waiting.body).toBe(200);
    }
    await app.pool.query(
      `UPDATE workflow_stages s SET started_at = NULL FROM workflows w WHERE w.id = s.workflow_id AND w.external_id = $1`,
      [a.ext],
    );
    const r = await approve(approver, a.id);
    expect(r.statusCode, r.body).toBe(200);
    const stages = (
      await app.pool.query<{ position: number; state: string; started_at: Date | null }>(
        `SELECT s.position, s.state, s.started_at FROM workflow_stages s JOIN workflows w ON w.id = s.workflow_id WHERE w.external_id = $1 ORDER BY s.position`,
        [a.ext],
      )
    ).rows;
    expect(stages.map((s) => s.state)).toEqual(['RUNNING', 'WAITING_FOR_HUMAN']);
    expect(stages[0]!.started_at).toBeInstanceOf(Date);
    expect(stages[1]!.started_at).toBeNull();
  });

  it('FR-014 agent replays after a human decision cannot overwrite the decision or the answer', async () => {
    const a = await raiseApproval('LOW');
    expect((await approve(approver, a.id)).statusCode).toBe(200);
    const replay = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/approvals/${a.ext}-a`,
        payload: {
          workflowExternalId: a.ext,
          ask: 'Approve: merge PR #LOW',
          riskLevel: 'LOW',
          requestedAt: iso(plus(-5 * MIN)),
          decision: { outcome: 'rejected', decidedAt: iso(plus(-1 * MIN)), decidedBy: 'bot' },
        },
      }),
    );
    expect(replay.statusCode, replay.body).toBe(200);
    const ap = (
      await app.pool.query(`SELECT decision, decided_by FROM approvals WHERE id = $1`, [a.id])
    ).rows[0];
    expect(ap).toEqual({ decision: 'approved', decided_by: 'Approver 1' });

    const c = await raiseClarification();
    expect((await answer(approver, c.id, { option: 'saml' })).statusCode).toBe(200);
    const creplay = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/clarifications/${c.ext}-c`,
        payload: {
          workflowExternalId: c.ext,
          question: 'Which sign-in method?',
          requestedAt: iso(plus(-4 * MIN)),
          answer: { answeredAt: iso(plus(-1 * MIN)), answeredBy: 'bot' },
          links: { agentRun: '/agent-runs/abc' },
        },
      }),
    );
    expect(creplay.statusCode, creplay.body).toBe(200);
    const cl = (
      await app.pool.query(
        `SELECT answered_by, answer_option, links FROM clarifications WHERE id = $1`,
        [c.id],
      )
    ).rows[0];
    expect(cl).toEqual({
      answered_by: 'Approver 1',
      answer_option: 'saml',
      links: { agentRun: '/agent-runs/abc' },
    });
    const d: ApprovalCenterDetail = (await detail(approver, c.id)).json();
    expect(d.clarification?.links.agentRun).toBe('/agent-runs/abc');
  });

  it('FR-014 a decision never moves state_observed_at backwards: a future-dated waiting observation keeps its clock, later stale ingestion is refused, audit keeps request time', async () => {
    const a = await raiseApproval('LOW');
    const ahead = plus(2 * MIN);
    await app.pool.query(`UPDATE workflows SET state_observed_at = $2 WHERE external_id = $1`, [
      a.ext,
      ahead,
    ]);
    const r = await approve(approver, a.id);
    expect(r.statusCode, r.body).toBe(200);
    const w = (
      await app.pool.query<{ state: string; state_observed_at: Date }>(
        `SELECT state, state_observed_at FROM workflows WHERE external_id = $1`,
        [a.ext],
      )
    ).rows[0]!;
    expect(w.state).toBe('RUNNING');
    expect(w.state_observed_at.getTime()).toBeGreaterThanOrEqual(ahead.getTime());
    const t = (
      await app.pool.query<{ observed_at: Date }>(
        `SELECT t.observed_at FROM workflow_transitions t JOIN workflows w ON w.id = t.workflow_id WHERE w.external_id = $1 AND t.from_state = 'WAITING_FOR_HUMAN' AND t.stage_id IS NULL`,
        [a.ext],
      )
    ).rows[0]!;
    expect(t.observed_at.getTime()).toBeGreaterThanOrEqual(ahead.getTime());
    const audit = (
      await app.pool.query<{ occurred_at: Date }>(
        `SELECT occurred_at FROM audit_events WHERE target_id = $1`,
        [a.id],
      )
    ).rows[0]!;
    expect(audit.occurred_at.getTime()).toBe(plus(0).getTime());
    const stale = await app.inject(
      asIngest({
        method: 'POST',
        url: `/api/ingest/workflows/${a.ext}/transitions`,
        payload: { toState: 'COMPLETED', observedAt: iso(plus(1 * MIN)) },
      }),
    );
    expect(stale.statusCode, stale.body).toBe(200);
    expect(await workflowState(a.ext)).toBe('RUNNING');

    // A waiting stage the decision does not move keeps its own clock and does not advance the workflow's.
    const b = await raiseApproval('MEDIUM');
    const stage = (position: number, body: Record<string, unknown>) =>
      app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/workflows/${b.ext}/stages/${position}`,
          payload: { name: `Stage ${position}`, state: 'RUNNING', count: 2, ...body },
        }),
      );
    const link = { approvalExternalId: `${b.ext}-a` };
    expect((await stage(1, { observedAt: iso(plus(-7 * MIN)), ...link })).statusCode).toBe(200);
    expect(
      (await stage(1, { state: 'WAITING_FOR_HUMAN', observedAt: iso(plus(-6 * MIN)), ...link }))
        .statusCode,
    ).toBe(200);
    expect((await stage(2, { observedAt: iso(plus(-7 * MIN)) })).statusCode).toBe(200);
    expect(
      (await stage(2, { state: 'WAITING_FOR_HUMAN', observedAt: iso(plus(120 * MIN)) })).statusCode,
    ).toBe(200);
    expect((await approve(approver, b.id)).statusCode).toBe(200);
    const wb = (
      await app.pool.query<{ state_observed_at: Date }>(
        `SELECT state_observed_at FROM workflows WHERE external_id = $1`,
        [b.ext],
      )
    ).rows[0]!;
    expect(wb.state_observed_at.getTime()).toBe(plus(0).getTime());
    const later = await app.inject(
      asIngest({
        method: 'POST',
        url: `/api/ingest/workflows/${b.ext}/transitions`,
        payload: { toState: 'COMPLETED', observedAt: iso(plus(1 * MIN)) },
      }),
    );
    expect(later.statusCode, later.body).toBe(200);
    expect(await workflowState(b.ext)).toBe('COMPLETED');
  });

  it('FR-015 a resolution reports the state the decision produced even after the workflow moves on', async () => {
    const a = await raiseApproval('LOW');
    expect((await approve(approver, a.id)).statusCode).toBe(200);
    const done = await app.inject(
      asIngest({
        method: 'POST',
        url: `/api/ingest/workflows/${a.ext}/transitions`,
        payload: { toState: 'COMPLETED', observedAt: iso(plus(5 * MIN)) },
      }),
    );
    expect(done.statusCode, done.body).toBe(200);
    expect(await workflowState(a.ext)).toBe('COMPLETED');
    const d: ApprovalCenterDetail = (await detail(approver, a.id)).json();
    expect(d.workflowState).toBe('COMPLETED');
    expect(d.resolution?.workflowState).toBe('RUNNING');
    const again = await approve(admin, a.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().resolution.workflowState).toBe('RUNNING');

    const b = await raiseApproval('LOW');
    expect(
      (await reject(approver, b.id, { reason: 'Not now', target: 'BLOCKED' })).statusCode,
    ).toBe(200);
    const resumed = await app.inject(
      asIngest({
        method: 'POST',
        url: `/api/ingest/workflows/${b.ext}/transitions`,
        payload: { toState: 'RUNNING', observedAt: iso(plus(5 * MIN)) },
      }),
    );
    expect(resumed.statusCode, resumed.body).toBe(200);
    const db: ApprovalCenterDetail = (await detail(approver, b.id)).json();
    expect(db.workflowState).toBe('RUNNING');
    expect(db.resolution).toMatchObject({ outcome: 'rejected', workflowState: 'BLOCKED' });

    // An outcome ingested from an agent moves no workflow, so its resolution reports the live state.
    const c = await raiseClarification({
      answer: { answeredAt: iso(plus(-1 * MIN)), answeredBy: 'bot' },
    });
    const dc: ApprovalCenterDetail = (await detail(approver, c.id)).json();
    expect(dc.workflowState).toBe('WAITING_FOR_HUMAN');
    expect(dc.resolution).toMatchObject({
      outcome: 'answered',
      by: { id: null, name: 'bot' },
      workflowState: 'WAITING_FOR_HUMAN',
    });
    const ag = await raiseApproval('LOW', {
      decision: { outcome: 'approved', decidedAt: iso(plus(-1 * MIN)), decidedBy: 'bot' },
    });
    const dag: ApprovalCenterDetail = (await detail(approver, ag.id)).json();
    expect(dag.resolution).toMatchObject({
      outcome: 'approved',
      workflowState: 'WAITING_FOR_HUMAN',
    });
  });

  it('answering an approval id or approving a clarification id is a 404', async () => {
    const a = await raiseApproval('LOW');
    const c = await raiseClarification();
    expect((await answer(approver, a.id, { text: 'x' })).statusCode).toBe(404);
    expect((await approve(approver, c.id)).statusCode).toBe(404);
  });
});
