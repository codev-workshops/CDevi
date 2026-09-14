// zod-free subpath: keeps the schema library out of the browser bundle (Inbox route JS budget).
export { expiryLabel, humanAgo, humanDuration } from '@cdevi/contracts/read-model';

/** Splits an ask on backticks so fragments like `main` can render as `Mono` (inbox-read-model.md §3). */
export function askSegments(ask: string): { text: string; mono: boolean }[] {
  return ask
    .split('`')
    .map((text, i) => ({ text, mono: i % 2 === 1 }))
    .filter((s) => s.text.length > 0);
}
