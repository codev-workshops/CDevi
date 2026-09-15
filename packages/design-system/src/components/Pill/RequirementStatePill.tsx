import { forwardRef } from 'react';
import { requirementStateToPill, type RequirementState } from '../../tokens';
import { Pill, type PillProps } from './Pill';

export interface RequirementStatePillProps extends Omit<
  PillProps,
  'variant' | 'pulse' | 'children'
> {
  state: RequirementState;
  /** Override the displayed word (e.g. localisation). The state's word is the default. */
  children?: string;
}

/** Requirement lifecycle state as a word in a pill, via the normative requirement mapping (FR-009). */
export const RequirementStatePill = forwardRef<HTMLSpanElement, RequirementStatePillProps>(
  function RequirementStatePill({ state, children, ...rest }, ref) {
    const p = requirementStateToPill[state];
    return (
      <Pill ref={ref} variant={p.variant} pulse={p.pulse} data-state={state} {...rest}>
        {children ?? p.word}
      </Pill>
    );
  },
);
