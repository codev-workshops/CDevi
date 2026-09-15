/**
 * Inbound Jira webhook (specs/001 FR-008, data-model.md §26, research R36).
 * The API verifies `x-hub-signature` (HMAC-SHA256 over the raw body) before parsing this.
 * Jira sends far more fields than we read; unknown keys pass through untouched.
 */
import { z } from 'zod';
import { Uuid } from './common';
import { JiraIssueKey } from './requirements';

export const JiraIssueFields = z
  .object({
    summary: z.string().max(1000),
    description: z.unknown().optional(),
    updated: z.string().optional(),
    project: z.object({ key: z.string().min(1).max(64) }).loose(),
    status: z
      .object({
        name: z.string().optional(),
        statusCategory: z.object({ key: z.string().optional() }).loose().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    assignee: z
      .object({ emailAddress: z.email().nullable().optional() })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

export const JiraWebhookEvent = z
  .object({
    webhookEvent: z.string().max(80),
    timestamp: z.number().optional(),
    issue: z.object({ key: JiraIssueKey, fields: JiraIssueFields }).loose(),
  })
  .loose();
export type JiraWebhookEvent = z.infer<typeof JiraWebhookEvent>;

export const JiraWebhookResult = z.object({
  outcome: z.enum(['created', 'updated', 'flagged', 'ignored']),
  requirementId: Uuid.nullable(),
});
export type JiraWebhookResult = z.infer<typeof JiraWebhookResult>;
