import {
  Fragment,
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
} from 'react';
import { cx } from '../../lib/cx';

/* ---------- KeyValue ---------- */

export interface KeyValueItem {
  term: ReactNode;
  detail: ReactNode;
}

export interface KeyValueProps extends HTMLAttributes<HTMLDListElement> {
  items: KeyValueItem[];
}

/** Two-column definition list. */
export const KeyValue = forwardRef<HTMLDListElement, KeyValueProps>(function KeyValue(
  { items, className, ...rest },
  ref,
) {
  return (
    <dl ref={ref} {...rest} className={cx('cd-kv', className)}>
      {items.map((it, i) => (
        <Fragment key={i}>
          <dt>{it.term}</dt>
          <dd>{it.detail}</dd>
        </Fragment>
      ))}
    </dl>
  );
});

/* ---------- Table ---------- */

export interface TableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Right-align numeric columns. */
  align?: 'start' | 'end';
}

export interface TableProps<Row> extends Omit<TableHTMLAttributes<HTMLTableElement>, 'children'> {
  /** Required for assistive technology; may be visually hidden with `hideCaption`. */
  caption: string;
  hideCaption?: boolean;
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  empty?: ReactNode;
}

/** Data table with caption and column scopes. */
export function Table<Row>({
  caption,
  hideCaption = false,
  columns,
  rows,
  rowKey,
  empty = 'No rows.',
  className,
  ...rest
}: TableProps<Row>) {
  return (
    <table {...rest} className={cx('cd-table', className)}>
      <caption className={hideCaption ? 'cd-visually-hidden' : undefined}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={c.align === 'end' ? 'cd-align-end' : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="cd-empty">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'end' ? 'cd-align-end' : undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/* ---------- Stat ---------- */

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  value: ReactNode;
  label: ReactNode;
}

/** A number with its label, grouped in one paragraph for AT. */
export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  { value, label, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx('cd-stat', className)}>
      <p>
        <span className="cd-value">{value}</span> <span className="cd-label">{label}</span>
      </p>
    </div>
  );
});

export interface StatGridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4;
}

export const StatGrid = forwardRef<HTMLDivElement, StatGridProps>(function StatGrid(
  { columns = 2, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} data-columns={columns} className={cx('cd-stat-grid', className)} />
  );
});

/* ---------- Meter ---------- */

export interface MeterProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max: number;
  min?: number;
  /** Accessible name, e.g. "Model cost". */
  label: string;
  /** Saffron fill for "approaching a limit". */
  warn?: boolean;
  /** Use the neutral fill (e.g. laptop minutes). */
  muted?: boolean;
}

/** Budget meter. Width is driven by the `--cd-meter-value` custom property (allow-listed dynamic value). */
export const Meter = forwardRef<HTMLDivElement, MeterProps>(function Meter(
  { value, max, min = 0, label, warn = false, muted = false, className, ...rest },
  ref,
) {
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  const style = { '--cd-meter-value': `${pct}%` } as CSSProperties;
  return (
    <div
      ref={ref}
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      {...rest}
      className={cx('cd-meter', className)}
    >
      <i className={cx(warn && 'cd-warn', muted && 'cd-muted')} style={style} />
    </div>
  );
});

/* ---------- Bars ---------- */

export interface Bar {
  value: number;
  /** Render with the neutral colour (e.g. laptop vs cloud). */
  local?: boolean;
  label?: string;
}

export interface BarsProps extends HTMLAttributes<HTMLDivElement> {
  values: Bar[];
  /** Accessible summary of the chart. */
  label: string;
  max?: number;
}

/** Tiny bar chart. Heights via `--cd-bar-value` (allow-listed dynamic value). */
export const Bars = forwardRef<HTMLDivElement, BarsProps>(function Bars(
  { values, label, max, className, ...rest },
  ref,
) {
  const top = max ?? Math.max(1, ...values.map((v) => v.value));
  return (
    <div ref={ref} role="img" aria-label={label} {...rest} className={cx('cd-bars', className)}>
      {values.map((v, i) => (
        <i
          key={i}
          className={v.local ? 'cd-local' : undefined}
          style={{ '--cd-bar-value': `${Math.round((v.value / top) * 100)}%` } as CSSProperties}
          title={v.label}
        />
      ))}
    </div>
  );
});
