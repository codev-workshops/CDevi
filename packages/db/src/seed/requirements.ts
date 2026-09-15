/**
 * Deterministic US4 requirements seed (specs/001 research R44, data-model.md §30, quickstart §5.5). Pure: builds
 * rows relative to a base time; `index.ts` writes them after S-500 and dashboard-demo. Eight requirements in
 * payments-api, one per lifecycle state, plus the PAY → payments-api Jira mapping.
 */
import type {
  AnalysisItemKind,
  ExternalRef,
  RequirementSource,
  RequirementState,
  TransitionActorType,
} from '@cdevi/contracts';
import { buildS500, SHOWCASE_WAITING } from './s500';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ENGINEER = 'engineer1@cdevi.demo';
const APPROVER = 'approver1@cdevi.demo';
const ANALYSIS_AGENT = 'Requirement Agent';
const AGENT_SOURCE = `agent:${ANALYSIS_AGENT}`;
const HUMAN_SOURCE = 'user:Engineer 1';

export const JIRA_MAPPING = {
  provider: 'jira',
  externalProjectKey: 'PAY',
  projectKey: 'payments-api',
  baseUrl: 'https://jira.example.invalid',
} as const;

/** External ids of the one requirement per state (and the Jira-linked one), for e2e and docs. */
export const REQUIREMENT_SHOWCASE = {
  draft: 'req-seed-001',
  analyzing: 'req-seed-002',
  needsClarification: 'req-seed-003',
  ready: 'req-seed-004',
  approved: 'req-seed-005',
  inImplementation: 'req-seed-006',
  completed: 'req-seed-007',
  rejected: 'req-seed-008',
  jira: 'req-seed-003',
} as const;

export const EXPECTED_REQUIREMENTS = {
  total: 8,
  byState: {
    DRAFT: 1,
    ANALYZING: 1,
    NEEDS_CLARIFICATION: 1,
    READY: 1,
    APPROVED: 1,
    IN_IMPLEMENTATION: 1,
    COMPLETED: 1,
    REJECTED: 1,
  },
  analysisItems: 28,
  aiGenerated: 26,
  openQuestions: 2,
  jiraLinked: 1,
  linkedWorkflows: 3,
  mappings: 1,
  transitions: 26,
} as const;

export interface SeedAnalysisItem {
  kind: AnalysisItemKind;
  position: number;
  text: string;
  aiGenerated: boolean;
  source: string;
}

export interface SeedRequirementTransition {
  fromState: RequirementState | null;
  toState: RequirementState;
  actorType: TransitionActorType;
  /** User email for `user` actors (resolved to `users.id` at insert); null otherwise. */
  actorEmail: string | null;
  actorName: string;
  reason: string | null;
  occurredAt: Date;
}

export interface SeedRequirement {
  externalId: string;
  project: 'payments-api';
  title: string;
  businessObjective: string;
  state: RequirementState;
  source: RequirementSource;
  externalRef: ExternalRef | null;
  /** Emails resolved to `users.id` at insert. */
  createdBy: string | null;
  assignee: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  analysisObservedAt: Date | null;
  analysisAgent: string | null;
  analysisSummary: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  items: SeedAnalysisItem[];
  transitions: SeedRequirementTransition[];
  /** External id of the S-500 workflow implementing this requirement (`workflows.requirement_id`). */
  linkedWorkflow: string | null;
}

export interface RequirementsSeed {
  requirements: SeedRequirement[];
  mapping: typeof JIRA_MAPPING;
}

type Content = {
  title: string;
  objective: string;
  criteria: string[];
  rules: string[];
  questions: string[];
};

