import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

export type PillVariant = 'neutral' | 'run' | 'wait' | 'needs-you' | 'blocked' | 'fail' | 'done';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
  /** Animated dot; only meaningful for `run`. Disabled under prefers-reduced-motion by CSS. */
  pulse?: boolean;
}

/** State is always a word in a pill (DR-01). The text content is the accessible name. */
export const Pill = forwardRef<HTMLSpanElement, PillProps>(function Pill(
  { variant = 'neutral', pulse = false, className, children, ...rest },
  ref,
) {
  return (
    <span ref={ref} {...rest} className={cx('cd-pill', `cd-${variant}`, className)}>
      {pulse ? <span className="cd-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
});
