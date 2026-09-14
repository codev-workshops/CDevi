/**
 * Normative Inbox read-model rules (specs/003 contracts/inbox-read-model.md). Pure functions: the API mirrors
 * them in SQL and a test asserts both agree over the seed; the web reuses the labels.
 */
import type { InboxKind, RiskLevel, Tab, WorkflowState } from './vocabulary';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const DONE_WINDOW_MS = 7 * DAY;
export const STALE_AFTER_MS = 24 * HOUR;

export interface PendingApproval {
  id: string;
  ask: string;
  riskLevel: RiskLevel;
  requestedAt: Date;
  expiresAt: Date | null;
  hasRecommendedAnswer: boolean;
}
export interface PendingClarification {
  id: string;
  question: string;
  requestedAt: Date;
  hasRecommendedAnswer: boolean;
}

/** The facts the read model needs about one workflow (what the SQL row carries). */
export interface InboxRowSource {
  workflowId: string;
  state: WorkflowState;
  stateObservedAt: Date;
  stateReason: string | null;
  stageIndex: number | null;
  stageName: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  approval: PendingApproval | null;
  clarification: PendingClarification | null;
}

// ---- §1 tab
const NEEDS_YOU: ReadonlySet<WorkflowState> = new Set(['WAITING_FOR_HUMAN', 'BLOCKED', 'FAILED']);
const RUNNING: ReadonlySet<WorkflowState> = new Set(['QUEUED', 'RUNNING', 'RETRYING', 'WAITING']);
const DONE: ReadonlySet<WorkflowState> = new Set(['COMPLETED', 'CANCELLED']);

export function classifyTab(state: WorkflowState, finishedAt: Date | null, now: Date): Tab | null {
  if (NEEDS_YOU.has(state)) return 'needsYou';
  if (RUNNING.has(state)) return 'running';
  if (DONE.has(state)) {
    if (!finishedAt) return null;
    return now.getTime() - finishedAt.getTime() <= DONE_WINDOW_MS ? 'done' : null;
  }
  return null;
}

// ---- §2 kind
export function deriveKind(row: InboxRowSource): InboxKind {
  if (row.state === 'WAITING_FOR_HUMAN') {
    if (row.approval) return 'approval';
    if (row.clarification) return 'clarification';
    return 'blocked';
  }
  if (row.state === 'BLOCKED') return 'blocked';
  if (row.state === 'FAILED') return 'failed';
  if (RUNNING.has(row.state)) return 'running';
  return 'done';
}

// ---- §3 ask
export const ORPHAN_ASK = 'Waiting for a person — no request recorded';
export function deriveAsk(row: InboxRowSource): string | null {
  const kind = deriveKind(row);
  const reason = row.stateReason ?? 'reason not provided';
  switch (kind) {
    case 'approval':
      return row.approval!.ask;
    case 'clarification':
      return row.clarification!.question;
    case 'blocked':
      return row.state === 'WAITING_FOR_HUMAN' ? ORPHAN_ASK : `Blocked: ${reason}`;
    case 'failed': {
      const stage =
        row.stageName ?? (row.stageIndex != null ? `stage ${row.stageIndex}` : 'unknown stage');
      return `Failed at ${stage}: ${reason}`;
    }
    default:
      return null;
  }
}

// ---- §4 ordering
export function riskRank(level: RiskLevel | null): number {
  switch (level) {
    case 'CRITICAL':
      return 0;
    case 'HIGH':
      return 1;
    case 'MEDIUM':
      return 2;
    case 'LOW':
      return 3;
    default:
      return 4;
  }
}

export function raisedAt(row: InboxRowSource): Date {
  if (row.state === 'WAITING_FOR_HUMAN') {
    if (row.approval) return row.approval.requestedAt;
    if (row.clarification) return row.clarification.requestedAt;
  }
  return row.stateObservedAt;
}

export function riskLevelOf(row: InboxRowSource): RiskLevel | null {
  return row.state === 'WAITING_FOR_HUMAN' && row.approval ? row.approval.riskLevel : null;
}

const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
const cmpId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function orderNeedsYou(a: InboxRowSource, b: InboxRowSource): number {
  return (
    cmp(riskRank(riskLevelOf(a)), riskRank(riskLevelOf(b))) ||
    cmp(raisedAt(a).getTime(), raisedAt(b).getTime()) ||
    cmpId(a.workflowId, b.workflowId)
  );
}

