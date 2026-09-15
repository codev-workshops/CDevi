/**
 * Pure, zod-free rules for User Story 4 (Requirements) — specs/001 data-model.md §28,
 * research.md R32/R33/R36/R38/R39/R41/R42. Imported by the API and by browser code via
 * `@cdevi/contracts/requirement-rules`; nothing here may pull in zod.
 */
import { canDecide } from './decision-rules';
import { InvalidCursorError } from './read-model';
import { canCreateRequirement, type Role, type WorkflowState } from './vocabulary';

export const REQUIREMENT_STATES = [
  'DRAFT',
  'ANALYZING',
  'NEEDS_CLARIFICATION',
  'READY',
  'APPROVED',
  'IN_IMPLEMENTATION',
  'COMPLETED',
  'REJECTED',
] as const;

/** Structural twin of the Zod `RequirementState` in ./requirements (kept zod-free here). */
export type RequirementState = (typeof REQUIREMENT_STATES)[number];

export type SubmitLabel = 'Submit for analysis' | 'Resubmit for analysis';

/** Structural twin of the Zod `RequirementActions` in ./requirements. */
export type RequirementActions = {
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  submitLabel: SubmitLabel;
  reasons: string[];
};

/** Allowed target states per current state; `CREATE` is the pseudo-state before the first row. */
export const REQUIREMENT_TRANSITIONS: Readonly<
  Record<RequirementState | 'CREATE', readonly RequirementState[]>
> = {
  CREATE: ['DRAFT'],
  DRAFT: ['ANALYZING', 'REJECTED'],
  ANALYZING: ['READY', 'NEEDS_CLARIFICATION'],
  NEEDS_CLARIFICATION: ['ANALYZING', 'READY', 'NEEDS_CLARIFICATION', 'REJECTED'],
  READY: ['APPROVED', 'REJECTED'],
  APPROVED: ['IN_IMPLEMENTATION', 'COMPLETED'],
  IN_IMPLEMENTATION: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
};

export const TERMINAL_REQUIREMENT_STATES: readonly RequirementState[] = ['COMPLETED', 'REJECTED'];

export const isTerminalRequirement = (state: RequirementState): boolean =>
  TERMINAL_REQUIREMENT_STATES.includes(state);

export const canTransitionRequirement = (
  from: RequirementState | null,
  to: RequirementState,
): boolean => REQUIREMENT_TRANSITIONS[from ?? 'CREATE'].includes(to);

/** Analysis delivered by the runtime: READY when nothing is open, otherwise NEEDS_CLARIFICATION. */
export const stateAfterAnalysis = (openQuestionCount: number): RequirementState =>
  openQuestionCount > 0 ? 'NEEDS_CLARIFICATION' : 'READY';

const WORKFLOW_NOT_STARTED: readonly WorkflowState[] = ['QUEUED', 'BLOCKED', 'CANCELLED'];

/**
 * The requirement state a linked workflow's state implies, or null when nothing changes
 * (mirrors the `workflows_follow_requirement` trigger of 0005_requirements.sql).
 */
export function requirementStateForWorkflow(
  current: RequirementState,
  workflow: WorkflowState,
): RequirementState | null {
  if (workflow === 'COMPLETED' && (current === 'APPROVED' || current === 'IN_IMPLEMENTATION'))
    return 'COMPLETED';
  if (current === 'APPROVED' && !WORKFLOW_NOT_STARTED.includes(workflow))
    return 'IN_IMPLEMENTATION';
  return null;
}

const SUBMITTABLE: readonly RequirementState[] = ['DRAFT', 'NEEDS_CLARIFICATION'];
const REJECTABLE: readonly RequirementState[] = ['DRAFT', 'NEEDS_CLARIFICATION', 'READY'];

export const ONLY_DECIDERS_REASON = 'Only approvers and administrators can approve';
export const ONLY_CREATORS_REASON = 'Only engineers, approvers and administrators can submit';
export const ANALYSIS_UNFINISHED_REASON = 'Analysis has not finished';
export const ANALYSIS_RUNNING_REASON = 'Analysis is in progress';

/** Role- and state-gated affordances for the detail screen (FR-032). */
export function requirementActions(state: RequirementState, role: Role): RequirementActions {
  const reasons: string[] = [];
  const creator = canCreateRequirement(role);
  const decider = canDecide(role);
  const canSubmit = creator && SUBMITTABLE.includes(state);
  const canApprove = decider && state === 'READY';
  const canReject = decider && REJECTABLE.includes(state);

  if (SUBMITTABLE.includes(state) && !creator) reasons.push(ONLY_CREATORS_REASON);
  if (REJECTABLE.includes(state) && !decider) reasons.push(ONLY_DECIDERS_REASON);
  if (SUBMITTABLE.includes(state) && decider) reasons.push(ANALYSIS_UNFINISHED_REASON);
  if (state === 'ANALYZING') reasons.push(ANALYSIS_RUNNING_REASON);

  return {
    canSubmit,
    canApprove,
    canReject,
    submitLabel: state === 'NEEDS_CLARIFICATION' ? 'Resubmit for analysis' : 'Submit for analysis',
    reasons,
  };
}

export const REQUIREMENTS_PAGE_SIZE = 50;
export const WORKFLOWS_PAGE_SIZE = 50;

export type RequirementCursor = { createdAt: string; id: string };
export type WorkflowCursor = { stateObservedAt: string; id: string };

