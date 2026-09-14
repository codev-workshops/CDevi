'use client';

import type {
  ApprovalCenterDetail,
  DecisionLinks,
  DecisionResult,
  Problem,
  Resolution,
} from '@cdevi/contracts';
import { answerIsValid, requiresConfirmation } from '@cdevi/contracts/decision-rules';
import {
  ActionBar,
  AuditTable,
  Button,
  Card,
  DecisionCard,
  Field,
  KeyValue,
  List,
  ListRow,
  Mono,
  Notice,
  OptionGroup,
  OptionRow,
  PageMeta,
  PanelBlock,
  Pill,
  RiskBadge,
  StatePill,
  TextArea,
  Topbar,
  type AuditEvent,
  type KeyValueItem,
} from '@cdevi/design-system';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import { expiryLabel, humanAgo } from '../../../../lib/format';
import { subscribeInboxStream } from '../../../../lib/inbox-stream';
import { useInboxCount } from '../../AppFrame';
import { Ask } from '../ApprovalCenterScreen';

export interface ApprovalDecisionScreenProps {
  initial: ApprovalCenterDetail;
}

type Step = 'idle' | 'confirm' | 'reject';
type Submitting = 'approve' | 'confirm' | 'reject' | 'answer' | null;

const OTHER = '__text';
const REASON_MAX = 500;
const ANSWER_MAX = 2000;

const LINK_LABEL: Record<keyof DecisionLinks, string> = {
  requirement: 'Requirement',
  workflow: 'Workflow',
  agentRun: 'Agent run',
  externalTicket: 'External ticket',
  pullRequest: 'Pull request',
};
const LINK_ORDER: (keyof DecisionLinks)[] = [
  'requirement',
  'workflow',
  'agentRun',
  'externalTicket',
  'pullRequest',
];

const OUTCOME_WORD: Record<Resolution['outcome'], string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  answered: 'Answered',
};

function When({ at, now }: { at: string; now: Date }) {
  const d = new Date(at);
  return (
    <time dateTime={at} title={d.toISOString()}>
      {humanAgo(d, now)}
    </time>
  );
}

const hasResolution = (p: Problem | null): p is Problem & { resolution: Resolution } =>
  p !== null && 'resolution' in p && typeof p.resolution === 'object' && p.resolution !== null;

