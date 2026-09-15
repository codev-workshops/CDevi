import type { AgentDecision, AgentRunDetail, EvidenceRef, RunStep } from '@cdevi/contracts';
import type { AgentRunEvent } from '@cdevi/contracts';

/** Fixtures for the Agent Run Inspector (specs/001 US5, ui-agent-run.md §5). Shapes follow `AgentRunDetail`. */
export const NOW = '2026-09-14T09:00:00.000Z';
const at = (minsAgo: number) => new Date(new Date(NOW).getTime() - minsAgo * 60_000).toISOString();
let n = 0;
const uuid = () => `00000000-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;

export const WORKFLOW_ID = uuid();
const WORKFLOW = {
  id: WORKFLOW_ID,
  externalId: 's500-001',
  title: 'Add rate limiting to /api/auth',
};

const ev = (minsAgo: number, kind: AgentRunEvent['kind'], message: string): AgentRunEvent => ({
  at: at(minsAgo),
  kind,
  message,
});
const step = (label: string, status: RunStep['status']): RunStep => ({ label, status });

const evidence = (
  over: Partial<EvidenceRef> & Pick<EvidenceRef, 'kind' | 'label'>,
): EvidenceRef => ({
  accessible: true,
  ...over,
});

export const decision = (position: number, over: Partial<AgentDecision> = {}): AgentDecision => ({
  id: uuid(),
  position,
  decidedAt: at(30 - position),
  action: `Action ${position}`,
  reason: `Reason ${position}`,
  confidence: 'HIGH',
  policyOutcome: 'ALLOWED',
  policyRef: null,
  riskLevel: null,
  evidence: [],
  ...over,
});

/** The seeded showcase run `s500-001-r7`: 4 steps (one running), 3 decisions incl. one restricted evidence ref. */
export function runRunning(over: Partial<AgentRunDetail> = {}): AgentRunDetail {
  return {
    id: uuid(),
    externalId: 's500-001-r7',
    agent: 'Review Agent',
    model: 'fable-5.1',
    state: 'RUNNING',
    startedAt: at(20),
    finishedAt: null,
    durationMs: 20 * 60_000,
    summary: 'Review complete; waiting for approval to open the PR.',
    workflow: WORKFLOW,
    stage: { position: 6, name: 'Approve' },
    steps: [
      step('Review the diff', 'completed'),
      step('Check test evidence', 'completed'),
      step('Wait for approval to open the PR', 'running'),
      step('Open the pull request', 'pending'),
    ],
    timeline: [
      ev(18, 'tool', 'Read the diff of 4 files'),
      ev(10, 'note', 'No blocking findings; 1 suggestion on error copy'),
      ev(5, 'error', 'Policy check timed out once; retried'),
      ev(1, 'decision', 'Opening a pull request needs human approval (policy)'),
    ],
    decisions: [
      decision(1, {
        decidedAt: at(15),
        action: 'Accepted the limiter diff without requesting changes',
        reason:
          'All four suites pass and the clock-skew fix has a regression test; the one suggestion (error copy) is not blocking.',
        confidence: 'HIGH',
        policyOutcome: 'ALLOWED',
        evidence: [
          evidence({
            kind: 'artifact',
            label: 'Test results — all suites',
            href: `/workflows/${WORKFLOW_ID}#artifact-s500-001-tests`,
            locator: 's500-001-tests',
          }),
          evidence({
            kind: 'ticket',
            label: 'PAY-231 — rate limiting for /api/auth',
            href: 'https://jira.acme.example/browse/PAY-231',
          }),
        ],
      }),
      decision(2, {
        decidedAt: at(8),
        action: 'Opening the pull request requires approval',
        reason: 'Policy POL-PR-01 requires a human approval before any pull request is opened.',
        confidence: 'MEDIUM',
        policyOutcome: 'APPROVAL_REQUIRED',
        policyRef: 'POL-PR-01',
        riskLevel: 'MEDIUM',
        evidence: [
          evidence({
            kind: 'url',
            label: 'Pull request policy',
            href: 'https://wiki.acme.example/policies/pull-requests',
          }),
        ],
      }),
      decision(3, {
        decidedAt: at(2),
        action: 'Did not read the production secrets file',
        reason: 'The file is outside the allowed paths for this agent.',
        confidence: 'HIGH',
        policyOutcome: 'DENIED',
        policyRef: 'POL-SEC-04',
        evidence: [
          evidence({
            kind: 'file',
            label: 'config/production.secrets.env',
            href: null,
            locator: 'config/production.secrets.env:1',
            accessible: false,
          }),
        ],
      }),
    ],
    ...over,
  };
}

