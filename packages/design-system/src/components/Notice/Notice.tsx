import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type NoticeTone = 'info' | 'error';

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  /** `info` is announced politely (`role="status"`); `error` interrupts (`role="alert"`). */
  tone: NoticeTone;
  /** Optional action, usually one `Button` (e.g. "Retry"). */
  action?: ReactNode;
  children: ReactNode;
}

/** Inline message for load errors (with a retry), session notices and demonstration-data banners. */
export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  { tone, action, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role={tone === 'error' ? 'alert' : 'status'}
      {...rest}
      className={cx('cd-notice', tone === 'error' ? 'cd-error' : 'cd-info', className)}
    >
      <div className="cd-notice-body">{children}</div>
      {action ? <div className="cd-notice-action">{action}</div> : null}
    </div>
  );
});
