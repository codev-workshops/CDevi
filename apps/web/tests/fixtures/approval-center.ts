import type {
  ApprovalCenterDetail,
  ApprovalCenterItem,
  ApprovalCenterSnapshot,
  AuditEventView,
  Resolution,
} from '@cdevi/contracts';

export const NOW = '2026-09-14T09:00:00.000Z';
const at = (minsAgo: number) => new Date(new Date(NOW).getTime() - minsAgo * 60_000).toISOString();
let n = 0;
const uuid = () => `00000000-0000-7000-9000-${(++n).toString(16).padStart(12, '0')}`;

export const PAYMENTS = { id: uuid(), key: 'PAY', name: 'Payments API' };
export const WEB = { id: uuid(), key: 'WEB', name: 'Web App' };

function item(over: Partial<ApprovalCenterItem>): ApprovalCenterItem {
  const id = over.id ?? uuid();
  const kind = over.kind ?? 'approval';
  return {
    id,
    kind,
    workflowId: uuid(),
    workflowExternalId: 'WF-100',
    workflowTitle: 'Rotate signing keys',
    project: PAYMENTS,
    ask: 'Approve: rotate production signing keys',
    riskLevel: kind === 'approval' ? 'CRITICAL' : null,
    requestedBy: 'Implementation Agent',
    requestedAt: at(40),
    expiresAt: null,
    hasRecommendedAnswer: false,
    href: `/approvals/${id}`,
    ...over,
  };
}

export const critical = item({
  workflowExternalId: 'WF-100',
  ask: 'Approve: rotate production signing keys',
  riskLevel: 'CRITICAL',
  expiresAt: at(-236),
});
export const medium = item({
  workflowExternalId: 'WF-101',
  workflowTitle: 'Merge PR #482',
  ask: 'Approve: merge PR #482 into main',
  riskLevel: 'MEDIUM',
  requestedAt: at(120),
});
export const low = item({
  workflowExternalId: 'WF-102',
  workflowTitle: 'Requirement: rate limiting',
  ask: 'Approve requirement: add rate limiting to /login',
  riskLevel: 'LOW',
  project: WEB,
  requestedAt: at(200),
});
export const clarification = item({
  kind: 'clarification',
  workflowExternalId: 'WF-103',
  workflowTitle: 'Rate limiting',
  ask: 'Should the limiter apply per IP or per account?',
  riskLevel: null,
  requestedBy: 'Analysis Agent',
  requestedAt: at(30),
  hasRecommendedAnswer: true,
});

export const items: ApprovalCenterItem[] = [critical, medium, low, clarification];

export function snapshot(over: Partial<ApprovalCenterSnapshot> = {}): ApprovalCenterSnapshot {
  const list = over.items ?? items;
  return {
    generatedAt: NOW,
    project: 'all',
    items: list,
    counts: {
      approvals: list.filter((i) => i.kind === 'approval').length,
      clarifications: list.filter((i) => i.kind === 'clarification').length,
    },
    ...over,
  };
}

const LINKS = {
  requirement: '/requirements/REQ-42',
  pullRequest: 'https://github.com/acme/payments-api/pull/482',
};

export function approvalDetail(over: Partial<ApprovalCenterDetail> = {}): ApprovalCenterDetail {
  return {
    item: critical,
    workflowState: 'WAITING_FOR_HUMAN',
    canDecide: true,
    approval: {
      context:
        'Rotates the production JWT signing keys; sessions issued before now are invalidated.',
      links: LINKS,
      requiresConfirmation: true,
    },
    clarification: null,
    resolution: null,
    audit: [],
    ...over,
  };
}

export function lowRiskDetail(over: Partial<ApprovalCenterDetail> = {}): ApprovalCenterDetail {
  return approvalDetail({
    item: low,
    approval: {
      context: null,
      links: { requirement: '/requirements/REQ-7' },
      requiresConfirmation: false,
    },
    ...over,
  });
}

export const OPTIONS = [
  { value: 'ip', label: 'Per IP only', recommended: false },
  { value: 'ip-account', label: 'Per IP and per authenticated account', recommended: true },
];

export function clarificationDetail(
  over: Partial<ApprovalCenterDetail> = {},
): ApprovalCenterDetail {
  return {
    item: clarification,
    workflowState: 'WAITING_FOR_HUMAN',
    canDecide: true,
    approval: null,
    clarification: {
      whyItMatters: 'Determines whether shared office IPs lock out whole teams.',
      options: OPTIONS,
      links: { requirement: '/requirements/REQ-42' },
    },
    resolution: null,
    audit: [],
    ...over,
  };
}

export function resolution(over: Partial<Resolution> = {}): Resolution {
  return {
    outcome: 'approved',
    by: { id: uuid(), name: 'Approver 2' },
    at: at(1),
    answer: null,
    reason: null,
    target: null,
    workflowState: 'RUNNING',
    ...over,
  };
}

export function auditEvent(over: Partial<AuditEventView> = {}): AuditEventView {
  return {
    id: uuid(),
    occurredAt: at(1),
    actor: { type: 'user', id: uuid(), name: 'Approver 2' },
    action: 'approval.approved',
    target: { type: 'approval', id: critical.id },
    riskLevel: 'CRITICAL',
    result: 'RUNNING',
    details: {},
    ...over,
  };
}
