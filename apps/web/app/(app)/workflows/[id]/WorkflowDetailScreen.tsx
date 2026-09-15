'use client';

import type { ArtifactType, Role, WorkflowAction, WorkflowDetail } from '@cdevi/contracts';
import { agentRunHref } from '@cdevi/contracts/agent-run-model';
import { reviewStatusWord } from '@cdevi/contracts/review-model';
import {
  ActionBar,
  Button,
  Card,
  DecisionCard,
  Field,
  GateCheck,
  GateList,
  Input,
  KeyValue,
  List,
  ListRow,
  Message,
  Meter,
  Mono,
  Notice,
  PageMeta,
  PanelBlock,
  Pill,
  RiskBadge,
  StatePill,
  Step,
  Stepper,
  Topbar,
  stateToPill,
  type GateState,
  type KeyValueItem,
} from '@cdevi/design-system';
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import { humanAgo, humanDuration } from '../../../../lib/format';
import { subscribeInboxStream } from '../../../../lib/inbox-stream';
import { useInboxCount } from '../../AppFrame';

export interface WorkflowDetailScreenProps {
  initial: WorkflowDetail;
  userRole: Role;
}

const ARTIFACT_WORD: Record<ArtifactType, string> = {
  requirement_spec: 'requirement spec',
  impact_analysis: 'impact analysis',
  implementation_plan: 'implementation plan',
  test_results: 'test results',
  code_diff: 'code diff',
  pull_request: 'pull request',
};

const GATE_STATE: Record<WorkflowDetail['testRuns'][number]['status'], GateState> = {
  PASSED: 'ok',
  FAILED: 'bad',
  RUNNING: 'wait',
};

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

function When({ at, now }: { at: string; now: Date }) {
  const d = new Date(at);
  return (
    <time dateTime={at} title={d.toISOString()}>
      {humanAgo(d, now)}
    </time>
  );
}

const stageLabel = (s: { position: number; name: string } | null | undefined) =>
  s ? `${s.position}. ${s.name}` : null;

type StageRuns = WorkflowDetail['stages'][number]['agentRuns'];

/**
 * US5 drill-down (ui-agent-run.md §4): one plain link per run, newest first. The run's state word is in the
 * accessible name; `withPill` adds a visible `StatePill` where the row has no other state pill (Current stage).
 */
