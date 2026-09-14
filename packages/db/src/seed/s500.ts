/**
 * Deterministic S-500 dataset (specs/003 research R12, data-model.md §7). Pure: builds rows relative to a base
 * time; `index.ts` writes them. Same base + same seed → identical dataset.
 */
import type {
  AgentRunEvent,
  ArtifactType,
  RiskLevel,
  Role,
  TestRunStatus,
  WorkflowState,
} from '@cdevi/contracts';

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

/** specs/001 US1 (research R8): per-stage journey for the two showcase workflows. */
export interface SeedStage {
  position: number;
  name: string;
  state: WorkflowState;
  stateObservedAt: Date;
  stateReason: string | null;
  agent: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorSummary: string | null;
  requiresApproval: boolean;
  /** Link this stage to the workflow's pending approval (SeedWorkflow.approval). */
  linkApproval: boolean;
  history: {
    fromState: WorkflowState | null;
    toState: WorkflowState;
    observedAt: Date;
    reason: string | null;
  }[];
}
export interface SeedAgentRun {
  externalId: string;
  stagePosition: number;
  agent: string;
  model: string | null;
  state: WorkflowState;
  startedAt: Date;
  finishedAt: Date | null;
  summary: string | null;
  timeline: AgentRunEvent[];
}
export interface SeedArtifact {
  externalId: string;
  stagePosition: number;
  type: ArtifactType;
  title: string;
  href: string | null;
  summary: string | null;
  producedAt: Date;
}
export interface SeedTestRun {
  externalId: string;
  stagePosition: number;
  category: string;
  status: TestRunStatus;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  href: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}
export interface SeedShowcase {
  externalId: string;
  stages: SeedStage[];
  runs: SeedAgentRun[];
  artifacts: SeedArtifact[];
  testRuns: SeedTestRun[];
}

export const SHOWCASE_WAITING = 's500-001';
export const SHOWCASE_FAILED = 's500-045';
const MODEL = 'cdevi-orchestrator-1';