const CONTENT: Record<string, Content> = {
  'req-seed-001': {
    title: 'Retry queue for card declines',
    objective:
      'Recover revenue from soft card declines by retrying the charge on a schedule instead of failing the order immediately.',
    criteria: [
      'A soft-declined payment is retried at most three times over 48 hours.',
      'The customer is emailed once when the final retry fails.',
    ],
    rules: [],
    questions: [],
  },
  'req-seed-002': {
    title: 'Refund status webhooks for merchants',
    objective:
      'Let merchants track refunds without polling by pushing refund status changes to their configured webhook endpoint.',
    criteria: [],
    rules: [],
    questions: [],
  },
  'req-seed-003': {
    title: 'Partial refunds for split shipments',
    objective:
      'Allow a single order paid with one charge to be refunded per shipment so customers get money back as items are returned.',
    criteria: [
      'A refund request may reference a subset of line items of a captured charge.',
      'The sum of partial refunds never exceeds the captured amount.',
      'Each partial refund appears as its own entry in the merchant ledger.',
    ],
    rules: [
      'Refunds are only possible for captured charges (PCI scope unchanged).',
      'Currency rounding follows the ledger rounding rules of the settlement currency.',
    ],
    questions: [
      'Should shipping fees be refunded proportionally or only on the last shipment?',
      'Is a partial refund allowed after the 90-day chargeback window has closed?',
    ],
  },
  'req-seed-004': {
    title: 'Idempotency keys for payment intents',
    objective:
      'Prevent duplicate charges when clients retry a create-payment call after a timeout by honouring a client-supplied idempotency key.',
    criteria: [
      'A repeated request with the same idempotency key returns the original response.',
      'Keys expire after 24 hours and may then be reused.',
      'A key reused with a different payload is rejected with a validation problem.',
      'Idempotency is enforced per merchant account.',
    ],
    rules: [
      'Idempotency keys are opaque strings of at most 255 characters.',
      'The stored response is returned verbatim, including its status code.',
      'Keys are scoped to the API version that created them.',
    ],
    questions: [],
  },
  'req-seed-005': {
    title: 'Rate limiting for the tokenization endpoint',
    objective:
      'Protect the card tokenization endpoint from enumeration attacks by limiting requests per merchant and per client IP.',
    criteria: [
      'A merchant exceeding 600 tokenization requests per minute receives 429 with Retry-After.',
      'A single client IP exceeding 60 requests per minute receives 429.',
      'Limits are visible on the merchant settings page.',
    ],
    rules: [
      'Rate limits are enforced before authentication to bound the cost of invalid requests.',
      'Limit counters are shared across API instances.',
    ],
    questions: [],
  },
  'req-seed-006': {
    title: 'Ledger export for month-end close',
    objective:
      'Give finance a downloadable ledger export per settlement currency so month-end reconciliation no longer needs a database query.',
    criteria: [
      'An administrator can request a CSV export for a calendar month and currency.',
      'The export contains every captured, refunded and disputed amount for the period.',
      'Export generation completes within five minutes for one million rows.',
    ],
    rules: ['Exports include only settled transactions; pending authorizations are excluded.'],
    questions: [],
  },
  'req-seed-007': {
    title: 'Retry policy for settlement webhooks',
    objective:
      'Stop losing settlement notifications when a merchant endpoint is briefly unavailable by retrying with exponential backoff.',
    criteria: [
      'A failed delivery is retried with exponential backoff for up to 24 hours.',
      'Each retry is recorded with its response status.',
      'A merchant can replay a failed webhook manually from the dashboard.',
    ],
    rules: [],
    questions: [],
  },
  'req-seed-008': {
    title: 'Duplicate charge protection on retries',
    objective:
      'Ensure a client that retries a payment after a network timeout does not charge the customer twice.',
    criteria: [],
    rules: [],
    questions: [],
  },
};

function items(content: Content, human: boolean): SeedAnalysisItem[] {
  const out: SeedAnalysisItem[] = [];
  const push = (kind: AnalysisItemKind, texts: string[]) =>
    texts.forEach((text, i) =>
      out.push({
        kind,
        position: i + 1,
        text,
        aiGenerated: !human,
        source: human ? HUMAN_SOURCE : AGENT_SOURCE,
      }),
    );
  push('acceptance_criterion', content.criteria);
  push('rule', content.rules);
  push('open_question', content.questions);
  return out;
}

/** First S-500 workflow of `state` inside payments-api by external id — the requirements' own project. */
function firstS500(base: Date, state: string): string {
  const match = buildS500(base)
    .workflows.filter((w) => w.state === state && w.project === JIRA_MAPPING.projectKey)
    .sort((a, b) => a.externalId.localeCompare(b.externalId))[0];
  if (!match) throw new Error(`S-500 has no ${state} workflow in ${JIRA_MAPPING.projectKey}`);
  return match.externalId;
}

