'use client';

import type {
  FindingActionResult,
  PullRequestReviewView,
  ReviewCycleView,
  ReviewFindingView,
} from '@cdevi/contracts';
import { evidenceHref, type EvidenceKind } from '@cdevi/contracts/agent-run-model';
import {
  FINDING_SEVERITIES,
  FINDING_STATES,
  REVIEW_LANES,
  REVIEW_LANE_WORDS,
  blockingOpenCount,
  canActOnFinding,
  canActOnFindingState,
  cycleProgress,
  cycleStateWord,
  findingStateWord,
  iterationWord,
  laneStatusWord,
  pullRequestStatusWord,
  readyForMerge,
  reviewStatusWord,
  severityPill,
  toDesignBlocking,
  type FindingSeverity,
  type FindingState,
  type LaneStatus,
  type ReviewActorRole,
  type ReviewCycleState,
  type ReviewLane,
} from '@cdevi/contracts/review-model';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ApiError,
  applyFix,
  createIssue,
  dismissFinding,
  getPullRequestReview,
} from '../../../../lib/api';
import {
  Button,
  Card,
  Crumbs,
  Field,
  FindingRow,
  GateCheck,
  GateList,
  Help,
  KeyValue,
  Meter,
  Mono,
  Notice,
  PageMeta,
  Pill,
  Select,
  Tab,
  TabPanel,
  Tabs,
  TextArea,
  Topbar,
  type FindingEvidence,
  type GateState,
  type PillVariant,
} from '../../../../lib/ds';
import { humanAgo } from '../../../../lib/format';
import { subscribeInboxStream } from '../../../../lib/inbox-stream';

export interface ReviewCenterScreenProps {
  initial: PullRequestReviewView;
  userRole: ReviewActorRole;
  /** Server render time (ISO) used as the reference for relative times. */
  now: string;
}

type TabValue = 'findings' | 'cycles';
type FindingAction = 'fix' | 'dismiss' | 'issue';

const REFETCH_DEBOUNCE_MS = 300;
const REASON_MAX = 240;
const HASH = /^#finding-(\d+)$/;
const VIEWER_EXPLANATION = 'Viewers can read findings but cannot act on them';

const LANE_GATE: Record<LaneStatus, GateState> = { PASS: 'ok', WARN: 'wait', FAIL: 'bad' };
const STATE_PILL: Record<FindingState, PillVariant> = {
  OPEN: 'neutral',
  FIX_REQUESTED: 'run',
  FIXED: 'done',
  DISMISSED: 'neutral',
  ISSUE_REQUESTED: 'wait',
};
const CYCLE_PILL: Record<ReviewCycleState, PillVariant> = {
  RUNNING: 'run',
  COMPLETED: 'done',
  FAILED: 'fail',
  CANCELLED: 'neutral',
};
const EVIDENCE_KIND_WORDS: Record<EvidenceKind, string> = {
  file: 'file',
  ticket: 'ticket',
  artifact: 'artifact',
  url: 'link',
  pullRequest: 'pull request',
};

export const findingAnchor = (position: number): string => `finding-${position}`;

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const readHashAnchor = (): string | null => {
  const m = HASH.exec(window.location.hash);
  return m ? findingAnchor(Number(m[1])) : null;
};
const noHash = () => null;

