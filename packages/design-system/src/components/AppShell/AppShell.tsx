import {
  forwardRef,
  useId,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../../lib/cx';

/* ---------- AppShell ---------- */

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  /** `full` fills the viewport (default). `framed` is the bordered card used by reference screens. */
  variant?: 'full' | 'framed' | undefined;
  side: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}

/** Page layout: sidebar, main, optional right panel. Scrolls with the page; no sticky headers (DR-05). */
export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(function AppShell(
  { variant = 'full', side, panel, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cx(
        'cd-root',
        'cd-app',
        variant === 'full' && 'cd-full',
        Boolean(panel) && 'cd-with-panel',
        className,
      )}
    >
      {side}
      {children}
      {panel}
    </div>
  );
});

/* ---------- Side / Brand / Nav ---------- */

export interface SideProps extends HTMLAttributes<HTMLElement> {
  brand: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/** Sidebar. Below 768px it becomes a top bar with a disclosure menu. */
export const Side = forwardRef<HTMLElement, SideProps>(function Side(
  { brand, footer, className, children, ...rest },
  ref,
) {
  const [open, setOpen] = useState(false);
  const navId = useId();
  return (
    <aside ref={ref} aria-label="Primary" {...rest} className={cx('cd-side', className)}>
      {brand}
      <button
        type="button"
        className="cd-btn cd-ghost cd-sm cd-menu-toggle"
        aria-expanded={open}
        aria-controls={navId}
        onClick={() => setOpen((o) => !o)}
      >
        Menu
      </button>
      <nav id={navId} className={cx('cd-nav', open && 'cd-open')} aria-label="Primary">
        {children}
      </nav>
      {footer ? <div className="cd-ws">{footer}</div> : null}
    </aside>
  );
});

export interface BrandProps extends HTMLAttributes<HTMLDivElement> {
  /** Short mark, e.g. the Sinhala syllable. */
  mark: ReactNode;
  name: ReactNode;
  /** Sinhala wordmark; rendered with `lang="si"`. */
  wordmark?: string;
  href?: string;
}

export const Brand = forwardRef<HTMLDivElement, BrandProps>(function Brand(
  { mark, name, wordmark, href, className, ...rest },
  ref,
) {
  const inner = (
    <>
      <span className="cd-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="cd-name">{name}</span>
      {wordmark ? (
        <small lang="si" aria-hidden="true">
          {wordmark}
        </small>
      ) : null}
    </>
  );
  return (
    <div ref={ref} {...rest} className={cx('cd-brand', className)}>
      {href ? (
        <a href={href} className="cd-brand-link">
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
});

export interface NavGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Group heading inside the nav. */
export const NavGroup = forwardRef<HTMLDivElement, NavGroupProps>(function NavGroup(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} {...rest} className={cx('cd-grp', className)} />;
});

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  active?: boolean;
  /** Pending count; announced as "n pending". */
  count?: number;
  icon?: ReactNode;
  children: ReactNode;
}

export const NavItem = forwardRef<HTMLAnchorElement, NavItemProps>(function NavItem(
  { href, active, count, icon, className, children, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      href={href}
      aria-current={active ? 'page' : undefined}
      {...rest}
      className={cx(active && 'cd-is-active', className)}
    >
      <span className="cd-nav-inner">
        {icon ? (
          <span className="cd-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="cd-label">{children}</span>
      </span>
      {count !== undefined && count > 0 ? (
        <span className="cd-count" aria-label={`${count} pending`}>
          {count}
        </span>
      ) : null}
    </a>
  );
});

/** Alias kept for API symmetry: the `<nav>` itself is rendered by `Side`; `Nav` groups items when used outside `Side`. */
export const Nav = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Nav(
  { className, ...rest },
  ref,
) {
  return <nav ref={ref} aria-label="Primary" {...rest} className={cx('cd-nav', className)} />;
});

/* ---------- Main / Panel ---------- */

export const Main = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Main(
  { className, ...rest },
  ref,
) {
  return <main ref={ref} {...rest} className={cx('cd-main', className)} />;
});

export const Panel = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Panel(
  { className, ...rest },
  ref,
) {
  return <aside ref={ref} aria-label="Details" {...rest} className={cx('cd-panel', className)} />;
});

export interface PanelBlockProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
}

export const PanelBlock = forwardRef<HTMLElement, PanelBlockProps>(function PanelBlock(
  { title, className, children, ...rest },
  ref,
) {
  const id = useId();
  return (
    <section ref={ref} aria-labelledby={id} {...rest} className={cx('cd-blk', className)}>
      <h4 id={id}>{title}</h4>
      {children}
    </section>
  );
});

/* ---------- Topbar / Crumbs / PageMeta / ActionBar ---------- */

export interface TopbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  actions?: ReactNode;
}

/** Page heading row with optional actions. Renders the page `<h1>`. */
export const Topbar = forwardRef<HTMLDivElement, TopbarProps>(function Topbar(
  { title, actions, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx('cd-topbar', className)}>
      <h1>{title}</h1>
      {actions ? <div className="cd-topbar-actions">{actions}</div> : null}
    </div>
  );
});

export interface CrumbItem {
  label: ReactNode;
  href?: string;
}

export interface CrumbsProps extends HTMLAttributes<HTMLElement> {
  items: CrumbItem[];
}

export const Crumbs = forwardRef<HTMLElement, CrumbsProps>(function Crumbs(
  { items, className, ...rest },
  ref,
) {
  return (
    <nav ref={ref} aria-label="Breadcrumb" {...rest} className={cx('cd-crumbs', className)}>
      <ol>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {it.href && !last ? (
                <a href={it.href}>{it.label}</a>
              ) : (
                <b aria-current={last ? 'page' : undefined}>{it.label}</b>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
});

export interface PageMetaProps extends HTMLAttributes<HTMLUListElement> {
  /** Each child becomes one metadata item separated by a middle dot. */
  children: ReactNode[] | ReactNode;
}

/** Inline metadata line under the page title (agent · model · runtime · key · budget …). */
export const PageMeta = forwardRef<HTMLUListElement, PageMetaProps>(function PageMeta(
  { className, children, ...rest },
  ref,
) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <ul ref={ref} {...rest} className={cx('cd-page-meta', className)}>
      {items.map((c, i) => (
        <li key={i}>{c}</li>
      ))}
    </ul>
  );
});

export interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'end';
  /** Explanation shown beside the actions, e.g. why the primary action is disabled. */
  help?: ReactNode;
}

/** Row of actions at the end of a form or card. */
export const ActionBar = forwardRef<HTMLDivElement, ActionBarProps>(function ActionBar(
  { align = 'end', help, className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx('cd-actions', align === 'end' && 'cd-end', className)}>
      {help ? <p className="cd-help">{help}</p> : null}
      {children}
    </div>
  );
});
