import { Writable } from 'node:stream';
import type {
  DashboardSnapshot,
  JiraWebhookResult,
  Problem,
  RequirementDetail,
} from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  iso,
  JIRA_TEST_SECRET,
  MIN,
  plus,
  SEED_INGEST_TOKEN,
  signIn,
  signJira,
  skipDb,
  testApp,
} from './helpers';

const WEBHOOK = '/api/integrations/jira/webhook';

const adf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
  ],
});

interface IssueOptions {
  key?: string;
  event?: string;
  summary?: string;
  description?: unknown;
  updated?: string;
  projectKey?: string;
  statusCategory?: string;
  assigneeEmail?: string | null;
}

function issueEvent(o: IssueOptions = {}) {
  return {
    webhookEvent: o.event ?? 'jira:issue_created',
    timestamp: Date.now(),
    issue: {
      id: '10001',
      key: o.key ?? 'PAY-240',
      fields: {
        summary: o.summary ?? 'Retry soft declines nightly',
        description: o.description ?? adf('Retry declined renewals once a night for three nights.'),
        updated: o.updated ?? iso(plus(-5 * MIN)),
        project: { key: o.projectKey ?? 'PAY', name: 'Payments' },
        status: { name: 'To Do', statusCategory: { key: o.statusCategory ?? 'new' } },
        assignee:
          o.assigneeEmail === null
            ? null
            : { emailAddress: o.assigneeEmail ?? 'engineer1@cdevi.demo' },
        customfield_10011: 'ignored',
      },
    },
  };
}

