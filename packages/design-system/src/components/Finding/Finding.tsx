import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import {
  blockingToPill,
  severityToPill,
  type FindingBlocking,
  type FindingSeverity,
  type RiskLevel,
} from '../../tokens';
import { Pill } from '../Pill/Pill';
import { RiskBadge } from '../RiskBadge/RiskBadge';
import { Table, type TableColumn } from '../Data/Data';

/* ---------- FindingRow ---------- */

export interface FindingEvidence {
  label: ReactNode;
  href?: string;
}

export interface FindingRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  severity: FindingSeverity;
  blocking: FindingBlocking;
  /** Review lane, e.g. Security. */
  lane?: ReactNode;
  title: ReactNode;
  impact?: ReactNode;
  evidence?: FindingEvidence[];
  fix?: ReactNode;
  /** Apply Fix / Dismiss / Create Issue buttons. */
  actions?: ReactNode;
}

/** One AI review finding (specs/001 FR-020). Severity and blocking class are always words. */
export const FindingRow = forwardRef<HTMLElement, FindingRowProps>(function FindingRow(
  { severity, blocking, lane, title, impact, evidence, fix, actions, className, ...rest },
  ref,
) {
  const id = useId();
  return (
    <article
      ref={ref}
      aria-labelledby={id}
      data-severity={severity}
      data-blocking={blocking}
      {...rest}
      className={cx('cd-finding', blocking === 'BLOCKING' && 'cd-finding-blocking', className)}
    >
      <div className="cd-finding-head">
        <Pill variant={severityToPill[severity]}>{severity.toLowerCase()}</Pill>
        <Pill variant={blockingToPill[blocking]}>{blocking.toLowerCase()}</Pill>
        {lane ? <Pill variant="neutral">{lane}</Pill> : null}
        <h3 id={id}>{title}</h3>
      </div>
      {impact ? (
        <div className="cd-finding-section">
          <b>Impact</b>
          {impact}
        </div>
      ) : null}
      {evidence && evidence.length > 0 ? (
        <div className="cd-finding-section cd-finding-evidence">
          <b>Evidence</b>
          <ul>
            {evidence.map((e, i) => (
              <li key={i}>{e.href ? <a href={e.href}>{e.label}</a> : e.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {fix ? (
        <div className="cd-finding-section">
          <b>Recommended fix</b>
          {fix}
        </div>
      ) : null}
      {actions ? <div className="cd-acts">{actions}</div> : null}
    </article>
  );
});

/* ---------- Audit ---------- */

export interface AuditEvent {
  id: string;
  time: ReactNode;
  actor: ReactNode;
  action: ReactNode;
  target: ReactNode;
  workflow?: ReactNode;
  policy?: ReactNode;
  /** Omitted (or null) when the target carries no risk level, e.g. a clarification. */
  risk?: RiskLevel | null;
  result: ReactNode;
}

export interface AuditTableProps {
  events: AuditEvent[];
  caption?: string;
  hideCaption?: boolean;
  empty?: ReactNode;
  className?: string;
}

const auditColumns: TableColumn<AuditEvent>[] = [
  { key: 'time', header: 'Time', cell: (e) => <span className="cd-audit-time">{e.time}</span> },
  { key: 'actor', header: 'Actor', cell: (e) => <span className="cd-audit-actor">{e.actor}</span> },
  { key: 'action', header: 'Action', cell: (e) => e.action },
  {
    key: 'target',
    header: 'Target',
    cell: (e) => <span className="cd-audit-target">{e.target}</span>,
  },
  { key: 'workflow', header: 'Workflow', cell: (e) => e.workflow ?? '—' },
  { key: 'policy', header: 'Policy', cell: (e) => e.policy ?? '—' },
  { key: 'risk', header: 'Risk', cell: (e) => (e.risk ? <RiskBadge level={e.risk} /> : '—') },
  { key: 'result', header: 'Result', cell: (e) => e.result },
];

/** Immutable audit log rows (specs/001 FR-029) rendered as a table with all eight slots. */
export function AuditTable({
  events,
  caption = 'Audit log',
  hideCaption,
  empty = 'No audit events match.',
  className,
}: AuditTableProps) {
  return (
    <Table<AuditEvent>
      caption={caption}
      hideCaption={hideCaption ?? false}
      columns={auditColumns}
      rows={events}
      rowKey={(e) => e.id}
      empty={empty}
      className={cx('cd-audit', className)}
    />
  );
}

export interface AuditRowProps extends AuditEvent {
  className?: string;
}

/** A single audit event as a table row; use inside a `<tbody>` when composing a custom table. */
export function AuditRow({ className, ...e }: AuditRowProps) {
  return (
    <tr className={className} data-audit-id={e.id}>
      {auditColumns.map((c) => (
        <td key={c.key}>{c.cell(e)}</td>
      ))}
    </tr>
  );
}