const absolute = (iso: string) => {
  const utc = new Date(iso).toISOString();
  return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lower = (s: string) => s.toLowerCase();

function evidenceItems(finding: ReviewFindingView): FindingEvidence[] {
  return finding.evidence.map((ref) => {
    const href = evidenceHref(ref);
    const kind = EVIDENCE_KIND_WORDS[ref.kind];
    const where = ref.locator && ref.locator !== ref.label ? ` · ${ref.locator}` : '';
    return href
      ? { label: `${ref.label}${where} · ${kind}`, href }
      : { label: `${ref.label}${where} · ${kind} — access restricted` };
  });
}

/** Merge a `FindingActionResult` into the last loaded view: the finding, the cycle it created or joined, the derived readiness. */
function applyResult(
  view: PullRequestReviewView,
  result: FindingActionResult,
): PullRequestReviewView {
  const findings = view.findings.map((f) => (f.id === result.finding.id ? result.finding : f));
  let cycles = view.cycles;
  if (result.cycle) {
    const c = result.cycle;
    cycles = cycles.some((x) => x.id === c.id)
      ? cycles.map((x) => (x.id === c.id ? c : x))
      : [...cycles, c];
  }
  return {
    ...view,
    findings,
    cycles,
    readyForMerge: result.readyForMerge,
    blockingOpenCount: result.blockingOpenCount,
  };
}

function ExternalLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
    >
      {children}
    </a>
  );
}

interface DismissFormProps {
  findingTitle: string;
  busy: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
  onCancel: () => void;
}

/** Inline required-reason form for Dismiss (FR-021): ≤ 240 chars, validation message, Confirm/Cancel. */
function DismissForm({ findingTitle, busy, onConfirm, onCancel }: DismissFormProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  useEffect(() => areaRef.current?.focus(), []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError('A reason is required.');
      areaRef.current?.focus();
      return;
    }
    if (trimmed.length > REASON_MAX) {
      setError(`Keep the reason to ${REASON_MAX} characters.`);
      areaRef.current?.focus();
      return;
    }
    setError(null);
    await onConfirm(trimmed);
  };

  return (
    <form
      noValidate
      aria-label={`Dismiss finding: ${findingTitle}`}
      onSubmit={(e) => void submit(e)}
    >
      <Field
        label="Reason"
        htmlFor={fieldId}
        help={`${reason.length} of ${REASON_MAX} characters. The reason is recorded in the audit log.`}
        error={error}
      >
        <TextArea
          ref={areaRef}
          id={fieldId}
          name="reason"
          required
          maxLength={REASON_MAX}
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
      <Button type="submit" size="sm" variant="primary" loading={busy}>
        Confirm dismiss
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </form>
  );
}

