import {
  forwardRef,
  useId,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../../lib/cx';

/* ---------- Message ---------- */

export type MessageVariant = 'agent' | 'user' | 'summary';

export interface MessageProps extends HTMLAttributes<HTMLElement> {
  who: ReactNode;
  when?: ReactNode;
  /** `summary` = the agent's own account of its work; labelled "not evidence" (DR-03). */
  variant?: MessageVariant;
}

/** Agent or user prose. Never used to present platform evidence. */
export const Message = forwardRef<HTMLElement, MessageProps>(function Message(
  { who, when, variant = 'agent', className, children, ...rest },
  ref,
) {
  const label = typeof who === 'string' && typeof when === 'string' ? `${who}, ${when}` : undefined;
  return (
    <article
      ref={ref}
      aria-label={label}
      {...rest}
      className={cx(
        'cd-msg',
        variant === 'user' && 'cd-user',
        variant === 'summary' && 'cd-summary',
        className,
      )}
    >
      <div className="cd-who">
        <span>
          {who}
          {variant === 'summary' ? ' — not evidence' : null}
        </span>
        {when !== undefined ? <span>{when}</span> : null}
      </div>
      {children}
    </article>
  );
});

/* ---------- ToolLog ---------- */

export type ToolLineKind = 'read' | 'write' | 'ok' | 'error' | 'dim';

const toolKindClass: Record<ToolLineKind, string> = {
  read: 'cd-rd',
  write: 'cd-wr',
  ok: 'cd-ok',
  error: 'cd-ex',
  dim: 'cd-dim',
};

export interface ToolLineProps extends HTMLAttributes<HTMLSpanElement> {
  kind: ToolLineKind;
}

export const ToolLine = forwardRef<HTMLSpanElement, ToolLineProps>(function ToolLine(
  { kind, className, ...rest },
  ref,
) {
  return <span ref={ref} {...rest} className={cx(toolKindClass[kind], className)} />;
});

export interface ToolLogProps extends HTMLAttributes<HTMLPreElement> {
  label?: string;
}

/** Compact log of tool calls; children are lines of text with `ToolLine` spans. */
export const ToolLog = forwardRef<HTMLPreElement, ToolLogProps>(function ToolLog(
  { label = 'Tool activity', className, ...rest },
  ref,
) {
  return <pre ref={ref} aria-label={label} {...rest} className={cx('cd-tools', className)} />;
});

/* ---------- DecisionCard ---------- */

export interface DecisionCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  /** Pill next to the title, e.g. blocking / external. */
  badge?: ReactNode;
  description?: ReactNode;
  /** Buttons; exactly one may be saffron (DR-02). */
  actions?: ReactNode;
  /** `needs-you` (saffron) when a person must act now; `neutral` for informational/pre-filled cards. */
  tone?: 'needs-you' | 'neutral';
}

/** An approval or clarification raised by an agent, placed in the flow where it was raised. */
export const DecisionCard = forwardRef<HTMLElement, DecisionCardProps>(function DecisionCard(
  { title, badge, description, actions, tone = 'needs-you', className, children, ...rest },
  ref,
) {
  const id = useId();
  return (
    <section
      ref={ref}
      aria-labelledby={id}
      {...rest}
      className={cx('cd-decision', tone === 'neutral' && 'cd-neutral', className)}
    >
      <h3 className="cd-head" id={id}>
        <span>{title}</span>
        {badge}
      </h3>
      {description ? <div className="cd-desc">{description}</div> : null}
      {children}
      {actions ? <div className="cd-acts">{actions}</div> : null}
    </section>
  );
});

/* ---------- GateCheck ---------- */

export type GateState = 'pending' | 'ok' | 'wait' | 'bad' | 'override';

const gateGlyph: Record<GateState, string> = {
  pending: '',
  ok: '✓',
  wait: '',
  bad: '✗',
  override: '!',
};
const gateName: Record<GateState, string> = {
  pending: 'not yet checked',
  ok: 'passed',
  wait: 'waiting',
  bad: 'failed',
  override: 'overridden',
};
const gateClass: Record<GateState, string | undefined> = {
  pending: undefined,
  ok: 'cd-ok',
  wait: 'cd-wait',
  bad: 'cd-bad',
  override: 'cd-override',
};

export interface GateCheckProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onToggle'> {
  state: GateState;
  label: ReactNode;
  /** Where the evidence came from, e.g. `github_checks · high`. */
  source?: ReactNode;
  /** When provided, the row becomes a toggleable checkbox (acceptance criteria). */
  onToggle?: (checked: boolean) => void;
  disabled?: boolean;
}

