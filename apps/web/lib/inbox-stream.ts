/**
 * SSE subscription for `inbox.changed` (research R6). Notifications only — the caller refetches the snapshot.
 * Reconnects use a fresh EventSource with a capped back-off (1 s → 30 s), which forfeits the browser's
 * `Last-Event-ID` replay — so every reconnect fires `onChange` once and the caller's refetch catches up instead.
 */
export interface InboxStreamOptions {
  url?: string | undefined;
  debounceMs?: number | undefined;
  onChange: () => void;
  onStatus?: ((connected: boolean) => void) | undefined;
  /** When set, only `inbox.changed` frames whose data carries this `workflowId` fire `onChange` (specs/001 R3). */
  workflowId?: string | undefined;
  /** When set, frames carrying this `requirementId` fire `onChange`; combines with `workflowId` as "either" (R37). */
  requirementId?: string | undefined;
}

export type FrameIdKey = 'workflowId' | 'requirementId';

/** Reads one id from an `inbox.changed` frame; unparsable frames match nothing. */
export function frameId(data: unknown, key: FrameIdKey): string | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && key in parsed) {
      const id = (parsed as Record<FrameIdKey, unknown>)[key];
      return typeof id === 'string' ? id : null;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export function frameWorkflowId(data: unknown): string | null {
  return frameId(data, 'workflowId');
}

function frameMatches(data: unknown, opts: InboxStreamOptions): boolean {
  if (!opts.workflowId && !opts.requirementId) return true;
  return (
    (Boolean(opts.workflowId) && frameId(data, 'workflowId') === opts.workflowId) ||
    (Boolean(opts.requirementId) && frameId(data, 'requirementId') === opts.requirementId)
  );
}

export function streamUrl(): string {
  const direct =
    typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_API_STREAM_URL'] : undefined;
  return direct ? `${direct.replace(/\/$/, '')}/api/inbox/stream` : '/api/inbox/stream';
}

export function subscribeInboxStream(opts: InboxStreamOptions): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const debounceMs = opts.debounceMs ?? 250;
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;
  let closed = false;
  let reconnecting = false;

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      opts.onChange();
    }, debounceMs);
  };

  const open = () => {
    if (closed) return;
    es = new EventSource(opts.url ?? streamUrl(), { withCredentials: true });
    es.addEventListener('open', () => {
      backoff = 1000;
      opts.onStatus?.(true);
      if (reconnecting) {
        reconnecting = false;
        fire();
      }
    });
    es.addEventListener('inbox.changed', (ev) => {
      if (!frameMatches((ev as MessageEvent).data, opts)) return;
      fire();
    });
    es.addEventListener('error', () => {
      opts.onStatus?.(false);
      es?.close();
      es = null;
      if (closed) return;
      reconnecting = true;
      retry = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
  };
  open();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (retry) clearTimeout(retry);
    es?.close();
  };
}
