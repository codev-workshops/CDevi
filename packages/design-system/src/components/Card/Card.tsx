import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render; defaults to `div`. Use `section`/`article` when the card is a landmark. */
  as?: ElementType;
}

/** Surface container. */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { as: Tag = 'div', className, ...rest },
  ref,
) {
  return <Tag ref={ref} {...rest} className={cx('cd-card', className)} />;
});

export interface ListProps extends HTMLAttributes<HTMLDivElement> {
  /** Rendered instead of children when there are none. */
  empty?: ReactNode;
}

/** Bordered list of `ListRow`s with an explicit empty state. */
export const List = forwardRef<HTMLDivElement, ListProps>(function List(
  { empty = 'Nothing here yet.', className, children, ...rest },
  ref,
) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  return (
    <div
      ref={ref}
      role={hasChildren ? 'list' : undefined}
      {...rest}
      className={cx('cd-list', className)}
    >
      {hasChildren ? children : <p className="cd-empty">{empty}</p>}
    </div>
  );
});

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** Link target for the title. */
  href?: string;
  /** Right-aligned element, usually a `Pill`. */
  trailing?: ReactNode;
  /** The exact question or approval being asked; makes this a saffron "gate" row (DR-02). */
  ask?: ReactNode;
  meta?: ReactNode;
  /** Force gate styling without an `ask` (rare). */
  gate?: boolean;
}

let rowId = 0;

/** One row in a `List`. Gate rows carry the question so a decision can be made from the list. */
export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { title, href, trailing, ask, meta, gate, className, ...rest },
  ref,
) {
  const id = `cd-row-ask-${++rowId}`;
  const isGate = gate ?? Boolean(ask);
  return (
    <div
      ref={ref}
      role="listitem"
      {...rest}
      aria-describedby={ask ? id : rest['aria-describedby']}
      className={cx('cd-row', isGate && 'cd-gate', className)}
    >
      {href ? (
        <a className="cd-title" href={href}>
          {title}
        </a>
      ) : (
        <div className="cd-title">{title}</div>
      )}
      {trailing ? <span className="cd-trailing">{trailing}</span> : null}
      {ask ? (
        <div className="cd-ask" id={id}>
          {ask}
        </div>
      ) : null}
      {meta ? <div className="cd-meta">{meta}</div> : null}
    </div>
  );
});
