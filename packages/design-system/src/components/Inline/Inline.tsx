import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

export type RuntimeKind = 'cloud' | 'laptop';

export interface RuntimeGlyphProps extends HTMLAttributes<HTMLSpanElement> {
  kind: RuntimeKind;
  /** Visible text label. Required: the glyph alone is decorative. */
  label?: string;
}

const paths: Record<RuntimeKind, React.ReactNode> = {
  cloud: <path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.5-1.5A4.5 4.5 0 0 1 18 18z" />,
  laptop: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </>
  ),
};

/** Runtime indicator: glyph + word. Appears on every run surface. */
export const RuntimeGlyph = forwardRef<HTMLSpanElement, RuntimeGlyphProps>(function RuntimeGlyph(
  { kind, label, className, children, ...rest },
  ref,
) {
  return (
    <span ref={ref} {...rest} className={cx('cd-rt', className)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {paths[kind]}
      </svg>
      {label ?? children ?? kind}
    </span>
  );
});

export interface KeyFingerprintProps extends HTMLAttributes<HTMLElement> {
  /** Last characters of the credential, e.g. "8f2a". Never pass the full key. */
  children: string;
}

/** Credential fingerprint chip. Renders as `…8f2a` with an explicit accessible name. */
export const KeyFingerprint = forwardRef<HTMLElement, KeyFingerprintProps>(function KeyFingerprint(
  { children, className, ...rest },
  ref,
) {
  const tail = children.replace(/^…/, '');
  return (
    <code
      ref={ref}
      {...rest}
      className={cx('cd-key', className)}
      aria-label={`key ending in ${tail}`}
    >
      …{tail}
    </code>
  );
});

/** Inline monospace text for paths, identifiers and commands. */
export const Mono = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Mono(
  { className, ...rest },
  ref,
) {
  return <code ref={ref} {...rest} className={cx('cd-mono', className)} />;
});