/** Evidence row: state box, label and source. Overrides are saffron, never green (DR-04). */
export const GateCheck = forwardRef<HTMLDivElement, GateCheckProps>(function GateCheck(
  { state, label, source, onToggle, disabled, className, ...rest },
  ref,
) {
  const id = useId();
  const box = (
    <span
      className={cx('cd-box', gateClass[state])}
      role={onToggle ? undefined : 'img'}
      aria-label={onToggle ? undefined : gateName[state]}
      aria-hidden={onToggle ? true : undefined}
    >
      {gateGlyph[state]}
    </span>
  );
  return (
    <div ref={ref} {...rest} className={cx('cd-check', className)}>
      {onToggle ? (
        <label htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={state === 'ok'}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {box}
          <span>{label}</span>
        </label>
      ) : (
        <>
          {box}
          <span>{label}</span>
        </>
      )}
      <span className="cd-src">{source}</span>
    </div>
  );
});

export interface GateListProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export const GateList = forwardRef<HTMLDivElement, GateListProps>(function GateList(
  { label = 'Gates', className, ...rest },
  ref,
) {
  return <div ref={ref} role="group" aria-label={label} {...rest} className={cx(className)} />;
});

/* ---------- Diff ---------- */

export type DiffLineKind = 'add' | 'del' | 'ctx';

export interface DiffProps extends HTMLAttributes<HTMLPreElement> {
  label?: string;
}

export const Diff = forwardRef<HTMLPreElement, DiffProps>(function Diff(
  { label = 'Diff', className, ...rest },
  ref,
) {
  return <pre ref={ref} aria-label={label} {...rest} className={cx('cd-diff', className)} />;
});

export const DiffFile = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function DiffFile({ className, ...rest }, ref) {
    return <div ref={ref} {...rest} className={cx('cd-file-head', className)} />;
  },
);

export interface DiffLineProps extends HTMLAttributes<HTMLDivElement> {
  kind?: DiffLineKind;
}

export const DiffLine = forwardRef<HTMLDivElement, DiffLineProps>(function DiffLine(
  { kind = 'ctx', className, children, ...rest },
  ref,
) {
  const prefix = kind === 'add' ? '+' : kind === 'del' ? '-' : ' ';
  return (
    <div
      ref={ref}
      {...rest}
      className={cx(kind === 'add' && 'cd-add', kind === 'del' && 'cd-del', className)}
    >
      {prefix}
      {children}
    </div>
  );
});

/* ---------- Stepper ---------- */

export type StepState = 'done' | 'current' | 'todo';

export interface StepperProps extends HTMLAttributes<HTMLOListElement> {
  label?: string;
}

export const Stepper = forwardRef<HTMLOListElement, StepperProps>(function Stepper(
  { label = 'Progress', className, ...rest },
  ref,
) {
  return <ol ref={ref} aria-label={label} {...rest} className={cx('cd-stepper', className)} />;
});

export interface StepProps extends Omit<LiHTMLAttributes<HTMLLIElement>, 'title'> {
  state?: StepState;
  title: ReactNode;
  detail?: ReactNode;
}

export const Step = forwardRef<HTMLLIElement, StepProps>(function Step(
  { state = 'todo', title, detail, className, ...rest },
  ref,
) {
  return (
    <li
      ref={ref}
      aria-current={state === 'current' ? 'step' : undefined}
      {...rest}
      className={cx(state === 'done' && 'cd-done', state === 'current' && 'cd-cur', className)}
    >
      <b>{title}</b>
      {detail}
      {state === 'done' ? <span className="cd-visually-hidden"> (done)</span> : null}
    </li>
  );
});

/* ---------- Terminal ---------- */

export type TermLineKind = 'prompt' | 'good' | 'warn' | 'dim';

export interface TerminalProps extends HTMLAttributes<HTMLPreElement> {
  label?: string;
}

export const Terminal = forwardRef<HTMLPreElement, TerminalProps>(function Terminal(
  { label = 'Terminal', className, ...rest },
  ref,
) {
  return <pre ref={ref} aria-label={label} {...rest} className={cx('cd-term', className)} />;
});

export interface TermLineProps extends HTMLAttributes<HTMLSpanElement> {
  kind: TermLineKind;
}

export const TermLine = forwardRef<HTMLSpanElement, TermLineProps>(function TermLine(
  { kind, className, ...rest },
  ref,
) {
  return <span ref={ref} {...rest} className={cx(`cd-${kind}`, className)} />;
});
