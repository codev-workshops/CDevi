import { describe, expect, it } from 'vitest';
import {
  canTransition,
  classifyTab,
  decodeCursor,
  deriveAsk,
  deriveKind,
  encodeCursor,
  expiryLabel,
  humanAgo,
  humanDuration,
  isStale,
  orderDone,
  orderNeedsYou,
  orderRunning,
  riskRank,
  WORKFLOW_STATES,
  type InboxRowSource,
} from '../src/index';

const NOW = new Date('2026-09-14T09:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const m = 60_000;
const h = 60 * m;
const d = 24 * h;

const base = (over: Partial<InboxRowSource>): InboxRowSource => ({
  workflowId: '00000000-0000-7000-8000-000000000001',
  state: 'RUNNING',
  stateObservedAt: ago(10 * m),
  stateReason: null,
  stageIndex: null,
  stageName: null,
  startedAt: ago(10 * m),
  finishedAt: null,
  approval: null,
  clarification: null,
  ...over,
});

describe('classifyTab (§1)', () => {
  it('maps the nine states to tabs; done requires finishedAt within 7 days', () => {
    expect(classifyTab('WAITING_FOR_HUMAN', null, NOW)).toBe('needsYou');
    expect(classifyTab('BLOCKED', null, NOW)).toBe('needsYou');
    expect(classifyTab('FAILED', null, NOW)).toBe('needsYou');
    for (const s of ['QUEUED', 'RUNNING', 'RETRYING', 'WAITING'] as const)
      expect(classifyTab(s, null, NOW)).toBe('running');
    expect(classifyTab('COMPLETED', ago(6 * d), NOW)).toBe('done');
    expect(classifyTab('CANCELLED', ago(6 * d), NOW)).toBe('done');
    expect(classifyTab('COMPLETED', ago(8 * d), NOW)).toBeNull();
    expect(classifyTab('COMPLETED', null, NOW)).toBeNull();
  });
});

describe('deriveKind and deriveAsk (§2, §3)', () => {
  it('approval wins over clarification; inconsistent WAITING_FOR_HUMAN is shown as blocked', () => {
    const appr = {
      id: 'a1',
      ask: 'Approve: open a PR against `main`',
      riskLevel: 'HIGH' as const,
      requestedAt: ago(40 * m),
      expiresAt: null,
      hasRecommendedAnswer: false,
    };
    const clar = {
      id: 'c1',
      question: 'Keep `/session/v1`?',
      requestedAt: ago(2 * h),
      hasRecommendedAnswer: true,
    };
    expect(
      deriveKind(base({ state: 'WAITING_FOR_HUMAN', approval: appr, clarification: clar })),
    ).toBe('approval');
    expect(deriveKind(base({ state: 'WAITING_FOR_HUMAN', clarification: clar }))).toBe(
      'clarification',
    );
    const orphan = base({ state: 'WAITING_FOR_HUMAN' });
    expect(deriveKind(orphan)).toBe('blocked');
    expect(deriveAsk(orphan)).toBe('Waiting for a person — no request recorded');
    expect(deriveKind(base({ state: 'BLOCKED' }))).toBe('blocked');
    expect(deriveKind(base({ state: 'FAILED' }))).toBe('failed');
    expect(deriveKind(base({ state: 'RUNNING' }))).toBe('running');
    expect(deriveKind(base({ state: 'COMPLETED', finishedAt: ago(h) }))).toBe('done');
  });

  it('asks per kind', () => {
    expect(
      deriveAsk(
        base({
          state: 'WAITING_FOR_HUMAN',
          approval: {
            id: 'a',
            ask: 'Approve: X',
            riskLevel: 'LOW',
            requestedAt: NOW,
            expiresAt: null,
            hasRecommendedAnswer: false,
          },
        }),
      ),
    ).toBe('Approve: X');
    expect(
      deriveAsk(
        base({
          state: 'WAITING_FOR_HUMAN',
          clarification: { id: 'c', question: 'Q?', requestedAt: NOW, hasRecommendedAnswer: false },
        }),
      ),
    ).toBe('Q?');
    expect(deriveAsk(base({ state: 'BLOCKED', stateReason: 'issue tracker unreachable' }))).toBe(
      'Blocked: issue tracker unreachable',
    );
    expect(deriveAsk(base({ state: 'BLOCKED' }))).toBe('Blocked: reason not provided');
    expect(
      deriveAsk(
        base({ state: 'FAILED', stageName: 'Testing', stateReason: '3 unit tests failing' }),
      ),
    ).toBe('Failed at Testing: 3 unit tests failing');
    expect(deriveAsk(base({ state: 'FAILED', stageIndex: 4 }))).toBe(
      'Failed at stage 4: reason not provided',
    );
    expect(deriveAsk(base({ state: 'FAILED' }))).toBe(
      'Failed at unknown stage: reason not provided',
    );
    expect(deriveAsk(base({ state: 'RUNNING' }))).toBeNull();
  });
});

describe('ordering (§4)', () => {
  const appr = (id: string, risk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', at: Date) =>
    base({
      workflowId: id,
      state: 'WAITING_FOR_HUMAN',
      approval: {
        id: 'a' + id,
        ask: 'x',
        riskLevel: risk,
        requestedAt: at,
        expiresAt: null,
        hasRecommendedAnswer: false,
      },
    });
  it('riskRank', () => {
    expect([
      riskRank('CRITICAL'),
      riskRank('HIGH'),
      riskRank('MEDIUM'),
      riskRank('LOW'),
      riskRank(null),
    ]).toEqual([0, 1, 2, 3, 4]);
  });
  it('needsYou: risk rank, then raisedAt ascending, then id — the worked example', () => {
    const rows = [
      appr('1', 'HIGH', ago(40 * m)),
      appr('2', 'MEDIUM', ago(4 * m)),
      base({
        workflowId: '3',
        state: 'WAITING_FOR_HUMAN',
        clarification: {
          id: 'c3',
          question: 'q',
          requestedAt: ago(2 * h),
          hasRecommendedAnswer: false,
        },
      }),
      base({ workflowId: '4', state: 'BLOCKED', stateObservedAt: ago(10 * m) }),
      base({ workflowId: '5', state: 'FAILED', stateObservedAt: ago(3 * d) }),
    ];
    expect([...rows].sort(orderNeedsYou).map((r) => r.workflowId)).toEqual([
      '1',
      '2',
      '5',
      '3',
      '4',
    ]);
    const tie = [appr('b', 'LOW', NOW), appr('a', 'LOW', NOW)];
    expect(tie.sort(orderNeedsYou).map((r) => r.workflowId)).toEqual(['a', 'b']);
  });
  it('running: startedAt desc, QUEUED (no startedAt) last', () => {
    const rows = [
      base({ workflowId: 'q', state: 'QUEUED', startedAt: null }),
      base({ workflowId: 'old', startedAt: ago(h) }),
      base({ workflowId: 'new', startedAt: ago(m) }),
    ];
    expect(rows.sort(orderRunning).map((r) => r.workflowId)).toEqual(['new', 'old', 'q']);
  });
  it('done: finishedAt desc', () => {
    const rows = [
      base({ workflowId: 'old', state: 'COMPLETED', finishedAt: ago(d) }),
      base({ workflowId: 'new', state: 'CANCELLED', finishedAt: ago(h) }),
    ];
    expect(rows.sort(orderDone).map((r) => r.workflowId)).toEqual(['new', 'old']);
  });
});

describe('stale, expiry and labels (§5, §6)', () => {
  it('isStale is strictly greater than 24 h and only for needsYou', () => {
    expect(isStale('needsYou', ago(24 * h), NOW)).toBe(false);
    expect(isStale('needsYou', ago(24 * h + 1), NOW)).toBe(true);
    expect(isStale('running', ago(3 * d), NOW)).toBe(false);
  });
  it('expiryLabel', () => {
    expect(expiryLabel(new Date(NOW.getTime() + 3 * h + 56 * m + 30_000), NOW)).toBe(
      'times out in 3 h 56 m',
    );
    expect(expiryLabel(new Date(NOW.getTime() + 2 * d + 4 * h), NOW)).toBe('times out in 2 d 4 h');
    expect(expiryLabel(new Date(NOW.getTime() + 20_000), NOW)).toBe('times out in < 1 m');
    expect(expiryLabel(NOW, NOW)).toBe('expired');
    expect(expiryLabel(ago(m), NOW)).toBe('expired');
  });
  it('humanDuration and humanAgo', () => {
    expect(humanDuration(12 * m)).toBe('12 m');
    expect(humanDuration(3 * h + 56 * m)).toBe('3 h 56 m');
    expect(humanDuration(2 * d + 4 * h + 5 * m)).toBe('2 d 4 h');
    expect(humanDuration(30_000)).toBe('< 1 m');
    expect(humanAgo(ago(20_000), NOW)).toBe('just now');
    expect(humanAgo(ago(4 * m), NOW)).toBe('4 min ago');
    expect(humanAgo(ago(3 * h), NOW)).toBe('3 h ago');
    expect(humanAgo(ago(2 * d), NOW)).toBe('2 d ago');
  });
});

describe('cursor (§7)', () => {
  it('round-trips per tab and rejects a shape mismatch', () => {
    const c = encodeCursor('needsYou', [1, NOW.toISOString(), 'id-1']);
    expect(decodeCursor('needsYou', c)).toEqual([1, NOW.toISOString(), 'id-1']);
    expect(() => decodeCursor('running', c)).toThrow(/cursor/i);
    expect(() => decodeCursor('needsYou', 'not-base64!')).toThrow(/cursor/i);
    const r = encodeCursor('running', [null, 'id-2']);
    expect(decodeCursor('running', r)).toEqual([null, 'id-2']);
  });
});

describe('transition table (data-model.md §3)', () => {
  it('allows exactly the listed pairs', () => {
    expect(canTransition(null, 'QUEUED')).toBe(true);
    expect(canTransition(null, 'RUNNING')).toBe(true);
    expect(canTransition(null, 'COMPLETED')).toBe(false);
    expect(canTransition('RUNNING', 'WAITING_FOR_HUMAN')).toBe(true);
    expect(canTransition('WAITING_FOR_HUMAN', 'RUNNING')).toBe(true);
    expect(canTransition('WAITING_FOR_HUMAN', 'QUEUED')).toBe(false);
    expect(canTransition('FAILED', 'RETRYING')).toBe(true);
    expect(canTransition('BLOCKED', 'QUEUED')).toBe(true);
    for (const to of WORKFLOW_STATES) {
      expect(canTransition('COMPLETED', to)).toBe(false);
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
    expect(canTransition('RUNNING', 'RUNNING')).toBe(false);
  });
});
