import { describe, expect, it } from 'vitest';
import {
  blockingOpenCount,
  blockingPill,
  canActOnFinding,
  canActOnFindingState,
  cycleProgress,
  cycleStateWord,
  decodeReviewCursor,
  encodeReviewCursor,
  FINDING_BLOCKING_CLASSES,
  FINDING_SEVERITIES,
  FINDING_STATES,
  findingStateWord,
  iterationWord,
  isFindingOpen,
  LANE_STATUSES,
  laneStatusFromFindings,
  laneStatusWord,
  laneWord,
  mergeReadinessNotice,
  readyForMerge,
  REVIEW_CYCLE_STATES,
  REVIEW_LANE_WORDS,
  REVIEW_LANES,
  REVIEW_STATUSES,
  reviewHref,
  REVIEWS_PAGE_SIZE,
  reviewStatusWord,
  PULL_REQUEST_STATUSES,
  pullRequestStatusWord,
  severityPill,
  toDesignBlocking,
  type FindingLike,
} from '../src/review-model';
import { InvalidCursorError } from '../src/read-model';

const finding = (over: Partial<FindingLike> = {}): FindingLike => ({
  lane: 'security',
  blocking: 'BLOCKING',
  state: 'OPEN',
  ...over,
});

describe('US6 review model (specs/001 US6, FR-020/FR-021/FR-022)', () => {
  it('FR-020 REVIEW_LANES is the ordered seven-lane tuple of UI spec §20 and every lane has a display word (edge_cases → "Edge Cases")', () => {
    expect(REVIEW_LANES).toEqual([
      'correctness',
      'security',
      'dependencies',
      'edge_cases',
      'testing',
      'architecture',
      'general',
    ]);
    expect(REVIEW_LANE_WORDS).toEqual({
      correctness: 'Correctness',
      security: 'Security',
      dependencies: 'Dependencies',
      edge_cases: 'Edge Cases',
      testing: 'Testing',
      architecture: 'Architecture',
      general: 'General',
    });
    for (const lane of REVIEW_LANES) expect(laneWord(lane)).toBe(REVIEW_LANE_WORDS[lane]);
  });

  it('FR-020 the vocabularies match the 0007 enums and laneStatusWord / reviewStatusWord / cycleStateWord give a word for every value', () => {
    expect(LANE_STATUSES).toEqual(['PASS', 'WARN', 'FAIL']);
    expect(REVIEW_STATUSES).toEqual(['RUNNING', 'COMPLETE', 'FAILED']);
    expect(FINDING_SEVERITIES).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
    expect(FINDING_BLOCKING_CLASSES).toEqual(['BLOCKING', 'NON_BLOCKING', 'SUGGESTION']);
    expect(FINDING_STATES).toEqual(['OPEN', 'FIX_REQUESTED', 'FIXED', 'DISMISSED', 'ISSUE_REQUESTED']);
    expect(REVIEW_CYCLE_STATES).toEqual(['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
    expect(PULL_REQUEST_STATUSES).toEqual(['OPEN', 'MERGED', 'CLOSED']);
    expect(PULL_REQUEST_STATUSES.map(pullRequestStatusWord)).toEqual(['open', 'merged', 'closed']);
    expect(laneStatusWord('PASS')).toBe('Pass');
    expect(laneStatusWord('WARN')).toBe('Warn');
    expect(laneStatusWord('FAIL')).toBe('Fail');
    expect(reviewStatusWord('RUNNING')).toBe('AI review running');
    expect(reviewStatusWord('COMPLETE')).toBe('AI review complete');
    expect(reviewStatusWord('FAILED')).toBe('AI review failed');
    expect(cycleStateWord('RUNNING')).toBe('Running');
    expect(cycleStateWord('COMPLETED')).toBe('Completed');
    expect(cycleStateWord('FAILED')).toBe('Failed');
    expect(cycleStateWord('CANCELLED')).toBe('Cancelled');
  });

  it('FR-020 severityPill maps to the FindingRow / DESIGN.md §161 words and variants: CRITICAL blocked, HIGH fail, MEDIUM wait, LOW/INFO neutral', () => {
    expect(severityPill('CRITICAL')).toEqual({ word: 'critical', variant: 'blocked' });
    expect(severityPill('HIGH')).toEqual({ word: 'high', variant: 'fail' });
    expect(severityPill('MEDIUM')).toEqual({ word: 'medium', variant: 'wait' });
    expect(severityPill('LOW')).toEqual({ word: 'low', variant: 'neutral' });
    expect(severityPill('INFO')).toEqual({ word: 'info', variant: 'neutral' });
  });

  it('FR-020 blockingPill: BLOCKING is needs-you (saffron), NON_BLOCKING and SUGGESTION are neutral; toDesignBlocking spells NON-BLOCKING for the design system', () => {
    expect(blockingPill('BLOCKING')).toEqual({ word: 'blocking', variant: 'needs-you' });
    expect(blockingPill('NON_BLOCKING')).toEqual({ word: 'non-blocking', variant: 'neutral' });
    expect(blockingPill('SUGGESTION')).toEqual({ word: 'suggestion', variant: 'neutral' });
    expect(toDesignBlocking('BLOCKING')).toBe('BLOCKING');
    expect(toDesignBlocking('NON_BLOCKING')).toBe('NON-BLOCKING');
    expect(toDesignBlocking('SUGGESTION')).toBe('SUGGESTION');
  });

  it('FR-021 findingStateWord: Open, Fix requested, Fixed, Dismissed, Issue requested; isFindingOpen is true for OPEN and FIX_REQUESTED only', () => {
    expect(findingStateWord('OPEN')).toBe('Open');
    expect(findingStateWord('FIX_REQUESTED')).toBe('Fix requested');
    expect(findingStateWord('FIXED')).toBe('Fixed');
    expect(findingStateWord('DISMISSED')).toBe('Dismissed');
    expect(findingStateWord('ISSUE_REQUESTED')).toBe('Issue requested');
    expect(isFindingOpen('OPEN')).toBe(true);
    expect(isFindingOpen('FIX_REQUESTED')).toBe(true);
    for (const s of ['FIXED', 'DISMISSED', 'ISSUE_REQUESTED'] as const)
      expect(isFindingOpen(s), s).toBe(false);
  });

  it('FR-022 readyForMerge is false iff a BLOCKING finding is OPEN or FIX_REQUESTED; blockingOpenCount counts exactly those', () => {
    expect(readyForMerge([])).toBe(true);
    expect(blockingOpenCount([])).toBe(0);
    expect(readyForMerge([finding()])).toBe(false);
    expect(readyForMerge([finding({ state: 'FIX_REQUESTED' })])).toBe(false);
    for (const state of ['FIXED', 'DISMISSED', 'ISSUE_REQUESTED'] as const)
      expect(readyForMerge([finding({ state })]), state).toBe(true);
    // Open non-blocking findings never block the merge.
    expect(readyForMerge([finding({ blocking: 'NON_BLOCKING' })])).toBe(true);
    expect(readyForMerge([finding({ blocking: 'SUGGESTION' })])).toBe(true);
    const mixed = [
      finding(),
      finding({ state: 'FIX_REQUESTED', lane: 'correctness' }),
      finding({ state: 'FIXED' }),
      finding({ state: 'DISMISSED' }),
      finding({ blocking: 'NON_BLOCKING' }),
      finding({ blocking: 'SUGGESTION', state: 'ISSUE_REQUESTED' }),
    ];
    expect(blockingOpenCount(mixed)).toBe(2);
    expect(readyForMerge(mixed)).toBe(false);
  });

  it('FR-022 mergeReadinessNotice is the "Not ready for merge approval — N blocking findings open" text (singular for 1) and null when ready', () => {
    expect(mergeReadinessNotice([])).toBeNull();
    expect(mergeReadinessNotice([finding()])).toBe(
      'Not ready for merge approval — 1 blocking finding open',
    );
    expect(mergeReadinessNotice([finding(), finding({ lane: 'testing' })])).toBe(
      'Not ready for merge approval — 2 blocking findings open',
    );
  });

  it('FR-020 laneStatusFromFindings: FAIL when an open BLOCKING finding is in the lane, WARN when only open NON_BLOCKING ones, else PASS (open SUGGESTIONs never change the lane); other lanes are ignored', () => {
    expect(laneStatusFromFindings('security', [])).toBe('PASS');
    expect(laneStatusFromFindings('security', [finding()])).toBe('FAIL');
    expect(laneStatusFromFindings('security', [finding({ state: 'FIX_REQUESTED' })])).toBe('FAIL');
    expect(laneStatusFromFindings('security', [finding({ blocking: 'NON_BLOCKING' })])).toBe('WARN');
    expect(laneStatusFromFindings('security', [finding({ blocking: 'SUGGESTION' })])).toBe('PASS');
    expect(
      laneStatusFromFindings('security', [
        finding({ blocking: 'NON_BLOCKING' }),
        finding({ state: 'FIX_REQUESTED' }),
      ]),
    ).toBe('FAIL');
    expect(laneStatusFromFindings('security', [finding({ state: 'FIXED' })])).toBe('PASS');
    expect(laneStatusFromFindings('security', [finding({ state: 'DISMISSED' })])).toBe('PASS');
    expect(laneStatusFromFindings('correctness', [finding()])).toBe('PASS');
    expect(
      laneStatusFromFindings('correctness', [
        finding(),
        finding({ lane: 'correctness', blocking: 'NON_BLOCKING' }),
      ]),
    ).toBe('WARN');
    expect(
      laneStatusFromFindings('correctness', [
        finding({ lane: 'correctness', blocking: 'SUGGESTION' }),
        finding({ lane: 'correctness', blocking: 'NON_BLOCKING', state: 'DISMISSED' }),
      ]),
    ).toBe('PASS');
  });

  it('AS-4 cycleProgress is fixedCount of findingsCount for Progress (clamped to the max) and iterationWord reads "Iteration 3 of 5"', () => {
    const cycle = {
      findingsCount: 7,
      fixedCount: 6,
      remainingCount: 1,
      iteration: 3,
      maxIterations: 5,
    };
    expect(cycleProgress(cycle)).toEqual({ value: 6, max: 7 });
    expect(cycleProgress({ ...cycle, findingsCount: 0, fixedCount: 0 })).toEqual({
      value: 0,
      max: 0,
    });
    expect(cycleProgress({ ...cycle, fixedCount: 9 })).toEqual({ value: 7, max: 7 });
    expect(iterationWord(cycle)).toBe('Iteration 3 of 5');
  });

  it('FR-032 canActOnFinding is true for engineer, approver and administrator and false for viewer; canActOnFindingState only for OPEN', () => {
    expect(canActOnFinding('engineer')).toBe(true);
    expect(canActOnFinding('approver')).toBe(true);
    expect(canActOnFinding('administrator')).toBe(true);
    expect(canActOnFinding('viewer')).toBe(false);
    expect(canActOnFindingState('OPEN')).toBe(true);
    for (const s of ['FIX_REQUESTED', 'FIXED', 'DISMISSED', 'ISSUE_REQUESTED'] as const)
      expect(canActOnFindingState(s), s).toBe(false);
  });

  it('FR-025 reviewHref composes /reviews/{pullRequestId}; the list is bounded to 50 with a tagged keyset cursor', () => {
    expect(reviewHref('00000000-0000-7000-8000-000000000001')).toBe(
      '/reviews/00000000-0000-7000-8000-000000000001',
    );
    expect(REVIEWS_PAGE_SIZE).toBe(50);
    const key = { updatedAt: '2026-09-14T09:00:00.000Z', id: '00000000-0000-7000-8000-000000000001' };
    const cursor = encodeReviewCursor(key);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeReviewCursor(cursor)).toEqual(key);
    expect(() => decodeReviewCursor('not-a-cursor')).toThrow(InvalidCursorError);
    expect(() =>
      decodeReviewCursor(Buffer.from(JSON.stringify(['requirements', key.updatedAt, key.id])).toString('base64url')),
    ).toThrow(InvalidCursorError);
  });
});