/** Deterministic showcase journeys (research R8). `wait`/`fail` are the workflows they decorate. */
export function buildShowcase(base: Date, wait: SeedWorkflow, fail: SeedWorkflow): SeedShowcase[] {
  const t = (min: number) => new Date(base.getTime() - min * MIN);
  const ev = (min: number, kind: AgentRunEvent['kind'], message: string): AgentRunEvent => ({
    at: t(min).toISOString(),
    kind,
    message,
  });
  const done = (
    position: number,
    agent: string,
    from: number,
    to: number,
    over: Partial<SeedStage> = {},
  ): SeedStage => ({
    position,
    name: STAGES[position - 1]!,
    state: 'COMPLETED',
    stateObservedAt: t(to),
    stateReason: null,
    agent,
    startedAt: t(from),
    finishedAt: t(to),
    errorSummary: null,
    requiresApproval: false,
    linkApproval: false,
    history: [
      { fromState: 'QUEUED', toState: 'RUNNING', observedAt: t(from), reason: null },
      { fromState: 'RUNNING', toState: 'COMPLETED', observedAt: t(to), reason: null },
    ],
    ...over,
  });
  const queued = (position: number, createdMin: number): SeedStage => ({
    position,
    name: STAGES[position - 1]!,
    state: 'QUEUED',
    stateObservedAt: t(createdMin),
    stateReason: null,
    agent: null,
    startedAt: null,
    finishedAt: null,
    errorSummary: null,
    requiresApproval: position === 7,
    linkApproval: false,
    history: [],
  });
  const run = (
    externalId: string,
    stagePosition: number,
    agent: string,
    state: WorkflowState,
    from: number,
    to: number | null,
    summary: string,
    timeline: AgentRunEvent[],
  ): SeedAgentRun => ({
    externalId,
    stagePosition,
    agent,
    model: MODEL,
    state,
    startedAt: t(from),
    finishedAt: to === null ? null : t(to),
    summary,
    timeline,
  });
  const artifact = (
    externalId: string,
    stagePosition: number,
    type: ArtifactType,
    title: string,
    summary: string,
    producedAt: number,
    href: string | null = null,
  ): SeedArtifact => ({
    externalId,
    stagePosition,
    type,
    title,
    href,
    summary,
    producedAt: t(producedAt),
  });
  const test = (
    externalId: string,
    stagePosition: number,
    category: string,
    status: TestRunStatus,
    counts: [total: number, passed: number, failed: number, skipped: number],
    from: number,
    to: number | null,
  ): SeedTestRun => ({
    externalId,
    stagePosition,
    category,
    status,
    total: counts[0],
    passed: counts[1],
    failed: counts[2],
    skipped: counts[3],
    href: `https://ci.cdevi.demo/${externalId}`,
    startedAt: t(from),
    finishedAt: to === null ? null : t(to),
  });

  // --- s500-001 · "Add rate limiting to /api/auth": 1–5 done (Testing failed once), 6 waiting, 7 queued
  const w = wait.externalId;
  const waitingSince = wait.approval?.requestedAt ?? wait.stateObservedAt;
  const wm = (base.getTime() - waitingSince.getTime()) / MIN;
  const waiting: SeedShowcase = {
    externalId: w,
    stages: [
      done(1, AGENTS[0]!, wm + 320, wm + 290),
      done(2, AGENTS[1]!, wm + 290, wm + 260),
      done(3, AGENTS[1]!, wm + 260, wm + 220),
      done(4, AGENTS[2]!, wm + 220, wm + 100),
      done(5, AGENTS[3]!, wm + 100, wm + 20, {
        history: [
          { fromState: 'QUEUED', toState: 'RUNNING', observedAt: t(wm + 100), reason: null },
          {
            fromState: 'RUNNING',
            toState: 'FAILED',
            observedAt: t(wm + 70),
            reason: '2 unit tests failing',
          },
          {
            fromState: 'FAILED',
            toState: 'RETRYING',
            observedAt: t(wm + 65),
            reason: 'Retry requested by Engineer 1',
          },
          { fromState: 'RETRYING', toState: 'RUNNING', observedAt: t(wm + 60), reason: null },
          { fromState: 'RUNNING', toState: 'COMPLETED', observedAt: t(wm + 20), reason: null },
        ],
      }),
      {
        position: 6,
        name: STAGES[5]!,
        state: 'WAITING_FOR_HUMAN',
        stateObservedAt: waitingSince,
        stateReason: 'Approval required before opening the pull request',
        agent: AGENTS[4]!,
        startedAt: t(wm + 20),
        finishedAt: null,
        errorSummary: null,
        requiresApproval: true,
        linkApproval: true,
        history: [
          { fromState: 'QUEUED', toState: 'RUNNING', observedAt: t(wm + 20), reason: null },
          {
            fromState: 'RUNNING',
            toState: 'WAITING_FOR_HUMAN',
            observedAt: waitingSince,
            reason: 'Approval required before opening the pull request',
          },
        ],
      },
      queued(7, wm + 321),
    ],
    runs: [
      run(
        `${w}-r1`,
        1,
        AGENTS[0]!,
        'COMPLETED',
        wm + 320,
        wm + 290,
        'Wrote the requirement spec from ticket PAY-231.',
        [
          ev(wm + 318, 'tool', 'Read ticket PAY-231 and 3 linked comments'),
          ev(wm + 295, 'decision', 'Scoped to /api/auth login and token refresh only'),
        ],
      ),
      run(
        `${w}-r2`,
        2,
        AGENTS[1]!,
        'COMPLETED',
        wm + 290,
        wm + 260,
        'Analysed impact on 4 auth handlers and the gateway.',
        [ev(wm + 280, 'tool', 'Searched call sites of authMiddleware')],
      ),
      run(
        `${w}-r3`,
        3,
        AGENTS[1]!,
        'COMPLETED',
        wm + 260,
        wm + 220,
        'Planned a sliding-window limiter keyed on user id.',
        [ev(wm + 240, 'decision', 'Chose sliding window over token bucket for burst fairness')],
      ),
      run(
        `${w}-r4`,
        4,
        AGENTS[2]!,
        'COMPLETED',
        wm + 220,
        wm + 100,
        'Implemented the limiter and wired it into /api/auth.',
        [
          ev(wm + 200, 'tool', 'Created src/auth/limiter.ts'),
          ev(wm + 140, 'tool', 'Ran pnpm typecheck — clean'),
        ],
      ),
      run(
        `${w}-r5`,
        5,
        AGENTS[3]!,
        'FAILED',
        wm + 100,
        wm + 70,
        'Unit suite failed: 2 limiter edge cases.',
        [
          ev(wm + 80, 'tool', 'Ran 128 unit tests'),
          ev(wm + 70, 'error', 'limiter resets window on clock skew (2 failures)'),
        ],
      ),
      run(
        `${w}-r6`,
        5,
        AGENTS[3]!,
        'COMPLETED',
        wm + 60,
        wm + 20,
        'Fixed clock-skew handling; all suites green.',
        [
          ev(wm + 55, 'tool', 'Patched limiter window rollover'),
          ev(wm + 25, 'tool', 'Ran unit, integration, e2e and accessibility suites'),
        ],
      ),
      run(
        `${w}-r7`,
        6,
        AGENTS[4]!,
        'WAITING_FOR_HUMAN',
        wm + 20,
        null,
        'Review complete; waiting for approval to open the PR.',
        [
          ev(wm + 10, 'note', 'No blocking findings; 1 suggestion on error copy'),
          ev(wm + 0, 'decision', 'Opening a pull request needs human approval (policy)'),
        ],
      ),
      run(
        `${w}-r8`,
        6,
        AGENTS[4]!,
        'COMPLETED',
        wm + 18,
        wm + 5,
        'Prepared the code diff and PR description.',
        [ev(wm + 7, 'tool', 'Generated diff (14 files, +412 −38)')],
      ),
    ],
    artifacts: [
      artifact(
        `${w}-spec`,
        1,
        'requirement_spec',
        'Requirement spec — rate limiting for /api/auth',
        'Limits: 10 req/min per user on login and refresh.',
        wm + 291,
      ),
      artifact(
        `${w}-impact`,
        2,
        'impact_analysis',
        'Impact analysis — auth handlers and gateway',
        '4 handlers touched; no schema change.',
        wm + 261,
      ),
      artifact(
        `${w}-plan`,
        3,
        'implementation_plan',
        'Implementation plan — sliding-window limiter',
        '3 steps; limiter module, middleware, tests.',
        wm + 221,
      ),
      artifact(
        `${w}-tests`,
        5,
        'test_results',
        'Test results — all suites',
        '128 unit, 22 integration, 6 e2e, 4 a11y — all passing.',
        wm + 21,
        'https://ci.cdevi.demo/s500-001/tests',
      ),
      artifact(
        `${w}-diff`,
        6,
        'code_diff',
        'Code diff — 14 files (+412 −38)',
        'Adds src/auth/limiter.ts and middleware wiring.',
        wm + 6,
        'https://git.cdevi.demo/payments-api/compare/main...pay-231',
      ),
      artifact(
        `${w}-pr`,
        6,
        'pull_request',
        'Draft PR — Add rate limiting to /api/auth',
        'Opens once the approval is granted.',
        wm + 5,
        'https://git.cdevi.demo/payments-api/pull/512',
      ),
    ],
    testRuns: [
      test(`${w}-t1`, 5, 'unit', 'FAILED', [128, 126, 2, 0], wm + 82, wm + 70),
      test(`${w}-t2`, 5, 'unit', 'PASSED', [128, 128, 0, 0], wm + 50, wm + 40),
      test(`${w}-t3`, 5, 'integration', 'PASSED', [22, 22, 0, 0], wm + 40, wm + 30),
      test(`${w}-t4`, 5, 'e2e', 'PASSED', [6, 6, 0, 0], wm + 30, wm + 21),
    ],
  };

  // --- s500-045 · first FAILED workflow: 1–4 done, 5 Testing FAILED, 6–7 queued
  const f = fail.externalId;
  const failedAt = fail.stateObservedAt;
  const failedReason = fail.stateReason ?? '3 unit tests failing';
  const fm = (base.getTime() - failedAt.getTime()) / MIN;
  const failed: SeedShowcase = {
    externalId: f,
    stages: [
      done(1, AGENTS[0]!, fm + 240, fm + 220),
      done(2, AGENTS[1]!, fm + 220, fm + 200),
      done(3, AGENTS[1]!, fm + 200, fm + 170),
      done(4, AGENTS[2]!, fm + 170, fm + 60),
      {
        position: 5,
        name: STAGES[4]!,
        state: 'FAILED',
        stateObservedAt: failedAt,
        stateReason: failedReason,
        agent: AGENTS[3]!,
        startedAt: t(fm + 60),
        finishedAt: null,
        errorSummary: `${failedReason}: refund rounding differs for JPY and KRW`,
        requiresApproval: false,
        linkApproval: false,
        history: [
          { fromState: 'QUEUED', toState: 'RUNNING', observedAt: t(fm + 60), reason: null },
          { fromState: 'RUNNING', toState: 'FAILED', observedAt: failedAt, reason: failedReason },
        ],
      },
      queued(6, fm + 241),
      queued(7, fm + 241),
    ],
    runs: [
      run(
        `${f}-r1`,
        1,
        AGENTS[0]!,
        'COMPLETED',
        fm + 240,
        fm + 220,
        'Wrote the requirement spec.',
        [],
      ),
      run(
        `${f}-r2`,
        2,
        AGENTS[1]!,
        'COMPLETED',
        fm + 220,
        fm + 200,
        'Analysed impact on the refunds service.',
        [],
      ),
      run(
        `${f}-r3`,
        3,
        AGENTS[1]!,
        'COMPLETED',
        fm + 200,
        fm + 170,
        'Planned the change in 2 steps.',
        [],
      ),
      run(
        `${f}-r4`,
        4,
        AGENTS[2]!,
        'COMPLETED',
        fm + 170,
        fm + 60,
        'Implemented the change across 6 files.',
        [ev(fm + 100, 'tool', 'Ran pnpm typecheck — clean')],
      ),
      run(`${f}-r5`, 5, AGENTS[3]!, 'FAILED', fm + 60, fm, `Unit suite failed: ${failedReason}.`, [
        ev(fm + 20, 'tool', 'Ran 96 unit tests'),
        ev(fm, 'error', 'Rounding assertions failed for zero-decimal currencies'),
      ]),
    ],
    artifacts: [
      artifact(
        `${f}-spec`,
        1,
        'requirement_spec',
        'Requirement spec',
        'Scope and acceptance criteria from the ticket.',
        fm + 221,
      ),
      artifact(
        `${f}-impact`,
        2,
        'impact_analysis',
        'Impact analysis',
        '6 files; no schema change.',
        fm + 201,
      ),
      artifact(`${f}-plan`, 3, 'implementation_plan', 'Implementation plan', '2 steps.', fm + 171),
      artifact(
        `${f}-tests`,
        5,
        'test_results',
        'Test results — unit (failed)',
        `96 unit tests, 3 failing.`,
        fm,
        `https://ci.cdevi.demo/${f}/tests`,
      ),
    ],
    testRuns: [test(`${f}-t1`, 5, 'unit', 'FAILED', [96, 93, 3, 0], fm + 20, fm)],
  };

  return [waiting, failed];
}

export const EXPECTED_SHOWCASE = {
  workflows: 2,
  stages: 14,
  runs: 13,
  artifacts: 10,
  testRuns: 5,
} as const;

export function buildS500(base: Date): {
  users: SeedUser[];
  workflows: SeedWorkflow[];
  showcase: SeedShowcase[];
} {
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

  // --- specs/001 US1 showcase (research R8): pin the two decorated workflows' stage pointers.
  const wait = workflows.find((x) => x.externalId === SHOWCASE_WAITING)!;
  const fail = workflows.find((x) => x.externalId === SHOWCASE_FAILED)!;
  wait.stageIndex = 6;
  wait.stageName = STAGES[5]!;
  wait.agent = AGENTS[4]!;
  wait.startedAt = new Date(
    (wait.approval?.requestedAt ?? wait.stateObservedAt).getTime() - 320 * MIN,
  );
  fail.stageIndex = 5;
  fail.stageName = STAGES[4]!;
  fail.agent = AGENTS[3]!;
  fail.startedAt = new Date(fail.stateObservedAt.getTime() - 240 * MIN);
  fail.stateReason = FAIL_REASONS[0]!;
  const showcase = buildShowcase(base, wait, fail);

  return { users, workflows, showcase };
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
