/**
 * `GET /workflows` — the bounded workflow list the Workflow Center will consume
 * (specs/001 FR-003 shape, data-model.md §27, research R39). 50 per page, keyset cursor
 * over (state_observed_at DESC, id DESC).
 */
import { z } from 'zod';
import { ProjectRef } from './auth';
import { IsoDateTime, splitCsv, Uuid } from './common';
import { Href } from './dashboard';
import { StageProgress } from './requirements';
import { WORKFLOW_STATES, WorkflowState } from './vocabulary';

export const WorkflowListQuery = z.object({
  project: z.union([z.literal('all'), Uuid]).default('all'),
  requirement: Uuid.optional(),
  state: z.preprocess(splitCsv, z.array(WorkflowState).max(WORKFLOW_STATES.length)).optional(),
  stage: z.coerce.number().int().min(1).max(7).optional(),
  cursor: z.string().max(200).optional(),
});
export type WorkflowListQuery = z.infer<typeof WorkflowListQuery>;

export const PullRequestRef = z.object({
  url: z.string(),
  number: z.number().int().min(1).nullable(),
  state: z.string().nullable(),
});
export type PullRequestRef = z.infer<typeof PullRequestRef>;

export const WorkflowListItem = z.object({
  id: Uuid,
  externalId: z.string(),
  title: z.string(),
  project: ProjectRef,
  state: WorkflowState,
  stateObservedAt: IsoDateTime,
  stage: StageProgress.nullable(),
  agent: z.string().nullable(),
  pullRequest: PullRequestRef.nullable(),
  requirement: z.object({ id: Uuid, title: z.string(), href: Href }).nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  href: Href,
});
export type WorkflowListItem = z.infer<typeof WorkflowListItem>;

export const WorkflowListPage = z.object({
  generatedAt: IsoDateTime,
  project: z.union([z.literal('all'), Uuid]),
  filters: z.object({
    requirement: Uuid.nullable(),
    state: z.array(WorkflowState).max(WORKFLOW_STATES.length),
    stage: z.number().int().min(1).max(7).nullable(),
  }),
  items: z.array(WorkflowListItem).max(50),
  nextCursor: z.string().nullable(),
  total: z.number().int().min(0),
});
export type WorkflowListPage = z.infer<typeof WorkflowListPage>;
