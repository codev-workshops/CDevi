/**
 * Typed fixtures for the Requirements screens (specs/001 US4, T109). Mirrors the eight seed rows of
 * packages/db/src/seed/requirements.ts (req-seed-001 … req-seed-008, one per state, project payments-api).
 */
import type {
  AnalysisItem,
  Me,
  Requirement,
  RequirementDetail,
  RequirementListPage,
  RequirementState,
} from '@cdevi/contracts';
import { requirementActions } from '@cdevi/contracts/requirement-rules';
import type { Role } from '@cdevi/contracts/vocabulary';

export const NOW = '2026-09-14T09:00:00.000Z';
const daysAgo = (d: number) => new Date(new Date(NOW).getTime() - d * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(new Date(NOW).getTime() - h * 3_600_000).toISOString();

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const PROJECT = { id: id(0x100), key: 'payments-api', name: 'Payments API' };
export const OTHER_PROJECT = { id: id(0x101), key: 'web-portal', name: 'Web Portal' };

export const ENGINEER = { id: id(0x201), name: 'Engineer 1' };
export const APPROVER = { id: id(0x202), name: 'Approver 1' };
export const VIEWER = { id: id(0x203), name: 'Viewer 1' };

export const JIRA_KEY = 'PAY-231';
export const JIRA_URL = `https://jira.example.invalid/browse/${JIRA_KEY}`;

export function me(role: Role): Me {
  const user =
    role === 'engineer'
      ? ENGINEER
      : role === 'viewer'
        ? VIEWER
        : role === 'approver'
          ? APPROVER
          : { id: id(0x204), name: 'Admin 1' };
  return {
    user: { id: user.id, displayName: user.name, role },
    organization: { id: id(0x1), name: 'Acme', isDemo: true },
    projects: [PROJECT, OTHER_PROJECT],
    canCreateRequirement: role !== 'viewer',
  };
}

const WORKFLOW_IDS = { queued: id(0x301), waiting: id(0x302), completed: id(0x303) };

type Seed = {
  n: number;
  state: RequirementState;
  title: string;
  over?: Partial<Requirement>;
};

const SEEDS: Seed[] = [
  { n: 1, state: 'DRAFT', title: 'Add refund reason codes to the payments API' },
  { n: 2, state: 'ANALYZING', title: 'Retry failed webhook deliveries with back-off' },
  {
    n: 3,
    state: 'NEEDS_CLARIFICATION',
    title: 'Support partial captures for card payments',
    over: {
      source: 'jira',
      externalRef: { provider: 'jira', key: JIRA_KEY, url: JIRA_URL, updatedAt: daysAgo(5) },
      assignee: APPROVER,
      createdBy: null,
      openQuestionCount: 2,
    },
  },
  { n: 4, state: 'READY', title: 'Expose settlement reports per merchant' },
  {
    n: 5,
    state: 'APPROVED',
    title: 'Add rate limiting to /api/auth',
    over: {
      workflow: {
        id: WORKFLOW_IDS.queued,
        externalId: 's500-001',
        state: 'QUEUED',
        stage: { index: 1, count: 7, name: 'Specify' },
        href: `/workflows/${WORKFLOW_IDS.queued}`,
      },
    },
  },
  {
    n: 6,
    state: 'IN_IMPLEMENTATION',
    title: 'Migrate ledger exports to the new bucket',
    over: {
      assignee: ENGINEER,
      workflow: {
        id: WORKFLOW_IDS.waiting,
        externalId: 's500-002',
        state: 'WAITING_FOR_HUMAN',
        stage: { index: 6, count: 7, name: 'Approve' },
        href: `/workflows/${WORKFLOW_IDS.waiting}`,
      },
    },
  },
  {
    n: 7,
    state: 'COMPLETED',
    title: 'Tokenise stored card numbers',
    over: {
      workflow: {
        id: WORKFLOW_IDS.completed,
        externalId: 's500-003',
        state: 'COMPLETED',
        stage: { index: 7, count: 7, name: 'Merge' },
        href: `/workflows/${WORKFLOW_IDS.completed}`,
      },
    },
  },
  { n: 8, state: 'REJECTED', title: 'Rewrite the payments API in a new language' },
];

export function row(seed: Seed): Requirement {
  const rid = id(0x400 + seed.n);
  return {
    id: rid,
    externalId: `req-seed-${String(seed.n).padStart(3, '0')}`,
    project: PROJECT,
    title: seed.title,
    state: seed.state,
    source: 'manual',
    externalRef: null,
    externalFlag: null,
    externalFlaggedAt: null,
    assignee: null,
    createdBy: ENGINEER,
    createdAt: daysAgo(9 - seed.n),
    updatedAt: daysAgo(9 - seed.n),
    openQuestionCount: 0,
    workflow: null,
    href: `/requirements/${rid}`,
    ...seed.over,
  };
}

/** Rows in API order: created_at DESC, id DESC (req-seed-008 first). */
export const SEED_ROWS: Requirement[] = SEEDS.map(row).reverse();

export function page(over: Partial<RequirementListPage> = {}): RequirementListPage {
  return {
    generatedAt: NOW,
    project: 'all',
    filters: { state: [], assignee: null },
    items: SEED_ROWS,
    nextCursor: null,
    total: SEED_ROWS.length,
    ...over,
  };
}

export const listPopulated = (): RequirementListPage => page();
export const listEmpty = (): RequirementListPage => page({ items: [], total: 0 });
export const listFiltered = (): RequirementListPage =>
  page({
    filters: { state: ['NEEDS_CLARIFICATION'], assignee: null },
    items: SEED_ROWS.filter((r) => r.state === 'NEEDS_CLARIFICATION'),
    total: 1,
  });
export const listFilteredEmpty = (): RequirementListPage =>
  page({ filters: { state: ['COMPLETED'], assignee: 'me' }, items: [], total: 0 });

/** A page of `count` synthetic rows (for the 50-row bound), offset so ids never collide with the seed rows. */
export function bulkPage(count: number, offset = 0, over: Partial<RequirementListPage> = {}) {
  const items: Requirement[] = [];
  for (let i = 0; i < count; i++) {
    const n = 1000 + offset + i;
    const r = row({ n: 100 + offset + i, state: 'DRAFT', title: `Bulk requirement ${n}` });
    items.push({ ...r, id: id(0x5000 + n), href: `/requirements/${id(0x5000 + n)}` });
  }
  return page({ items, total: 120, nextCursor: 'cursor-next', ...over });
}

let itemN = 0;
function item(kind: AnalysisItem['kind'], text: string, human?: string): AnalysisItem {
  itemN += 1;
  return {
    id: id(0x600 + itemN),
    kind,
    position: itemN,
    text,
    aiGenerated: !human,
    source: human ? `user:${human}` : 'agent:Requirement Agent',
  };
}

export const AGENT_NAME = 'Requirement Agent';

function analysis(openQuestions: string[], withHuman = false): RequirementDetail['analysis'] {
  itemN = 0;
  return {
    observedAt: hoursAgo(2),
    summary: 'The requirement is well scoped; two payment flows are affected.',
    acceptanceCriteria: [
      ...(withHuman
        ? [item('acceptance_criterion', 'Captures below 1 EUR are rejected', 'Engineer 1')]
        : []),
      item('acceptance_criterion', 'A partial capture reduces the authorised amount'),
      item('acceptance_criterion', 'The remaining authorisation is released after 7 days'),
    ],
    rules: [item('rule', 'Only one capture per authorisation per day')],
    openQuestions: openQuestions.map((q) => item('open_question', q)),
  };
}

const OPEN_QUESTIONS = [
  'Should partial captures be allowed for 3-D Secure transactions?',
  'Which merchants are in the pilot?',
];

type DetailSeed = {
  n: number;
  role?: Role;
  analysis?: RequirementDetail['analysis'];
  over?: Partial<RequirementDetail>;
  rowOver?: Partial<Requirement>;
};

export function detail(seed: DetailSeed): RequirementDetail {
  const base = SEEDS.find((s) => s.n === seed.n)!;
  const requirement = { ...row(base), ...seed.rowOver };
  const role = seed.role ?? 'engineer';
  const submitted = requirement.state !== 'DRAFT';
  const decided =
    requirement.state === 'APPROVED' ||
    requirement.state === 'IN_IMPLEMENTATION' ||
    requirement.state === 'COMPLETED' ||
    requirement.state === 'REJECTED';
  return {
    requirement,
    businessObjective:
      'Merchants need to capture part of an authorised amount when an order ships in several parcels.',
    analysis: seed.analysis ?? null,
    submittedBy: submitted ? ENGINEER : null,
    submittedAt: submitted ? daysAgo(3) : null,
    decidedBy: decided ? APPROVER : null,
    decidedAt: decided ? daysAgo(1) : null,
    decisionReason: requirement.state === 'REJECTED' ? 'Out of scope for this quarter' : null,
    actions: requirementActions(requirement.state, role),
    transitions: [
      {
        fromState: null,
        toState: 'DRAFT',
        actorType: 'user',
        actorName: ENGINEER.name,
        reason: null,
        occurredAt: daysAgo(4),
      },
      ...(submitted
        ? [
            {
              fromState: 'DRAFT' as const,
              toState: 'ANALYZING' as const,
              actorType: 'user' as const,
              actorName: ENGINEER.name,
              reason: null,
              occurredAt: daysAgo(3),
            },
          ]
        : []),
    ],
    audit: submitted
      ? [
          {
            id: id(0x700),
            action: 'requirement.submitted',
            actorName: ENGINEER.name,
            reason: null,
            riskLevel: null,
            occurredAt: daysAgo(3),
          },
        ]
      : [],
    generatedAt: NOW,
    ...seed.over,
  };
}

export const detailDraft = (role: Role = 'engineer') => detail({ n: 1, role });
export const detailAnalyzing = (role: Role = 'engineer') => detail({ n: 2, role });
export const detailNeedsClarification = (role: Role = 'engineer') =>
  detail({ n: 3, role, analysis: analysis(OPEN_QUESTIONS, true) });
export const detailReady = (role: Role = 'approver') =>
  detail({ n: 4, role, analysis: analysis([]) });
export const detailApproved = (role: Role = 'approver') =>
  detail({ n: 5, role, analysis: analysis([]) });
export const detailCompleted = (role: Role = 'approver') =>
  detail({ n: 7, role, analysis: analysis([]) });
export const detailRejected = (role: Role = 'approver') =>
  detail({ n: 8, role, analysis: analysis([]) });
/** req-seed-005 after its Jira issue was deleted externally: flagged, workflow BLOCKED (spec edge case). */
export const detailFlagged = (role: Role = 'approver') =>
  detail({
    n: 5,
    role,
    analysis: analysis([]),
    rowOver: {
      source: 'jira',
      externalRef: {
        provider: 'jira',
        key: 'PAY-241',
        url: 'https://jira.example.invalid/browse/PAY-241',
        updatedAt: daysAgo(1),
      },
      externalFlag: 'deleted',
      externalFlaggedAt: hoursAgo(1),
      workflow: {
        id: WORKFLOW_IDS.queued,
        externalId: 's500-001',
        state: 'BLOCKED',
        stage: { index: 1, count: 7, name: 'Specify' },
        href: `/workflows/${WORKFLOW_IDS.queued}`,
      },
    },
  });

/** The list row for the flagged requirement (list "Jira deleted" pill). */
export const flaggedRow = (): Requirement => detailFlagged().requirement;
