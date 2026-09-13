import { forwardRef } from 'react';
import { cx } from '../../lib/cx';
import { stateToPill, type WorkflowState } from '../../tokens';
import { Pill, type PillProps } from './Pill';

export interface StatePillProps extends Omit<PillProps, 'variant' | 'pulse' | 'children'> {
  state: WorkflowState;
  /** Override the displayed word (e.g. localisation). The state's word is the default. */
  children?: string;
}

/** Workflow state as a word in a pill, via the normative state mapping. */
export const StatePill = forwardRef<HTMLSpanElement, StatePillProps>(function StatePill(
  { state, className, children, ...rest },
  ref,
) {
  const p = stateToPill[state];
  return (
    <Pill
      ref={ref}
      variant={p.variant}
      pulse={p.pulse}
      data-state={state}
      {...rest}
      className={cx(p.modifier, className)}
    >
      {children ?? p.word}
    </Pill>
  );
});
