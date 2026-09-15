import type { FindingActionResult, Problem, PullRequestReviewView } from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, asUser, iso, MIN, plus, signIn, skipDb, testApp } from './helpers';
import {
  REVIEW_STAGE_POSITION,
  finding,
  lanes,
  reviewFixture,
  type ReviewFixture,
} from './review-fixture';

type Action = 'dismiss' | 'fix' | 'issue';

describe.skipIf(skipDb)(
  'POST /api/reviews/{pullRequestId}/findings/{findingId}/dismiss|fix|issue (specs/001 US6, FR-021, FR-022, FR-032, FR-034)',
  () => {
    let app: FastifyInstance;
    let engineer: string;
    let approver: string;
    let viewer: string;
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });

    beforeAll(async () => {
      app = await testApp();
      engineer = await signIn(app, 'engineer1@cdevi.demo');
      approver = await signIn(app, 'approver1@cdevi.demo');
      viewer = await signIn(app, 'viewer1@cdevi.demo');
    });
    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    const detail = async (cookie: string, id: string) => {
      const r = await app.inject(asUser(cookie, { method: 'GET', url: `/api/reviews/${id}` }));
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as PullRequestReviewView;
    };
    const act = (
      cookie: string,
      fx: ReviewFixture,
      findingId: string,
      action: Action,
      payload: Record<string, unknown> = {},
    ) =>
      app.inject(
        asUser(cookie, {
          method: 'POST',
          url: `/api/reviews/${fx.pullRequestId}/findings/${findingId}/${action}`,
          payload,
        }),
      );
    const findingId = async (cookie: string, fx: ReviewFixture, index: number) => {
      const d = await detail(cookie, fx.pullRequestId);
      return d.findings.find((f) => f.externalId === fx.findingExternalIds[index])!.id;
    };
    const inboxRows = async (workflowId: string) =>
      Number(
        (
          await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM inbox_change_log WHERE workflow_id = $1`,
            [workflowId],
          )
        ).rows[0]!.n,
      );
    const auditRows = async (findingId: string) =>
      (
        await pool.query<{
          action: string;
          actor_id: string | null;
          actor_type: string;
          details: Record<string, unknown>;
        }>(
          `SELECT action, actor_id, actor_type, details FROM audit_events WHERE target_type = 'review_finding' AND target_id = $1 ORDER BY occurred_at`,
          [findingId],
        )
      ).rows;
    const reviewStage = async (workflowId: string) =>
      (
        await pool.query<{ state: string }>(
          `SELECT state FROM workflow_stages WHERE workflow_id = $1 AND position = $2`,
          [workflowId, REVIEW_STAGE_POSITION],
        )
      ).rows[0]!.state;

    it('FR-021 dismiss requires a reason (400 when missing)', async () => {
      const fx = await reviewFixture(app);
      const id = await findingId(engineer, fx, 0);
      const r = await act(engineer, fx, id, 'dismiss', {});
      expect(r.statusCode).toBe(400);
      expect(r.headers['content-type']).toContain('application/problem+json');
      const extra = await act(engineer, fx, id, 'dismiss', { reason: 'x', reasoning: 'why' });
      expect(extra.statusCode).toBe(400);
      for (const [action, payload] of [
        ['dismiss', { reason: 'x'.repeat(241) }],
        ['fix', { reason: 'not allowed here' }],
        ['issue', { reasoning: 'nope' }],
      ] as const) {
        const bad = await act(engineer, fx, id, action, payload);
        expect(bad.statusCode, action).toBe(400);
        expect(bad.headers['content-type']).toContain('application/problem+json');
      }
      expect((await detail(engineer, fx.pullRequestId)).findings[0]?.state).toBe('OPEN');
    });

    it('FR-021 dismiss → DISMISSED + audit row + one inbox_change_log row', async () => {
      const fx = await reviewFixture(app);
      const id = await findingId(engineer, fx, 2);
      const before = await inboxRows(fx.workflowId);
      const r = await act(engineer, fx, id, 'dismiss', {
        reason: 'False positive: guarded upstream.',
      });
      expect(r.statusCode, r.body).toBe(200);
      const body = r.json() as FindingActionResult;
      expect(body.finding.state).toBe('DISMISSED');
      expect(body.finding.dismissedReason).toBe('False positive: guarded upstream.');
      expect(body.finding.dismissedBy?.displayName).toBeTruthy();
      expect(body.finding.dismissedAt).not.toBeNull();
      expect(body.cycle).toBeUndefined();
      expect(body.blockingOpenCount).toBe(2);
      expect(body.readyForMerge).toBe(false);
      expect(await inboxRows(fx.workflowId)).toBe(before + 1);
      const audit = await auditRows(id);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('finding.dismissed');
      expect(audit[0]!.actor_type).toBe('user');
      expect(audit[0]!.actor_id).not.toBeNull();
      expect(audit[0]!.details).toMatchObject({ reason: 'False positive: guarded upstream.' });
      const d = await detail(engineer, fx.pullRequestId);
      expect(d.findings.find((f) => f.id === id)?.state).toBe('DISMISSED');
    });

    it('FR-021 second dismiss → 409 with recorded outcome', async () => {
      const fx = await reviewFixture(app);
      const id = await findingId(engineer, fx, 1);
      expect(
        (await act(engineer, fx, id, 'dismiss', { reason: 'Covered by tests.' })).statusCode,
      ).toBe(200);
      const again = await act(approver, fx, id, 'dismiss', { reason: 'Again.' });
      expect(again.statusCode).toBe(409);
      expect(again.headers['content-type']).toContain('application/problem+json');
      const p = again.json() as Problem & { state: string; dismissedReason?: string };
      expect(p.state).toBe('DISMISSED');
      expect(p.dismissedReason).toBe('Covered by tests.');
      expect((await act(approver, fx, id, 'fix')).statusCode).toBe(409);
      expect((await act(approver, fx, id, 'issue')).statusCode).toBe(409);
      expect(await auditRows(id)).toHaveLength(1);
    });

    it('FR-021 fix → RUNNING review cycle iteration n+1, finding FIX_REQUESTED, Review stage RUNNING, audit row', async () => {
      const fx = await reviewFixture(app);
      expect(await reviewStage(fx.workflowId)).toBe('WAITING_FOR_HUMAN');
      const id = await findingId(engineer, fx, 0);
      const before = await inboxRows(fx.workflowId);
      const r = await act(engineer, fx, id, 'fix');
      expect(r.statusCode, r.body).toBe(200);
      const body = r.json() as FindingActionResult;
      expect(body.finding.state).toBe('FIX_REQUESTED');
      expect(body.cycle).toBeDefined();
      expect(body.finding.fixCycleId).toBe(body.cycle!.id);
      expect(body.cycle).toMatchObject({
        cycleNumber: 1,
        iteration: 1,
        state: 'RUNNING',
        findingsCount: 3,
        fixedCount: 0,
        remainingCount: 3,
        finishedAt: null,
      });
      expect(body.cycle!.requestedBy?.displayName).toBeTruthy();
      expect(body.blockingOpenCount).toBe(2);
      expect(body.readyForMerge).toBe(false);
      expect(await reviewStage(fx.workflowId)).toBe('RUNNING');
      // one row from the 0007 review trigger (finding + cycle deduplicated) plus the 0002 stage trigger
      const after = await inboxRows(fx.workflowId);
      expect(after).toBeGreaterThanOrEqual(before + 1);
      expect(after).toBeLessThanOrEqual(before + 3);
      const audit = await auditRows(id);
      expect(audit.map((a) => a.action)).toEqual(['finding.fix_requested']);
      const d = await detail(engineer, fx.pullRequestId);
      expect(d.cycles).toHaveLength(1);
      expect(d.cycles[0]!.id).toBe(body.cycle!.id);
      // 409 carries the recorded outcome
      const again = await act(engineer, fx, id, 'fix');
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ state: 'FIX_REQUESTED', fixCycleId: body.cycle!.id });
    });

    it('FR-021 second fix on the same PR attaches to the running cycle', async () => {
      const fx = await reviewFixture(app);
      const first = await act(engineer, fx, await findingId(engineer, fx, 0), 'fix');
      expect(first.statusCode, first.body).toBe(200);
      const second = await act(approver, fx, await findingId(approver, fx, 1), 'fix');
      expect(second.statusCode, second.body).toBe(200);
      const a = first.json() as FindingActionResult;
      const b = second.json() as FindingActionResult;
      expect(b.cycle!.id).toBe(a.cycle!.id);
      expect(b.finding.fixCycleId).toBe(a.cycle!.id);
      expect(b.cycle!.iteration).toBe(1);
      expect((await detail(engineer, fx.pullRequestId)).cycles).toHaveLength(1);
    });

    it('FR-021 fix after a finished cycle opens cycle n+1 with iteration n+1', async () => {
      const fx = await reviewFixture(app);
      const id = await findingId(engineer, fx, 0);
      const r = await act(engineer, fx, id, 'fix');
      expect(r.statusCode, r.body).toBe(200);
      await pool.query(
        `UPDATE review_cycles SET state = 'COMPLETED', finished_at = now() WHERE pull_request_id = $1`,
        [fx.pullRequestId],
      );
      const r2 = await act(engineer, fx, await findingId(engineer, fx, 1), 'fix');
      expect(r2.statusCode, r2.body).toBe(200);
      const body = r2.json() as FindingActionResult;
      expect(body.cycle).toMatchObject({ cycleNumber: 2, iteration: 2, state: 'RUNNING' });
      expect(body.cycle!.findingsCount).toBe(3);
    });

    it('FR-021 issue → ISSUE_REQUESTED + audit row', async () => {
      const fx = await reviewFixture(app);
      const id = await findingId(engineer, fx, 2);
      const before = await inboxRows(fx.workflowId);
      const r = await act(engineer, fx, id, 'issue');
      expect(r.statusCode, r.body).toBe(200);
      const body = r.json() as FindingActionResult;
      expect(body.finding.state).toBe('ISSUE_REQUESTED');
      expect(body.finding.issueRequestedAt).not.toBeNull();
      expect(body.cycle).toBeUndefined();
      expect(await inboxRows(fx.workflowId)).toBe(before + 1);
      const audit = await auditRows(id);
      expect(audit.map((a) => a.action)).toEqual(['finding.issue_requested']);
      expect(Object.keys(audit[0]!.details)).not.toContain('reason');
      expect((await act(engineer, fx, id, 'issue')).statusCode).toBe(409);
    });

    it('FR-022 dismissing the last blocking finding makes the PR ready for merge', async () => {
      const fx = await reviewFixture(app);
      const a = await act(engineer, fx, await findingId(engineer, fx, 0), 'dismiss', {
        reason: 'Handled.',
      });
      expect((a.json() as FindingActionResult).blockingOpenCount).toBe(1);
      const b = await act(engineer, fx, await findingId(engineer, fx, 1), 'dismiss', {
        reason: 'Handled too.',
      });
      const body = b.json() as FindingActionResult;
      expect(body.blockingOpenCount).toBe(0);
      expect(body.readyForMerge).toBe(true);
      const d = await detail(engineer, fx.pullRequestId);
      expect(d.readyForMerge).toBe(true);
      expect(d.blockingOpenCount).toBe(0);
    });

    it('FR-032 viewer → 403 on all three actions', async () => {
      const fx = await reviewFixture(app);
      const id = await findingId(viewer, fx, 0);
      for (const action of ['dismiss', 'fix', 'issue'] as const) {
        const r = await act(viewer, fx, id, action, action === 'dismiss' ? { reason: 'no' } : {});
        expect(r.statusCode, action).toBe(403);
        expect(r.headers['content-type']).toContain('application/problem+json');
      }
      expect((await detail(viewer, fx.pullRequestId)).findings[0]?.state).toBe('OPEN');
      expect(await auditRows(id)).toHaveLength(0);
    });

    it('FR-032 PR in invisible project → 404', async () => {
      const fx = await reviewFixture(app, { projectKey: 'storefront' });
      const admin = await signIn(app, 'admin@cdevi.demo');
      const id = await findingId(admin, fx, 0);
      for (const action of ['dismiss', 'fix', 'issue'] as const) {
        const r = await act(engineer, fx, id, action, action === 'dismiss' ? { reason: 'no' } : {});
        expect(r.statusCode, action).toBe(404);
        expect(r.headers['content-type']).toContain('application/problem+json');
      }
      const visible = await reviewFixture(app);
      const wrongPr = await act(engineer, visible, id, 'issue');
      expect(wrongPr.statusCode).toBe(404);
    });

    it('FR-021 a finding dropped by a newer review is no longer actionable (404)', async () => {
      const fx = await reviewFixture(app);
      const stale = await findingId(engineer, fx, 0);
      const p = fx.pullRequestExternalId;
      const r = await app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/pull-requests/${p}/reviews/2`,
          payload: {
            externalId: `${p}-rev-2`,
            status: 'COMPLETE',
            lanes: lanes({ security: 'FAIL' }),
            findings: [finding(1, { externalId: `${p}-f2` })],
            startedAt: iso(plus(-25 * MIN)),
            finishedAt: iso(plus(-21 * MIN)),
            observedAt: iso(plus(-20 * MIN)),
          },
        }),
      );
      expect(r.statusCode, r.body).toBe(200);
      for (const action of ['dismiss', 'fix', 'issue'] as const) {
        const gone = await act(
          engineer,
          fx,
          stale,
          action,
          action === 'dismiss' ? { reason: 'no' } : {},
        );
        expect(gone.statusCode, action).toBe(404);
      }
      expect(await auditRows(stale)).toEqual([]);
      const current = await findingId(engineer, fx, 1);
      expect(current).not.toBe(stale);
      const ok = await act(engineer, fx, current, 'issue');
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it('401 without session', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/reviews/00000000-0000-4000-8000-0000000000aa/findings/00000000-0000-4000-8000-0000000000ab/fix',
        payload: {},
      });
      expect(r.statusCode).toBe(401);
      expect(r.headers['content-type']).toContain('application/problem+json');
    });
  },
);
