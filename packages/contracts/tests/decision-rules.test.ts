import { describe, expect, it } from 'vitest';
import {
  answerIsValid,
  canDecide,
  canTransition,
  decisionAllowed,
  orderApprovalCenter,
  requiresConfirmation,
  resultingState,
  RISK_LEVELS,
  ROLES,
  WORKFLOW_STATES,
  type ApprovalCenterOrderSource,
} from '../src/index';

const id = (n: number) => `00000000-0000-7000-8000-00000000000${n}`;

describe('decision rules (specs/001 contracts/decision-rules.md)', () => {
  it('FR-032 canDecide allows approver and administrator only', () => {
    expect(ROLES.filter(canDecide)).toEqual(['administrator', 'approver']);
    expect(canDecide('engineer')).toBe(false);
    expect(canDecide('viewer')).toBe(false);
  });

  it('FR-013 requiresConfirmation is true for HIGH and CRITICAL only', () => {
    expect(RISK_LEVELS.filter(requiresConfirmation)).toEqual(['HIGH', 'CRITICAL']);
    expect(requiresConfirmation(null)).toBe(false);
  });

  it('FR-014 resultingState maps approve/answer to RUNNING and reject to its target', () => {
    expect(resultingState({ kind: 'approve' })).toBe('RUNNING');
    expect(resultingState({ kind: 'answer' })).toBe('RUNNING');
    expect(resultingState({ kind: 'reject', target: 'BLOCKED' })).toBe('BLOCKED');
    expect(resultingState({ kind: 'reject', target: 'CANCELLED' })).toBe('CANCELLED');
  });

  it('FR-015 decisionAllowed requires WAITING_FOR_HUMAN and a pending item', () => {
    expect(decisionAllowed('WAITING_FOR_HUMAN', true)).toBe(true);
    expect(decisionAllowed('WAITING_FOR_HUMAN', false)).toBe(false);
    for (const s of WORKFLOW_STATES.filter((s) => s !== 'WAITING_FOR_HUMAN')) {
      expect(decisionAllowed(s, true)).toBe(false);
    }
  });

  it('FR-015 every resulting state satisfies canTransition from WAITING_FOR_HUMAN', () => {
    for (const d of [
      { kind: 'approve' } as const,
      { kind: 'answer' } as const,
      { kind: 'reject', target: 'BLOCKED' } as const,
      { kind: 'reject', target: 'CANCELLED' } as const,
    ]) {
      expect(canTransition('WAITING_FOR_HUMAN', resultingState(d))).toBe(true);
    }
  });

  it('FR-011 orderApprovalCenter sorts risk desc, requestedAt asc, id asc with clarifications last (worked example B, D, A, E, C)', () => {
    const at = (t: string) => new Date(`2026-09-14T${t}:00Z`);
    const items: ApprovalCenterOrderSource[] = [
      { id: id(1), riskLevel: 'MEDIUM', requestedAt: at('09:00') }, // A
      { id: id(2), riskLevel: 'CRITICAL', requestedAt: at('09:30') }, // B
      { id: id(3), riskLevel: null, requestedAt: at('08:00') }, // C clarification
      { id: id(4), riskLevel: 'MEDIUM', requestedAt: at('08:30') }, // D
      { id: id(5), riskLevel: 'LOW', requestedAt: at('07:00') }, // E
    ];
    expect([...items].sort(orderApprovalCenter).map((i) => i.id)).toEqual([
      id(2),
      id(4),
      id(1),
      id(5),
      id(3),
    ]);
    // tie on risk and time → id ascending
    const tie: ApprovalCenterOrderSource[] = [
      { id: id(9), riskLevel: 'LOW', requestedAt: at('07:00') },
      { id: id(8), riskLevel: 'LOW', requestedAt: at('07:00') },
    ];
    expect([...tie].sort(orderApprovalCenter).map((i) => i.id)).toEqual([id(8), id(9)]);
  });

  it('FR-014 answerIsValid requires exactly one of option/text, known option, trimmed text 1–2000', () => {
    const options = [
      { value: 'oidc', label: 'OIDC', recommended: true },
      { value: 'saml', label: 'SAML', recommended: false },
    ];
    expect(answerIsValid({ option: 'oidc' }, options)).toEqual({
      ok: true,
      option: 'oidc',
      text: 'OIDC',
    });
    expect(answerIsValid({ text: '  Use magic links  ' }, options)).toEqual({
      ok: true,
      option: null,
      text: 'Use magic links',
    });
    expect(answerIsValid({}, options)).toMatchObject({ ok: false, path: 'answer' });
    expect(answerIsValid({ option: 'oidc', text: 'x' }, options)).toMatchObject({
      ok: false,
      path: 'answer',
    });
    expect(answerIsValid({ option: 'ldap' }, options)).toMatchObject({ ok: false, path: 'option' });
    expect(answerIsValid({ text: '   ' }, options)).toMatchObject({ ok: false, path: 'text' });
    expect(answerIsValid({ text: 'x'.repeat(2001) }, options)).toMatchObject({
      ok: false,
      path: 'text',
    });
  });
});
