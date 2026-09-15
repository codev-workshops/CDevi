import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ButtonHTMLAttributes,
  type FieldsetHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '../../lib/cx';

/* ---------- Field ---------- */

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  /** Small text under the label (left column). */
  hint?: ReactNode;
  /** Help text under the control. */
  help?: ReactNode;
  /** Error text under the control; sets `aria-invalid` on the control. */
  error?: ReactNode;
  /** Id of the control; generated when omitted and passed to child controls via context. */
  htmlFor?: string;
  children?: ReactNode;
}

/** Label + control row. Child `Input`/`TextArea`/`Select` pick up id, description and invalid state. */
export function Field({
  label,
  hint,
  help,
  error,
  htmlFor,
  className,
  children,
  ...rest
}: FieldProps) {
  const auto = useId();
  const id = htmlFor ?? `cd-field-${auto}`;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div {...rest} className={cx('cd-field', className)}>
        <label htmlFor={id}>
          {label}
          {hint ? <small>{hint}</small> : null}
        </label>
        <div>
          {children}
          {help ? (
            <p className="cd-help" id={helpId}>
              {help}
            </p>
          ) : null}
          {error ? (
            <p className="cd-error" id={errorId} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </FieldContext.Provider>
  );
}

function useFieldProps(invalidProp: boolean | undefined) {
  const f = useContext(FieldContext);
  return {
    id: f?.id,
    'aria-describedby': f?.describedBy,
    'aria-invalid': (invalidProp ?? f?.invalid) || undefined,
  };
}

/* ---------- Inputs ---------- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Monospace for paths, commands, keys. */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, mono, className, ...rest },
  ref,
) {
  const a = useFieldProps(invalid);
  return (
    <input ref={ref} {...a} {...rest} className={cx('cd-input', mono && 'cd-mono', className)} />
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid, className, ...rest },
  ref,
) {
  const a = useFieldProps(invalid);
  return <textarea ref={ref} {...a} {...rest} className={cx('cd-input', 'cd-area', className)} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, ...rest },
  ref,
) {
  const a = useFieldProps(invalid);
  return <select ref={ref} {...a} {...rest} className={cx('cd-input', className)} />;
});

/* ---------- Help ---------- */

export const Help = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function Help({ className, ...rest }, ref) {
    return <p ref={ref} {...rest} className={cx('cd-help', className)} />;
  },
);

/* ---------- Segmented ---------- */

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'onChange'
> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
}

/** Radiogroup rendered as a segmented control. Arrow keys move and select. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
  className,
  ...rest
}: SegmentedProps<V>) {
  const enabled = options.filter((o) => !o.disabled && !disabled);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = enabled.findIndex((o) => o.value === value);
    let next: SegmentedOption<V> | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(i + 1) % enabled.length];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(i - 1 + enabled.length) % enabled.length];
    if (next) {
      e.preventDefault();
      onChange(next.value);
      (
        e.currentTarget.parentElement?.querySelector(
          `[data-value="${next.value}"]`,
        ) as HTMLElement | null
      )?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-label={label} {...rest} className={cx('cd-seg', className)}>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={o.value}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || o.disabled}
            onKeyDown={onKeyDown}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Chips ---------- */

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onToggle'> {
  /** When provided the chip is a toggle button with `aria-pressed`. */
  selected?: boolean;
  onToggle?: (selected: boolean) => void;
}

/** Static chip (span) or toggle chip (button with aria-pressed). */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, onToggle, className, children, ...rest },
  ref,
) {
  if (onToggle === undefined) {
    return <span className={cx('cd-chip', selected && 'cd-is-active', className)}>{children}</span>;
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={Boolean(selected)}
      {...rest}
      className={cx('cd-chip', className)}
      onClick={(e) => {
        rest.onClick?.(e);
        if (!e.defaultPrevented) onToggle(!selected);
      }}
    >
      {children}
    </button>
  );
});

export interface ChipsProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the group when chips are toggles. */
  label?: string;
}

export const Chips = forwardRef<HTMLDivElement, ChipsProps>(function Chips(
  { label, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role={label ? 'group' : undefined}
      aria-label={label}
      {...rest}
      className={cx('cd-chips', className)}
    />
  );
});

/* ---------- OptionRow ---------- */

export interface OptionRowProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'onChange'> {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Marks the recommended answer. */
  recommended?: boolean;
  children: ReactNode;
}

/* ---------- OptionGroup ---------- */

export interface OptionGroupProps extends FieldsetHTMLAttributes<HTMLFieldSetElement> {
  /** Accessible name of the group (rendered as the `<legend>`). */
  legend: ReactNode;
  /** Error text under the options; announced with `role="alert"`. */
  error?: ReactNode;
  children: ReactNode;
}

/** A named group of `OptionRow`s: a real `<fieldset>` with a `<legend>`, so the radios form one radiogroup. */
export const OptionGroup = forwardRef<HTMLFieldSetElement, OptionGroupProps>(function OptionGroup(
  { legend, error, className, children, ...rest },
  ref,
) {
  const errorId = useId();
  return (
    <fieldset
      ref={ref}
      {...rest}
      className={cx('cd-optgroup', className)}
      aria-describedby={error ? errorId : rest['aria-describedby']}
    >
      <legend>{legend}</legend>
      {children}
      {error ? (
        <p className="cd-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
});

/** Radio option rendered as a row; wraps a real `<input type="radio">`. */
export const OptionRow = forwardRef<HTMLLabelElement, OptionRowProps>(function OptionRow(
  { name, value, checked, onChange, disabled, recommended, className, children, ...rest },
  ref,
) {
  return (
    <label ref={ref} {...rest} className={cx('cd-opt', checked && 'cd-is-active', className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span className="cd-radio" aria-hidden="true" />
      {children}
      {recommended ? <span className="cd-recommended">Recommended</span> : null}
    </label>
  );
});