const b64url = {
  encode: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
  decode: (s: string) => Buffer.from(s, 'base64url').toString('utf8'),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeTagged(tag: string, cursor: string): [string, string] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64url.decode(cursor));
  } catch {
    throw new InvalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== tag)
    throw new InvalidCursorError();
  const [, at, id] = parsed as [unknown, unknown, unknown];
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw new InvalidCursorError();
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new InvalidCursorError();
  return [at, id];
}

export const encodeRequirementCursor = (k: RequirementCursor): string =>
  b64url.encode(JSON.stringify(['requirements', k.createdAt, k.id]));

export function decodeRequirementCursor(cursor: string): RequirementCursor {
  const [createdAt, id] = decodeTagged('requirements', cursor);
  return { createdAt, id };
}

export const encodeWorkflowCursor = (k: WorkflowCursor): string =>
  b64url.encode(JSON.stringify(['workflows', k.stateObservedAt, k.id]));

export function decodeWorkflowCursor(cursor: string): WorkflowCursor {
  const [stateObservedAt, id] = decodeTagged('workflows', cursor);
  return { stateObservedAt, id };
}

export type RequirementListFilters = {
  project?: 'all' | string;
  state?: readonly RequirementState[];
  assignee?: 'me' | 'unassigned' | string;
};

export const requirementHrefs = {
  requirement: (id: string) => `/requirements/${id}`,
  workflow: (id: string) => `/workflows/${id}`,
  list: (f: RequirementListFilters): string => {
    const params: string[] = [];
    if (f.project && f.project !== 'all') params.push(`project=${f.project}`);
    if (f.state && f.state.length > 0) params.push(`state=${f.state.join(',')}`);
    if (f.assignee) params.push(`assignee=${f.assignee}`);
    return params.length ? `/requirements?${params.join('&')}` : '/requirements';
  },
};

export const isSafeExternalUrl = (url: string): boolean => {
  if (!url.startsWith('https://')) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/** One lowercase word per state for the pill (design-system `requirementStateToPill`). */
export const REQUIREMENT_STATE_WORDS: Readonly<Record<RequirementState, string>> = {
  DRAFT: 'draft',
  ANALYZING: 'analyzing',
  NEEDS_CLARIFICATION: 'needs clarification',
  READY: 'ready',
  APPROVED: 'approved',
  IN_IMPLEMENTATION: 'in implementation',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
};

export const OBJECTIVE_MAX = 4000;

type AdfNode = { type?: unknown; text?: unknown; content?: unknown };

const BLOCK_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'panel',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'rule',
  'mediaGroup',
  'mediaSingle',
]);

function flattenAdf(node: AdfNode): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  if (!Array.isArray(node.content)) return '';
  const children = (node.content as AdfNode[])
    .filter((c) => c && typeof c === 'object')
    .map(flattenAdf);
  const blocks = children.filter((_, i) => {
    const t = (node.content as AdfNode[])[i]?.type;
    return typeof t === 'string' && BLOCK_TYPES.has(t);
  });
  return blocks.length ? children.filter((c) => c.length > 0).join('\n') : children.join('');
}

/** Jira issue descriptions arrive as plain strings (Server) or ADF documents (Cloud). */
export function adfToPlainText(description: unknown, max = OBJECTIVE_MAX): string {
  if (description == null) return '';
  const text =
    typeof description === 'string'
      ? description
      : typeof description === 'object'
        ? flattenAdf(description as AdfNode)
        : '';
  return text.trim().slice(0, max);
}

export type JiraWebhookEventLike = {
  webhookEvent: string;
  issue: {
    key: string;
    fields: {
      summary: string;
      description?: unknown;
      updated?: string | undefined;
      project: { key: string };
      status?: { name?: string; statusCategory?: { key?: string } | null } | null;
      assignee?: { emailAddress?: string | null } | null;
    };
  };
};

export type JiraMappedEvent = {
  kind: 'create' | 'update' | 'flag' | 'ignore';
  key: string;
  projectKey: string;
  title: string;
  objective: string;
  url: (base: string) => string;
  updatedAt: string | null;
  flag: 'deleted' | 'closed' | null;
  assigneeEmail: string | null;
};

/** Jira sends `+0000`-style offsets that `Date.parse` accepts; anything unparsable becomes null. */
function jiraTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const normalised = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function mapJiraEvent(event: JiraWebhookEventLike): JiraMappedEvent {
  const { key, fields } = event.issue;
  const title = fields.summary.trim().slice(0, 200) || key;
  const objective = adfToPlainText(fields.description) || `Imported from Jira ${key}`;
  const base: Omit<JiraMappedEvent, 'kind' | 'flag'> = {
    key,
    projectKey: fields.project.key,
    title,
    objective,
    url: (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/browse/${key}`,
    updatedAt: jiraTimestamp(fields.updated),
    assigneeEmail: fields.assignee?.emailAddress ?? null,
  };
  switch (event.webhookEvent) {
    case 'jira:issue_created':
      return { ...base, kind: 'create', flag: null };
    case 'jira:issue_updated':
      return fields.status?.statusCategory?.key === 'done'
        ? { ...base, kind: 'flag', flag: 'closed' }
        : { ...base, kind: 'update', flag: null };
    case 'jira:issue_deleted':
      return { ...base, kind: 'flag', flag: 'deleted' };
    default:
      return { ...base, kind: 'ignore', flag: null };
  }
}
