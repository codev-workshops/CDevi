'use client';

import type { AnalysisItem, Me, RequirementDetail } from '@cdevi/contracts';
import { REQUIREMENT_STATE_WORDS, isSafeExternalUrl } from '@cdevi/contracts/requirement-rules';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import {
  ActionBar,
  AuditTable,
  Button,
  Card,
  Crumbs,
  Field,
  Help,
  KeyValue,
  List,
  ListRow,
  Message,
  Mono,
  Notice,
  PageMeta,
  Pill,
  RequirementStatePill,
  StatePill,
  TextArea,
  Topbar,
  type AuditEvent,
} from '../../../../lib/ds';
import { humanAgo } from '../../../../lib/format';
import { subscribeInboxStream } from '../../../../lib/inbox-stream';

export interface RequirementDetailScreenProps {
  me: Me;
  initial: RequirementDetail;
}

type Action = 'submit' | 'approve' | 'reject';

const REFETCH_DEBOUNCE_MS = 300;
const ALREADY_DECIDED = 'This requirement was already decided.';
const ROLE_FORBIDDEN = "You can't do that with your role.";
const ACTION_FAILED = "The action couldn't be completed.";

const word = (s: keyof typeof REQUIREMENT_STATE_WORDS) => REQUIREMENT_STATE_WORDS[s];

function whenBy(name: string | null | undefined, at: string | null, now: Date): ReactNode {
  if (!at) return '—';
  return (
    <>
      {name ?? 'system'},{' '}
      <time dateTime={at} title={new Date(at).toISOString()}>
        {humanAgo(new Date(at), now)}
      </time>
    </>
  );
}

/** Who produced an item: agents are labelled "AI-generated", people "Authored by {name}" (FR-009). */
function Provenance({ item }: { item: AnalysisItem }) {
  return item.aiGenerated ? (
    <Pill variant="neutral">AI-generated</Pill>
  ) : (
    <Pill variant="neutral">Authored by {item.source.replace(/^user:/, '')}</Pill>
  );
}

function ItemList({ items }: { items: AnalysisItem[] }) {
  if (items.length === 0) return <p>None</p>;
  return (
    <ol>
      {items.map((it) => (
        <li key={it.id}>
          <span>{it.text}</span> <Provenance item={it} />
        </li>
      ))}
    </ol>
  );
}

function agentName(a: NonNullable<RequirementDetail['analysis']>): string {
  const first = [...a.acceptanceCriteria, ...a.rules, ...a.openQuestions].find(
    (i) => i.aiGenerated,
  );
  return first ? first.source.replace(/^agent:/, '') : 'Agent';
}

function Section({
  title,
  children,
  ...rest
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <Card as="section" aria-labelledby={id} {...rest}>
      <h2 id={id}>{title}</h2>
      {children}
    </Card>
  );
}

