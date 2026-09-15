import type { FindingActionResult, IngestResult, PullRequestReviewView } from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, asUser, iso, MIN, plus, signIn, skipDb, testApp, uniq } from './helpers';
import {
  defaultFindings,
  finding,
  lanes,
  REVIEW_STAGE_POSITION,
  reviewFixture,
} from './review-fixture';

describe.skipIf(skipDb)(
  'PUT /api/ingest/pull-requests/{externalId}[/reviews/{cycle}|/cycles/{cycle}] (specs/001 US6, FR-018, FR-034, FR-036)',
  () => {
    let app: FastifyInstance;
    let engineer: string;
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });

    beforeAll(async () => {
      app = await testApp();
      engineer = await signIn(app, 'engineer1@cdevi.demo');
    });
    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    const put = (url: string, payload: unknown, token?: string) =>
      app.inject(
        asIngest({ method: 'PUT', url, payload: payload as Record<string, unknown> }, token),
      );
    const detail = async (id: string) => {
      const r = await app.inject(asUser(engineer, { method: 'GET', url: `/api/reviews/${id}` }));
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as PullRequestReviewView;
    };
    const reviewBody = (
      findings: unknown[],
      observedAt: string,
      over: Record<string, unknown> = {},
    ) => ({
      status: 'COMPLETE',
      lanes: lanes({ security: 'FAIL' }),
      findings,
      startedAt: iso(plus(-25 * MIN)),
      finishedAt: iso(plus(-21 * MIN)),
      observedAt,
      ...over,
    });
    const cycleBody = (over: Record<string, unknown> = {}) => ({
      findingsCount: 3,
      fixedCount: 3,
      remainingCount: 0,
      iteration: 1,
      maxIterations: 5,
      state: 'COMPLETED',
      startedAt: iso(plus(-20 * MIN)),
      finishedAt: iso(plus(-15 * MIN)),
      observedAt: iso(plus(-15 * MIN)),
      ...over,
    });
    const inboxRows = async (workflowId: string) =>
      Number(
        (
          await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM inbox_change_log WHERE workflow_id = $1`,
            [workflowId],
          )
        ).rows[0]!.n,
      );
    const ingestionLogRows = async (route: string, target: string) =>
      (
        await pool.query<{ outcome: string }>(
          `SELECT outcome FROM ingestion_log WHERE route = $1 AND target_external_id = $2 ORDER BY received_at`,
          [route, target],
        )
      ).rows.map((r) => r.outcome);
    const reviewStage = async (workflowId: string) =>
      (
        await pool.query<{ state: string }>(
          `SELECT state FROM workflow_stages WHERE workflow_id = $1 AND position = $2`,
          [workflowId, REVIEW_STAGE_POSITION],
        )
      ).rows[0]!.state;
    const auditCount = async (workflowId: string) =>
      Number(
        (
          await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_events WHERE workflow_id = $1`,
            [workflowId],
          )
        ).rows[0]!.n,
      );

    it('FR-036 pull-request ingest upserts by external id, resolves the workflow and requirement, 404 for an unknown workflow', async () => {
      const fx = await reviewFixture(app, { withReview: false });
      const d = await detail(fx.pullRequestId);
      expect(d.pullRequest.externalId).toBe(fx.pullRequestExternalId);
      expect(d.latestReview).toBeNull();
      expect(d.findings).toEqual([]);
      expect(d.readyForMerge).toBe(true);
      expect(d.workflow.id).toBe(fx.workflowId);
      const again = await put(`/api/ingest/pull-requests/${fx.pullRequestExternalId}`, {
        number: 4242,
        title: 'Renamed pull request',
        href: 'https://git.cdevi.demo/payments-api/pull/4242',
        status: 'MERGED',
        workflowExternalId: fx.workflowExternalId,
        requirementExternalId: 'req-seed-001',
        observedAt: iso(plus(-20 * MIN)),
      });
      expect(again.statusCode, again.body).toBe(200);
      expect((again.json() as IngestResult).outcome).toBe('accepted');
      expect((again.json() as IngestResult).id).toBe(fx.pullRequestId);
      const d2 = await detail(fx.pullRequestId);
      expect(d2.pullRequest).toMatchObject({
        number: 4242,
        title: 'Renamed pull request',
        status: 'MERGED',
      });
      expect(d2.requirement?.title).toBeTruthy();
      const unknown = await put(`/api/ingest/pull-requests/${uniq('us6-orphan')}`, {
        number: 1,
        title: 'Orphan',
        href: 'https://git.cdevi.demo/payments-api/pull/1',
        status: 'OPEN',
        workflowExternalId: uniq('no-such-workflow'),
        observedAt: iso(plus(-20 * MIN)),
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.headers['content-type']).toContain('application/problem+json');
      expect(await auditCount(fx.workflowId)).toBe(0);
    });

    it('FR-036 review ingest replaces findings but preserves DISMISSED state', async () => {
      const fx = await reviewFixture(app);
      const before = await detail(fx.pullRequestId);
      const dismissTarget = before.findings.find((f) => f.externalId === fx.findingExternalIds[1])!;
      const issueTarget = before.findings.find((f) => f.externalId === fx.findingExternalIds[2])!;
      const dismiss = await app.inject(
        asUser(engineer, {
          method: 'POST',
          url: `/api/reviews/${fx.pullRequestId}/findings/${dismissTarget.id}/dismiss`,
          payload: { reason: 'Known and accepted.' },
        }),
      );
      expect(dismiss.statusCode, dismiss.body).toBe(200);
      const issue = await app.inject(
        asUser(engineer, {
          method: 'POST',
          url: `/api/reviews/${fx.pullRequestId}/findings/${issueTarget.id}/issue`,
          payload: {},
        }),
      );
      expect(issue.statusCode, issue.body).toBe(200);
      const inboxBefore = await inboxRows(fx.workflowId);
      const auditBefore = await auditCount(fx.workflowId);

      const p = fx.pullRequestExternalId;
      const replaced = [
        finding(1, { externalId: `${p}-f2`, title: 'Re-reported blocking finding' }),
        finding(2, { externalId: `${p}-f3`, blocking: 'NON_BLOCKING' }),
        finding(3, { externalId: `${p}-f5`, lane: 'testing', blocking: 'NON_BLOCKING' }),
      ];
      const r = await put(
        `/api/ingest/pull-requests/${p}/reviews/1`,
        reviewBody(replaced, iso(plus(-20 * MIN)), { lanes: lanes({ testing: 'WARN' }) }),
      );
      expect(r.statusCode, r.body).toBe(200);
      expect((r.json() as IngestResult).outcome).toBe('accepted');
      const after = await detail(fx.pullRequestId);
      expect(after.findings.map((f) => f.externalId)).toEqual([`${p}-f2`, `${p}-f3`, `${p}-f5`]);
      expect(after.findings.map((f) => f.state)).toEqual(['DISMISSED', 'ISSUE_REQUESTED', 'OPEN']);
      const kept = after.findings[0]!;
      expect(kept.title).toBe('Re-reported blocking finding');
      expect(kept.dismissedReason).toBe('Known and accepted.');
      expect(kept.dismissedBy?.id).toBe(dismissTarget.dismissedBy?.id ?? kept.dismissedBy?.id);
      expect(kept.dismissedAt).not.toBeNull();
      expect(after.findings[1]!.issueRequestedAt).not.toBeNull();
      expect(after.latestReview?.lanes.find((l) => l.lane === 'testing')?.status).toBe('WARN');
      expect(after.blockingOpenCount).toBe(0);
      expect(after.readyForMerge).toBe(true);
      expect(await inboxRows(fx.workflowId)).toBe(inboxBefore + 1);
      expect(await auditCount(fx.workflowId)).toBe(auditBefore);
      expect(
        await ingestionLogRows('PUT /ingest/pull-requests/{externalId}/reviews/{cycle}', p),
      ).toEqual(['accepted', 'accepted']);
    });

    it('FR-036 review ingest flips FIX_REQUESTED to FIXED when the runtime reports it and deletes absent findings', async () => {
      const fx = await reviewFixture(app);
      const d = await detail(fx.pullRequestId);
      const fixOn = async (index: number) => {
        const target = d.findings.find((f) => f.externalId === fx.findingExternalIds[index])!;
        const fix = await app.inject(
          asUser(engineer, {
            method: 'POST',
            url: `/api/reviews/${fx.pullRequestId}/findings/${target.id}/fix`,
            payload: {},
          }),
        );
        expect(fix.statusCode, fix.body).toBe(200);
        return (fix.json() as FindingActionResult).cycle!.id;
      };
      const cycleId = await fixOn(0);
      expect(await fixOn(1)).toBe(cycleId);
      const p = fx.pullRequestExternalId;
      const reported = [
        finding(1, { externalId: `${p}-f1`, state: 'FIXED' }),
        finding(2, { externalId: `${p}-f2` }),
        finding(3, { externalId: `${p}-f9`, blocking: 'SUGGESTION' }),
      ];
      const r = await put(
        `/api/ingest/pull-requests/${p}/reviews/2`,
        reviewBody(reported, iso(plus(-19 * MIN))),
      );
      expect(r.statusCode, r.body).toBe(200);
      const after = await detail(fx.pullRequestId);
      expect(after.latestReview?.cycleNumber).toBe(2);
      expect(after.findings.map((f) => [f.externalId, f.state])).toEqual([
        [`${p}-f1`, 'FIXED'],
        [`${p}-f2`, 'FIX_REQUESTED'],
        [`${p}-f9`, 'OPEN'],
      ]);
      expect(after.findings[0]!.fixCycleId).toBe(cycleId);
      expect(after.findings[1]!.fixCycleId).toBe(cycleId);
      expect(after.cycles).toHaveLength(1);
      expect(after.cycles[0]!.state).toBe('RUNNING');
      expect(after.blockingOpenCount).toBe(1);
      expect(await auditCount(fx.workflowId)).toBe(2);
    });

    it('FR-036 empty replacement still notifies exactly once', async () => {
      const fx = await reviewFixture(app);
      const before = await inboxRows(fx.workflowId);
      const r = await put(
        `/api/ingest/pull-requests/${fx.pullRequestExternalId}/reviews/1`,
        reviewBody([], iso(plus(-20 * MIN))),
      );
      expect(r.statusCode, r.body).toBe(200);
      expect((await detail(fx.pullRequestId)).findings).toEqual([]);
      expect(await inboxRows(fx.workflowId)).toBe(before + 1);
    });

    it('FR-036 stale observedAt → stale, no writes', async () => {
      const fx = await reviewFixture(app);
      const before = await detail(fx.pullRequestId);
      const inboxBefore = await inboxRows(fx.workflowId);
      const p = fx.pullRequestExternalId;
      const stale = await put(
        `/api/ingest/pull-requests/${p}/reviews/1`,
        reviewBody([finding(1, { externalId: `${p}-old` })], iso(plus(-45 * MIN))),
      );
      expect(stale.statusCode, stale.body).toBe(200);
      expect((stale.json() as IngestResult).outcome).toBe('stale');
      const stalePr = await put(`/api/ingest/pull-requests/${p}`, {
        number: 1,
        title: 'Stale title',
        href: 'https://git.cdevi.demo/payments-api/pull/1',
        status: 'CLOSED',
        workflowExternalId: fx.workflowExternalId,
        observedAt: iso(plus(-50 * MIN)),
      });
      expect((stalePr.json() as IngestResult).outcome).toBe('stale');
      expect(await detail(fx.pullRequestId)).toEqual(before);
      expect(await inboxRows(fx.workflowId)).toBe(inboxBefore);
      expect(
        await ingestionLogRows('PUT /ingest/pull-requests/{externalId}/reviews/{cycle}', p),
      ).toEqual(['accepted', 'stale']);
      expect(await ingestionLogRows('PUT /ingest/pull-requests/{externalId}', p)).toEqual([
        'accepted',
        'stale',
      ]);
    });

    it('FR-018 unknown reasoning key → 400', async () => {
      const fx = await reviewFixture(app);
      const p = fx.pullRequestExternalId;
      const findings = defaultFindings(p);
      const body = reviewBody(findings, iso(plus(-20 * MIN)));
      for (const [url, payload] of [
        [`/api/ingest/pull-requests/${p}/reviews/1`, { ...body, reasoning: 'because' }],
        [
          `/api/ingest/pull-requests/${p}/reviews/1`,
          { ...body, findings: [{ ...findings[0]!, chainOfThought: 'x' }] },
        ],
        [`/api/ingest/pull-requests/${p}/reviews/1`, { ...body, lanes: body.lanes.slice(0, 6) }],
        [`/api/ingest/pull-requests/${p}/cycles/1`, { ...cycleBody(), reasoning: 'because' }],
        [
          `/api/ingest/pull-requests/${p}`,
          {
            number: 1,
            title: 't',
            href: 'https://x.test/1',
            status: 'OPEN',
            workflowExternalId: fx.workflowExternalId,
            observedAt: iso(plus(0)),
            reasoning: 'x',
          },
        ],
      ] as const) {
        const r = await put(url, payload);
        expect(r.statusCode, `${url} ${JSON.stringify(Object.keys(payload))}`).toBe(400);
        expect(r.headers['content-type']).toContain('application/problem+json');
      }
      const tooMany = await put(
        `/api/ingest/pull-requests/${p}/reviews/1`,
        reviewBody(
          Array.from({ length: 51 }, (_, i) => finding(i + 1, { externalId: `${p}-many-${i}` })),
          iso(plus(-20 * MIN)),
        ),
      );
      expect(tooMany.statusCode).toBe(400);
      const unauthorised = await put(
        `/api/ingest/pull-requests/${p}/cycles/1`,
        cycleBody(),
        'not-a-token',
      );
      expect(unauthorised.statusCode).toBe(401);
    });

    it('FR-036 cycle ingest COMPLETED syncs Review stage', async () => {
      const fx = await reviewFixture(app, { reviewStageState: 'RUNNING' });
      const p = fx.pullRequestExternalId;
      const inboxBefore = await inboxRows(fx.workflowId);
      const running = await put(`/api/ingest/pull-requests/${p}/cycles/1`, {
        ...cycleBody({
          state: 'RUNNING',
          fixedCount: 1,
          remainingCount: 2,
          observedAt: iso(plus(-18 * MIN)),
        }),
        finishedAt: undefined,
      });
      expect(running.statusCode, running.body).toBe(200);
      expect((running.json() as IngestResult).outcome).toBe('accepted');
      expect(await reviewStage(fx.workflowId)).toBe('RUNNING');
      const d1 = await detail(fx.pullRequestId);
      expect(d1.cycles).toHaveLength(1);
      expect(d1.cycles[0]).toMatchObject({
        cycleNumber: 1,
        iteration: 1,
        maxIterations: 5,
        state: 'RUNNING',
        findingsCount: 3,
        fixedCount: 1,
        remainingCount: 2,
        requestedBy: null,
      });
      expect(d1.cycles[0]!.requestedByAgent).toBeTruthy();

      const completed = await put(`/api/ingest/pull-requests/${p}/cycles/1`, cycleBody());
      expect(completed.statusCode, completed.body).toBe(200);
      expect(await reviewStage(fx.workflowId)).toBe('COMPLETED');
      const d2 = await detail(fx.pullRequestId);
      expect(d2.cycles[0]).toMatchObject({ state: 'COMPLETED', fixedCount: 3, remainingCount: 0 });
      expect(d2.cycles[0]!.finishedAt).not.toBeNull();
      expect(await inboxRows(fx.workflowId)).toBeGreaterThan(inboxBefore);
      expect(await auditCount(fx.workflowId)).toBe(0);
      expect(
        await ingestionLogRows('PUT /ingest/pull-requests/{externalId}/cycles/{cycle}', p),
      ).toEqual(['accepted', 'accepted']);

      const stale = await put(
        `/api/ingest/pull-requests/${p}/cycles/1`,
        cycleBody({ state: 'FAILED', observedAt: iso(plus(-30 * MIN)) }),
      );
      expect((stale.json() as IngestResult).outcome).toBe('stale');
      expect(await reviewStage(fx.workflowId)).toBe('COMPLETED');
    });

    it('FR-036 cycle ingest FAILED fails the Review stage, CANCELLED leaves it alone', async () => {
      const failed = await reviewFixture(app, { reviewStageState: 'RUNNING' });
      const f = await put(
        `/api/ingest/pull-requests/${failed.pullRequestExternalId}/cycles/1`,
        cycleBody({ state: 'FAILED', fixedCount: 0, remainingCount: 3 }),
      );
      expect(f.statusCode, f.body).toBe(200);
      expect(await reviewStage(failed.workflowId)).toBe('FAILED');

      const cancelled = await reviewFixture(app, { reviewStageState: 'RUNNING' });
      const c = await put(
        `/api/ingest/pull-requests/${cancelled.pullRequestExternalId}/cycles/1`,
        cycleBody({ state: 'CANCELLED', fixedCount: 0, remainingCount: 3 }),
      );
      expect(c.statusCode, c.body).toBe(200);
      expect(await reviewStage(cancelled.workflowId)).toBe('RUNNING');

      const unknown = await put(
        `/api/ingest/pull-requests/${uniq('us6-nope')}/cycles/1`,
        cycleBody(),
      );
      expect(unknown.statusCode).toBe(404);
    });

    it('FR-036 a COMPLETE review does not touch a RUNNING cycle; the cycles route owns it', async () => {
      const fx = await reviewFixture(app);
      const d = await detail(fx.pullRequestId);
      const target = d.findings.find((f) => f.externalId === fx.findingExternalIds[0])!;
      const fix = await app.inject(
        asUser(engineer, {
          method: 'POST',
          url: `/api/reviews/${fx.pullRequestId}/findings/${target.id}/fix`,
          payload: {},
        }),
      );
      expect(fix.statusCode, fix.body).toBe(200);
      const p = fx.pullRequestExternalId;
      const r = await put(
        `/api/ingest/pull-requests/${p}/reviews/2`,
        reviewBody([finding(1, { externalId: `${p}-f1`, state: 'FIXED' })], iso(plus(-19 * MIN))),
      );
      expect(r.statusCode, r.body).toBe(200);
      const after = await detail(fx.pullRequestId);
      expect(after.cycles).toHaveLength(1);
      expect(after.cycles[0]).toMatchObject({ state: 'RUNNING', fixedCount: 0 });
    });
  },
);
