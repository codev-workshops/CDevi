import { forwardRef, useId, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
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
  /**
   * Data is being fetched: marks the list `aria-busy` and, when there are no rows yet, renders three
   * skeleton rows so loading is never mistaken for "nothing here".
   */
  loading?: boolean;
}

const SKELETON_ROWS = [0, 1, 2];

/** Bordered list of `ListRow`s with explicit empty and loading states. */
export const List = forwardRef<HTMLDivElement, ListProps>(function List(
  { empty = 'Nothing here yet.', loading = false, className, children, ...rest },
  ref,
) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  const showSkeleton = loading && !hasChildren;
  return (
    <div
      ref={ref}
      role={hasChildren ? 'list' : 'group'}
      aria-busy={loading || undefined}
      {...rest}
      className={cx('cd-list', className)}
    >
      {hasChildren ? (
        children
      ) : showSkeleton ? (
        SKELETON_ROWS.map((i) => (
          <div key={i} className="cd-row cd-skeleton" aria-hidden="true">
            <span className="cd-title" />
            <span className="cd-meta" />
          </div>
        ))
      ) : (
        <p className="cd-empty">{empty}</p>
      )}
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

/** One row in a `List`. Gate rows carry the question so a decision can be made from the list. */
export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { title, href, trailing, ask, meta, gate, className, ...rest },
  ref,
) {
  // useId is stable across server and client renders (a module counter caused hydration mismatches).
  const id = `cd-row-ask-${useId()}`;
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