export function orderRunning(a: InboxRowSource, b: InboxRowSource): number {
  const sa = a.startedAt?.getTime();
  const sb = b.startedAt?.getTime();
  if (sa == null && sb == null) return cmpId(a.workflowId, b.workflowId);
  if (sa == null) return 1;
  if (sb == null) return -1;
  return cmp(sb, sa) || cmpId(a.workflowId, b.workflowId);
}

export function orderDone(a: InboxRowSource, b: InboxRowSource): number {
  return (
    cmp(b.finishedAt?.getTime() ?? 0, a.finishedAt?.getTime() ?? 0) ||
    cmpId(a.workflowId, b.workflowId)
  );
}

// ---- §5 stale & expiry
export function isStale(tab: Tab, raised: Date, now: Date): boolean {
  return tab === 'needsYou' && now.getTime() - raised.getTime() > STALE_AFTER_MS;
}

/** Largest two units, rounded down: "3 h 56 m", "2 d 4 h", "12 m", "< 1 m". */
export function humanDuration(ms: number): string {
  if (ms < MINUTE) return '< 1 m';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const mins = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} m` : `${hours} h`;
  return `${mins} m`;
}

export function expiryLabel(expiresAt: Date, now: Date): string {
  const remaining = expiresAt.getTime() - now.getTime();
  return remaining <= 0 ? 'expired' : `times out in ${humanDuration(remaining)}`;
}

// ---- §6 age
export function humanAgo(at: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - at.getTime());
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  return `${Math.floor(ms / DAY)} d ago`;
}

// ---- §7 cursor
export type CursorKeys = {
  needsYou: [riskRank: number, raisedAt: string, id: string];
  running: [startedAt: string | null, id: string];
  done: [finishedAt: string, id: string];
};

export class InvalidCursorError extends Error {
  constructor(message = 'Invalid cursor for this tab') {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

const b64url = {
  encode: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
  decode: (s: string) => Buffer.from(s, 'base64url').toString('utf8'),
};

export function encodeCursor<T extends Tab>(tab: T, keys: CursorKeys[T]): string {
  return b64url.encode(JSON.stringify([tab, ...keys]));
}

export function decodeCursor<T extends Tab>(tab: T, cursor: string): CursorKeys[T] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64url.decode(cursor));
  } catch {
    throw new InvalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed[0] !== tab) throw new InvalidCursorError();
  const keys = parsed.slice(1);
  const valid =
    (tab === 'needsYou' &&
      keys.length === 3 &&
      typeof keys[0] === 'number' &&
      typeof keys[1] === 'string' &&
      typeof keys[2] === 'string') ||
    (tab === 'running' &&
      keys.length === 2 &&
      (keys[0] === null || typeof keys[0] === 'string') &&
      typeof keys[1] === 'string') ||
    (tab === 'done' &&
      keys.length === 2 &&
      typeof keys[0] === 'string' &&
      typeof keys[1] === 'string');
  if (!valid) throw new InvalidCursorError();
  return keys as CursorKeys[T];
}

// ---- data-model.md §3 transition table
export const WORKFLOW_TRANSITIONS: Readonly<
  Record<'CREATE' | WorkflowState, readonly WorkflowState[]>
> = {
  CREATE: ['QUEUED', 'RUNNING'],
  QUEUED: ['RUNNING', 'CANCELLED', 'BLOCKED'],
  RUNNING: [
    'WAITING',
    'WAITING_FOR_HUMAN',
    'RETRYING',
    'BLOCKED',
    'FAILED',
    'COMPLETED',
    'CANCELLED',
  ],
  RETRYING: ['RUNNING', 'FAILED', 'CANCELLED', 'BLOCKED'],
  WAITING: ['RUNNING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  WAITING_FOR_HUMAN: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['RUNNING', 'QUEUED', 'CANCELLED'],
  FAILED: ['RETRYING', 'RUNNING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: WorkflowState | null, to: WorkflowState): boolean {
  return WORKFLOW_TRANSITIONS[from ?? 'CREATE'].includes(to);
}

export const isTerminal = (s: WorkflowState) => s === 'COMPLETED' || s === 'CANCELLED';
export const TAB_STATES: Readonly<Record<Tab, readonly WorkflowState[]>> = {
  needsYou: ['WAITING_FOR_HUMAN', 'BLOCKED', 'FAILED'],
  running: ['QUEUED', 'RUNNING', 'RETRYING', 'WAITING'],
  done: ['COMPLETED', 'CANCELLED'],
};
