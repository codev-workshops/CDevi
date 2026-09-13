import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { riskToVariant, type RiskLevel } from '../../tokens';

export interface RiskBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  level: RiskLevel;
}

/** Risk level as a word in a badge. HIGH and CRITICAL are visually prominent; CRITICAL is not the "failed" look. */
export const RiskBadge = forwardRef<HTMLSpanElement, RiskBadgeProps>(function RiskBadge(
  { level, className, ...rest },
  ref,
) {
  const r = riskToVariant[level];
  return (
    <span
      ref={ref}
      data-risk={level}
      data-prominent={r.prominent || undefined}
      {...rest}
      className={cx('cd-risk', `cd-risk-${r.variant}`, className)}
    >
      {r.word}
    </span>
  );
});