/** PR Review Center (specs/001 US6; UI spec §20–22). No saffron: merge approval lives in the Approval Center. */
export function ReviewCenterScreen({ initial, userRole, now }: ReviewCenterScreenProps) {
  const [view, setView] = useState<PullRequestReviewView>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(now);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ findingId: string; action: FindingAction } | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [laneFilter, setLaneFilter] = useState<ReviewLane | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');
  const [stateFilter, setStateFilter] = useState<FindingState | 'all'>('all');
  const [focusCycle, setFocusCycle] = useState<string | null>(null);
  const refocusDismiss = useRef<string | null>(null);

  const hashAnchor = useSyncExternalStore(subscribeHash, readHashAnchor, noHash);
  // A tab choice is remembered until the URL hash changes: every new `#finding-n` selects Findings again.
  const [chosen, setChosen] = useState<{ tab: TabValue; forHash: string | null } | null>(null);
  const tab: TabValue = chosen && chosen.forHash === hashAnchor ? chosen.tab : 'findings';
  const setTab = useCallback(
    (next: TabValue) => setChosen({ tab: next, forHash: hashAnchor }),
    [hashAnchor],
  );

  const tabsId = useId();
  const headerId = useId();
  const lanesId = useId();
  const viewerHelpId = useId();
  const laneSelectId = useId();
  const severitySelectId = useId();
  const stateSelectId = useId();
  const focusedAnchor = useRef<string | null>(null);
  const generation = useRef(0);
  const dismissButtons = useRef(new Map<string, HTMLButtonElement | HTMLAnchorElement>());
  const cycleCards = useRef(new Map<string, HTMLLIElement>());

  const prId = view.pullRequest.id;
  const canAct = canActOnFinding(userRole);
  const referenceNow = new Date(lastFetchedAt);
  // Readiness is derived from the findings, never stored (FR-022); the server figure is the same rule.
  const blocking = blockingOpenCount(view.findings);
  const ready = readyForMerge(view.findings);
  const latest = view.latestReview;

  const refetch = useCallback(async () => {
    const mine = ++generation.current;
    setRefreshing(true);
    try {
      const next = await getPullRequestReview(prId);
      if (mine !== generation.current) return;
      setView(next);
      setLastFetchedAt(new Date().toISOString());
      setLoadError(false);
    } catch (e) {
      if (mine !== generation.current) return;
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign(`/sign-in?reason=expired&next=/reviews/${prId}`);
        return;
      }
      setLoadError(true);
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  }, [prId]);

  // Live updates (FR-034): the inbox stream filtered to this PR's workflow, debounced 300 ms; tab, focus and scroll stay.
  useEffect(
    () =>
      subscribeInboxStream({
        workflowId: view.workflow.id,
        debounceMs: REFETCH_DEBOUNCE_MS,
        onChange: () => void refetch(),
        onStatus: setConnected,
      }),
    [view.workflow.id, refetch],
  );

  // `#finding-n` deep links: select Findings, bring the finding into view and focus it once per hash.
  useEffect(() => {
    if (!hashAnchor || tab !== 'findings' || focusedAnchor.current === hashAnchor) return;
    const el = document.getElementById(hashAnchor);
    if (!el) return;
    focusedAnchor.current = hashAnchor;
    el.scrollIntoView?.({ block: 'start' });
    el.focus({ preventScroll: true });
  }, [hashAnchor, tab, view.findings]);

  // Apply Fix switches to Cycles and lands on the cycle it created or joined.
  useEffect(() => {
    if (!focusCycle || tab !== 'cycles') return;
    const el = cycleCards.current.get(focusCycle);
    if (!el) return;
    setFocusCycle(null);
    el.scrollIntoView?.({ block: 'start' });
    el.focus({ preventScroll: true });
  }, [focusCycle, tab, view.cycles]);

  const act = useCallback(
    async (
      finding: ReviewFindingView,
      action: FindingAction,
      reason?: string,
    ): Promise<boolean> => {
      setPending({ findingId: finding.id, action });
      setActionError(null);
      setOutcome(null);
      try {
        const result =
          action === 'fix'
            ? await applyFix(prId, finding.id)
            : action === 'issue'
              ? await createIssue(prId, finding.id)
              : await dismissFinding(prId, finding.id, reason ?? '');
        setView((prev) => applyResult(prev, result));
        setDismissing(null);
        if (action === 'fix' && result.cycle) {
          setFocusCycle(result.cycle.id);
          setTab('cycles');
        }
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // Someone else got there first: show the recorded outcome and reload the view.
          setOutcome(e.problem?.detail ?? e.problem?.title ?? 'This finding was already resolved.');
          setDismissing(null);
          void refetch();
          return false;
        }
        if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
          window.location.assign(`/sign-in?reason=expired&next=/reviews/${prId}`);
          return false;
        }
        setActionError(
          e instanceof ApiError
            ? e.message
            : 'The action could not be completed. Check your connection and try again.',
        );
        return false;
      } finally {
        setPending(null);
      }
    },
    [prId, refetch, setTab],
  );

  // Cancel returns focus to the Dismiss button once the form has unmounted and the button is back.
  useEffect(() => {
    if (dismissing !== null || !refocusDismiss.current) return;
    dismissButtons.current.get(refocusDismiss.current)?.focus();
    refocusDismiss.current = null;
  }, [dismissing]);

  const cancelDismiss = (findingId: string) => {
    refocusDismiss.current = findingId;
    setDismissing(null);
  };

  const visible = view.findings
    .filter((f) => laneFilter === 'all' || f.lane === laneFilter)
    .filter((f) => severityFilter === 'all' || f.severity === severityFilter)
    .filter((f) => stateFilter === 'all' || f.state === stateFilter)
    .sort((a, b) => a.position - b.position);
  const filtered = laneFilter !== 'all' || severityFilter !== 'all' || stateFilter !== 'all';
  const cycles = [...view.cycles].sort((a, b) => b.cycleNumber - a.cycleNumber);
  const livePill = refreshing ? 'updating' : connected === false ? 'reconnecting' : 'live';
  const title = `PR #${view.pullRequest.number} — ${view.pullRequest.title}`;

  const laneSource = (lane: ReviewLane) => {
    const result = latest?.lanes.find((l) => l.lane === lane);
    if (!result) return { state: 'pending' as GateState, source: 'not yet reviewed' };
    return {
      state: LANE_GATE[result.status],
      source: `${laneStatusWord(result.status)} · review agent · ${result.summary}`,
    };
  };

  const renderActions = (f: ReviewFindingView) => {
    if (!canActOnFindingState(f.state)) {
      return (
        <>
          <Pill variant={STATE_PILL[f.state]}>{lower(findingStateWord(f.state))}</Pill>
          {f.state === 'DISMISSED' && f.dismissedReason ? (
            <span>
              Reason: {f.dismissedReason}
              {f.dismissedBy ? ` — ${f.dismissedBy.displayName}` : ''}
            </span>
          ) : null}
          {f.state === 'FIX_REQUESTED' && f.fixCycleId ? (
            <span>
              Fix requested in{' '}
              {(() => {
                const c = view.cycles.find((x) => x.id === f.fixCycleId);
                return c ? `Review Cycle #${c.cycleNumber}` : 'a review cycle';
              })()}
            </span>
          ) : null}
        </>
      );
    }
    if (dismissing === f.id && canAct) {
      return (
        <DismissForm
          findingTitle={f.title}
          busy={pending?.findingId === f.id && pending.action === 'dismiss'}
          onConfirm={(reason) => act(f, 'dismiss', reason)}
          onCancel={() => cancelDismiss(f.id)}
        />
      );
    }
    const busy = pending?.findingId === f.id;
    const describedBy = canAct ? undefined : viewerHelpId;
    return (
      <>
        <Button
          size="sm"
          variant="primary"
          disabled={!canAct || busy}
          loading={busy && pending?.action === 'fix'}
          aria-describedby={describedBy}
          onClick={() => void act(f, 'fix')}
        >
          Apply Fix
        </Button>
        <Button
          ref={(el) => {
            if (el) dismissButtons.current.set(f.id, el);
            else dismissButtons.current.delete(f.id);
          }}
          size="sm"
          variant="ghost"
          disabled={!canAct || busy}
          aria-describedby={describedBy}
          onClick={() => {
            setActionError(null);
            setDismissing(f.id);
          }}
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canAct || busy}
          loading={busy && pending?.action === 'issue'}
          aria-describedby={describedBy}
          onClick={() => void act(f, 'issue')}
        >
          Create Issue
        </Button>
      </>
    );
  };

  return (
    <div aria-busy={refreshing || undefined}>
      <Crumbs
        items={[
          { label: 'Reviews', href: '/reviews' },
          { label: `PR #${view.pullRequest.number}` },
        ]}
      />
      <Topbar
        title={title}
        actions={
          <Button variant="ghost" href={view.workflow.href}>
            Back to workflow
          </Button>
        }
      />
      <PageMeta>
        {latest ? (
          <Pill
            variant={
              latest.status === 'FAILED' ? 'fail' : latest.status === 'RUNNING' ? 'run' : 'done'
            }
          >
            {reviewStatusWord(latest.status)}
          </Pill>
        ) : (
          <Pill variant="neutral">no review yet</Pill>
        )}
        <Mono>{view.pullRequest.externalId}</Mono>
        <Pill variant="neutral">{pullRequestStatusWord(view.pullRequest.status)}</Pill>
        <Pill variant="neutral" pulse={refreshing}>
          {livePill}
        </Pill>
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
          The review couldn&apos;t be refreshed. Showing the last loaded state from{' '}
          {humanAgo(referenceNow, new Date())}.
        </Notice>
      ) : null}

      <Card as="section" aria-labelledby={headerId}>
        <h2 id={headerId}>Pull request</h2>
        <KeyValue
          items={[
            {
              term: 'Pull request',
              detail: (
                <ExternalLink
                  href={view.pullRequest.href}
                  label={`Open pull request #${view.pullRequest.number} on GitHub`}
                >
                  #{view.pullRequest.number} {view.pullRequest.title}
                </ExternalLink>
              ),
            },
            {
              term: 'Requirement',
              detail: view.requirement ? (
                <a href={view.requirement.href}>{view.requirement.title}</a>
              ) : (
                'none linked'
              ),
            },
            { term: 'Workflow', detail: <a href={view.workflow.href}>{view.workflow.name}</a> },
            {
              term: 'Latest review',
              detail: latest ? (
                <>
                  Review cycle #{latest.cycleNumber} ·{' '}
                  <Pill variant="neutral">{reviewStatusWord(latest.status)}</Pill>
                </>
              ) : (
                'no review reported yet'
              ),
            },
            {
              term: 'Started',
              detail: latest ? (
                <time dateTime={latest.startedAt}>
                  {absolute(latest.startedAt)} ({humanAgo(new Date(latest.startedAt), referenceNow)}
                  )
                </time>
              ) : (
                '—'
              ),
            },
            {
              term: 'Finished',
              detail: latest?.finishedAt ? (
                <time dateTime={latest.finishedAt}>
                  {absolute(latest.finishedAt)} (
                  {humanAgo(new Date(latest.finishedAt), referenceNow)})
                </time>
              ) : latest ? (
                'in progress'
              ) : (
                '—'
              ),
            },
          ]}
        />
      </Card>

      <Card as="section" aria-labelledby={lanesId}>
        <h2 id={lanesId}>Review lanes</h2>
        <GateList label="Review lanes">
          {REVIEW_LANES.map((lane) => {
            const { state, source } = laneSource(lane);
            return (
              <GateCheck key={lane} state={state} label={REVIEW_LANE_WORDS[lane]} source={source} />
            );
          })}
        </GateList>
      </Card>

      {ready ? (
        <Notice tone="info">
          <Pill variant="done">ready</Pill> Ready for merge approval — no blocking findings open.
        </Notice>
      ) : (
        <Notice tone="error">
          <Pill variant="blocked">not ready</Pill> Not ready for merge approval —{' '}
          {plural(blocking, 'blocking finding')} open
        </Notice>
      )}

      {outcome ? (
        <Notice
          tone="info"
          action={
            <Button variant="ghost" onClick={() => setOutcome(null)}>
              Dismiss notice
            </Button>
          }
        >
          {outcome}
        </Notice>
      ) : null}
      {actionError ? (
        <Notice
          tone="error"
          action={
            <Button variant="ghost" onClick={() => setActionError(null)}>
              Dismiss notice
            </Button>
          }
        >
          {actionError}
        </Notice>
      ) : null}

      {canAct ? null : <Help id={viewerHelpId}>{VIEWER_EXPLANATION}</Help>}

      <Tabs id={tabsId} label="Review details" value={tab} onChange={(v) => setTab(v as TabValue)}>
        <Tab value="findings">Findings ({view.findings.length})</Tab>
        <Tab value="cycles">Cycles ({view.cycles.length})</Tab>
      </Tabs>

      <TabPanel value="findings" current={tab} tabsId={tabsId}>
        <PageMeta>
          <Field label="Lane" htmlFor={laneSelectId}>
            <Select
              id={laneSelectId}
              value={laneFilter}
              onChange={(e) => setLaneFilter(e.target.value as ReviewLane | 'all')}
            >
              <option value="all">All lanes</option>
              {REVIEW_LANES.map((l) => (
                <option key={l} value={l}>
                  {REVIEW_LANE_WORDS[l]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severity" htmlFor={severitySelectId}>
            <Select
              id={severitySelectId}
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as FindingSeverity | 'all')}
            >
              <option value="all">Any severity</option>
              {FINDING_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {severityPill(s).word}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="State" htmlFor={stateSelectId}>
            <Select
              id={stateSelectId}
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as FindingState | 'all')}
            >
              <option value="all">Any state</option>
              {FINDING_STATES.map((s) => (
                <option key={s} value={s}>
                  {lower(findingStateWord(s))}
                </option>
              ))}
            </Select>
          </Field>
        </PageMeta>
        {view.findings.length === 0 ? (
          <Notice tone="info">
            No findings reported yet — findings appear here when the review agent reports them.
          </Notice>
        ) : visible.length === 0 ? (
          <Notice
            tone="info"
            action={
              <Button
                variant="ghost"
                onClick={() => {
                  setLaneFilter('all');
                  setSeverityFilter('all');
                  setStateFilter('all');
                }}
              >
                Clear filters
              </Button>
            }
          >
            No findings match these filters.
          </Notice>
        ) : (
          <ol aria-label="Findings">
            {visible.map((f) => (
              <li key={f.id} id={findingAnchor(f.position)} tabIndex={-1}>
                <FindingRow
                  severity={f.severity}
                  blocking={toDesignBlocking(f.blocking)}
                  lane={REVIEW_LANE_WORDS[f.lane]}
                  title={`${f.position}. ${f.title}`}
                  description={f.description}
                  impact={f.impact}
                  evidence={evidenceItems(f)}
                  fix={f.recommendedFix}
                  actions={renderActions(f)}
                />
              </li>
            ))}
          </ol>
        )}
        {filtered && visible.length > 0 ? (
          <Help>
            {visible.length} of {view.findings.length} findings shown
          </Help>
        ) : null}
      </TabPanel>

      <TabPanel value="cycles" current={tab} tabsId={tabsId}>
        {cycles.length === 0 ? (
          <Notice tone="info">No review cycles yet — Apply Fix on a finding starts one.</Notice>
        ) : (
          <ol aria-label="Review cycles">
            {cycles.map((c) => (
              <li
                key={c.id}
                tabIndex={-1}
                ref={(el) => {
                  if (el) cycleCards.current.set(c.id, el);
                  else cycleCards.current.delete(c.id);
                }}
              >
                <CycleCard cycle={c} referenceNow={referenceNow} />
              </li>
            ))}
          </ol>
        )}
      </TabPanel>
    </div>
  );
}

