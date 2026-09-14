import { z } from 'zod';
import { IsoDateTime, Uuid } from './common';
import { InboxKind, RiskLevel, Tab, WorkflowState } from './vocabulary';

export const InboxQuery = z.object({
  tab: Tab.default('needsYou'),
  project: z.union([z.literal('all'), Uuid]).default('all'),
  cursor: z.string().max(200).optional(),
});
export type InboxQuery = z.infer<typeof InboxQuery>;

export const InboxItem = z.object({
  workflowId: Uuid,
  title: z.string(),
  project: z.object({ id: Uuid, key: z.string() }),
  agent: z.string().nullable(),
  state: WorkflowState,
  tab: Tab,
  kind: InboxKind,
  ask: z.string().nullable(),
  riskLevel: RiskLevel.nullable(),
  raisedAt: IsoDateTime,
  isStale: z.boolean(),
  expiry: z.object({ expiresAt: IsoDateTime, isExpired: z.boolean() }).nullable(),
  hasRecommendedAnswer: z.boolean(),
  stage: z
    .object({ index: z.number().int(), count: z.number().int(), name: z.string().nullable() })
    .nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  pullRequestRef: z.string().nullable(),
  requestId: Uuid.nullable(),
  href: z.string(),
});
export type InboxItem = z.infer<typeof InboxItem>;

export const LinkedCount = z.object({ value: z.number().int().min(0), href: z.string() });
export type LinkedCount = z.infer<typeof LinkedCount>;

export const TodaySummary = z.object({
  timezone: z.string(),
  windowStart: IsoDateTime,
  workflowsStarted: LinkedCount,
  workflowsCompleted: LinkedCount,
  approvalsDecided: LinkedCount,
  needsYou: LinkedCount,
});
export type TodaySummary = z.infer<typeof TodaySummary>;

export const InboxCounts = z.object({
  needsYou: z.number().int().min(0),
  running: z.number().int().min(0),
  done: z.number().int().min(0),
});
export type InboxCounts = z.infer<typeof InboxCounts>;

export const InboxSnapshot = z.object({
  generatedAt: IsoDateTime,
  project: z.string(),
  tab: Tab,
  counts: InboxCounts,
  items: z.array(InboxItem).max(50),
  nextCursor: z.string().nullable(),
  today: TodaySummary,
  policySummary: z.object({ text: z.string(), href: z.string() }),
});
export type InboxSnapshot = z.infer<typeof InboxSnapshot>;

/** Read-only record view behind `/approvals/{id}` and `/workflows/{id}` stubs (research R9). */
export const RecordView = z.object({
  item: InboxItem,
  resolution: z
    .object({
      outcome: z.enum(['approved', 'rejected', 'answered']),
      at: IsoDateTime,
      by: z.string().nullable(),
    })
    .nullable(),
});
export type RecordView = z.infer<typeof RecordView>;

export const RecordParams = z.object({ kind: z.enum(['approvals', 'workflows']), id: Uuid });

export const PAGE_SIZE = 50;
