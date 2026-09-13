import { useState } from 'react';
import {
  AppShell,
  Brand,
  List,
  ListRow,
  Main,
  NavGroup,
  NavItem,
  PageMeta,
  Pill,
  RiskBadge,
  Side,
  Stat,
  StatGrid,
  StatePill,
  Topbar,
  type RiskLevel,
} from '@cdevi/design-system';

/**
 * Approval Center — specs/001-sdlc-control-plane-mvp/spec.md, User Story 2, scenario 1.
 *
 * Every pending human intervention (approvals and agent clarification questions) in one list,
 * each showing identifier, what is requested, who asked, when, and risk level; ordered highest
 * risk first, then oldest first. Sample data only — no backend yet.
 */

export type ApprovalKind = 'approval' | 'clarification';

export interface ApprovalItem {
  /** Approval request or clarification id. */
  id: string;
  kind: ApprovalKind;
  /** Requirement / workflow identifier the item belongs to (e.g. a Jira key). */
  workflowId: string;
  /** Short name of the requirement or workflow. */
  workflowTitle: string;
  /** What is being requested — the exact action to approve or the question asked. */
  request: string;
  /** Agent or user who raised it. */
  requester: string;
  /** ISO-8601 creation time. */
  createdAt: string;
  risk: RiskLevel;
  /** Where the item opens. */
  href: string;
}

const RISK_RANK: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Highest risk first, then oldest first (acceptance scenario 1). Pure; does not mutate. */
export function sortApprovalItems(items: readonly ApprovalItem[]): ApprovalItem[] {
  return [...items].sort((a, b) => {
    const byRisk = RISK_RANK[a.risk] - RISK_RANK[b.risk];
    if (byRisk !== 0) return byRisk;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

/** Three pending items from the User Story 2 independent test. */
export const SAMPLE_ITEMS: readonly ApprovalItem[] = [
  {
    id: 'APR-3101',
    kind: 'approval',
    workflowId: 'CDV-142',
    workflowTitle: 'Rate-limit the public webhook endpoint',
    request: 'Approve requirement so analysis can start',
    requester: 'requirement-agent',
    createdAt: '2025-09-13T06:40:00Z',
    risk: 'LOW',
    href: '#/approvals/APR-3101',
  },
  {
    id: 'APR-3118',
    kind: 'approval',
    workflowId: 'CDV-137',
    workflowTitle: 'Move session store to Redis',
    request: 'Approve merge of PR #482 into main (12 files, migrations included)',
    requester: 'pr-agent',
    createdAt: '2025-09-13T09:15:00Z',
    risk: 'MEDIUM',
    href: '#/approvals/APR-3118',
  },
  {
    id: 'CLR-877',
    kind: 'clarification',
    workflowId: 'CDV-151',
    workflowTitle: 'Export audit log as CSV',
    request: 'Should exports include events from archived projects, or only active ones?',
    requester: 'analysis-agent',
    createdAt: '2025-09-13T04:05:00Z',
    risk: 'LOW',
    href: '#/clarifications/CLR-877',
  },
];

const KIND_LABEL: Record<ApprovalKind, string> = {
  approval: 'approval',
  clarification: 'clarification',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse relative time ("2 h ago"); the exact instant is in the `<time>` element. */
export function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  return `${Math.floor(diff / DAY)} d ago`;
}

export interface ApprovalCenterProps {
  items?: readonly ApprovalItem[];
  /** Injected for deterministic rendering in tests; defaults to `Date.now()`. */
  now?: number;
}

export function ApprovalCenter({ items = SAMPLE_ITEMS, now }: ApprovalCenterProps) {
  // Read the clock once per mount so render stays pure; callers may inject `now` for tests.
  const [mountedAt] = useState(() => Date.now());
  const clock = now ?? mountedAt;
  const sorted = sortApprovalItems(items);
  const approvals = sorted.filter((it) => it.kind === 'approval').length;
  const clarifications = sorted.length - approvals;

  return (
    <AppShell
      side={
        <Side brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" href="#/" />}>
          <NavGroup>Supervise</NavGroup>
          <NavItem href="#/">Dashboard</NavItem>
          <NavItem href="#/workflows">Workflow Center</NavItem>
          <NavItem href="#/approvals" active count={sorted.length}>
            Approval Center
          </NavItem>
          <NavItem href="#/audit">Audit Log</NavItem>
        </Side>
      }
    >
      <Main>
        <Topbar title="Approval Center" />
        <PageMeta>
          <span>All projects</span>
          <span>Highest risk first, then oldest</span>
        </PageMeta>

        <StatGrid columns={3} aria-label="Pending summary">
          <Stat value={sorted.length} label="pending — need a person" />
          <Stat value={approvals} label="approvals" />
          <Stat value={clarifications} label="clarifications" />
        </StatGrid>

        <List
          aria-label="Pending approvals and clarifications"
          empty="Nothing needs you right now."
        >
          {sorted.map((it) => (
            <ListRow
              key={it.id}
              href={it.href}
              title={`${it.workflowId} · ${it.workflowTitle}`}
              trailing={
                <>
                  <Pill>{KIND_LABEL[it.kind]}</Pill>
                  <RiskBadge level={it.risk} />
                </>
              }
              ask={it.request}
              meta={
                <>
                  {it.id} · requested by {it.requester} ·{' '}
                  <time dateTime={it.createdAt}>{relativeTime(it.createdAt, clock)}</time> ·{' '}
                  <StatePill state="WAITING_FOR_HUMAN" />
                </>
              }
            />
          ))}
        </List>
      </Main>
    </AppShell>
  );
}
