import { Fragment, type ReactNode } from 'react';
import { ApiError } from './api';

/** Shared pieces of the bounded, keyset-paginated list screens (Requirements, Reviews). */

export const Sep = () => <> · </>;

/** Joins the non-empty parts of a row's meta line with a middle dot. */
export function meta(parts: ReactNode[]): ReactNode {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== '');
  return shown.map((p, i) => (
    <Fragment key={i}>
      {i > 0 ? <Sep /> : null}
      {p}
    </Fragment>
  ));
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Appends a "Load more" page, dropping rows already shown (keyset pages may overlap on updates). */
export function appendPage<T extends { id: string }, P extends { items: T[] }>(
  prev: P,
  next: P,
  added: T[],
): P {
  const seen = new Set(prev.items.map((r) => r.id));
  return { ...next, items: [...prev.items, ...added.filter((r) => !seen.has(r.id))] };
}

/** Sends an expired session back to sign-in; returns true when a redirect was issued. */
export function redirectIfExpired(e: unknown, next: string): boolean {
  if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
    window.location.assign(`/sign-in?reason=expired&next=${next}`);
    return true;
  }
  return false;
}
