import type { PullRequestReviewView, ReviewListResponse } from '@cdevi/contracts';
import { EXPECTED_REVIEW_SEED } from '@cdevi/db/seed';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, signIn, skipDb, testApp } from './helpers';
import { reviewFixture } from './review-fixture';

describe.skipIf(skipDb)(
  'GET /api/reviews and /api/reviews/{pullRequestId} (specs/001 US6, FR-020, FR-022, FR-032)',
  () => {
    let app: FastifyInstance;
    let engineer: string;
    let viewer: string;

    beforeAll(async () => {
      app = await testApp();
      engineer = await signIn(app, 'engineer1@cdevi.demo');
      viewer = await signIn(app, 'viewer1@cdevi.demo');
    });
    afterAll(() => app.close());

    const list = async (cookie: string, qs = '') => {
      const r = await app.inject(asUser(cookie, { method: 'GET', url: `/api/reviews${qs}` }));
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as ReviewListResponse;
    };
    const detail = async (cookie: string, id: string) => {
      const r = await app.inject(asUser(cookie, { method: 'GET', url: `/api/reviews/${id}` }));
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as PullRequestReviewView;
    };
    const seededId = async (cookie: string) => {
      const page = await list(cookie);
      const item = page.items.find(
        (i) => i.externalId === EXPECTED_REVIEW_SEED.pullRequest.externalId,
      );
      expect(item).toBeDefined();
      return item!;
    };

    it('FR-020 GET /api/reviews lists visible PRs with latest status', async () => {
      const item = await seededId(engineer);
      expect(item.number).toBe(EXPECTED_REVIEW_SEED.pullRequest.number);
      expect(item.title).toBe(EXPECTED_REVIEW_SEED.pullRequest.title);
      expect(item.project.key).toBe(EXPECTED_REVIEW_SEED.project);
      expect(item.reviewStatus).toBe(EXPECTED_REVIEW_SEED.review.status);
      expect(item.reviewHref).toBe(`/reviews/${item.id}`);
      expect(item.workflow.href).toMatch(/^\/workflows\//);
      const page = await list(engineer);
      expect(page.items.length).toBeLessThanOrEqual(50);
      const ts = page.items.map((i) => new Date(i.updatedAt).getTime());
      for (let k = 1; k < ts.length; k++) expect(ts[k]!).toBeLessThanOrEqual(ts[k - 1]!);
    });

    it('FR-020 GET /api/reviews filters by project and pull-request state', async () => {
      const item = await seededId(engineer);
      const byProject = await list(engineer, `?project=${item.project.id}`);
      expect(byProject.items.every((i) => i.project.id === item.project.id)).toBe(true);
      const merged = await list(engineer, '?state=MERGED');
      expect(merged.items.every((i) => i.status === 'MERGED')).toBe(true);
      expect(merged.items.some((i) => i.id === item.id)).toBe(false);
      const other = await list(engineer, '?project=00000000-0000-4000-8000-000000000000');
      expect(other.items).toEqual([]);
      const bad = await app.inject(
        asUser(engineer, { method: 'GET', url: '/api/reviews?cursor=nope' }),
      );
      expect(bad.statusCode).toBe(400);
      expect(bad.headers['content-type']).toContain('application/problem+json');
      expect((bad.json() as { type: string }).type).toBe('urn:cdevi:problem:invalid-cursor');
    });

    it('FR-020 GET /api/reviews/{id} returns PR, requirement, review status, 7 lanes, findings in position order and cycles', async () => {
      const item = await seededId(engineer);
      const d = await detail(engineer, item.id);
      expect(d.pullRequest.externalId).toBe(EXPECTED_REVIEW_SEED.pullRequest.externalId);
      expect(d.pullRequest.number).toBe(EXPECTED_REVIEW_SEED.pullRequest.number);
      expect(d.workflow.href).toBe(`/workflows/${d.workflow.id}`);
      expect(d.requirement).not.toBeNull();
      expect(d.requirement?.href).toMatch(/^\/requirements\//);
      expect(d.latestReview?.status).toBe(EXPECTED_REVIEW_SEED.review.status);
      expect(d.latestReview?.cycleNumber).toBe(EXPECTED_REVIEW_SEED.review.cycleNumber);
      expect(d.latestReview?.lanes).toHaveLength(7);
      for (const [lane, status] of Object.entries(EXPECTED_REVIEW_SEED.lanes))
        expect(d.latestReview?.lanes.find((l) => l.lane === lane)?.status).toBe(status);
      expect(d.findings.map((f) => f.externalId)).toEqual([...EXPECTED_REVIEW_SEED.findings]);
      expect(d.findings.map((f) => f.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      const byState = d.findings.reduce<Record<string, number>>((acc, f) => {
        acc[f.state] = (acc[f.state] ?? 0) + 1;
        return acc;
      }, {});
      expect(byState).toEqual(EXPECTED_REVIEW_SEED.byState);
      const dismissed = d.findings.find(
        (f) => f.externalId === EXPECTED_REVIEW_SEED.dismissedFinding,
      );
      expect(dismissed?.state).toBe('DISMISSED');
      expect(dismissed?.dismissedReason).toBeTruthy();
      expect(dismissed?.dismissedBy).not.toBeNull();
      const restricted = d.findings.find(
        (f) => f.externalId === EXPECTED_REVIEW_SEED.restrictedEvidenceFinding,
      );
      expect(restricted?.evidence.some((e) => e.accessible === false)).toBe(true);
      expect(d.cycles).toHaveLength(EXPECTED_REVIEW_SEED.cycles);
      expect(d.cycles.map((c) => c.cycleNumber)).toEqual([3, 2, 1]);
      expect(d.cycles[0]).toMatchObject(EXPECTED_REVIEW_SEED.latestCycle);
      expect(d.readyForMerge).toBe(EXPECTED_REVIEW_SEED.readyForMerge);
      expect(d.blockingOpenCount).toBe(EXPECTED_REVIEW_SEED.blockingOpenCount);
    });

    it('FR-022 readyForMerge=false and blockingOpenCount=2 while blocking findings are open', async () => {
      const fx = await reviewFixture(app);
      const d = await detail(engineer, fx.pullRequestId);
      expect(d.blockingOpenCount).toBe(2);
      expect(d.readyForMerge).toBe(false);
      expect(d.findings.map((f) => f.state)).toEqual(['OPEN', 'OPEN', 'OPEN', 'FIXED']);
      const item = (await list(engineer)).items.find((i) => i.id === fx.pullRequestId);
      expect(item?.blockingOpenCount).toBe(2);
      expect(item?.openFindingsCount).toBe(3);
      expect(item?.readyForMerge).toBe(false);
    });

    it('FR-032 viewer reads the same review as the engineer', async () => {
      const item = await seededId(engineer);
      expect(await detail(viewer, item.id)).toEqual(await detail(engineer, item.id));
    });

    it('FR-032 PR in invisible project → 404', async () => {
      const fx = await reviewFixture(app, { projectKey: 'storefront' });
      const r = await app.inject(
        asUser(engineer, { method: 'GET', url: `/api/reviews/${fx.pullRequestId}` }),
      );
      expect(r.statusCode).toBe(404);
      expect(r.headers['content-type']).toContain('application/problem+json');
      const unknown = await app.inject(
        asUser(engineer, {
          method: 'GET',
          url: '/api/reviews/00000000-0000-4000-8000-0000000000aa',
        }),
      );
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json()).toEqual(r.json());
      expect((await list(engineer)).items.some((i) => i.id === fx.pullRequestId)).toBe(false);
    });

    it('401 without session', async () => {
      for (const url of ['/api/reviews', '/api/reviews/00000000-0000-4000-8000-0000000000aa']) {
        const r = await app.inject({ method: 'GET', url });
        expect(r.statusCode, url).toBe(401);
        expect(r.headers['content-type']).toContain('application/problem+json');
      }
    });
  },
);
