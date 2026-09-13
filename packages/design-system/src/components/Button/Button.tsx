import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../../lib/cx';

export type ButtonVariant = 'primary' | 'saffron' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

interface CommonProps {
  /** `saffron` is reserved for the single primary "needs you" action on a screen (DR-02). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and sets `aria-busy`; the control stays focusable but is inert. */
  loading?: boolean;
  children?: ReactNode;
  className?: string;
}

export type ButtonAsButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };

export type ButtonAsLinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & {
    href: string;
    disabled?: boolean;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

const variantClass: Record<ButtonVariant, string | undefined> = {
  primary: undefined,
  saffron: 'cd-saffron',
  ghost: 'cd-ghost',
  danger: 'cd-danger',
};

/** Semantic button; renders `<a>` when `href` is given. */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = 'primary',
      size = 'md',
      loading = false,
      children,
      className,
      ...rest
    } = props;
    const classes = cx('cd-btn', variantClass[variant], size === 'sm' && 'cd-sm', className);
    const spinner = loading ? <span className="cd-spin" aria-hidden="true" /> : null;

    if ('href' in rest && rest.href !== undefined) {
      const { disabled, href, onClick, ...anchor } = rest as ButtonAsLinkProps;
      const inert = disabled || loading;
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          {...anchor}
          href={inert ? undefined : href}
          role={inert ? 'link' : undefined}
          aria-disabled={inert || undefined}
          aria-busy={loading || undefined}
          tabIndex={inert ? -1 : anchor.tabIndex}
          onClick={inert ? (e) => e.preventDefault() : onClick}
          className={classes}
        >
          {spinner}
          {children}
        </a>
      );
    }

    const { disabled, type = 'button', ...button } = rest as ButtonAsButtonProps;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        {...button}
        type={type}
        disabled={disabled}
        aria-disabled={loading || undefined}
        aria-busy={loading || undefined}
        className={classes}
      >
        {spinner}
        {children}
      </button>
    );
  },
);
