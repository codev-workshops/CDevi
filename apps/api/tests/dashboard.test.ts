import type { DashboardSnapshot, Me } from '@cdevi/contracts';
import { ACTIVE_CARD_LIMIT, dashboardHrefs, SDLC_STAGES } from '@cdevi/contracts/dashboard-model';
import { DASHBOARD_FIGURES, DASHBOARD_PROJECT } from '@cdevi/db/seed';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asIngest,
  asUser,
  DAY,
  FIXED_NOW,
  iso,
  MIN,
  plus,
  seedSc007Org,
  signIn,
  skipDb,
  testApp,
} from './helpers';

const ZERO_PROJECT = '00000000-0000-4000-8000-000000000000';

describe.skipIf(skipDb)(
  'Dashboard API (specs/001 US3, FR-023/FR-025/FR-026/FR-034, SC-007)',
  () => {
    let app: FastifyInstance;
    let admin: string;
    let viewer: string;
    let demo: string;

    beforeAll(async () => {
      app = await testApp();
      admin = await signIn(app, 'admin@cdevi.demo');
      viewer = await signIn(app, 'viewer1@cdevi.demo');
      demo = (
        await app.pool.query<{ id: string }>(`SELECT id FROM projects WHERE key = $1`, [
          DASHBOARD_PROJECT.key,
        ])
      ).rows[0]!.id;
    });
    afterAll(() => app.close());

    const get = (cookie: string, q = '') =>
      app.inject(asUser(cookie, { method: 'GET', url: `/api/dashboard${q}` }));
    const snapshot = async (cookie: string, q = ''): Promise<DashboardSnapshot> => {
      const r = await get(cookie, q);
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };
    const me = async (cookie: string): Promise<Me> =>
      (await app.inject(asUser(cookie, { method: 'GET', url: '/api/auth/me' }))).json();
    const values = (s: DashboardSnapshot) => ({
      counts: Object.fromEntries(Object.entries(s.counts).map(([k, f]) => [k, f.value])),
      pipeline: s.pipeline.stages.map((st) => st.count),
      unstaged: s.pipeline.unstaged.value,
      needsMe: Object.fromEntries(Object.entries(s.needsMe).map(([k, f]) => [k, f.value])),
      health: Object.fromEntries(
        Object.entries(s.health).map(([k, r]) => [k, [r.numerator, r.denominator]]),
      ),
      risk: [s.risk.pendingHighCritical.value, s.risk.auditHighCritical.value],
      cards: s.activeWorkflows.length,
      total: s.activeWorkflowsTotal,
    });
    const expectZeros = (s: DashboardSnapshot, project: string) => {
      expect(s.project).toBe(project);
      expect(values(s)).toEqual({
        counts: { activeWorkflows: 0, runningAgents: 0, prsGenerated: 0, openFailures: 0 },
        pipeline: [0, 0, 0, 0, 0, 0, 0],
        unstaged: 0,
        needsMe: { approvals: 0, clarifications: 0, failed: 0, blocked: 0 },
        health: {
          testPassRate: [0, 0],
          agentSuccessRate: [0, 0],
          humanInterventionRate: [0, 0],
        },
        risk: [0, 0],
        cards: 0,
        total: 0,
      });
    };

    it('FR-023 GET /dashboard?project=<dashboard-demo> returns 18 active, 7 running agents, 6 PRs, 2 open failures, pipeline 3/2/1/4/3/3/2, needsMe 4/2/1/1, testPassRate 974/1000, agentSuccessRate 35/37, humanInterventionRate 8/24, pendingHighCritical 2, auditHighCritical 0', async () => {
      const s = await snapshot(admin, `?project=${demo}`);
      expect(s.project).toBe(demo);
      expect(s.generatedAt).toBe(iso(FIXED_NOW));
      expect(s.window).toEqual({
        key: '7d',
        from: iso(plus(-7 * 24 * 60 * MIN)),
        to: iso(FIXED_NOW),
      });
      const f = DASHBOARD_FIGURES;
      expect(values(s)).toEqual({
        counts: {
          activeWorkflows: f.active,
          runningAgents: f.runningAgents,
          prsGenerated: f.prsGenerated,
          openFailures: f.openFailures,
        },
        pipeline: [...f.stages],
        unstaged: f.unstaged,
        needsMe: {
          approvals: f.approvals,
          clarifications: f.clarifications,
          failed: f.failed,
          blocked: f.blocked,
        },
        health: {
          testPassRate: [f.testPassRate.passed, f.testPassRate.total],
          agentSuccessRate: [f.agentSuccess.completed, f.agentSuccess.finished],
          humanInterventionRate: [f.intervention.numerator, f.intervention.denominator],
        },
        risk: [f.pendingHighCritical, f.auditHighCritical],
        cards: ACTIVE_CARD_LIMIT,
        total: f.active,
      });
      expect(values(s).counts['activeWorkflows']).toBe(18);
      expect(values(s).health['testPassRate']).toEqual([974, 1000]);
    });

    it('FR-023 every figure and card carries the R25 href and cards are 12 of 18 ordered stateObservedAt desc', async () => {
      const s = await snapshot(admin, `?project=${demo}`);
      const h = dashboardHrefs('7d');
      expect(s.counts.activeWorkflows.href).toBe(h.activeWorkflows);
      expect(s.counts.runningAgents.href).toBe(h.runningAgents);
      expect(s.counts.prsGenerated.href).toBe('/workflows?hasPr=true&window=7d');
      expect(s.counts.openFailures.href).toBe(h.openFailures);
      expect(s.pipeline.stages.map((st) => [st.stage, st.name, st.href])).toEqual(
        SDLC_STAGES.map((name, i) => [i + 1, name, `/workflows?stage=${i + 1}`]),
      );
      expect(s.pipeline.unstaged.href).toBe('/workflows?stage=none');
      expect(s.needsMe.approvals.href).toBe('/approvals');
      expect(s.needsMe.clarifications.href).toBe('/approvals?kind=clarification');
      expect(s.needsMe.failed.href).toBe('/workflows?state=FAILED');
      expect(s.needsMe.blocked.href).toBe('/workflows?state=BLOCKED');
      expect(s.health.testPassRate.href).toBe('/testing?window=7d');
      expect(s.health.agentSuccessRate.href).toBe('/agents?window=7d');
      expect(s.health.humanInterventionRate.href).toBe('/workflows?intervention=human&window=7d');
      expect(s.risk.pendingHighCritical.href).toBe('/approvals?risk=HIGH,CRITICAL');
      expect(s.risk.auditHighCritical.href).toBe('/audit?risk=HIGH,CRITICAL&window=7d');

      expect(s.activeWorkflows).toHaveLength(12);
      expect(s.activeWorkflowsTotal).toBe(18);
      const observed = s.activeWorkflows.map((c) => c.stateObservedAt);
      expect(observed).toEqual([...observed].sort().reverse());
      for (const card of s.activeWorkflows) {
        expect(card.href).toBe(`/workflows/${card.workflowId}`);
        expect(card.externalId).toMatch(/^s500-d\d\d$/);
        expect(card.title.length).toBeGreaterThan(0);
        expect(card.progress.total).toBe(7);
        expect(card.progress.done).toBeLessThanOrEqual(card.progress.total);
        if (card.stage.index != null)
          expect(card.stage.name).toBe(SDLC_STAGES[card.stage.index - 1]);
        if (card.elapsedMs != null) expect(card.elapsedMs).toBeGreaterThanOrEqual(0);
        expect([
          'QUEUED',
          'RUNNING',
          'RETRYING',
          'WAITING',
          'WAITING_FOR_HUMAN',
          'BLOCKED',
          'FAILED',
        ]).toContain(card.state);
      }
      const queued = s.activeWorkflows.filter((c) => c.state === 'QUEUED');
      for (const c of queued) expect(c.elapsedMs).toBeNull();
    });

    it('FR-026 securityFindings is connected:false with href /reviews', async () => {
      const s = await snapshot(admin, `?project=${demo}`);
      expect(s.risk.securityFindings).toEqual({ connected: false, count: null, href: '/reviews' });
    });

    it('FR-025 project=all aggregates every visible project (≥ 118 active for the administrator) and is the default', async () => {
      const all = await snapshot(admin, '?project=all');
      const dflt = await snapshot(admin);
      expect(all.project).toBe('all');
      expect(dflt.project).toBe('all');
      expect(dflt.window.key).toBe('7d');
      expect(all.counts.activeWorkflows.value).toBeGreaterThanOrEqual(118);
      expect(all.needsMe.approvals.value).toBeGreaterThanOrEqual(28);
      expect(all.needsMe.clarifications.value).toBeGreaterThanOrEqual(14);
      expect(all.activeWorkflowsTotal).toBe(all.counts.activeWorkflows.value);
      expect(all.activeWorkflows).toHaveLength(12);
      const sum = all.pipeline.stages.reduce((n, st) => n + st.count, all.pipeline.unstaged.value);
      expect(sum).toBe(all.counts.activeWorkflows.value);
      expect(all.needsMe.failed.value + all.needsMe.blocked.value).toBe(
        all.counts.openFailures.value,
      );
      expect(values(dflt)).toEqual(values(all));
    });

    it('FR-025 a viewer sees only member projects and an unknown or invisible uuid yields zeros, not 404', async () => {
      const vm = await me(viewer);
      expect(vm.projects.map((p) => p.key)).not.toContain(DASHBOARD_PROJECT.key);
      const adminAll = await snapshot(admin);
      const viewerAll = await snapshot(viewer);
      expect(viewerAll.counts.activeWorkflows.value).toBeGreaterThan(0);
      expect(viewerAll.counts.activeWorkflows.value).toBeLessThan(
        adminAll.counts.activeWorkflows.value,
      );
      let perProject = 0;
      for (const p of vm.projects)
        perProject += (await snapshot(viewer, `?project=${p.id}`)).counts.activeWorkflows.value;
      expect(perProject).toBe(viewerAll.counts.activeWorkflows.value);

      expectZeros(await snapshot(viewer, `?project=${demo}`), demo);
      expectZeros(await snapshot(admin, `?project=${ZERO_PROJECT}`), ZERO_PROJECT);
    });

    it('FR-023 window=24h empties the health denominators and window=30d equals 7d for dashboard-demo', async () => {
      const day = await snapshot(admin, `?project=${demo}&window=24h`);
      expect(day.window).toEqual({
        key: '24h',
        from: iso(plus(-24 * 60 * MIN)),
        to: iso(FIXED_NOW),
      });
      expect(day.health.testPassRate).toEqual({
        numerator: 0,
        denominator: 0,
        href: '/testing?window=24h',
      });
      expect(day.health.agentSuccessRate).toEqual({
        numerator: 0,
        denominator: 0,
        href: '/agents?window=24h',
      });
      expect(day.counts.prsGenerated).toEqual({
        value: 1,
        href: '/workflows?hasPr=true&window=24h',
      });
      expect(day.counts.activeWorkflows.value).toBe(18);
      expect(day.risk.auditHighCritical.href).toBe('/audit?risk=HIGH,CRITICAL&window=24h');

      const week = await snapshot(admin, `?project=${demo}&window=7d`);
      const month = await snapshot(admin, `?project=${demo}&window=30d`);
      expect(month.window.key).toBe('30d');
      expect(values(month)).toEqual(values(week));
      expect(month.health.testPassRate.href).toBe('/testing?window=30d');
    });

    it('FR-023 window=90d and project=foo return 400 problem+json validation without internals', async () => {
      for (const q of ['?window=90d', '?project=foo', `?project=${demo}&window=1d`]) {
        const r = await get(admin, q);
        expect(r.statusCode, q).toBe(400);
        expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
        const body = r.json();
        expect(body.status).toBe(400);
        expect(body.type).toMatch(/validation/);
        expect(Array.isArray(body.errors)).toBe(true);
        expect(r.body).not.toMatch(/SELECT|stack|at /);
      }
    });

    it('FR-023 unauthenticated returns 401', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/dashboard' });
      expect(r.statusCode).toBe(401);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    });

    it('SC-007 GET /dashboard p95 ≤ 300 ms and payload ≤ 8 KB over 20 calls at 500 workflows / 5 000 agent runs / 50 000 audit events', async () => {
      const org = await seedSc007Org(app);
      const cookie = await signIn(app, org.email, org.password);
      const first = await snapshot(cookie);
      expect(first.counts.activeWorkflows.value).toBe(50);
      expect(first.activeWorkflows).toHaveLength(12);
      expect(first.risk.auditHighCritical.value).toBeGreaterThan(0);
      expect(first.health.agentSuccessRate.denominator).toBeGreaterThan(0);
      const durations: number[] = [];
      for (let i = 0; i < 20; i++) {
        const r = await get(cookie, '?project=all&window=30d');
        expect(r.statusCode).toBe(200);
        const timing = String(r.headers['server-timing']);
        const m = /dashboard;dur=(\d+(?:\.\d+)?)/.exec(timing);
        expect(m, timing).not.toBeNull();
        durations.push(Number(m![1]));
        expect(Buffer.byteLength(r.body)).toBeLessThanOrEqual(8 * 1024);
      }
      durations.sort((a, b) => a - b);
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
      expect(p95, durations.join(',')).toBeLessThanOrEqual(300);
    });

    it('FR-034 an ingested WAITING_FOR_HUMAN transition changes runningAgents and needsMe on the next call', async () => {
      const before = await snapshot(admin, `?project=${demo}`);
      expect(before.counts.runningAgents.value).toBe(7);
      expect(before.needsMe.approvals.value).toBe(4);
      const moved = await app.inject(
        asIngest({
          method: 'POST',
          url: '/api/ingest/workflows/s500-d05/transitions',
          payload: {
            toState: 'WAITING_FOR_HUMAN',
            observedAt: iso(plus(-1 * MIN)),
            reason: 'needs sign-off',
          },
        }),
      );
      expect(moved.statusCode, moved.body).toBe(200);
      const mid = await snapshot(admin, `?project=${demo}`);
      expect(mid.counts.runningAgents.value).toBe(6);
      expect(mid.counts.activeWorkflows.value).toBe(18);
      expect(mid.activeWorkflows[0]).toMatchObject({
        externalId: 's500-d05',
        state: 'WAITING_FOR_HUMAN',
      });

      const asked = await app.inject(
        asIngest({
          method: 'PUT',
          url: '/api/ingest/approvals/s500-d05-a',
          payload: {
            workflowExternalId: 's500-d05',
            ask: 'Approve: apply the schema change',
            riskLevel: 'HIGH',
            requestedAt: iso(plus(-1 * MIN)),
            context: 'Migration touches the ledger table.',
            links: { pullRequest: 'https://github.com/acme/dashboard-demo/pull/5' },
          },
        }),
      );
      expect(asked.statusCode, asked.body).toBe(200);
      const after = await snapshot(admin, `?project=${demo}`);
      expect(after.needsMe.approvals.value).toBe(5);
      expect(after.risk.pendingHighCritical.value).toBe(3);
      expect(after.health.humanInterventionRate).toMatchObject({ numerator: 9, denominator: 24 });
    });

    it('FR-023 a workflow completed after the window closes leaves the human intervention rate (both ends of the window bound Q6)', async () => {
      const before = await snapshot(admin, `?project=${demo}`);
      expect(before.health.humanInterventionRate).toMatchObject({ numerator: 9, denominator: 24 });
      const done = await app.inject(
        asIngest({
          method: 'POST',
          url: '/api/ingest/workflows/s500-d06/transitions',
          payload: { toState: 'COMPLETED', observedAt: iso(plus(2 * DAY)), reason: 'clock skew' },
        }),
      );
      expect(done.statusCode, done.body).toBe(200);
      const after = await snapshot(admin, `?project=${demo}`);
      expect(after.counts.activeWorkflows.value).toBe(17);
      expect(after.health.humanInterventionRate).toMatchObject({ numerator: 9, denominator: 23 });
    });
  },
);
