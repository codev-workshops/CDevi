'use client';

import type { AgentRunDetail } from '@cdevi/contracts';
import {
  CONFIDENCE_WORDS,
  POLICY_OUTCOME_WORDS,
  decisionAnchor,
  evidenceHref,
  runDuration,
  runFreshness,
  stepsSummary,
  type EvidenceKind,
  type PolicyOutcome,
  type RunStepStatus,
} from '@cdevi/contracts/agent-run-model';
import type { RiskLevel } from '@cdevi/contracts/vocabulary';
import {
  Button,
  Card,
  Crumbs,
  DecisionCard,
  GateCheck,
  GateList,
  KeyValue,
  Message,
  Mono,
  Notice,
  PageMeta,
  PanelBlock,
  Pill,
  RiskBadge,
  StatePill,
  Step,
  Stepper,
  Tab,
  TabPanel,
  Tabs,
  ToolLine,
  ToolLog,
  Topbar,
  type PillVariant,
  type StepProps,
  type ToolLineKind,
} from '@cdevi/design-system';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { humanAgo, humanDuration } from '../../../../../lib/format';
import { subscribeInboxStream } from '../../../../../lib/inbox-stream';
import { useInboxCount } from '../../../AppFrame';

export interface AgentRunScreenProps {
  initial: AgentRunDetail;
  /** Server render time (ISO); the duration ticker takes over on the client. */
  now: string;
}

type TabValue = 'timeline' | 'decisions';
type TimelineKind = AgentRunDetail['timeline'][number]['kind'];

const TIMELINE_TONE: Record<TimelineKind, ToolLineKind> = {
  tool: 'read',
  decision: 'write',
  note: 'dim',
  error: 'error',
};
const OUTCOME_PILL: Record<PolicyOutcome, PillVariant> = {
  ALLOWED: 'done',
  APPROVAL_REQUIRED: 'wait',
  DENIED: 'fail',
};
const STEP_STATE: Record<RunStepStatus, NonNullable<StepProps['state']>> = {
  completed: 'done',
  running: 'current',
  pending: 'todo',
  failed: 'todo',
};
const EVIDENCE_KIND_WORDS: Record<EvidenceKind, string> = {
  file: 'file',
  ticket: 'ticket',
  artifact: 'artifact',
  url: 'link',
  pullRequest: 'pull request',
};
const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const HOUR = 3_600_000;
const HASH = /^#decision-(\d+)$/;

/** `#decision-n` from the URL as an element id, or null. Server snapshot is null (the hash never reaches the server). */
const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const readHashAnchor = (): string | null => {
  const m = HASH.exec(window.location.hash);
  return m ? decisionAnchor(Number(m[1])) : null;
};
const noHash = () => null;

