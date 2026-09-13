import { describe, expect, it } from 'vitest';
import {
  RISK_LEVELS,
  WORKFLOW_STATES,
  blockingToPill,
  policyOutcomeToPill,
  riskToVariant,
  severityToPill,
  stateToPill,
} from './tokens';

describe('stateToPill (contracts/state-risk-mapping.md)', () => {
  it('is total over all nine workflow states', () => {
    expect(WORKFLOW_STATES).toHaveLength(9);
    for (const s of WORKFLOW_STATES) {
      expect(stateToPill[s].word.length, s).toBeGreaterThan(0);
    }
    expect(Object.keys(stateToPill).sort()).toEqual([...WORKFLOW_STATES].sort());
  });

  it('BLOCKED and FAILED use different variants', () => {
    expect(stateToPill.BLOCKED.variant).toBe('blocked');
    expect(stateToPill.FAILED.variant).toBe('fail');
    expect(stateToPill.BLOCKED.variant).not.toBe(stateToPill.FAILED.variant);
  });

  it('WAITING_FOR_HUMAN uses the needs-you treatment and is not the plain wait pill', () => {
    expect(stateToPill.WAITING_FOR_HUMAN.variant).toBe('needs-you');
    expect(stateToPill.WAITING.variant).toBe('wait');
    expect(stateToPill.WAITING_FOR_HUMAN.word).toBe('needs you');
  });

  it('only RUNNING and RETRYING pulse', () => {
    const pulsing = WORKFLOW_STATES.filter((s) => stateToPill[s].pulse);
    expect(pulsing.sort()).toEqual(['RETRYING', 'RUNNING']);
  });

  it('CANCELLED is neutral, struck through, and says "cancelled"', () => {
    expect(stateToPill.CANCELLED).toEqual({
      variant: 'neutral',
      word: 'cancelled',
      pulse: false,
      modifier: 'cd-cancelled',
    });
  });
});

describe('riskToVariant', () => {
  it('is total over the four levels; HIGH and CRITICAL are prominent; words end with "risk"', () => {
    expect(RISK_LEVELS).toHaveLength(4);
    for (const l of RISK_LEVELS) {
      expect(riskToVariant[l].word.endsWith('risk'), l).toBe(true);
      expect(riskToVariant[l].variant).toBe(l.toLowerCase());
    }
    expect(riskToVariant.HIGH.prominent).toBe(true);
    expect(riskToVariant.CRITICAL.prominent).toBe(true);
    expect(riskToVariant.LOW.prominent).toBe(false);
    expect(riskToVariant.MEDIUM.prominent).toBe(false);
  });
});

describe('finding and policy vocabulary', () => {
  it('maps every severity, blocking class and policy outcome', () => {
    expect(Object.keys(severityToPill)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
    expect(Object.keys(blockingToPill)).toEqual(['BLOCKING', 'NON-BLOCKING', 'SUGGESTION']);
    expect(policyOutcomeToPill.denied.variant).toBe('blocked');
    expect(policyOutcomeToPill.approval_required.variant).toBe('needs-you');
    expect(policyOutcomeToPill.allowed.variant).toBe('done');
  });
});