function InspectRuns({
  runs,
  leadingSep = true,
  withPill = false,
}: {
  runs: StageRuns;
  leadingSep?: boolean;
  withPill?: boolean;
}) {
  return (
    <>
      {runs.map((r, i) => (
        <Fragment key={r.id}>
          {leadingSep || i > 0 ? <Sep /> : null}
          <a
            href={agentRunHref(r.id)}
            aria-label={`Inspect run ${i + 1} of ${runs.length} by ${r.agent}, ${stateToPill[r.state].word}`}
          >
            Inspect run{runs.length > 1 ? ` · ${r.agent}` : ''}
          </a>
          {withPill ? (
            <>
              {' '}
              <StatePill state={r.state} />
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

/** Workflow Detail (contracts/ui-workflow-detail-screen.md §2). Everything shown comes from one `WorkflowDetail`. */
export function WorkflowDetailScreen({ initial, userRole }: WorkflowDetailScreenProps) {
  const [detail, setDetail] = useState<WorkflowDetail>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalateTo, setEscalateTo] = useState('');
  const { setPanel } = useInboxCount();
  const headingId = useId();
  const failureId = useId();
  const currentId = useId();
  const escalateId = useId();
  const h1Ref = useRef<HTMLSpanElement | null>(null);

  const pullRequestHeadingId = useId();

  const { workflow, stages, currentStage, progress, activity, artifacts, testRuns, pullRequest } =
    detail;
  const { attention, failure, actions } = detail;
  const now = new Date(detail.generatedAt);
  const id = workflow.id;

  const refetch = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      setDetail(await apiFetch<WorkflowDetail>(`/api/workflows/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign(`/sign-in?reason=expired&next=/workflows/${id}`);
        return;
      }
      setLoadError("Couldn't refresh this workflow.");
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  // Live updates (FR-034, SC-003): reuse the inbox stream, filtered to this workflow (research R3).
  useEffect(
    () =>
      subscribeInboxStream({
        workflowId: id,
        onChange: () => void refetch(),
        onStatus: setConnected,
      }),
    [id, refetch],
  );

  // The right rail shows evidence (test runs) and freshness — §2.10, §2.11.
  useEffect(() => {
    setPanel(
      <>
        <PanelBlock title="Test runs">
          {testRuns.length === 0 ? (
            <p>No test runs yet.</p>
          ) : (
            <GateList label="Test runs">
              {testRuns.map((t) => (
                <GateCheck
                  key={t.id}
                  state={GATE_STATE[t.status]}
                  label={t.href ? <a href={t.href}>{t.category}</a> : t.category}
                  source={`${t.passed}/${t.total} passed · ${t.failed} failed · Stage ${t.stage.position}`}
                />
              ))}
            </GateList>
          )}
        </PanelBlock>
        <PanelBlock title="Freshness">
          <p>
            Updated <When at={detail.generatedAt} now={now} />{' '}
            <Pill variant="neutral">
              {refreshing ? 'updating' : connected === false ? 'reconnecting' : 'live'}
            </Pill>
          </p>
        </PanelBlock>
      </>,
    );
    return () => setPanel(undefined);
    // `now` derives from generatedAt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPanel, testRuns, detail.generatedAt, refreshing, connected]);

  const act = async (action: WorkflowAction, note?: string) => {
    setPending(action);
    setActionError(null);
    try {
      const next = await apiFetch<WorkflowDetail>(
        `/api/workflows/${encodeURIComponent(id)}/actions`,
        { method: 'POST', body: JSON.stringify(note ? { action, note } : { action }) },
      );
      setDetail(next);
      setConfirmCancel(false);
      setEscalating(false);
      setEscalateTo('');
      if (!next.failure) h1Ref.current?.focus();
    } catch (e) {
      setActionError(
        e instanceof ApiError
          ? (e.problem?.detail ?? e.problem?.title ?? "Couldn't apply that action.")
          : "Couldn't apply that action.",
      );
    } finally {
      setPending(null);
    }
  };

  const anyDisabled = !actions.retry || !actions.escalate || !actions.cancel;
  const roleHelp =
    userRole === 'viewer'
      ? 'Viewers cannot retry, escalate or cancel workflows.'
      : 'Only engineers and administrators can retry or cancel.';
  const attentionWord = attention ? stateToPill[attention.state].word : null;
  const currentRuns: StageRuns =
    stages.find((s) => s.id === currentStage?.stage.id)?.agentRuns ?? [];

  const currentItems: KeyValueItem[] = currentStage
    ? [
        { term: 'Agent', detail: currentStage.agent ?? 'unassigned' },
        { term: 'Model', detail: currentStage.model ?? '—' },
        {
          term: 'Started',
          detail: currentStage.startedAt ? <When at={currentStage.startedAt} now={now} /> : '—',
        },
        {
          term: 'Elapsed',
          detail: currentStage.elapsedMs !== null ? humanDuration(currentStage.elapsedMs) : '—',
        },
        {
          term: 'Next stage',
          detail: stageLabel(detail.nextStage) ?? 'None — workflow complete',
        },
        {
          term: 'Run',
          detail:
            currentRuns.length === 0 ? (
              'No run recorded'
            ) : (
              <span>
                <InspectRuns runs={currentRuns} leadingSep={false} withPill />
              </span>
            ),
        },
      ]
    : [];

  return (
    <div aria-busy={refreshing || undefined}>
      <Topbar
        title={
          <span ref={h1Ref} tabIndex={-1} id={headingId}>
            {workflow.title}
          </span>
        }
        actions={
          <Button variant="ghost" href="/inbox">
            Back to Inbox
          </Button>
        }
      />
      <PageMeta>
        <StatePill state={workflow.state} />
        {workflow.riskLevel ? <RiskBadge level={workflow.riskLevel} /> : null}
        <Mono>{workflow.externalId}</Mono>
        {workflow.project.key}
        {workflow.agent ? `Agent: ${workflow.agent}` : null}
        {workflow.stage
          ? `Stage ${workflow.stage.index} of ${workflow.stage.count}${workflow.stage.name ? ` · ${workflow.stage.name}` : ''}`
          : null}
        {workflow.elapsedMs !== null ? `Elapsed ${humanDuration(workflow.elapsedMs)}` : null}
        {!pullRequest && workflow.pullRequestRef ? <Mono>{workflow.pullRequestRef}</Mono> : null}
      </PageMeta>

      {pullRequest ? (
        <Card as="section" aria-labelledby={pullRequestHeadingId}>
          <h2 id={pullRequestHeadingId}>Pull request</h2>
          <KeyValue
            items={[
              {
                term: 'Pull request',
                detail: (
                  <a
                    href={pullRequest.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open pull request #${pullRequest.number} on GitHub (opens in a new tab)`}
                  >
                    #{pullRequest.number} {pullRequest.title}
                  </a>
                ),
              },
              {
                term: 'AI review',
                detail: pullRequest.reviewStatus ? (
                  <Pill
                    variant={
                      pullRequest.reviewStatus === 'FAILED'
                        ? 'fail'
                        : pullRequest.reviewStatus === 'RUNNING'
                          ? 'run'
                          : 'done'
                    }
                  >
                    {reviewStatusWord(pullRequest.reviewStatus)}
                  </Pill>
                ) : (
                  <Pill variant="neutral">no review yet</Pill>
                ),
              },
              {
                term: 'Merge readiness',
                detail: pullRequest.readyForMerge ? (
                  <>
                    <Pill variant="done">ready</Pill> Ready for merge approval
                  </>
                ) : (
                  <>
                    <Pill variant="blocked">not ready</Pill> Not ready for merge approval —{' '}
                    {pullRequest.blockingOpenCount} blocking{' '}
                    {pullRequest.blockingOpenCount === 1 ? 'finding' : 'findings'} open
                  </>
                ),
              },
            ]}
          />
          <Button variant="ghost" href={pullRequest.reviewHref}>
            Open review
          </Button>
        </Card>
      ) : null}

      <Card>
        <Meter label="Progress" value={progress.completed} max={progress.total} />
        <p>
          {progress.completed} of {progress.total} stages complete
        </p>
      </Card>

      {loadError ? (
        <Notice
          tone="error"
          action={
            <Button variant="ghost" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Notice>
      ) : null}

      {attention ? (
        <DecisionCard
          tone="needs-you"
          title={`${attention.stage.name} — ${attentionWord}`}
          badge={
            <>
              <StatePill state={attention.state} />
              {attention.riskLevel ? <RiskBadge level={attention.riskLevel} /> : null}
            </>
          }
          description={
            <>
              {attention.reason}
              <Sep />
              since <When at={attention.since} now={now} />
            </>
          }
          actions={
            <Button variant="saffron" href={attention.action.href}>
              {attention.action.label}
            </Button>
          }
        />
      ) : null}

      {failure ? (
        <Card as="section" aria-labelledby={failureId}>
          <h2 id={failureId}>Workflow failed</h2>
          <KeyValue
            items={[
              { term: 'Reason', detail: failure.reason },
              {
                term: 'Failed at',
                detail: (
                  <>
                    Stage {failure.failingStage.position} · {failure.failingStage.name} ·{' '}
                    <When at={failure.failedAt} now={now} />
                  </>
                ),
              },
              {
                term: 'Last successful stage',
                detail: failure.lastSuccessfulStage
                  ? `Stage ${failure.lastSuccessfulStage.position} · ${failure.lastSuccessfulStage.name}`
                  : 'None',
              },
            ]}
          />
          {actionError ? (
            <Notice tone="error" role="alert">
              {actionError}
            </Notice>
          ) : null}
          {confirmCancel ? (
            <Notice tone="info">Cancelling stops every remaining stage.</Notice>
          ) : null}
          {escalating ? (
            <Field label="Escalate to (name or group)" htmlFor={escalateId}>
              <Input
                id={escalateId}
                value={escalateTo}
                onChange={(e) => setEscalateTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEscalating(false);
                }}
              />
            </Field>
          ) : null}
          <ActionBar help={anyDisabled ? roleHelp : undefined}>
            <Button
              variant="primary"
              disabled={!actions.retry || pending !== null}
              loading={pending === 'retry'}
              onClick={() => void act('retry')}
            >
              Retry
            </Button>
            {escalating ? (
              <Button
                variant="primary"
                disabled={pending !== null}
                loading={pending === 'escalate'}
                onClick={() => void act('escalate', escalateTo || undefined)}
              >
                Send
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={!actions.escalate || pending !== null}
                onClick={() => setEscalating(true)}
              >
                Escalate
              </Button>
            )}
            <Button
              variant="danger"
              disabled={!actions.cancel || pending !== null}
              loading={pending === 'cancel'}
              onClick={() => (confirmCancel ? void act('cancel') : setConfirmCancel(true))}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && confirmCancel) setConfirmCancel(false);
              }}
              onBlur={() => setConfirmCancel(false)}
            >
              {confirmCancel ? 'Confirm cancel' : 'Cancel'}
            </Button>
          </ActionBar>
        </Card>
      ) : null}

      <Stepper label="Stage pipeline">
        {stages.map((s) => (
          <Step
            key={s.id}
            id={`stage-${s.position}`}
            state={s.state === 'COMPLETED' ? 'done' : s.current ? 'current' : 'todo'}
            title={`${s.position}. ${s.name}`}
            detail={
              <span>
                <StatePill state={s.state} />
                <Sep />
                {s.agent ?? 'unassigned'}
                {s.elapsedMs !== null ? (
                  <>
                    <Sep />
                    {humanDuration(s.elapsedMs)}
                  </>
                ) : null}
                <InspectRuns runs={s.agentRuns} />
              </span>
            }
          />
        ))}
      </Stepper>

      <Card as="section" aria-labelledby={currentId}>
        {currentStage ? (
          <>
            <h2 id={currentId}>Current stage: {currentStage.stage.name}</h2>
            <PageMeta>
              <StatePill state={currentStage.state} />
            </PageMeta>
            <KeyValue items={currentItems} />
            <Message variant="summary" who={currentStage.agent ?? 'agent'}>
              {currentStage.summary}
            </Message>
          </>
        ) : (
          <>
            <h2 id={currentId}>Current stage</h2>
            <p>No stages recorded yet.</p>
          </>
        )}
      </Card>

      <List aria-label="Activity" empty="No activity yet.">
        {activity.map((e, i) => (
          <ListRow
            key={`${e.at}-${i}`}
            title={e.message}
            meta={meta([
              <When key="t" at={e.at} now={now} />,
              <Pill key="s" variant="neutral">
                {e.source}
              </Pill>,
              e.stage ? `Stage ${e.stage.position}` : null,
              e.state ? <StatePill key="st" state={e.state} /> : null,
            ])}
          />
        ))}
      </List>

      <List aria-label="Artifacts" empty="No artifacts yet.">
        {artifacts.map((a) => (
          <ListRow
            key={a.id}
            id={`artifact-${a.externalId}`}
            title={a.title}
            {...(a.href ? { href: a.href } : {})}
            trailing={<Pill variant="neutral">{ARTIFACT_WORD[a.type]}</Pill>}
            meta={meta([
              `Stage ${a.stage.position} · ${a.stage.name}`,
              <When key="t" at={a.producedAt} now={now} />,
              a.summary,
            ])}
          />
        ))}
      </List>
    </div>
  );
}