/** Requirement Detail (specs/001 US4 scenarios 1, 3, 4; ui-requirements.md §3/§5.2). */
export function RequirementDetailScreen({ me, initial }: RequirementDetailScreenProps) {
  const [detail, setDetail] = useState<RequirementDetail>(initial);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState<Action | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const pillRef = useRef<HTMLSpanElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const rejectOpenRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const focusNext = useRef<'pill' | 'error' | 'reason' | 'reject' | null>(null);
  const helpId = useId();

  const { requirement: req, analysis, actions } = detail;
  const id = req.id;
  const now = useMemo(() => new Date(detail.generatedAt), [detail.generatedAt]);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const el =
      target === 'pill'
        ? pillRef.current
        : target === 'error'
          ? errorRef.current
          : target === 'reason'
            ? reasonRef.current
            : rejectOpenRef.current;
    el?.focus();
  });

  const refetch = useCallback(async () => {
    setRefreshing(true);
    setLoadError(false);
    try {
      setDetail(await apiFetch<RequirementDetail>(`/api/requirements/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign(`/sign-in?reason=expired&next=/requirements/${id}`);
        return;
      }
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  const workflowId = req.workflow?.id;
  useEffect(
    () =>
      subscribeInboxStream({
        debounceMs: REFETCH_DEBOUNCE_MS,
        requirementId: id,
        workflowId,
        onChange: () => void refetch(),
        onStatus: setConnected,
      }),
    [id, workflowId, refetch],
  );

  const post = async (action: Action, body?: unknown) => {
    setSubmitting(action);
    setActionError(null);
    try {
      const next = await apiFetch<RequirementDetail>(
        `/api/requirements/${encodeURIComponent(id)}/${action}`,
        { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      );
      focusNext.current = 'pill';
      setDetail(next);
      setRejecting(false);
      setReason('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign(`/sign-in?reason=expired&next=/requirements/${id}`);
        return;
      }
      focusNext.current = 'error';
      setActionError(
        e instanceof ApiError && e.status === 409
          ? ALREADY_DECIDED
          : e instanceof ApiError && e.status === 403
            ? ROLE_FORBIDDEN
            : ACTION_FAILED,
      );
    } finally {
      setSubmitting(null);
    }
  };

  const openReject = () => {
    setRejecting(true);
    setReasonError(null);
    focusNext.current = 'reason';
  };
  const cancelReject = () => {
    setRejecting(false);
    setReason('');
    setReasonError(null);
    focusNext.current = 'reject';
  };
  const confirmReject = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setReasonError('Give a reason for rejecting this requirement.');
      focusNext.current = 'reason';
      return;
    }
    setReasonError(null);
    void post('reject', { reason: trimmed });
  };

  const busy = submitting !== null;
  const viewer = me.user.role === 'viewer';
  const decider = actions.canApprove || actions.canReject;
  const rejectable =
    req.state === 'DRAFT' || req.state === 'NEEDS_CLARIFICATION' || req.state === 'READY';
  const showSubmit = actions.canSubmit;
  const showApprove = decider && (rejectable || req.state === 'READY');
  const showReject = rejectable && !viewer;
  const anyButton = showSubmit || showApprove || showReject;
  const submitVariant = req.state === 'NEEDS_CLARIFICATION' && !decider ? 'saffron' : 'primary';
  const reasonsHelp = actions.reasons.join(' ');

  const help = viewer ? (
    <Help id={helpId}>Your role ({me.user.role}) is read-only</Help>
  ) : reasonsHelp ? (
    <Help id={helpId}>{reasonsHelp}</Help>
  ) : null;

  const jira = req.externalRef && isSafeExternalUrl(req.externalRef.url) ? req.externalRef : null;
  const wf = req.workflow;
  const wfLabel = wf
    ? wf.stage
      ? `${wf.externalId} · stage ${wf.stage.index} of ${wf.stage.count}`
      : wf.externalId
    : null;

  const auditEvents: AuditEvent[] = detail.audit.map((a) => ({
    id: a.id,
    time: (
      <time dateTime={a.occurredAt} title={new Date(a.occurredAt).toISOString()}>
        {humanAgo(new Date(a.occurredAt), now)}
      </time>
    ),
    actor: a.actorName ?? 'system',
    action: a.action,
    target: <Mono>{req.externalId}</Mono>,
    result: a.reason ?? '—',
  }));

  return (
    <>
      <Crumbs
        items={[{ label: 'Requirements', href: '/requirements' }, { label: req.externalId }]}
      />
      <Topbar
        title={req.title}
        actions={
          anyButton || help ? (
            <ActionBar aria-busy={busy || undefined}>
              {help}
              {showSubmit ? (
                <Button
                  variant={submitVariant}
                  disabled={busy}
                  loading={submitting === 'submit'}
                  onClick={() => void post('submit')}
                >
                  {actions.submitLabel}
                </Button>
              ) : null}
              {showApprove ? (
                <Button
                  variant={actions.canApprove ? 'saffron' : 'primary'}
                  disabled={busy}
                  loading={submitting === 'approve'}
                  {...(actions.canApprove
                    ? { onClick: () => void post('approve') }
                    : { 'aria-disabled': true, 'aria-describedby': helpId })}
                >
                  Approve
                </Button>
              ) : null}
              {showReject ? (
                <Button
                  ref={rejectOpenRef}
                  variant="ghost"
                  disabled={busy}
                  {...(actions.canReject
                    ? { onClick: openReject }
                    : { 'aria-disabled': true, 'aria-describedby': helpId })}
                >
                  Reject…
                </Button>
              ) : null}
            </ActionBar>
          ) : undefined
        }
      />
      <PageMeta>
        <RequirementStatePill ref={pillRef} state={req.state} tabIndex={-1} />
        <Mono>{req.externalId}</Mono>
        <span>{req.project.name}</span>
        <span>Assignee: {req.assignee?.name ?? 'Unassigned'}</span>
        <span title={new Date(req.createdAt).toISOString()}>
          Created {humanAgo(new Date(req.createdAt), now)} by {req.createdBy?.name ?? 'Jira'}
        </span>
        <Pill variant="neutral" pulse={refreshing}>
          {connected === false ? 'reconnecting' : 'live'}
        </Pill>
      </PageMeta>

      {actionError ? (
        <Notice ref={errorRef} tone="error" tabIndex={-1}>
          {actionError}
        </Notice>
      ) : null}
      {loadError ? (
        <Notice
          tone="error"
          action={
            <Button variant="ghost" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        >
          The requirement couldn&apos;t be refreshed.
        </Notice>
      ) : null}

      {rejecting ? (
        <Card as="section" aria-label="Reject requirement">
          <form onSubmit={confirmReject} noValidate>
            <Field
              label="Reason"
              htmlFor="reject-reason"
              {...(reasonError ? { error: reasonError } : {})}
            >
              <TextArea
                ref={reasonRef}
                id="reject-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </Field>
            <ActionBar>
              <Button
                type="submit"
                variant="danger"
                disabled={busy}
                loading={submitting === 'reject'}
              >
                Confirm rejection
              </Button>
              <Button variant="ghost" disabled={busy} onClick={cancelReject}>
                Cancel
              </Button>
            </ActionBar>
          </form>
        </Card>
      ) : null}

      {req.externalFlag && req.externalRef ? (
        <Notice tone="error">
          The linked Jira issue {req.externalRef.key} was {req.externalFlag} on{' '}
          <time dateTime={req.externalFlaggedAt ?? undefined}>
            {req.externalFlaggedAt
              ? new Date(req.externalFlaggedAt).toUTCString()
              : 'an unknown date'}
          </time>
          . The linked workflow is paused in BLOCKED until a person decides.
          {wf ? (
            <>
              {' '}
              <a href={wf.href}>Open workflow {wf.externalId}</a>
            </>
          ) : null}
        </Notice>
      ) : null}
      {jira ? (
        <KeyValue
          items={[
            {
              term: 'Jira',
              detail: (
                <a
                  href={jira.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${jira.key} in Jira (opens in a new tab)`}
                >
                  {jira.key}
                </a>
              ),
            },
          ]}
        />
      ) : null}

      <Section title="Business objective">
        <p>{detail.businessObjective}</p>
      </Section>

      <Section title="Analysis">
        {analysis === null ? (
          <Notice tone="info">
            {req.state === 'ANALYZING'
              ? 'Analysis in progress — results appear here automatically.'
              : 'No analysis yet — submit the requirement for analysis.'}
          </Notice>
        ) : (
          <>
            <Message who={`${agentName(analysis)} · analysis`} variant="summary">
              {analysis.summary ? (
                <p>
                  {analysis.summary} <Pill variant="neutral">AI-generated</Pill>
                </p>
              ) : null}
              <h3>Acceptance criteria</h3>
              <ItemList items={analysis.acceptanceCriteria} />
              <h3>Identified business rules</h3>
              <ItemList items={analysis.rules} />
              <h3>Open questions ({analysis.openQuestions.length})</h3>
              <ItemList items={analysis.openQuestions} />
            </Message>
            <Mono title={new Date(analysis.observedAt).toISOString()}>
              Observed {humanAgo(new Date(analysis.observedAt), now)}
            </Mono>
          </>
        )}
      </Section>

      <Section title="Decision">
        <KeyValue
          items={[
            {
              term: 'Submitted',
              detail: whenBy(detail.submittedBy?.name, detail.submittedAt, now),
            },
            {
              term: req.state === 'REJECTED' ? 'Rejected' : 'Approved',
              detail: (
                <>
                  {whenBy(detail.decidedBy?.name, detail.decidedAt, now)}
                  {detail.decisionReason ? <> — {detail.decisionReason}</> : null}
                </>
              ),
            },
            {
              term: 'Workflow',
              detail: wf ? (
                <>
                  <a href={wf.href}>{wfLabel}</a> <StatePill state={wf.state} />
                </>
              ) : (
                'Not started'
              ),
            },
          ]}
        />
      </Section>

      <Section title="History">
        <List aria-label="Requirement history" empty="No transitions yet.">
          {detail.transitions.slice(0, 40).map((t, i) => (
            <ListRow
              key={`${t.occurredAt}-${i}`}
              title={`${t.fromState ? word(t.fromState) : 'created'} → ${word(t.toState)}`}
              meta={
                <>
                  {t.actorName ?? t.actorType} ·{' '}
                  <time dateTime={t.occurredAt} title={new Date(t.occurredAt).toISOString()}>
                    {humanAgo(new Date(t.occurredAt), now)}
                  </time>
                  {t.reason ? <> · {t.reason}</> : null}
                </>
              }
            />
          ))}
        </List>
        <AuditTable caption="Audit" events={auditEvents} empty="No audit events yet." />
      </Section>
    </>
  );
}