function CycleCard({ cycle, referenceNow }: { cycle: ReviewCycleView; referenceNow: Date }) {
  const id = useId();
  const progress = cycleProgress(cycle);
  return (
    <Card as="section" aria-labelledby={id}>
      <h3 id={id}>Review Cycle #{cycle.cycleNumber}</h3>
      <Pill variant={CYCLE_PILL[cycle.state]} pulse={cycle.state === 'RUNNING'}>
        {lower(cycleStateWord(cycle.state))}
      </Pill>
      <KeyValue
        items={[
          { term: 'Findings', detail: String(cycle.findingsCount) },
          { term: 'Fixed', detail: String(cycle.fixedCount) },
          { term: 'Remaining', detail: String(cycle.remainingCount) },
          {
            term: 'Requested by',
            detail: cycle.requestedBy?.displayName ?? cycle.requestedByAgent ?? 'not reported',
          },
          {
            term: 'Started',
            detail: (
              <time dateTime={cycle.startedAt}>
                {absolute(cycle.startedAt)} ({humanAgo(new Date(cycle.startedAt), referenceNow)})
              </time>
            ),
          },
          {
            term: 'Finished',
            detail: cycle.finishedAt ? (
              <time dateTime={cycle.finishedAt}>
                {absolute(cycle.finishedAt)} ({humanAgo(new Date(cycle.finishedAt), referenceNow)})
              </time>
            ) : (
              'in progress'
            ),
          },
        ]}
      />
      <Mono>{iterationWord(cycle)}</Mono>
      <Meter
        value={progress.value}
        max={progress.max}
        label={iterationWord(cycle)}
        warn={cycle.iteration >= cycle.maxIterations}
      />
    </Card>
  );
}