/** Human-readable elapsed time with seconds under an hour ("4 min 12 s"), `humanDuration` above. */
function durationLabel(ms: number): string {
  if (ms >= HOUR) return humanDuration(ms);
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins} min ${secs} s`;
}

const absolute = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const clock = (iso: string) => iso.slice(11, 19);
const isExternal = (href: string) => /^https?:\/\//i.test(href);

function lastActivity(run: AgentRunDetail): number {
  let last = new Date(run.startedAt).getTime();
  for (const e of run.timeline) last = Math.max(last, new Date(e.at).getTime());
  return last;
}

function EvidenceLink({ href, label }: { href: string; label: string }) {
  return isExternal(href) ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
    >
      {label}
    </a>
  ) : (
    <a href={href}>{label}</a>
  );
}

/** Agent Run Inspector (specs/001 US5, contracts/ui-agent-run.md). Read-only: no saffron, no forms (§7). */
export function AgentRunScreen({ initial, now }: AgentRunScreenProps) {
  const [run, setRun] = useState<AgentRunDetail>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(now);
  const [updated, setUpdated] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date(now));
  // The client clock continues from the server's `now` so server and client agree on every rendered duration.
  const clockBase = useRef<{ at: number; since: number } | null>(null);
  const readClock = useCallback(() => {
    clockBase.current ??= { at: new Date(now).getTime(), since: Date.now() };
    return new Date(clockBase.current.at + (Date.now() - clockBase.current.since));
  }, [now]);
  const hashAnchor = useSyncExternalStore(subscribeHash, readHashAnchor, noHash);
  const [chosenTab, setTab] = useState<TabValue | null>(null);
  const tab: TabValue =
    chosenTab ?? (hashAnchor || initial.decisions.length > 0 ? 'decisions' : 'timeline');
  const { setPanel } = useInboxCount();
  const tabsId = useId();
  const headerId = useId();
  const progressId = useId();
  const focusedAnchor = useRef<string | null>(null);

  const id = run.id;
  const workflowHref = `/workflows/${run.workflow.id}`;
  const unfinished = run.finishedAt === null;
  const liveState = run.state === 'RUNNING' || run.state === 'RETRYING';
  const referenceNow = new Date(lastFetchedAt);
  const freshness = runFreshness(run, clockNow);
  const durationMs = unfinished ? runDuration(run.startedAt, null, clockNow) : run.durationMs;
  const summary = stepsSummary(run.steps);

  const refetch = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await apiFetch<AgentRunDetail>(`/api/agent-runs/${encodeURIComponent(id)}`);
      setRun(next);
      setLastFetchedAt(readClock().toISOString());
      setLoadError(false);
      setUpdated(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign(`/sign-in?reason=expired&next=/agents/runs/${id}`);
        return;
      }
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  }, [id, readClock]);

  // Live updates (FR-004, FR-034): the inbox stream filtered to this run's workflow, debounced by the helper.
  useEffect(
    () =>
      subscribeInboxStream({
        workflowId: run.workflow.id,
        onChange: () => void refetch(),
        onStatus: setConnected,
      }),
    [run.workflow.id, refetch],
  );

  // Duration ticker: one interval, only while the run is unfinished; cleared when `finishedAt` arrives.
  useEffect(() => {
    if (!unfinished) return;
    readClock();
    const t = setInterval(() => setClockNow(readClock()), 1000);
    return () => clearInterval(t);
  }, [unfinished, readClock]);

  // `#decision-n` deep links (§6): select the Decisions tab, bring the card into view and focus it once.
  useEffect(() => {
    if (!hashAnchor || tab !== 'decisions' || focusedAnchor.current === hashAnchor) return;
    const el = document.getElementById(hashAnchor);
    if (!el) return;
    focusedAnchor.current = hashAnchor;
    el.scrollIntoView?.({ block: 'start' });
    el.focus({ preventScroll: true });
  }, [hashAnchor, tab, run.decisions]);

  const approvalRequired = run.decisions.filter((d) => d.policyOutcome === 'APPROVAL_REQUIRED').length;
  const denied = run.decisions.filter((d) => d.policyOutcome === 'DENIED').length;
  const highestRisk = run.decisions.reduce<RiskLevel | null>((acc, d) => {
    if (!d.riskLevel) return acc;
    return acc && RISK_ORDER.indexOf(acc) >= RISK_ORDER.indexOf(d.riskLevel) ? acc : d.riskLevel;
  }, null);
  const livePill = refreshing ? 'updating' : connected === false ? 'reconnecting' : 'live';

  useEffect(() => {
    setPanel(
      <>
        <PanelBlock title="About this run">
          <KeyValue
            items={[
              { term: 'Decisions', detail: String(run.decisions.length) },
              { term: 'Approval required', detail: String(approvalRequired) },
              { term: 'Denied', detail: String(denied) },
              {
                term: 'Highest risk',
                detail: highestRisk ? <RiskBadge level={highestRisk} /> : 'none reported',
              },
            ]}
          />
        </PanelBlock>
        <PanelBlock title="Live">
          <p>
            <Pill variant="neutral">{livePill}</Pill>{' '}
            <Mono>
              Updated{' '}
              <time dateTime={lastFetchedAt}>{humanAgo(new Date(lastFetchedAt), clockNow)}</time>
            </Mono>
          </p>
        </PanelBlock>
      </>,
    );
    return () => setPanel(undefined);
  }, [setPanel, run.decisions.length, approvalRequired, denied, highestRisk, livePill, lastFetchedAt, clockNow]);

  const stalePill = freshness === 'stale' && liveState;

  return (
    <div aria-busy={refreshing || undefined}>
      <Crumbs
        items={[
          { label: 'Workflows', href: '/workflows' },
          { label: run.workflow.title, href: workflowHref },
          { label: `Stage ${run.stage.position} · ${run.stage.name}`, href: `${workflowHref}#stage-${run.stage.position}` },
          { label: `Run · ${run.agent}` },
        ]}
      />
      <Topbar
        title={`${run.agent} — ${run.stage.name}`}
        actions={
          <Button variant="ghost" href={workflowHref}>
            Back to workflow
          </Button>
        }
      />
      <PageMeta>
        <StatePill state={run.state} />
        <Mono>{run.externalId}</Mono>
        {run.workflow.externalId}
        <Pill variant="neutral" pulse={updated && refreshing}>
          {livePill}
        </Pill>
        <span role="status">{updated ? 'Run updated' : null}</span>
      </PageMeta>

      {freshness === 'stale' ? (
        <Notice tone="info">
          No activity for {humanDuration(clockNow.getTime() - lastActivity(run))} — the runtime has not
          reported progress. The run&apos;s state is unchanged; see the workflow if it stays quiet.{' '}
          <a href={workflowHref}>Open workflow</a>
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
          The run couldn&apos;t be refreshed. Showing the last loaded state from{' '}
          {humanAgo(referenceNow, clockNow)}.
        </Notice>
      ) : null}

      <Card as="section" aria-labelledby={headerId}>
        <h2 id={headerId}>Run</h2>
        <KeyValue
          items={[
            { term: 'Agent', detail: run.agent },
            {
              term: 'Workflow',
              detail: (
                <a href={workflowHref}>
                  {run.workflow.externalId} · {run.workflow.title}
                </a>
              ),
            },
            { term: 'Stage', detail: `${run.stage.position}. ${run.stage.name}` },
            { term: 'Model', detail: run.model ?? 'not reported' },
            {
              term: 'Started',
              detail: (
                <time dateTime={run.startedAt}>
                  {absolute(run.startedAt)} ({humanAgo(new Date(run.startedAt), referenceNow)})
                </time>
              ),
            },
            {
              term: 'Duration',
              detail: (
                <>
                  <time dateTime={`PT${Math.floor(durationMs / 1000)}S`}>{durationLabel(durationMs)}</time>
                  {unfinished && liveState ? (
                    <>
                      {' '}
                      {stalePill ? (
                        <Pill variant="wait">no recent activity</Pill>
                      ) : (
                        <Pill variant="run">running</Pill>
                      )}
                    </>
                  ) : null}
                </>
              ),
            },
            { term: 'Status', detail: <StatePill state={run.state} /> },
          ]}
        />
        {run.summary ? (
          <Message who={`${run.agent} · summary`} variant="summary">
            <p>{run.summary}</p>
          </Message>
        ) : (
          <p>The agent has not reported a summary.</p>
        )}
      </Card>

      <Card as="section" aria-labelledby={progressId}>
        <h2 id={progressId}>Progress</h2>
        {run.steps.length === 0 ? (
          <p>The runtime has not reported structured progress for this run.</p>
        ) : (
          <>
            <Mono>
              {summary.completed} of {run.steps.length} steps completed
            </Mono>
            <Stepper label="Progress">
              {run.steps.map((s, i) => (
                <Step
                  key={`${i}-${s.label}`}
                  state={STEP_STATE[s.status]}
                  title={s.label}
                  detail={
                    s.status === 'failed' ? (
                      <Pill variant="fail">failed</Pill>
                    ) : s.status === 'running' ? (
                      <Pill variant="run">running</Pill>
                    ) : undefined
                  }
                />
              ))}
            </Stepper>
          </>
        )}
      </Card>

      <Tabs id={tabsId} label="Run details" value={tab} onChange={(v) => setTab(v as TabValue)}>
        <Tab value="timeline">Timeline ({run.timeline.length})</Tab>
        <Tab value="decisions">Decisions ({run.decisions.length})</Tab>
      </Tabs>

      <TabPanel value="timeline" current={tab} tabsId={tabsId}>
        {run.timeline.length === 0 ? (
          <p>No activity recorded yet.</p>
        ) : (
          <ToolLog label="Agent activity">
            {run.timeline.map((e, i) => (
              <ToolLine key={`${e.at}-${i}`} kind={TIMELINE_TONE[e.kind]}>
                <time dateTime={e.at}>{clock(e.at)}</time> {e.kind} · {e.message}
                {'\n'}
              </ToolLine>
            ))}
          </ToolLog>
        )}
      </TabPanel>

      <TabPanel value="decisions" current={tab} tabsId={tabsId}>
        {run.decisions.length === 0 ? (
          <Notice tone="info">
            No decisions recorded yet — decisions appear here as the agent reports them.
          </Notice>
        ) : (
          <ol aria-label="Decisions">
            {run.decisions.map((d) => (
              <li key={d.id} id={decisionAnchor(d.position)} tabIndex={-1}>
                <DecisionCard
                  tone="neutral"
                  title={`${d.position}. ${d.action}`}
                  badge={
                    <>
                      <Pill variant={OUTCOME_PILL[d.policyOutcome]}>
                        {POLICY_OUTCOME_WORDS[d.policyOutcome].toLowerCase()}
                      </Pill>
                      <Pill variant="neutral">
                        confidence {CONFIDENCE_WORDS[d.confidence].toLowerCase()}
                      </Pill>
                      {d.riskLevel ? <RiskBadge level={d.riskLevel} /> : null}
                    </>
                  }
                  description={
                    <>
                      <p>{d.reason}</p>
                      <Mono>
                        decided{' '}
                        <time dateTime={d.decidedAt}>
                          {humanAgo(new Date(d.decidedAt), referenceNow)}
                        </time>
                      </Mono>
                      {d.policyRef ? <Mono> · policy {d.policyRef}</Mono> : null}
                    </>
                  }
                >
                  {d.evidence.length === 0 ? (
                    <p>No evidence cited.</p>
                  ) : (
                    <GateList label={`Evidence for decision ${d.position}`}>
                      {d.evidence.map((ref, i) => {
                        const href = evidenceHref(ref);
                        const kind = EVIDENCE_KIND_WORDS[ref.kind];
                        const where = ref.locator ? `${kind} · ${ref.locator}` : kind;
                        return href ? (
                          <GateCheck
                            key={i}
                            state="ok"
                            label={<EvidenceLink href={href} label={ref.label} />}
                            source={where}
                          />
                        ) : (
                          <GateCheck
                            key={i}
                            state="pending"
                            label={`${ref.label} — access restricted`}
                            source={`${where} · not available to you`}
                          />
                        );
                      })}
                    </GateList>
                  )}
                </DecisionCard>
              </li>
            ))}
          </ol>
        )}
      </TabPanel>
    </div>
  );
}