/** Approval / clarification decision screen (specs/001 US2 scenarios 2–5; ui-approval-center.md §3). */
export function ApprovalDecisionScreen({ initial }: ApprovalDecisionScreenProps) {
  const [detail, setDetail] = useState<ApprovalCenterDetail>(initial);
  const [fetchedAt, setFetchedAt] = useState<Date>(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [target, setTarget] = useState<'BLOCKED' | 'CANCELLED'>('BLOCKED');
  const [choice, setChoice] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Submitting>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { setPanel } = useInboxCount();

  const approveRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const rejectOpenRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const answerTextRef = useRef<HTMLTextAreaElement | null>(null);
  const resolvedRef = useRef<HTMLDivElement | null>(null);
  const focusResolved = useRef(false);
  const returnFocus = useRef<'approve' | 'reject' | null>(null);

  const { item, workflowState, canDecide, approval, clarification, resolution, audit } = detail;
  const id = item.id;
  const now = fetchedAt;
  const pending = resolution === null && workflowState === 'WAITING_FOR_HUMAN';
  const links = approval?.links ?? clarification?.links ?? {};

  const refetch = useCallback(async () => {
    setRefreshing(true);
    setLoadError(false);
    try {
      setDetail(await apiFetch<ApprovalCenterDetail>(`/api/approvals/${encodeURIComponent(id)}`));
      setFetchedAt(new Date());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign(`/sign-in?reason=expired&next=/approvals/${id}`);
        return;
      }
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(
    () =>
      subscribeInboxStream({
        workflowId: item.workflowId,
        onChange: () => void refetch(),
        onStatus: setConnected,
      }),
    [item.workflowId, refetch],
  );

  useEffect(() => {
    const events: AuditEvent[] = audit.map((e) => ({
      id: e.id,
      time: <When at={e.occurredAt} now={now} />,
      actor: e.actor.name,
      action: e.action,
      target: e.target.type,
      workflow: <Mono>{item.workflowExternalId}</Mono>,
      risk: e.riskLevel,
      result: e.result,
    }));
    setPanel(
      <>
        <PanelBlock title="Audit">
          {events.length === 0 ? (
            <p>No decisions recorded yet.</p>
          ) : (
            <AuditTable caption="Audit" events={events} />
          )}
        </PanelBlock>
        <PanelBlock title="Freshness">
          <p>
            Updated <When at={fetchedAt.toISOString()} now={now} />{' '}
            <Pill variant="neutral">
              {refreshing ? 'updating' : connected === false ? 'reconnecting' : 'live'}
            </Pill>
          </p>
        </PanelBlock>
      </>,
    );
    return () => setPanel(undefined);
  }, [setPanel, audit, item.workflowExternalId, fetchedAt, now, refreshing, connected]);

  useEffect(() => {
    if (step === 'confirm') confirmRef.current?.focus();
    else if (step === 'reject') reasonRef.current?.focus();
    else if (returnFocus.current) {
      (returnFocus.current === 'approve' ? approveRef : rejectOpenRef).current?.focus();
      returnFocus.current = null;
    }
  }, [step]);

  useEffect(() => {
    if (resolution && focusResolved.current) {
      focusResolved.current = false;
      resolvedRef.current?.focus();
    }
  }, [resolution]);

  const back = () => {
    returnFocus.current = step === 'confirm' ? 'approve' : 'reject';
    setStep('idle');
    setReasonError(null);
    setSubmitError(null);
  };

  const onEscape = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && step !== 'idle') {
      e.preventDefault();
      back();
    }
  };

  const post = async (kind: Exclude<Submitting, null>, path: string, body: unknown) => {
    setSubmitting(kind);
    setSubmitError(null);
    try {
      const result = await apiFetch<DecisionResult>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      focusResolved.current = true;
      setDetail(result.detail);
      setFetchedAt(new Date());
      setStep('idle');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && hasResolution(e.problem)) {
        const winner = e.problem.resolution;
        focusResolved.current = true;
        setDetail((d) => ({ ...d, resolution: winner }));
        setStep('idle');
        void refetch();
        return;
      }
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign(`/sign-in?reason=expired&next=/approvals/${id}`);
        return;
      }
      setSubmitError(
        e instanceof ApiError
          ? (e.problem?.detail ?? e.problem?.title ?? "Couldn't record that decision.")
          : "Couldn't record that decision.",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const onApprove = () => {
    if (approval?.requiresConfirmation || requiresConfirmation(item.riskLevel)) {
      setStep('confirm');
      return;
    }
    void post('approve', `/api/approvals/${encodeURIComponent(id)}/approve`, {});
  };
  const onConfirm = () =>
    void post('confirm', `/api/approvals/${encodeURIComponent(id)}/approve`, { confirmed: true });

  const onReject = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setReasonError('A reason is required.');
      reasonRef.current?.focus();
      return;
    }
    setReasonError(null);
    void post('reject', `/api/approvals/${encodeURIComponent(id)}/reject`, {
      reason: trimmed,
      target,
    });
  };

  const onAnswer = (e: FormEvent) => {
    e.preventDefault();
    const options = clarification?.options ?? [];
    const input =
      choice === OTHER ? { text: answerText } : choice ? { option: choice } : { text: '' };
    const valid = answerIsValid(input, options);
    if (!valid.ok) {
      setAnswerError('Choose an option or write an answer.');
      if (choice === OTHER) answerTextRef.current?.focus();
      return;
    }
    setAnswerError(null);
    void post(
      'answer',
      `/api/clarifications/${encodeURIComponent(id)}/answer`,
      valid.option ? { option: valid.option } : { text: valid.text },
    );
  };

  const busy = submitting !== null;
  const roleHelp = canDecide ? undefined : 'Only approvers and administrators can decide.';

  const contextItems: KeyValueItem[] = [
    {
      term: 'Workflow',
      detail: (
        <a href={`/workflows/${encodeURIComponent(item.workflowId)}`}>
          <Mono>{item.workflowExternalId}</Mono> {item.workflowTitle}
        </a>
      ),
    },
    { term: 'Project', detail: `${item.project.key} · ${item.project.name}` },
    { term: 'Requested by', detail: item.requestedBy ?? 'unknown agent' },
    { term: 'Requested', detail: <When at={item.requestedAt} now={now} /> },
    ...(item.expiresAt
      ? [{ term: 'Expires', detail: expiryLabel(new Date(item.expiresAt), now) }]
      : []),
  ];

  const body = approval?.context ?? clarification?.whyItMatters ?? null;

  let decision: ReactNode = null;
  if (resolution) {
    const rows: KeyValueItem[] = [
      { term: 'Outcome', detail: <StatePill state={resolution.workflowState} /> },
      ...(resolution.reason ? [{ term: 'Reason', detail: resolution.reason }] : []),
      ...(resolution.target
        ? [{ term: 'Moved to', detail: <StatePill state={resolution.target} /> }]
        : []),
      ...(resolution.answer ? [{ term: 'Answer', detail: resolution.answer.text }] : []),
    ];
    decision = (
      <>
        <Notice tone="info" ref={resolvedRef} tabIndex={-1}>
          {OUTCOME_WORD[resolution.outcome]} by <strong>{resolution.by.name}</strong>{' '}
          <When at={resolution.at} now={now} />.
        </Notice>
        <Card>
          <KeyValue items={rows} />
        </Card>
      </>
    );
  } else if (!pending) {
    decision = (
      <Notice tone="info">
        This workflow is no longer waiting for a person (<StatePill state={workflowState} />
        ), so nothing can be decided here.
      </Notice>
    );
  } else if (item.kind === 'approval') {
    const badge = item.riskLevel ? <RiskBadge level={item.riskLevel} /> : undefined;
    decision = (
      <DecisionCard
        title="Decision"
        {...(badge ? { badge } : {})}
        description="Approving resumes the workflow. Rejecting requires a reason."
        onKeyDown={onEscape}
        actions={
          step === 'idle' ? (
            <ActionBar {...(roleHelp ? { help: roleHelp } : {})}>
              <Button
                ref={approveRef}
                variant={canDecide ? 'saffron' : 'primary'}
                disabled={!canDecide || busy}
                loading={submitting === 'approve'}
                onClick={onApprove}
              >
                Approve
              </Button>
              <Button
                ref={rejectOpenRef}
                variant="ghost"
                disabled={!canDecide || busy}
                onClick={() => setStep('reject')}
              >
                Reject…
              </Button>
            </ActionBar>
          ) : step === 'confirm' ? (
            <ActionBar>
              <Button
                ref={confirmRef}
                variant="saffron"
                disabled={busy}
                loading={submitting === 'confirm'}
                onClick={onConfirm}
              >
                Confirm approval
              </Button>
              <Button variant="ghost" disabled={busy} onClick={back}>
                Back
              </Button>
            </ActionBar>
          ) : undefined
        }
      >
        {step === 'confirm' && item.riskLevel ? (
          <Notice tone="info">
            Confirm: <strong>{item.ask}</strong> — risk <RiskBadge level={item.riskLevel} />. This
            will resume the workflow.
          </Notice>
        ) : null}
        {step === 'reject' ? (
          <form onSubmit={onReject} noValidate>
            <Field
              label="Reason"
              htmlFor="reject-reason"
              {...(reasonError ? { error: reasonError } : {})}
            >
              <TextArea
                ref={reasonRef}
                id="reject-reason"
                required
                maxLength={REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </Field>
            <OptionGroup legend="Then move the workflow to">
              <OptionRow
                name="target"
                value="BLOCKED"
                checked={target === 'BLOCKED'}
                onChange={() => setTarget('BLOCKED')}
                disabled={busy}
                recommended
              >
                BLOCKED — keeps the workflow so an engineer can fix and retry
              </OptionRow>
              <OptionRow
                name="target"
                value="CANCELLED"
                checked={target === 'CANCELLED'}
                onChange={() => setTarget('CANCELLED')}
                disabled={busy}
              >
                CANCELLED — stops the workflow permanently
              </OptionRow>
            </OptionGroup>
            <ActionBar>
              <Button
                type="submit"
                variant="danger"
                disabled={busy}
                loading={submitting === 'reject'}
              >
                Reject
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={back}>
                Back
              </Button>
            </ActionBar>
          </form>
        ) : null}
      </DecisionCard>
    );
  } else {
    const options = clarification?.options ?? [];
    decision = (
      <DecisionCard title="Your answer" badge={<Pill variant="neutral">clarification</Pill>}>
        <form onSubmit={onAnswer} noValidate>
          <OptionGroup legend="Suggested answers" {...(answerError ? { error: answerError } : {})}>
            {options.map((o) => (
              <OptionRow
                key={o.value}
                name="answer"
                value={o.value}
                checked={choice === o.value}
                onChange={setChoice}
                disabled={!canDecide || busy}
                recommended={o.recommended}
              >
                {o.label}
              </OptionRow>
            ))}
            <OptionRow
              name="answer"
              value={OTHER}
              checked={choice === OTHER}
              onChange={setChoice}
              disabled={!canDecide || busy}
            >
              Other (write an answer)
            </OptionRow>
          </OptionGroup>
          {choice === OTHER ? (
            <Field label="Answer" htmlFor="answer-text">
              <TextArea
                ref={answerTextRef}
                id="answer-text"
                required
                maxLength={ANSWER_MAX}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                disabled={!canDecide || busy}
              />
            </Field>
          ) : null}
          <ActionBar {...(roleHelp ? { help: roleHelp } : {})}>
            <Button
              type="submit"
              variant={canDecide ? 'saffron' : 'primary'}
              disabled={!canDecide || busy}
              loading={submitting === 'answer'}
            >
              Submit answer
            </Button>
          </ActionBar>
        </form>
      </DecisionCard>
    );
  }

  const presentLinks = LINK_ORDER.filter((k) => links[k]);

  return (
    <>
      <Topbar title={<Ask ask={item.ask} />} />
      <p>
        <Button variant="ghost" href="/approvals">
          Back to Approval Center
        </Button>{' '}
        <Button variant="ghost" href="/inbox?focus=tabs">
          Back to Inbox
        </Button>{' '}
        <Button variant="ghost" href={`/workflows/${encodeURIComponent(item.workflowId)}`}>
          Open workflow
        </Button>
      </p>
      <PageMeta>
        <StatePill state={workflowState} />
        {item.kind === 'approval' && item.riskLevel ? (
          <RiskBadge level={item.riskLevel} />
        ) : (
          <Pill variant="neutral">clarification</Pill>
        )}
        <Mono>{item.workflowExternalId}</Mono>
        {item.project.key}
        {`Requested by ${item.requestedBy ?? 'unknown agent'}`}
        <When at={item.requestedAt} now={now} />
      </PageMeta>
      {loadError ? (
        <Notice
          tone="error"
          action={
            <Button variant="ghost" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        >
          Couldn&apos;t load this item.
        </Notice>
      ) : null}
      {submitError ? <Notice tone="error">{submitError}</Notice> : null}
      <Card as="section" aria-labelledby="decision-context-heading">
        <h2 id="decision-context-heading">Context</h2>
        <KeyValue items={contextItems} />
        {body ? (
          <>
            <h3>{item.kind === 'approval' ? 'What is being requested' : 'Why this matters'}</h3>
            <p>{body}</p>
          </>
        ) : null}
      </Card>
      <List aria-label="Links" empty="No links provided.">
        {presentLinks.map((k) => (
          <ListRow key={k} title={LINK_LABEL[k]} href={links[k]!} meta={links[k]} />
        ))}
      </List>
      {decision}
    </>
  );
}
