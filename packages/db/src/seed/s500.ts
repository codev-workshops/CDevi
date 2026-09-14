/**
 * Deterministic S-500 dataset (specs/003 research R12, data-model.md §7). Pure: builds rows relative to a base
 * time; `index.ts` writes them. Same base + same seed → identical dataset.
 */
import type { RiskLevel, Role, WorkflowState } from '@cdevi/contracts';

export const SEED_RNG = 20260914;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** mulberry32 — small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROJECTS = [
  { key: 'payments-api', name: 'Payments API' },
  { key: 'web-app', name: 'Web App' },
  { key: 'storefront', name: 'Storefront' },
  { key: 'platform', name: 'Platform' },
] as const;
export type ProjectKey = (typeof PROJECTS)[number]['key'];

export const AGENTS = [
  'Requirement Agent',
  'Architecture Agent',
  'Implementation Agent',
  'Testing Agent',
  'Review Agent',
];
export const STAGES = [
  'Requirement',
  'Analysis',
  'Architecture',
  'Implementation',
  'Testing',
  'Review',
  'PR',
];

export interface SeedUser {
  email: string;
  displayName: string;
  role: Role;
  projects: ProjectKey[];
}

export interface SeedApproval {
  externalId: string;
  ask: string;
  riskLevel: RiskLevel;
  requestedAt: Date;
  expiresAt: Date | null;
}
export interface SeedClarification {
  externalId: string;
  question: string;
  requestedAt: Date;
  hasRecommendedAnswer: boolean;
}
export interface SeedWorkflow {
  externalId: string;
  project: ProjectKey;
  title: string;
  agent: string;
  state: WorkflowState;
  stateObservedAt: Date;
  stateReason: string | null;
  stageIndex: number;
  stageName: string;
  pullRequestRef: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  approval: SeedApproval | null;
  clarification: SeedClarification | null;
  /** Approvals decided today (for the Today block) live on finished workflows. */
  decidedApproval: {
    externalId: string;
    ask: string;
    riskLevel: RiskLevel;
    requestedAt: Date;
    decidedAt: Date;
    outcome: 'approved' | 'rejected';
  } | null;
}

const TITLES = [
  'Add rate limiting to /api/auth',
  'Migrate sessions to Redis',
  'Fix flaky checkout test',
  'Webhook retry policy',
  'Bump dependencies (weekly)',
  'Rotate signing keys',
  'Add limiter unit tests',
  'Refund idempotency keys',
  'Split payments ledger table',
  'Cart price recalculation',
  'Feature flags for checkout v2',
  'Audit log export',
  'Improve search relevance',
  'Accessibility fixes for forms',
  'Order status webhooks',
  'Currency rounding rules',
  'Retry queue for emails',
  'Upgrade Node runtime',
  'Remove legacy /session/v1',
  'Tenant-aware caching',
];
const ASKS = [
  'Approve: open a pull request against `main`',
  'Approve: merge PR #%n into `main`',
  'Approve: run the database migration on staging',
  'Approve: modify the CI workflow',
  'Approve: add a new dependency `%d`',
  'Approve: change the rate-limit policy',
];
const DEPS = ['ioredis', 'zod', 'undici', 'pino', 'ajv'];
const QUESTIONS = [
  'Keep the legacy `/session/v1` endpoint during migration?',
  'Should refunds over $500 require a second approver?',
  'Use a feature flag or a hard cutover for checkout v2?',
  'Which time zone should audit exports use?',
  'Is a 3-retry limit acceptable for webhook delivery?',
  'Should the limiter key on user id or IP?',
];
const BLOCK_REASONS = [
  'issue tracker unreachable',
  'source-control integration disconnected',
  'linked ticket closed externally',
  'CI credentials expired',
];
const FAIL_REASONS = [
  '3 unit tests failing',
  'type check failed after merge from main',
  'integration tests timed out',
  'lint errors introduced',
];