/** A finished run: static duration, every step done. */
export function runCompleted(over: Partial<AgentRunDetail> = {}): AgentRunDetail {
  return runRunning({
    externalId: 's500-001-r4',
    agent: 'Implement Agent',
    state: 'COMPLETED',
    startedAt: at(220),
    finishedAt: at(100),
    durationMs: 120 * 60_000,
    summary: 'Implemented the limiter and wired it into /api/auth.',
    stage: { position: 4, name: 'Implement' },
    steps: [
      step('Read the implementation plan', 'completed'),
      step('Implement limiter module', 'completed'),
      step('Wire middleware into /api/auth', 'completed'),
      step('Typecheck', 'completed'),
    ],
    timeline: [
      ev(200, 'tool', 'Created src/auth/limiter.ts'),
      ev(140, 'tool', 'Ran pnpm typecheck — clean'),
    ],
    decisions: [
      decision(1, {
        decidedAt: at(205),
        action: 'Implement the limiter as a new module rather than extending authMiddleware',
        reason:
          'Keeps the middleware single-purpose and lets the limiter be unit-tested in isolation.',
        evidence: [
          evidence({
            kind: 'artifact',
            label: 'Implementation plan — sliding-window limiter',
            href: `/workflows/${WORKFLOW_ID}#artifact-s500-001-plan`,
            locator: 's500-001-plan',
          }),
          evidence({
            kind: 'pullRequest',
            label: 'payments-api#412',
            href: 'https://git.cdevi.demo/payments-api/pull/412',
          }),
        ],
      }),
      decision(2, {
        decidedAt: at(150),
        action: 'Did not add a dependency for the sliding window',
        reason: 'A third-party rate-limit package would need a security review.',
        confidence: 'MEDIUM',
        policyOutcome: 'DENIED',
        policyRef: 'POL-DEP-01',
      }),
    ],
    ...over,
  });
}

export const runRunningNoDecisions = (): AgentRunDetail => runRunning({ decisions: [] });
export const runRunningEmptySteps = (): AgentRunDetail => runRunning({ steps: [] });
export const runEmptyTimeline = (): AgentRunDetail => runRunning({ timeline: [] });
export const runFailedStep = (): AgentRunDetail =>
  runRunning({
    state: 'FAILED',
    finishedAt: at(1),
    durationMs: 19 * 60_000,
    steps: [step('Review the diff', 'completed'), step('Run the policy check', 'failed')],
  });
export const runHighRisk = (): AgentRunDetail =>
  runRunning({
    decisions: [decision(1, { riskLevel: 'HIGH', policyOutcome: 'APPROVAL_REQUIRED' })],
  });

/** RUNNING with every timestamp 40 minutes old → `runFreshness === 'stale'` at NOW. */
export const runStale = (): AgentRunDetail =>
  runRunning({
    startedAt: at(60),
    durationMs: 60 * 60_000,
    timeline: [
      ev(50, 'tool', 'Read the diff of 4 files'),
      ev(40, 'note', 'Waiting on the policy service'),
    ],
    decisions: [],
  });

/** Every list at its contract bound (50 timeline, 20 steps, 50 decisions × 20 evidence). */
export function runMaxBounds(): AgentRunDetail {
  return runRunning({
    steps: Array.from({ length: 20 }, (_, i) =>
      step(`Step ${i + 1}`, i < 10 ? 'completed' : i === 10 ? 'running' : 'pending'),
    ),
    timeline: Array.from({ length: 50 }, (_, i) => ev(50 - i, 'tool', `Event ${i + 1}`)),
    decisions: Array.from({ length: 50 }, (_, i) =>
      decision(i + 1, {
        evidence: Array.from({ length: 20 }, (_, j) =>
          evidence({
            kind: 'url',
            label: `Evidence ${j + 1}`,
            href: `https://example.test/${i}/${j}`,
          }),
        ),
      }),
    ),
  });
}

export const ALL_FIXTURES: Record<string, () => AgentRunDetail> = {
  runRunning: () => runRunning(),
  runCompleted: () => runCompleted(),
  runRunningNoDecisions,
  runRunningEmptySteps,
  runEmptyTimeline,
  runFailedStep,
  runHighRisk,
  runStale,
};
