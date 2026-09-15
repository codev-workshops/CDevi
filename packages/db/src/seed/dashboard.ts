/**
 * Deterministic `dashboard-demo` dataset (specs/001 US3, research R30, data-model.md §21). Pure: builds rows
 * relative to a base time; `index.ts` writes them after S-500. Draws from its own mulberry32(SEED_RNG + 1)
 * stream so `buildS500()` stays byte-for-byte unchanged. With project=dashboard-demo and window=7d the
 * Dashboard shows the Independent Test figures in DASHBOARD_FIGURES.
 */
import type { AgentRunEvent, RiskLevel, WorkflowState } from '@cdevi/contracts';
import {
  AGENTS,
  mulberry32,
  SEED_RNG,
  STAGES,
  type SeedAgentRun,
  type SeedShowcase,
  type SeedStage,
  type SeedTestRun,
  type SeedWorkflow,
} from './s500';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MODEL = 'cdevi-orchestrator-1';

export const DASHBOARD_PROJECT = { key: 'dashboard-demo', name: 'Dashboard Demo' } as const;
export type DashboardProjectKey = typeof DASHBOARD_PROJECT.key;

/** A dashboard-demo workflow: SeedWorkflow shape on the extra project. */
export type DashboardWorkflow = Omit<SeedWorkflow, 'project'> & { project: DashboardProjectKey };

/** Row totals the seed adds on top of S-500 (data-model.md §21). */
export const EXPECTED_DASHBOARD = {
  workflows: 24,
  active: 18,
  approvals: 4,
  clarifications: 2,
  stages: 43,
  runs: 44,
  testRuns: 6,
} as const;

/** GET /api/dashboard?project=<dashboard-demo>&window=7d figures (quickstart §4, research R24). */
export const DASHBOARD_FIGURES = {
  active: 18,
  runningAgents: 7,
  prsGenerated: 6,
  openFailures: 2,
  stages: [3, 2, 1, 4, 3, 3, 2],
  unstaged: 0,
  approvals: 4,
  clarifications: 2,
  failed: 1,
  blocked: 1,
  testPassRate: { passed: 974, total: 1000 },
  agentSuccess: { completed: 35, finished: 37 },
  intervention: { numerator: 8, denominator: 24 },
  pendingHighCritical: 2,
  auditHighCritical: 0,
} as const;

const TITLES = [
  'Rotate signing keys for webhook deliveries',
  'Add idempotency keys to refund requests',
  'Clarify retention period for audit exports',
  'Choose queue backend for notification fan-out',
  'Migrate invoice PDFs to async rendering',
  'Introduce tenant-aware rate limits',
  'Split checkout service from cart service',
  'Add OpenTelemetry spans to payment retries',
  'Approve schema change: partition ledger by month',
  'Unblock: vendor sandbox certificate expired',
  'Replace polling with change feed for balances',
  'Retry flaky end-to-end suite on Safari',
  'Fix double-charge on network timeout',
  'Harden CSV import against formula injection',
  'Wait for upstream FX rate provider',
  'Approve production access for reconciliation job',
  'Merge PR: consolidate feature flags service',
  'Approve copy changes on the checkout page',
  'Add dark mode to merchant portal',
  'Migrate sessions to opaque tokens',
  'Cache exchange rates at the edge',
  'Ship bulk export for dispute evidence',
  'Upgrade payments SDK to v9',
  'Cancelled: duplicate of refund idempotency work',
];

type Plan = {
  state: WorkflowState;
  stage: number;
  approval?: RiskLevel;
  clarification?: true;
  decided?: true;
  pr?: true;
};

const agentFor = (stage: number): string =>
  stage <= 1
    ? AGENTS[0]!
    : stage <= 3
      ? AGENTS[1]!
      : stage === 4
        ? AGENTS[2]!
        : stage === 5
          ? AGENTS[3]!
          : AGENTS[4]!;

/**
 * 24 workflows: 2 QUEUED, 6 RUNNING, 1 RETRYING, 1 WAITING, 6 WAITING_FOR_HUMAN (4 approvals CRITICAL/HIGH/MEDIUM/LOW
 * + 2 clarifications), 1 BLOCKED, 1 FAILED → 18 active with stage counts 3/2/1/4/3/3/2; 5 COMPLETED (PR refs,
 * two decided approvals) + 1 CANCELLED. Every active `state_observed_at` is within the last 12 h; every
 * `finished_at` (runs, test runs, COMPLETED workflows) is 1–3 days before base so 24h windows are empty.
 */