export function buildS500(base: Date): { users: SeedUser[]; workflows: SeedWorkflow[] } {
  const rnd = mulberry32(SEED_RNG);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const at = (msAgo: number) => new Date(base.getTime() - msAgo);
  const project = (i: number): ProjectKey => PROJECTS[i % PROJECTS.length]!.key;
  const title = (i: number) =>
    `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` (${Math.floor(i / TITLES.length) + 1})` : ''}`;

  const users: SeedUser[] = [
    {
      email: 'admin@cdevi.demo',
      displayName: 'Nadeesha Perera',
      role: 'administrator',
      projects: [],
    },
    ...[1, 2, 3, 4].map((n): SeedUser => ({
      email: `approver${n}@cdevi.demo`,
      displayName: `Approver ${n}`,
      role: 'approver',
      projects: PROJECTS.slice(0, 1 + (n % 3) + 1).map((p) => p.key),
    })),
    ...Array.from({ length: 10 }, (_, k): SeedUser => ({
      email: `engineer${k + 1}@cdevi.demo`,
      displayName: `Engineer ${k + 1}`,
      role: 'engineer',
      projects: PROJECTS.slice(k % 4, (k % 4) + 1 + (k % 3)).map((p) => p.key),
    })),
    ...Array.from({ length: 5 }, (_, k): SeedUser => ({
      email: `viewer${k + 1}@cdevi.demo`,
      displayName: `Viewer ${k + 1}`,
      role: 'viewer',
      projects: PROJECTS.slice(k % 4, (k % 4) + 1 + (k % 2)).map((p) => p.key),
    })),
  ];
  // Every non-admin has at least one project; approver1 sees payments-api + web-app.
  for (const u of users)
    if (u.role !== 'administrator' && u.projects.length === 0) u.projects = ['payments-api'];

  const workflows: SeedWorkflow[] = [];
  let n = 0;
  const wf = (
    over: Partial<SeedWorkflow> & Pick<SeedWorkflow, 'state' | 'stateObservedAt'>,
  ): SeedWorkflow => {
    const i = n++;
    const stageIndex = over.stageIndex ?? int(1, 7);
    return {
      externalId: `s500-${String(i + 1).padStart(3, '0')}`,
      project: project(i),
      title: title(i),
      agent: pick(AGENTS),
      stateReason: null,
      stageIndex,
      stageName: STAGES[stageIndex - 1]!,
      pullRequestRef: null,
      startedAt: at(
        over.stateObservedAt
          ? base.getTime() - over.stateObservedAt.getTime() + int(10, 240) * MIN
          : HOUR,
      ),
      finishedAt: null,
      approval: null,
      clarification: null,
      decidedApproval: null,
      ...over,
    };
  };

  // --- needsYou · approvals: 6 per risk; 4 with expiry (1 expired); 3 stale (> 24 h)
  const risks: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  let a = 0;
  for (const risk of risks) {
    for (let k = 0; k < 6; k++, a++) {
      const stale = a < 3; // first three approvals are stale
      const requestedAt = stale ? at(int(25, 60) * HOUR) : at(int(2, 600) * MIN);
      let expiresAt: Date | null = null;
      if (a === 3) expiresAt = at(-(3 * HOUR + 56 * MIN)); // in 3 h 56 m
      if (a === 4) expiresAt = at(-(2 * DAY + 4 * HOUR));
      if (a === 5) expiresAt = at(-(30 * MIN));
      if (a === 6) expiresAt = at(15 * MIN); // expired 15 min ago
      const ask = pick(ASKS)
        .replace('%n', String(int(400, 499)))
        .replace('%d', pick(DEPS));
      const w = wf({
        state: 'WAITING_FOR_HUMAN',
        stateObservedAt: requestedAt,
        stageIndex: int(4, 7),
      });
      w.approval = {
        externalId: `${w.externalId}-a`,
        ask,
        riskLevel: risk,
        requestedAt,
        expiresAt,
      };
      workflows.push(w);
    }
  }
  // --- needsYou · clarifications: 12, 6 with recommended answer
  for (let k = 0; k < 12; k++) {
    const requestedAt = at(int(5, 900) * MIN);
    const w = wf({
      state: 'WAITING_FOR_HUMAN',
      stateObservedAt: requestedAt,
      stageIndex: int(1, 3),
    });
    w.clarification = {
      externalId: `${w.externalId}-c`,
      question: QUESTIONS[k % QUESTIONS.length]!,
      requestedAt,
      hasRecommendedAnswer: k % 2 === 0,
    };
    workflows.push(w);
  }
  // --- needsYou · blocked 8, failed 6
  for (let k = 0; k < 8; k++)
    workflows.push(
      wf({
        state: 'BLOCKED',
        stateObservedAt: at(int(3, 1500) * MIN),
        stateReason: pick(BLOCK_REASONS),
      }),
    );
  for (let k = 0; k < 6; k++)
    workflows.push(
      wf({
        state: 'FAILED',
        stateObservedAt: at(int(3, 4000) * MIN),
        stateReason: pick(FAIL_REASONS),
        stageIndex: pick([4, 5]),
      }),
    );

  // --- running 100: 20 QUEUED, 60 RUNNING, 10 RETRYING, 10 WAITING
  for (let k = 0; k < 20; k++)
    workflows.push(
      wf({
        state: 'QUEUED',
        stateObservedAt: at(int(1, 120) * MIN),
        startedAt: null,
        stageIndex: 1,
      }),
    );
  for (let k = 0; k < 60; k++) {
    const s = at(int(2, 600) * MIN);
    workflows.push(wf({ state: 'RUNNING', stateObservedAt: s, startedAt: s }));
  }
  for (let k = 0; k < 10; k++) {
    const s = at(int(30, 700) * MIN);
    workflows.push(
      wf({
        state: 'RETRYING',
        stateObservedAt: at(int(1, 25) * MIN),
        startedAt: s,
        stateReason: 'transient runtime error',
      }),
    );
  }
  for (let k = 0; k < 10; k++) {
    const s = at(int(30, 700) * MIN);
    workflows.push(
      wf({
        state: 'WAITING',
        stateObservedAt: at(int(1, 25) * MIN),
        startedAt: s,
        stateReason: 'waiting for CI',
      }),
    );
  }

  // --- done 350: 300 COMPLETED with PR refs, 50 CANCELLED; finished over 8 days (≈45 outside 7-day window)
  for (let k = 0; k < 350; k++) {
    const cancelled = k % 7 === 3; // 50 of 350
    const finishedAt = at(Math.floor((k / 350) * 8 * DAY) + int(0, 30) * MIN);
    const started = new Date(finishedAt.getTime() - int(20, 300) * MIN);
    const w = wf({
      state: cancelled ? 'CANCELLED' : 'COMPLETED',
      stateObservedAt: finishedAt,
      startedAt: started,
      finishedAt,
      stageIndex: 7,
      pullRequestRef: cancelled ? null : `PR #${300 + k}`,
    });
    // Some approvals decided today live on finished workflows (Today "approvals decided").
    if (!cancelled && finishedAt.getTime() > base.getTime() - 8 * HOUR && k % 3 === 0) {
      const requestedAt = new Date(finishedAt.getTime() - 40 * MIN);
      w.decidedApproval = {
        externalId: `${w.externalId}-a`,
        ask: 'Approve: merge pull request',
        riskLevel: 'HIGH',
        requestedAt,
        decidedAt: new Date(finishedAt.getTime() - 10 * MIN),
        outcome: 'approved',
      };
    }
    workflows.push(w);
  }

  return { users, workflows };
}

export const EXPECTED_BUCKETS = {
  approvals: 24,
  clarifications: 12,
  blocked: 8,
  failed: 6,
  running: { QUEUED: 20, RUNNING: 60, RETRYING: 10, WAITING: 10 },
  done: { COMPLETED: 300, CANCELLED: 50 },
  total: 500,
  users: 20,
} as const;
