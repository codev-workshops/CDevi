import { describe, expect, it } from 'vitest';
import {
  ApprovalUpsert,
  ClarificationUpsert,
  ExternalId,
  InboxQuery,
  SignInRequest,
  Transition,
  WorkflowUpsert,
} from '../src/index';

const T = '2026-09-14T09:00:00Z';

describe('ingestion schemas (data-model.md §6)', () => {
  it('externalId matches ^[A-Za-z0-9._:-]{1,128}$', () => {
    expect(ExternalId.safeParse('demo-live_1.a:b').success).toBe(true);
    expect(ExternalId.safeParse('has space').success).toBe(false);
    expect(ExternalId.safeParse('x'.repeat(129)).success).toBe(false);
    expect(ExternalId.safeParse('').success).toBe(false);
  });

  it('WorkflowUpsert: title ≤ 200 single-line trimmed, state enum, stage bounds, observedAt ISO', () => {
    const ok = { projectKey: 'payments-api', title: '  Add limiter  ', observedAt: T };
    const parsed = WorkflowUpsert.parse(ok);
    expect(parsed.title).toBe('Add limiter');
    expect(WorkflowUpsert.safeParse({ ...ok, title: 'x'.repeat(201) }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, title: 'two\nlines' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, title: '   ' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, state: 'DONE' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, state: 'RUNNING' }).success).toBe(true);
    expect(WorkflowUpsert.safeParse({ ...ok, stage: { index: 8, count: 7 } }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, stage: { index: 1, count: 21 } }).success).toBe(false);
    expect(
      WorkflowUpsert.safeParse({ ...ok, stage: { index: 3, count: 7, name: 'Impl' } }).success,
    ).toBe(true);
    expect(WorkflowUpsert.safeParse({ ...ok, observedAt: 'yesterday' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, reason: 'x'.repeat(241) }).success).toBe(false);
  });

  it('Transition: toState enum, observedAt required', () => {
    expect(
      Transition.safeParse({ toState: 'FAILED', observedAt: T, reason: '3 tests failing' }).success,
    ).toBe(true);
    expect(Transition.safeParse({ toState: 'PAUSED', observedAt: T }).success).toBe(false);
    expect(Transition.safeParse({ toState: 'FAILED' }).success).toBe(false);
  });

  it('ApprovalUpsert: ask ≤ 240, riskLevel enum, expiresAt after requestedAt', () => {
    const ok = {
      workflowExternalId: 'w1',
      ask: 'Approve: open a PR',
      riskLevel: 'HIGH',
      requestedAt: T,
    };
    expect(ApprovalUpsert.safeParse(ok).success).toBe(true);
    expect(ApprovalUpsert.safeParse({ ...ok, ask: 'x'.repeat(241) }).success).toBe(false);
    expect(ApprovalUpsert.safeParse({ ...ok, riskLevel: 'SEVERE' }).success).toBe(false);
    expect(ApprovalUpsert.safeParse({ ...ok, expiresAt: '2026-09-14T08:00:00Z' }).success).toBe(
      false,
    );
    expect(ApprovalUpsert.safeParse({ ...ok, expiresAt: '2026-09-14T13:00:00Z' }).success).toBe(
      true,
    );
    expect(
      ApprovalUpsert.safeParse({ ...ok, decision: { outcome: 'maybe', decidedAt: T } }).success,
    ).toBe(false);
  });

  it('ClarificationUpsert: question ≤ 240 single line, hasRecommendedAnswer defaults false', () => {
    const ok = { workflowExternalId: 'w1', question: 'Keep /session/v1?', requestedAt: T };
    expect(ClarificationUpsert.parse(ok).hasRecommendedAnswer).toBe(false);
    expect(ClarificationUpsert.safeParse({ ...ok, question: 'a\nb' }).success).toBe(false);
  });
});

describe('auth and query schemas', () => {
  it('SignInRequest: email ≤ 254, password 8..256', () => {
    expect(SignInRequest.safeParse({ email: 'a@b.co', password: 'longenough' }).success).toBe(true);
    expect(SignInRequest.safeParse({ email: 'not-an-email', password: 'longenough' }).success).toBe(
      false,
    );
    expect(SignInRequest.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(SignInRequest.safeParse({ email: 'a@b.co', password: 'x'.repeat(257) }).success).toBe(
      false,
    );
  });

  it('InboxQuery: tab enum, project uuid|all, cursor ≤ 200; limit is not client-settable', () => {
    expect(InboxQuery.parse({})).toEqual({ tab: 'needsYou', project: 'all' });
    expect(InboxQuery.safeParse({ tab: 'archive' }).success).toBe(false);
    expect(InboxQuery.safeParse({ project: 'payments' }).success).toBe(false);
    expect(InboxQuery.safeParse({ project: '0190a8f0-1234-7abc-8def-0123456789ab' }).success).toBe(
      true,
    );
    expect(InboxQuery.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false);
    expect('limit' in InboxQuery.parse({ limit: 500 } as never)).toBe(false);
  });
});