describe.skipIf(skipDb)('POST /api/integrations/jira/webhook (specs/001 US4, FR-008)', () => {
  let app: FastifyInstance;
  let admin: string;
  let approver: string;
  let payments: string;

  beforeAll(async () => {
    app = await testApp({ jiraWebhookSecret: JIRA_TEST_SECRET });
    admin = await signIn(app, 'admin@cdevi.demo');
    approver = await signIn(app, 'approver1@cdevi.demo');
    payments = (
      await app.pool.query<{ id: string }>(`SELECT id FROM projects WHERE key = 'payments-api'`)
    ).rows[0]!.id;
  });
  afterAll(() => app.close());

  const send = (
    body: unknown,
    headers: Record<string, string> = {},
    target: FastifyInstance = app,
    ip?: string,
  ) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return target.inject({
      method: 'POST',
      url: WEBHOOK,
      payload: raw,
      ...(ip ? { remoteAddress: ip } : {}),
      headers: { 'content-type': 'application/json', 'x-hub-signature': signJira(raw), ...headers },
    });
  };
  const detailByKey = async (key: string): Promise<RequirementDetail> => {
    const id = (
      await app.pool.query<{ id: string }>(
        `SELECT id FROM requirements WHERE source = 'jira' AND external_ref->>'key' = $1`,
        [key],
      )
    ).rows[0]!.id;
    const r = await app.inject(asUser(admin, { method: 'GET', url: `/api/requirements/${id}` }));
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const riskFigure = async () => {
    const r = await app.inject(
      asUser(admin, { method: 'GET', url: `/api/dashboard?project=${payments}&window=30d` }),
    );
    expect(r.statusCode).toBe(200);
    return (r.json() as DashboardSnapshot).risk.auditHighCritical.value;
  };
  /** Creates a Jira requirement, drives it to READY through the runtime and approves it → linked QUEUED workflow. */
  async function approvedJira(key: string) {
    const created = await send(issueEvent({ key, summary: `Issue ${key}` }));
    expect(created.statusCode, created.body).toBe(202);
    const d = await detailByKey(key);
    const engineer = await signIn(app, 'engineer1@cdevi.demo');
    expect(
      (
        await app.inject(
          asUser(engineer, { method: 'POST', url: `/api/requirements/${d.requirement.id}/submit` }),
        )
      ).statusCode,
    ).toBe(200);
    const ingest = await app.inject({
      method: 'PUT',
      url: `/api/ingest/requirements/${d.requirement.externalId}/analysis`,
      headers: { authorization: `Bearer ${SEED_INGEST_TOKEN}`, 'content-type': 'application/json' },
      payload: {
        agent: 'Requirement Agent',
        observedAt: iso(plus(-MIN)),
        acceptanceCriteria: ['Done when retried.'],
        rules: [],
        openQuestions: [],
      },
    });
    expect(ingest.statusCode, ingest.body).toBe(200);
    const approved = await app.inject(
      asUser(approver, { method: 'POST', url: `/api/requirements/${d.requirement.id}/approve` }),
    );
    expect(approved.statusCode, approved.body).toBe(200);
    const detail = approved.json() as RequirementDetail;
    return { requirementId: detail.requirement.id, workflowId: detail.requirement.workflow!.id };
  }
  const workflowRow = async (id: string) =>
    (
      await app.pool.query<{ state: string; state_reason: string | null; stage_index: number }>(
        `SELECT state, state_reason, stage_index FROM workflows WHERE id = $1`,
        [id],
      )
    ).rows[0]!;

  it('FR-008 a signed issue_created for PAY-240 returns 202 created and a DRAFT requirement in payments-api with source jira, external_ref key/url, business objective from an ADF description, assignee resolved by email, external_id req-pay-240', async () => {
    const r = await send(issueEvent());
    expect(r.statusCode, r.body).toBe(202);
    const result = r.json() as JiraWebhookResult;
    expect(result.outcome).toBe('created');
    expect(result.requirementId).toMatch(/^[0-9a-f-]{36}$/);
    const d = await detailByKey('PAY-240');
    expect(d.requirement.id).toBe(result.requirementId);
    expect(d.requirement).toMatchObject({
      externalId: 'req-pay-240',
      state: 'DRAFT',
      source: 'jira',
      title: 'Retry soft declines nightly',
      externalFlag: null,
      externalRef: {
        provider: 'jira',
        key: 'PAY-240',
        url: 'https://jira.example.invalid/browse/PAY-240',
        updatedAt: iso(plus(-5 * MIN)),
      },
    });
    expect(d.requirement.project.key).toBe('payments-api');
    expect(d.requirement.assignee?.name).toBe('Engineer 1');
    expect(d.requirement.createdBy).toBeNull();
    expect(d.businessObjective).toBe(
      'Retry declined renewals once a night for three nights.\n\nSecond paragraph.',
    );
    expect(d.transitions).toEqual([
      expect.objectContaining({ fromState: null, toState: 'DRAFT', actorType: 'system' }),
    ]);
  });

  it('FR-008 issue_updated with a newer updated changes title/objective and returns updated; the same updated returns ignored (stale); an unknown key is treated as created', async () => {
    expect((await send(issueEvent({ key: 'PAY-242' }))).statusCode).toBe(202);
    const updated = await send(
      issueEvent({
        key: 'PAY-242',
        event: 'jira:issue_updated',
        summary: 'Retry soft declines twice nightly',
        description: 'Plain string description.',
        updated: iso(plus(-2 * MIN)),
        assigneeEmail: null,
      }),
    );
    expect(updated.statusCode, updated.body).toBe(202);
    expect(updated.json()).toMatchObject({ outcome: 'updated' });
    const d = await detailByKey('PAY-242');
    expect(d.requirement.title).toBe('Retry soft declines twice nightly');
    expect(d.businessObjective).toBe('Plain string description.');
    expect(d.requirement.externalRef?.updatedAt).toBe(iso(plus(-2 * MIN)));
    expect(d.requirement.state).toBe('DRAFT');
    const same = await send(
      issueEvent({
        key: 'PAY-242',
        event: 'jira:issue_updated',
        summary: 'Would overwrite',
        updated: iso(plus(-2 * MIN)),
      }),
    );
    expect(same.statusCode).toBe(202);
    expect(same.json()).toEqual({ outcome: 'ignored', requirementId: d.requirement.id });
    expect((await detailByKey('PAY-242')).requirement.title).toBe(
      'Retry soft declines twice nightly',
    );
    const unknown = await send(issueEvent({ key: 'PAY-243', event: 'jira:issue_updated' }));
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json()).toMatchObject({ outcome: 'created' });
    expect((await detailByKey('PAY-243')).requirement.externalId).toBe('req-pay-243');
  });

  it('FR-008 a missing, malformed or wrong x-hub-signature returns 401 unauthenticated without body echo; a body whose bytes are re-serialised differently fails (raw-body HMAC)', async () => {
    const body = issueEvent({ key: 'PAY-244', summary: 'SECRET-MARKER-summary' });
    const raw = JSON.stringify(body);
    const cases: Record<string, string | undefined> = {
      missing: undefined,
      malformed: 'sha1=abc',
      'wrong-length': 'sha256=abcd',
      wrong: signJira(raw, 'another-secret'),
    };
    for (const [name, sig] of Object.entries(cases)) {
      const r = await app.inject({
        method: 'POST',
        url: WEBHOOK,
        payload: raw,
        headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature': sig } : {}) },
      });
      expect(r.statusCode, name).toBe(401);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect((r.json() as Problem).type).toBe('urn:cdevi:problem:unauthenticated');
      expect(r.body).not.toContain('SECRET-MARKER');
    }
    // signature over the canonical serialisation, body sent with different whitespace
    const pretty = JSON.stringify(body, null, 2);
    const mismatch = await app.inject({
      method: 'POST',
      url: WEBHOOK,
      payload: pretty,
      headers: { 'content-type': 'application/json', 'x-hub-signature': signJira(raw) },
    });
    expect(mismatch.statusCode).toBe(401);
    const exact = await app.inject({
      method: 'POST',
      url: WEBHOOK,
      payload: pretty,
      headers: { 'content-type': 'application/json', 'x-hub-signature': signJira(pretty) },
    });
    expect(exact.statusCode, exact.body).toBe(202);
    expect(
      (await app.pool.query(`SELECT 1 FROM requirements WHERE external_ref->>'key' = 'PAY-244'`))
        .rowCount,
    ).toBe(1);
  });

  it('FR-008 with jiraWebhookSecret undefined (buildApp option omitted) every call returns 401 and logs one warning', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const unconfigured = await testApp({ logger: { level: 'warn', stream: sink } });
    try {
      for (let i = 0; i < 3; i++) {
        const r = await send(issueEvent({ key: 'PAY-245' }), {}, unconfigured);
        expect(r.statusCode).toBe(401);
        expect((r.json() as Problem).type).toBe('urn:cdevi:problem:unauthenticated');
      }
      const warnings = lines.filter((l) => l.includes('JIRA_WEBHOOK_SECRET'));
      expect(warnings).toHaveLength(1);
      expect(
        (await app.pool.query(`SELECT 1 FROM requirements WHERE external_ref->>'key' = 'PAY-245'`))
          .rowCount,
      ).toBe(0);
    } finally {
      await unconfigured.close();
    }
  });

  it('FR-008 an unmapped project key returns 202 ignored with requirementId null; an unknown webhookEvent returns 202 ignored', async () => {
    const unmapped = await send(issueEvent({ key: 'OPS-1', projectKey: 'OPS' }));
    expect(unmapped.statusCode, unmapped.body).toBe(202);
    expect(unmapped.json()).toEqual({ outcome: 'ignored', requirementId: null });
    const unknown = await send(issueEvent({ key: 'PAY-246', event: 'comment_created' }));
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json()).toEqual({ outcome: 'ignored', requirementId: null });
    expect(
      (
        await app.pool.query(
          `SELECT 1 FROM requirements WHERE external_ref->>'key' IN ('OPS-1','PAY-246')`,
        )
      ).rowCount,
    ).toBe(0);
    const invalid = await send({
      webhookEvent: 'jira:issue_created',
      issue: { key: 'not a key', fields: {} },
    });
    expect(invalid.statusCode).toBe(400);
    expect((invalid.json() as Problem).type).toBe('urn:cdevi:problem:validation');
  });

  it('FR-008 issue_deleted for a requirement whose linked workflow is QUEUED flags deleted, moves the workflow and its current stage to BLOCKED with the Jira reason, a system workflow_transitions row and audit requirement.flagged with risk_level NULL (edge case)', async () => {
    const before = await riskFigure();
    const { requirementId, workflowId } = await approvedJira('PAY-247');
    expect((await workflowRow(workflowId)).state).toBe('QUEUED');
    const r = await send(issueEvent({ key: 'PAY-247', event: 'jira:issue_deleted' }));
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ outcome: 'flagged', requirementId });
    const d = await detailByKey('PAY-247');
    expect(d.requirement.externalFlag).toBe('deleted');
    expect(d.requirement.externalFlaggedAt).toBe(iso(app.now()));
    expect(d.requirement.state).toBe('APPROVED'); // the flag never changes the requirement state
    expect(d.requirement.workflow).toMatchObject({ id: workflowId, state: 'BLOCKED' });
    const reason = 'Jira PAY-247 deleted — human decision required';
    expect(await workflowRow(workflowId)).toMatchObject({
      state: 'BLOCKED',
      state_reason: reason,
      stage_index: 1,
    });
    const stage = await app.pool.query<{ state: string; state_reason: string | null }>(
      `SELECT state, state_reason FROM workflow_stages WHERE workflow_id = $1 AND position = 1`,
      [workflowId],
    );
    expect(stage.rows[0]).toEqual({ state: 'BLOCKED', state_reason: reason });
    expect(
      (
        await app.pool.query(
          `SELECT count(*)::int n FROM workflow_stages WHERE workflow_id = $1 AND state = 'QUEUED'`,
          [workflowId],
        )
      ).rows[0].n,
    ).toBe(6);
    const wt = await app.pool.query<{
      from_state: string;
      to_state: string;
      reason: string;
      principal_id: string | null;
      user_id: string | null;
    }>(
      `SELECT from_state, to_state, reason, principal_id, user_id FROM workflow_transitions WHERE workflow_id = $1 AND to_state = 'BLOCKED'`,
      [workflowId],
    );
    expect(wt.rows).toEqual([
      { from_state: 'QUEUED', to_state: 'BLOCKED', reason, principal_id: null, user_id: null },
    ]);
    const audit = await app.pool.query<{
      risk_level: string | null;
      result: string;
      actor_type: string;
      workflow_id: string;
    }>(
      `SELECT risk_level, result, actor_type, workflow_id FROM audit_events WHERE action = 'requirement.flagged' AND target_id = $1`,
      [requirementId],
    );
    expect(audit.rows).toEqual([
      { risk_level: null, result: 'blocked', actor_type: 'system', workflow_id: workflowId },
    ]);
    expect(d.audit.map((a) => a.action)).toContain('requirement.flagged');
    expect(await riskFigure()).toBe(before);
    // the requirement stays APPROVED: the follow-workflow trigger ignores BLOCKED
    expect(
      (await app.pool.query(`SELECT state FROM requirements WHERE id = $1`, [requirementId]))
        .rows[0].state,
    ).toBe('APPROVED');
  });

  it('FR-008 issue_updated with statusCategory done flags closed the same way; a FAILED or COMPLETED linked workflow is left unchanged but the requirement is still flagged', async () => {
    const closed = await approvedJira('PAY-248');
    const r = await send(
      issueEvent({
        key: 'PAY-248',
        event: 'jira:issue_updated',
        statusCategory: 'done',
        updated: iso(plus(-MIN)),
      }),
    );
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ outcome: 'flagged', requirementId: closed.requirementId });
    expect(await workflowRow(closed.workflowId)).toMatchObject({
      state: 'BLOCKED',
      state_reason: 'Jira PAY-248 closed — human decision required',
    });
    expect((await detailByKey('PAY-248')).requirement.externalFlag).toBe('closed');

    for (const [key, terminal] of [
      ['PAY-249', 'FAILED'],
      ['PAY-250', 'COMPLETED'],
    ] as const) {
      const { requirementId, workflowId } = await approvedJira(key);
      await app.pool.query(
        `UPDATE workflows SET state = $2, state_observed_at = $3, finished_at = $3 WHERE id = $1`,
        [workflowId, terminal, plus(-MIN)],
      );
      const flagged = await send(issueEvent({ key, event: 'jira:issue_deleted' }));
      expect(flagged.statusCode, flagged.body).toBe(202);
      expect(flagged.json()).toEqual({ outcome: 'flagged', requirementId });
      const wf = await workflowRow(workflowId);
      expect(wf.state).toBe(terminal);
      expect(wf.state_reason).toBeNull();
      expect(
        (
          await app.pool.query(
            `SELECT count(*)::int n FROM workflow_transitions WHERE workflow_id = $1 AND to_state = 'BLOCKED'`,
            [workflowId],
          )
        ).rows[0].n,
      ).toBe(0);
      const d = await detailByKey(key);
      expect(d.requirement.externalFlag).toBe('deleted');
      expect(d.audit.map((a) => a.action)).toContain('requirement.flagged');
    }
  });

  it('FR-008 a 300 KB body returns 413 and the 121st call in a minute from one IP returns 429', async () => {
    const big = issueEvent({ key: 'PAY-251', description: 'x'.repeat(300 * 1024) });
    const r = await send(big);
    expect(r.statusCode).toBe(413);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body).not.toContain('xxxxxxxx');
    const limited = await testApp({ jiraWebhookSecret: JIRA_TEST_SECRET });
    try {
      const ip = '203.0.113.77';
      for (let i = 0; i < 120; i++) {
        const ok = await send(issueEvent({ key: 'OPS-9', projectKey: 'OPS' }), {}, limited, ip);
        expect(ok.statusCode, `call ${i + 1}: ${ok.body}`).toBe(202);
      }
      const over = await send(issueEvent({ key: 'OPS-9', projectKey: 'OPS' }), {}, limited, ip);
      expect(over.statusCode).toBe(429);
      expect((over.json() as Problem).type).toBe('urn:cdevi:problem:rate-limited');
      const otherIp = await send(
        issueEvent({ key: 'OPS-9', projectKey: 'OPS' }),
        {},
        limited,
        '203.0.113.78',
      );
      expect(otherIp.statusCode).toBe(202);
    } finally {
      await limited.close();
    }
  });

  it('FR-008 the webhook never returns SQL, stack or the request body in a Problem', async () => {
    const marker = 'NEVER-ECHOED-MARKER';
    const responses = [
      await send(issueEvent({ key: 'PAY-252', summary: marker }), {
        'x-hub-signature': 'sha256=' + '0'.repeat(64),
      }),
      await send({
        webhookEvent: 'jira:issue_created',
        issue: {
          key: 'bad key',
          fields: { summary: marker, project: { key: 'PAY' } },
          extra: marker,
        },
        junk: marker,
      }),
      await send(`{"webhookEvent": "jira:issue_created", "broken": "${marker}"`),
      await send(
        issueEvent({ key: 'PAY-253', summary: marker, description: 'x'.repeat(300 * 1024) }),
      ),
    ];
    for (const r of responses) {
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      const body = r.body;
      expect(body).not.toContain(marker);
      expect(body).not.toMatch(
        /select |insert |update |from requirements|at \w+ \(|node_modules|\.ts:\d+/i,
      );
    }
  });
});
