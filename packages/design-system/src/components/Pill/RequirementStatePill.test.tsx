import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { REQUIREMENT_STATES, requirementStateToPill, type RequirementState } from '../../tokens';
import { RequirementStatePill } from './RequirementStatePill';

const EXPECTED: Record<RequirementState, [variant: string, word: string, pulse: boolean]> = {
  DRAFT: ['neutral', 'draft', false],
  ANALYZING: ['run', 'analyzing', true],
  NEEDS_CLARIFICATION: ['needs-you', 'needs clarification', false],
  READY: ['neutral', 'ready', false],
  APPROVED: ['done', 'approved', false],
  IN_IMPLEMENTATION: ['run', 'in implementation', true],
  COMPLETED: ['done', 'completed', false],
  REJECTED: ['fail', 'rejected', false],
};

describe('RequirementStatePill (specs/001 US4, FR-009, DESIGN.md §4)', () => {
  it('FR-009 requirementStateToPill covers all eight requirement states with the normative variant, word and pulse', () => {
    expect([...REQUIREMENT_STATES].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const state of REQUIREMENT_STATES) {
      const [variant, word, pulse] = EXPECTED[state];
      expect(requirementStateToPill[state], state).toEqual({ variant, word, pulse });
    }
  });

  it('FR-009 renders the mapped word as content with the variant class and data-state', () => {
    renderThemed(<RequirementStatePill state="NEEDS_CLARIFICATION" className="extra" />);
    const pill = screen.getByText('needs clarification');
    expect(pill).toHaveClass('cd-pill', 'cd-needs-you', 'extra');
    expect(pill).toHaveAttribute('data-state', 'NEEDS_CLARIFICATION');
    expect(pill.querySelector('.cd-dot')).toBeNull();
  });

  it('FR-009 pulses only for ANALYZING and IN_IMPLEMENTATION', () => {
    renderThemed(
      <>
        {REQUIREMENT_STATES.map((s) => (
          <RequirementStatePill key={s} state={s} />
        ))}
      </>,
    );
    for (const s of REQUIREMENT_STATES) {
      const pill = screen.getByText(requirementStateToPill[s].word);
      const dot = pill.querySelector('.cd-dot');
      if (requirementStateToPill[s].pulse) expect(dot).toHaveAttribute('aria-hidden', 'true');
      else expect(dot).toBeNull();
    }
  });

  it('SC-010 is accessible in both themes', async () => {
    await expectAccessible(
      <p>
        {REQUIREMENT_STATES.map((s) => (
          <RequirementStatePill key={s} state={s} />
        ))}
      </p>,
    );
  });
});
