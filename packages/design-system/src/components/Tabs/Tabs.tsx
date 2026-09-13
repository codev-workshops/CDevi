import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../../lib/cx';

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
  baseId: string;
  register: (value: string, el: HTMLButtonElement | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used within <Tabs>`);
  return ctx;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  /** Stable id shared with `TabPanel tabsId` so tabs and panels reference each other. Generated when omitted. */
  id?: string;
  children?: ReactNode;
}

/** Controlled tab list. Arrow keys move focus and select; Home/End jump. Panels are rendered separately with `TabPanel`. */
export function Tabs({ value, onChange, label, id, className, children, ...rest }: TabsProps) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const register = useCallback((v: string, el: HTMLButtonElement | null) => {
    if (el) tabs.current.set(v, el);
    else tabs.current.delete(v);
  }, []);
  const order = useCallback(
    () =>
      [...tabs.current.entries()]
        .sort((a, b) =>
          a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        )
        .map(([v]) => v),
    [],
  );
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys = order().filter((v) => !tabs.current.get(v)?.disabled);
    const i = keys.indexOf(value);
    let next: string | undefined;
    if (e.key === 'ArrowRight') next = keys[(i + 1) % keys.length];
    else if (e.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length];
    else if (e.key === 'Home') next = keys[0];
    else if (e.key === 'End') next = keys[keys.length - 1];
    if (next !== undefined) {
      e.preventDefault();
      onChange(next);
      tabs.current.get(next)?.focus();
    }
  };

  const ctx = useMemo(
    () => ({ value, onChange, baseId, register, onKeyDown }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onKeyDown closes over the same deps
    [value, onChange, baseId, register],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div
        role="tablist"
        aria-label={label}
        id={baseId}
        {...rest}
        className={cx('cd-tabs', className)}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  value: string;
  /** Optional count badge. */
  count?: ReactNode;
}

export function Tab({ value, count, className, children, disabled, ...rest }: TabProps) {
  const { value: selected, onChange, baseId, register, onKeyDown } = useTabs('Tab');
  const isSelected = selected === value;
  return (
    <button
      ref={(el) => register(value, el)}
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={isSelected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      {...rest}
      className={cx(className)}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e);
        if (!e.defaultPrevented) onKeyDown(e);
      }}
      onClick={(e) => {
        rest.onClick?.(e);
        if (!e.defaultPrevented) onChange(value);
      }}
    >
      {children}
      {count !== undefined ? <i>{count}</i> : null}
    </button>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  /** Currently selected tab value (the same `value` passed to `Tabs`). */
  current: string;
  /** The `id` given to `Tabs`; links the panel to its tab. */
  tabsId: string;
}

/** Panel for one tab; rendered only when `current === value`. */
export function TabPanel({ value, current, tabsId, children, ...rest }: TabPanelProps) {
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${tabsId}-panel-${value}`}
      aria-labelledby={`${tabsId}-tab-${value}`}
      tabIndex={0}
      {...rest}
    >
      {children}
    </div>
  );
}