export function buildDashboardShowcase(base: Date): {
  project: typeof DASHBOARD_PROJECT;
  workflows: DashboardWorkflow[];
  showcase: SeedShowcase[];
} {
  const rnd = mulberry32(SEED_RNG + 1);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const at = (msAgo: number) => new Date(base.getTime() - msAgo);
  const plans: Plan[] = [
    { state: 'QUEUED', stage: 1 }, // d01
    { state: 'QUEUED', stage: 1 }, // d02
    { state: 'WAITING_FOR_HUMAN', stage: 1, clarification: true }, // d03
    { state: 'WAITING_FOR_HUMAN', stage: 2, clarification: true }, // d04
    { state: 'RUNNING', stage: 2 }, // d05
    { state: 'RUNNING', stage: 3 }, // d06
    { state: 'RUNNING', stage: 4 }, // d07
    { state: 'RUNNING', stage: 4 }, // d08
    { state: 'WAITING_FOR_HUMAN', stage: 4, approval: 'CRITICAL' }, // d09
    { state: 'BLOCKED', stage: 4 }, // d10
    { state: 'RUNNING', stage: 5 }, // d11
    { state: 'RETRYING', stage: 5 }, // d12
    { state: 'FAILED', stage: 5 }, // d13
    { state: 'RUNNING', stage: 6 }, // d14
    { state: 'WAITING', stage: 6 }, // d15
    { state: 'WAITING_FOR_HUMAN', stage: 6, approval: 'HIGH' }, // d16
    { state: 'WAITING_FOR_HUMAN', stage: 7, approval: 'MEDIUM', pr: true }, // d17
    { state: 'WAITING_FOR_HUMAN', stage: 7, approval: 'LOW' }, // d18
    { state: 'COMPLETED', stage: 7, pr: true, decided: true }, // d19
    { state: 'COMPLETED', stage: 7, pr: true, decided: true }, // d20
    { state: 'COMPLETED', stage: 7, pr: true }, // d21
    { state: 'COMPLETED', stage: 7, pr: true }, // d22
    { state: 'COMPLETED', stage: 7, pr: true }, // d23
    { state: 'CANCELLED', stage: 3 }, // d24
  ];

  const workflows: DashboardWorkflow[] = [];
  const showcase: SeedShowcase[] = [];

  const stageRow = (
    position: number,
    state: WorkflowState,
    agent: string,
    startedAt: Date,
    finishedAt: Date | null,
    over: Partial<SeedStage> = {},
  ): SeedStage => ({
    position,
    name: STAGES[position - 1]!,
    state,
    stateObservedAt: finishedAt ?? startedAt,
    stateReason: null,
    agent,
    startedAt,
    finishedAt,
    errorSummary: null,
    requiresApproval: false,
    linkApproval: false,
    history: [
      { fromState: 'QUEUED', toState: 'RUNNING', observedAt: startedAt, reason: null },
      ...(state === 'RUNNING'
        ? []
        : [
            {
              fromState: 'RUNNING' as const,
              toState: state,
              observedAt: finishedAt ?? startedAt,
              reason: over.stateReason ?? null,
            },
          ]),
    ],
    ...over,
  });
  const runRow = (
    externalId: string,
    stagePosition: number,
    agent: string,
    state: WorkflowState,
    startedAt: Date,
    finishedAt: Date | null,
    summary: string,
  ): SeedAgentRun => {
    const ev = (d: Date, kind: AgentRunEvent['kind'], message: string): AgentRunEvent => ({
      at: d.toISOString(),
      kind,
      message,
    });
    return {
      externalId,
      stagePosition,
      agent,
      model: MODEL,
      state,
      startedAt,
      finishedAt,
      summary,
      timeline: [
        ev(startedAt, 'note', `${agent} started ${STAGES[stagePosition - 1]}`),
        ...(finishedAt ? [ev(finishedAt, state === 'FAILED' ? 'error' : 'note', summary)] : []),
      ],
      steps: [],
      decisions: [],
    };
  };

  plans.forEach((p, i) => {
    const externalId = `s500-d${String(i + 1).padStart(2, '0')}`;
    const agent = agentFor(p.stage);
    const active = p.state !== 'COMPLETED' && p.state !== 'CANCELLED';
    // Active workflows were observed in the last 12 h; finished ones ended 1–3 days ago (CANCELLED 5 days ago).
    const observedAt = active
      ? at(int(5, 11 * 60) * MIN)
      : p.state === 'CANCELLED'
        ? at(5 * DAY + int(0, 6) * HOUR)
        : at(DAY + int(1, 47) * HOUR + int(0, 59) * MIN);
    const startedAt =
      p.state === 'QUEUED' ? null : at(base.getTime() - observedAt.getTime() + int(2, 30) * HOUR);
    const w: DashboardWorkflow = {
      externalId,
      project: DASHBOARD_PROJECT.key,
      title: TITLES[i]!,
      agent,
      state: p.state,
      stateObservedAt: observedAt,
      stateReason: null,
      stageIndex: p.stage,
      stageName: STAGES[p.stage - 1]!,
      pullRequestRef: p.pr ? `${p.state === 'COMPLETED' ? 'PR ' : ''}#${int(500, 599)}` : null,
      startedAt,
      finishedAt: active ? null : observedAt,
      approval: null,
      clarification: null,
      decidedApproval: null,
    };
    if (p.state === 'BLOCKED')
      w.stateReason = 'Vendor sandbox certificate expired; waiting for a renewed certificate';
    if (p.state === 'FAILED') w.stateReason = 'Unit tests failed: 11 of 100 cases in refund flow';
    if (p.approval) {
      const asks: Record<RiskLevel, string> = {
        CRITICAL: 'Approve: partition the ledger table by month (production schema change)',
        HIGH: 'Approve: grant the reconciliation job production database access',
        MEDIUM: `Approve: merge PR ${w.pullRequestRef} into \`main\``,
        LOW: 'Approve: checkout page copy changes',
      };
      w.approval = {
        externalId: `${externalId}-a`,
        ask: asks[p.approval],
        riskLevel: p.approval,
        requestedAt: observedAt,
        expiresAt: null,
        context:
          p.approval === 'MEDIUM'
            ? 'All required checks passed and the review agent found no blocking findings.'
            : null,
        links: {
          workflow: `/workflows/${externalId}`,
          ...(p.pr
            ? {
                pullRequest: `https://github.com/acme/${DASHBOARD_PROJECT.key}/pull/${w.pullRequestRef!.replace(/\D/g, '')}`,
              }
            : {}),
        },
      };
    }
    if (p.clarification) {
      w.clarification = {
        externalId: `${externalId}-c`,
        question:
          i === 2
            ? 'How long must audit exports be retained?'
            : 'Which queue backend should notification fan-out use?',
        requestedAt: observedAt,
        hasRecommendedAnswer: i !== 2,
        whyItMatters:
          i === 2
            ? null
            : 'Determines the delivery guarantees and the infrastructure the implementation stage provisions.',
        options:
          i === 2
            ? []
            : [
                { value: 'sqs', label: 'Amazon SQS (managed)', recommended: true },
                {
                  value: 'rabbitmq',
                  label: 'RabbitMQ on the existing cluster',
                  recommended: false,
                },
              ],
        links: { workflow: `/workflows/${externalId}` },
      };
    }
    if (p.decided) {
      const requestedAt = at(base.getTime() - observedAt.getTime() + int(2, 6) * HOUR);
      w.decidedApproval = {
        externalId: `${externalId}-a`,
        ask: `Approve: merge PR ${w.pullRequestRef} into \`main\``,
        riskLevel: i % 2 === 0 ? 'MEDIUM' : 'LOW',
        requestedAt,
        decidedAt: new Date(requestedAt.getTime() + int(10, 90) * MIN),
        outcome: 'approved',
      };
    }
    workflows.push(w);

    // Showcase rows (43 stages / 44 runs / 6 test runs in total).
    if (p.state === 'RUNNING') {
      showcase.push({
        externalId,
        stages: [stageRow(p.stage, 'RUNNING', agent, observedAt, null)],
        runs: [
          runRow(
            `${externalId}-r1`,
            p.stage,
            agent,
            'RUNNING',
            observedAt,
            null,
            `${agent} is working on ${STAGES[p.stage - 1]}`,
          ),
        ],
        artifacts: [],
        testRuns: [],
      });
    } else if (p.state === 'RETRYING') {
      const failedAt = at(DAY + int(1, 47) * HOUR);
      const failedStart = new Date(failedAt.getTime() - int(20, 90) * MIN);
      w.startedAt = new Date(failedStart.getTime() - int(10, 120) * MIN);
      showcase.push({
        externalId,
        stages: [
          stageRow(p.stage, 'RETRYING', agent, failedStart, null, {
            stateObservedAt: observedAt,
            stateReason: 'Retry requested after a transient runner failure',
            history: [
              { fromState: 'QUEUED', toState: 'RUNNING', observedAt: failedStart, reason: null },
              {
                fromState: 'RUNNING',
                toState: 'FAILED',
                observedAt: failedAt,
                reason: 'Runner lost connection',
              },
              {
                fromState: 'FAILED',
                toState: 'RETRYING',
                observedAt,
                reason: 'Retry requested after a transient runner failure',
              },
            ],
          }),
        ],
        runs: [
          runRow(
            `${externalId}-r1`,
            p.stage,
            agent,
            'FAILED',
            failedStart,
            failedAt,
            'Runner lost connection to the test grid',
          ),
          runRow(
            `${externalId}-r2`,
            p.stage,
            agent,
            'RETRYING',
            observedAt,
            null,
            `${agent} is retrying ${STAGES[p.stage - 1]}`,
          ),
        ],
        artifacts: [],
        testRuns: [],
      });
    } else if (p.state === 'FAILED') {
      const failedAt = at(DAY + int(1, 47) * HOUR);
      const failedStart = new Date(failedAt.getTime() - int(30, 120) * MIN);
      w.startedAt = new Date(failedStart.getTime() - int(10, 120) * MIN);
      showcase.push({
        externalId,
        stages: [
          stageRow(p.stage, 'FAILED', agent, failedStart, failedAt, {
            stateObservedAt: observedAt,
            stateReason: w.stateReason,
            errorSummary: `${w.stateReason}. See the failed unit run for details.`,
          }),
        ],
        runs: [
          runRow(
            `${externalId}-r1`,
            p.stage,
            agent,
            'FAILED',
            failedStart,
            failedAt,
            w.stateReason!,
          ),
        ],
        artifacts: [],
        testRuns: [
          {
            externalId: `${externalId}-t1`,
            stagePosition: p.stage,
            category: 'unit',
            status: 'FAILED',
            total: 100,
            passed: 89,
            failed: 11,
            skipped: 0,
            href: null,
            startedAt: new Date(failedAt.getTime() - int(5, 15) * MIN),
            finishedAt: failedAt,
          },
        ],
      });
    } else if (p.state === 'COMPLETED') {
      // Seven stages of ~40 min ending at the workflow's finish, so every stage finish is also 1–3 days before base.
      const end = observedAt.getTime();
      const step = 40 * MIN;
      const first = end - 7 * step;
      w.startedAt = new Date(first - int(10, 120) * MIN);
      const stages: SeedStage[] = [];
      const runs: SeedAgentRun[] = [];
      for (let k = 1; k <= 7; k++) {
        const from = new Date(first + (k - 1) * step);
        const to = new Date(first + k * step - int(1, 5) * MIN);
        const stageAgent = agentFor(k);
        stages.push(stageRow(k, 'COMPLETED', stageAgent, from, to));
        runs.push(
          runRow(
            `${externalId}-r${k}`,
            k,
            stageAgent,
            'COMPLETED',
            from,
            to,
            `${stageAgent} completed ${STAGES[k - 1]}`,
          ),
        );
      }
      const testing = stages[4]!;
      const testRuns: SeedTestRun[] = [
        {
          externalId: `${externalId}-t1`,
          stagePosition: 5,
          category: 'unit',
          status: 'PASSED',
          total: 180,
          passed: 177,
          failed: 3,
          skipped: 0,
          href: null,
          startedAt: new Date(testing.finishedAt!.getTime() - int(5, 15) * MIN),
          finishedAt: testing.finishedAt!,
        },
      ];
      showcase.push({ externalId, stages, runs, artifacts: [], testRuns });
    }
  });

  return { project: DASHBOARD_PROJECT, workflows, showcase };
}
