import { describe, expect, it } from 'vitest';
import {
  agentRunHref,
  CONFIDENCE_WORDS,
  decisionAnchor,
  evidenceHref,
  POLICY_OUTCOME_WORDS,
  runDuration,
  runFreshness,
  STALE_RUN_AFTER_MS,
  stepsSummary,
  type EvidenceRefLike,
  type RunStepLike,
} from '../src/agent-run-model';

const NOW = new Date('2026-09-14T09:00:00.000Z');
const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000);
const iso = (minAgo: number) => at(minAgo).toISOString();

describe('US5 agent-run model (specs/001 US5, FR-016/FR-017/FR-018)', () => {
  it('FR-016 runDuration is finishedAt − startedAt when finished, now − startedAt while running, never negative', () => {
    expect(runDuration(at(30), at(10), NOW)).toBe(20 * 60_000);
    expect(runDuration(at(30), null, NOW)).toBe(30 * 60_000);
    expect(runDuration(new Date(NOW.getTime() + 5_000), null, NOW)).toBe(0);
    expect(runDuration(iso(30), iso(10), NOW)).toBe(20 * 60_000);
  });

  it('edge case "run exceeds duration": runFreshness is stale only for RUNNING|RETRYING with no timeline activity for > 30 min (last event at, else startedAt)', () => {
    expect(STALE_RUN_AFTER_MS).toBe(30 * 60_000);
    const running = (startedMinAgo: number, events: number[]) => ({
      state: 'RUNNING' as const,
      startedAt: at(startedMinAgo),
      timeline: events.map((m) => ({ at: iso(m), kind: 'tool' as const, message: 'x' })),
    });
    expect(runFreshness(running(10, []), NOW)).toBe('active');
    expect(runFreshness(running(30, []), NOW)).toBe('active');
    expect(runFreshness(running(31, []), NOW)).toBe('stale');
    // A recent timeline event keeps an old run active; the latest `at` wins regardless of order.
    expect(runFreshness(running(400, [5]), NOW)).toBe('active');
    expect(runFreshness(running(400, [200, 5, 90]), NOW)).toBe('active');
    expect(runFreshness(running(400, [200, 45, 90]), NOW)).toBe('stale');
    expect(runFreshness({ ...running(400, []), state: 'RETRYING' }, NOW)).toBe('stale');
    for (const state of [
      'WAITING',
      'WAITING_FOR_HUMAN',
      'BLOCKED',
      'FAILED',
      'COMPLETED',
      'CANCELLED',
    ] as const)
      expect(runFreshness({ ...running(400, []), state }, NOW), state).toBe('active');
    // ISO strings are accepted as well as Dates.
    expect(runFreshness({ state: 'RUNNING', startedAt: iso(31), timeline: [] }, NOW)).toBe('stale');
  });

  it('AS-3 stepsSummary counts steps by status and is all zeros for an empty array', () => {
    const steps: RunStepLike[] = [
      { label: 'Read ticket', status: 'completed' },
      { label: 'Plan', status: 'completed' },
      { label: 'Implement', status: 'running' },
      { label: 'Test', status: 'pending' },
      { label: 'Lint', status: 'failed' },
      { label: 'Review', status: 'pending' },
    ];
    expect(stepsSummary(steps)).toEqual({ completed: 2, running: 1, pending: 2, failed: 1 });
    expect(stepsSummary([])).toEqual({ completed: 0, running: 0, pending: 0, failed: 0 });
  });

  it('edge case "evidence the user cannot access": evidenceHref is null when accessible is false or there is no href, else the href', () => {
    const ref = (over: Partial<EvidenceRefLike>): EvidenceRefLike => ({
      kind: 'file',
      label: 'src/auth/limiter.ts',
      href: '/workflows/abc',
      locator: null,
      accessible: true,
      ...over,
    });
    expect(evidenceHref(ref({}))).toBe('/workflows/abc');
    expect(evidenceHref(ref({ href: 'https://git.example/pull/1' }))).toBe(
      'https://git.example/pull/1',
    );
    expect(evidenceHref(ref({ accessible: false }))).toBeNull();
    expect(evidenceHref(ref({ href: null }))).toBeNull();
    expect(evidenceHref(ref({ href: undefined }))).toBeNull();
    expect(evidenceHref(ref({ href: '' }))).toBeNull();
  });

  it('FR-017 POLICY_OUTCOME_WORDS and CONFIDENCE_WORDS give a word for every value', () => {
    expect(POLICY_OUTCOME_WORDS).toEqual({
      ALLOWED: 'Allowed',
      APPROVAL_REQUIRED: 'Approval required',
      DENIED: 'Denied',
    });
    expect(CONFIDENCE_WORDS).toEqual({ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' });
  });

  it('FR-016 agentRunHref and decisionAnchor compose the screen route and the per-decision anchor', () => {
    expect(agentRunHref('00000000-0000-7000-8000-000000000001')).toBe(
      '/agents/runs/00000000-0000-7000-8000-000000000001',
    );
    expect(decisionAnchor(1)).toBe('decision-1');
    expect(decisionAnchor(50)).toBe('decision-50');
  });
});