export function buildRequirements(base: Date): RequirementsSeed {
  const requirements: SeedRequirement[] = [];
  const ids = Object.keys(CONTENT);

  const build = (n: number, state: RequirementState): SeedRequirement => {
    const externalId = ids[n - 1]!;
    const content = CONTENT[externalId]!;
    const createdAt = new Date(base.getTime() - (9 - n) * DAY);
    const at = (hours: number) => new Date(createdAt.getTime() + hours * HOUR);
    const jira = externalId === REQUIREMENT_SHOWCASE.jira;
    const analysed = !['DRAFT', 'ANALYZING', 'REJECTED'].includes(state);
    const user = (
      from: RequirementState | null,
      to: RequirementState,
      email: string,
      name: string,
      occurredAt: Date,
      reason: string | null = null,
    ): SeedRequirementTransition => ({
      fromState: from,
      toState: to,
      actorType: 'user',
      actorEmail: email,
      actorName: name,
      reason,
      occurredAt,
    });
    const transitions: SeedRequirementTransition[] = [
      jira
        ? {
            fromState: null,
            toState: 'DRAFT',
            actorType: 'system',
            actorEmail: null,
            actorName: 'jira',
            reason: 'Imported from Jira PAY-231',
            occurredAt: createdAt,
          }
        : user(null, 'DRAFT', ENGINEER, 'Engineer 1', createdAt),
    ];
    // req-seed-008 is rejected straight from Draft: Approver 1 spotted the duplicate before analysis.
    const submittedAt = state === 'DRAFT' || state === 'REJECTED' ? null : at(1);
    if (submittedAt)
      transitions.push(user('DRAFT', 'ANALYZING', ENGINEER, 'Engineer 1', submittedAt));
    const analysisObservedAt = analysed ? at(2) : null;
    if (analysisObservedAt)
      transitions.push({
        fromState: 'ANALYZING',
        toState: content.questions.length > 0 ? 'NEEDS_CLARIFICATION' : 'READY',
        actorType: 'agent',
        actorEmail: null,
        actorName: ANALYSIS_AGENT,
        reason: content.questions.length > 0 ? `${content.questions.length} open questions` : null,
        occurredAt: analysisObservedAt,
      });
    const approved = ['APPROVED', 'IN_IMPLEMENTATION', 'COMPLETED'].includes(state);
    const approvedAt = approved ? at(6) : null;
    if (approvedAt) transitions.push(user('READY', 'APPROVED', APPROVER, 'Approver 1', approvedAt));
    const linkedWorkflow =
      state === 'APPROVED'
        ? firstS500(base, 'QUEUED')
        : state === 'IN_IMPLEMENTATION'
          ? SHOWCASE_WAITING
          : state === 'COMPLETED'
            ? firstS500(base, 'COMPLETED')
            : null;
    const system = (
      from: RequirementState,
      to: RequirementState,
      hours: number,
      workflowState: string,
    ) =>
      transitions.push({
        fromState: from,
        toState: to,
        actorType: 'system',
        actorEmail: null,
        actorName: 'workflow',
        reason: `workflow ${linkedWorkflow} → ${workflowState}`,
        occurredAt: at(hours),
      });
    if (state === 'IN_IMPLEMENTATION') system('APPROVED', 'IN_IMPLEMENTATION', 8, 'RUNNING');
    if (state === 'COMPLETED') {
      system('APPROVED', 'IN_IMPLEMENTATION', 8, 'RUNNING');
      system('IN_IMPLEMENTATION', 'COMPLETED', 30, 'COMPLETED');
    }
    const rejectedAt = state === 'REJECTED' ? at(6) : null;
    const rejectionReason = rejectedAt ? `Duplicate of ${REQUIREMENT_SHOWCASE.ready}` : null;
    if (rejectedAt)
      transitions.push(
        user('DRAFT', 'REJECTED', APPROVER, 'Approver 1', rejectedAt, rejectionReason),
      );
    const assignee = jira ? APPROVER : state === 'READY' ? ENGINEER : null;
    return {
      externalId,
      project: 'payments-api',
      title: content.title,
      businessObjective: content.objective,
      state,
      source: jira ? 'jira' : 'manual',
      externalRef: jira
        ? {
            provider: 'jira',
            key: 'PAY-231',
            url: `${JIRA_MAPPING.baseUrl}/browse/PAY-231`,
            updatedAt: at(0.5).toISOString(),
          }
        : null,
      createdBy: jira ? null : ENGINEER,
      assignee,
      submittedBy: submittedAt ? ENGINEER : null,
      submittedAt,
      analysisObservedAt,
      analysisAgent: analysisObservedAt ? ANALYSIS_AGENT : null,
      analysisSummary: analysisObservedAt
        ? `${content.criteria.length} acceptance criteria, ${content.rules.length} rules, ${content.questions.length} open questions identified.`
        : null,
      approvedBy: approvedAt ? APPROVER : null,
      approvedAt,
      rejectedBy: rejectedAt ? APPROVER : null,
      rejectedAt,
      rejectionReason,
      createdAt,
      items: state === 'DRAFT' ? items(content, true) : analysed ? items(content, false) : [],
      transitions,
      linkedWorkflow,
    };
  };

  const states: RequirementState[] = [
    'DRAFT',
    'ANALYZING',
    'NEEDS_CLARIFICATION',
    'READY',
    'APPROVED',
    'IN_IMPLEMENTATION',
    'COMPLETED',
    'REJECTED',
  ];
  states.forEach((state, i) => requirements.push(build(i + 1, state)));
  return { requirements, mapping: JIRA_MAPPING };
}
