'use client';

import type { ApprovalCenterItem, ApprovalCenterSnapshot, Me } from '@cdevi/contracts';
import {
  Button,
  Field,
  List,
  ListRow,
  Mono,
  Notice,
  PageMeta,
  Pill,
  RiskBadge,
  Select,
  StatePill,
  Topbar,
} from '@cdevi/design-system';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import { askSegments, expiryLabel, humanAgo } from '../../../lib/format';
import { subscribeInboxStream } from '../../../lib/inbox-stream';
import { PROJECT_COOKIE } from '../../../lib/navigation';
import { useInboxCount } from '../AppFrame';

export interface ApprovalCenterScreenProps {
  me: Me;
  initial: ApprovalCenterSnapshot;
}

const Sep = () => <> · </>;

function meta(parts: ReactNode[]): ReactNode {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== '');
  return shown.map((p, i) => (
    <Fragment key={i}>
      {i > 0 ? <Sep /> : null}
      {p}
    </Fragment>
  ));
}

export function Ask({ ask }: { ask: string }) {
  return (
    <>
      {askSegments(ask).map((s, i) => (
        <Fragment key={i}>{s.mono ? <Mono>{s.text}</Mono> : s.text}</Fragment>
      ))}
    </>
  );
}

function updateUrl(project: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('project', project);
  window.history.replaceState(null, '', url);
}

function rememberProject(project: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(project)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One pending decision (ui-approval-center.md §2.3): identifier, what, who, when and risk — no controls in rows (DR-02). */
function DecisionRow({ item, now }: { item: ApprovalCenterItem; now: Date }) {
  const requested = new Date(item.requestedAt);
  return (
    <ListRow
      title={<Ask ask={item.ask} />}
      href={item.href}
      trailing={
        <>
          <StatePill state="WAITING_FOR_HUMAN" />
          {item.kind === 'approval' && item.riskLevel ? (
            <RiskBadge level={item.riskLevel} />
          ) : (
            <Pill variant="neutral">clarification</Pill>
          )}
        </>
      }
      meta={meta([
        <Mono key="ext">{item.workflowExternalId}</Mono>,
        item.workflowTitle,
        item.project.key,
        `Requested by ${item.requestedBy ?? 'unknown agent'}`,
        <time key="at" dateTime={item.requestedAt} title={requested.toISOString()}>
          {humanAgo(requested, now)}
        </time>,
        item.expiresAt ? expiryLabel(new Date(item.expiresAt), now) : null,
      ])}
    />
  );
}

/** Approval Center list (specs/001 US2 scenario 1; ui-approval-center.md §2). Rows are in API order (FR-011). */
export function ApprovalCenterScreen({ me, initial }: ApprovalCenterScreenProps) {
  const [snapshot, setSnapshot] = useState<ApprovalCenterSnapshot>(initial);
  const [project, setProject] = useState<string>(initial.project);
  const [loading, setLoading] = useState<'initial' | 'refresh' | null>(null);
  const [error, setError] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const { setApprovalsCount } = useInboxCount();
  const requestSeq = useRef(0);
  const now = useMemo(() => new Date(snapshot.generatedAt), [snapshot.generatedAt]);

  const pendingTotal = snapshot.counts.approvals + snapshot.counts.clarifications;
  useEffect(() => setApprovalsCount(pendingTotal), [pendingTotal, setApprovalsCount]);

  const load = useCallback(async (p: string, mode: 'initial' | 'refresh') => {
    const seq = ++requestSeq.current;
    setLoading(mode);
    setError(false);
    try {
      const qs = new URLSearchParams({ project: p });
      const next = await apiFetch<ApprovalCenterSnapshot>(`/api/approvals?${qs}`);
      if (seq !== requestSeq.current) return;
      setSnapshot(next);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign('/sign-in?reason=expired&next=/approvals');
        return;
      }
      setError(true);
    } finally {
      if (seq === requestSeq.current) setLoading(null);
    }
  }, []);

  useEffect(
    () =>
      subscribeInboxStream({
        onChange: () => void load(project, 'refresh'),
        onStatus: setConnected,
      }),
    [load, project],
  );

  const onProject = (next: string) => {
    setProject(next);
    rememberProject(next);
    updateUrl(next);
    void load(next, 'initial');
  };

  const showSkeleton = loading === 'initial';
  const selectedKey = me.projects.find((p) => p.id === project)?.key;
  const empty =
    project === 'all' ? (
      'Nothing needs a decision.'
    ) : (
      <>
        Nothing needs a decision in <strong>{selectedKey ?? 'this project'}</strong>. Show{' '}
        <Button variant="ghost" size="sm" onClick={() => onProject('all')}>
          all projects
        </Button>
        .
      </>
    );

  return (
    <>
      <Topbar title="Approval Center" />
      <PageMeta>
        <Field label="Project" htmlFor="approvals-project">
          <Select
            id="approvals-project"
            value={project}
            onChange={(e) => onProject(e.target.value)}
          >
            <option value="all">All projects</option>
            {me.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <span>
          {plural(snapshot.counts.approvals, 'approval')} ·{' '}
          {plural(snapshot.counts.clarifications, 'clarification')}
        </span>
        <Pill variant="neutral">
          {loading === 'refresh' ? 'updating' : connected === false ? 'reconnecting' : 'live'}
        </Pill>
      </PageMeta>
      {error ? (
        <Notice
          tone="error"
          action={
            <Button
              variant="ghost"
              onClick={() => void load(project, showSkeleton ? 'initial' : 'refresh')}
            >
              Retry
            </Button>
          }
        >
          Couldn&apos;t load approvals.
        </Notice>
      ) : null}
      <List
        aria-label="Needs a decision"
        loading={loading !== null}
        empty={showSkeleton ? undefined : empty}
      >
        {showSkeleton
          ? null
          : snapshot.items.map((item) => <DecisionRow key={item.id} item={item} now={now} />)}
      </List>
    </>
  );
}
