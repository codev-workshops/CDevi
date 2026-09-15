'use client';

import type {
  ActiveWorkflowCard,
  DashboardSnapshot,
  Figure,
  Me,
  Rate,
  WindowKey,
} from '@cdevi/contracts';
import { ACTIVE_CARD_LIMIT, WINDOW_KEYS, ratePercent } from '@cdevi/contracts/dashboard-model';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import {
  Bars,
  Button,
  Card,
  Field,
  KeyValue,
  List,
  ListRow,
  Meter,
  Mono,
  Notice,
  PageMeta,
  Pill,
  RiskBadge,
  Select,
  Stat,
  StatGrid,
  StatePill,
  Topbar,
} from '../../../lib/ds';
import { humanAgo, humanDuration } from '../../../lib/format';
import { subscribeInboxStream } from '../../../lib/inbox-stream';
import { PROJECT_COOKIE } from '../../../lib/navigation';
import { useInboxCount } from '../AppFrame';

export interface DashboardScreenProps {
  me: Me;
  initial: DashboardSnapshot;
}

const WINDOW_LABELS: Record<WindowKey, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const REFETCH_DEBOUNCE_MS = 300;

function rememberProject(project: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(project)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
}

function updateUrl(params: Record<string, string>) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  window.history.replaceState(null, '', url);
}

/** A dashboard figure: the number is the link (FR-023); the accessible name reads "{value} {label}". */
function FigureStat({ figure, label, name }: { figure: Figure; label: ReactNode; name: string }) {
  return (
    <Stat
      value={
        <a href={figure.href} aria-label={`${figure.value} ${name}`}>
          {figure.value}
        </a>
      }
      label={label}
    />
  );
}

const HEALTH_EMPTY: Record<keyof DashboardSnapshot['health'], string> = {
  testPassRate: 'No test runs in this window',
  agentSuccessRate: 'No finished agent runs in this window',
  humanInterventionRate: 'No workflows in this window',
};

interface HealthMetric {
  key: keyof DashboardSnapshot['health'];
  label: string;
}

const HEALTH_METRICS: readonly HealthMetric[] = [
  { key: 'testPassRate', label: 'Test pass rate' },
  { key: 'agentSuccessRate', label: 'Agent success rate' },
  { key: 'humanInterventionRate', label: 'Human intervention rate' },
];

/** Health rows (ui-dashboard.md §2.6): a zero denominator is "—" with its reason, never "0 %" or NaN. */
function HealthRows({ health }: { health: DashboardSnapshot['health'] }) {
  const id = useId();
  return (
    <KeyValue
      items={HEALTH_METRICS.map(({ key, label }) => {
        const rate: Rate = health[key];
        const pct = ratePercent(rate);
        const unavailable = pct === null;
        const describedBy = `${id}-${key}`;
        return {
          term: (
            <>
              {label}
              <Meter
                label={label}
                value={rate.numerator}
                max={rate.denominator}
                muted={unavailable}
              />
            </>
          ),
          detail: (
            <>
              <a href={rate.href} aria-describedby={describedBy}>
                {unavailable ? '—' : `${pct} %`}
              </a>{' '}
              <span id={describedBy}>
                {unavailable ? (
                  HEALTH_EMPTY[key]
                ) : (
                  <Mono>
                    {rate.numerator} / {rate.denominator}
                  </Mono>
                )}
              </span>
            </>
          ),
        };
      })}
    />
  );
}

/** One active workflow (§2.8): identifier, stage, progress, agent, elapsed and the state word; the title opens Workflow Detail. */
function WorkflowRow({ card }: { card: ActiveWorkflowCard }) {
  return (
    <ListRow
      title={card.title}
      href={card.href}
      trailing={<StatePill state={card.state} />}
      meta={
        <>
          <Mono>{card.externalId}</Mono> · Stage {card.stage.index ?? '—'} of {card.stage.count} ·{' '}
          {card.stage.name ?? 'no stage'} · {card.agent ?? 'no agent'} ·{' '}
          {card.elapsedMs === null ? 'not started' : humanDuration(card.elapsedMs)}
          <Meter label="Progress" value={card.progress.done} max={card.progress.total} />
        </>
      }
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card as="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </Card>
  );
}

/** Dashboard (specs/001 US3; ui-dashboard.md). Read-only: every figure is a link, nothing here is saffron (§2.9). */
export function DashboardScreen({ me, initial }: DashboardScreenProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initial);
  const [project, setProject] = useState<string>(initial.project);
  const [windowKey, setWindowKey] = useState<WindowKey>(initial.window.key);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const { setApprovalsCount } = useInboxCount();
  const requestSeq = useRef(0);
  const titleRef = useRef<HTMLDivElement>(null);
  const generatedAt = useMemo(() => new Date(snapshot.generatedAt), [snapshot.generatedAt]);

  // The server resolved ?project= (or the cookie) into initial.project; keep the shared cookie in step
  // so the lists the figures link to open on the same scope.
  useEffect(() => rememberProject(initial.project), [initial.project]);

  const pendingTotal = snapshot.needsMe.approvals.value + snapshot.needsMe.clarifications.value;
  useEffect(() => setApprovalsCount(pendingTotal), [pendingTotal, setApprovalsCount]);
  // The wall clock is read only after mount so server and client render the same "Updated" label.
  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setClock(new Date());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async (p: string, w: WindowKey) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(false);
    try {
      const qs = new URLSearchParams({ project: p, window: w });
      const next = await apiFetch<DashboardSnapshot>(`/api/dashboard?${qs}`);
      if (seq !== requestSeq.current) return;
      setSnapshot(next);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign('/sign-in?reason=expired&next=/dashboard');
        return;
      }
      setError(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(
    () =>
      subscribeInboxStream({
        debounceMs: REFETCH_DEBOUNCE_MS,
        onChange: () => void load(project, windowKey),
        onStatus: setConnected,
      }),
    [load, project, windowKey],
  );

  const onProject = (next: string) => {
    setProject(next);
    rememberProject(next);
    updateUrl({ project: next });
    void load(next, windowKey);
  };

  const onWindow = (next: WindowKey) => {
    setWindowKey(next);
    updateUrl({ window: next });
    void load(project, next);
  };

  const onRetry = () => {
    void load(project, windowKey);
    const h1 = titleRef.current?.querySelector('h1');
    if (h1) {
      h1.tabIndex = -1;
      h1.focus();
    }
  };

  const windowLabel = WINDOW_LABELS[snapshot.window.key];
  const { counts, pipeline, needsMe, health, risk } = snapshot;
  const barsLabel = `Workflows per SDLC stage: ${pipeline.stages
    .map((s) => `${s.count} ${s.name}`)
    .join(', ')}`;
  const selectedName = me.projects.find((p) => p.id === project)?.name;
  const emptyCards =
    project === 'all' ? (
      'No active workflows.'
    ) : (
      <>
        No active workflows in <strong>{selectedName ?? 'this project'}</strong>.{' '}
        <Button variant="ghost" size="sm" onClick={() => onProject('all')}>
          Show all projects
        </Button>
      </>
    );

  return (
    <div aria-busy={loading || undefined}>
      <Topbar ref={titleRef} title="Dashboard" />
      <PageMeta>
        <Field label="Project" htmlFor="dashboard-project">
          <Select
            id="dashboard-project"
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
        <Field label="Window" htmlFor="dashboard-window">
          <Select
            id="dashboard-window"
            value={windowKey}
            onChange={(e) => onWindow(e.target.value as WindowKey)}
          >
            {WINDOW_KEYS.map((k) => (
              <option key={k} value={k}>
                {WINDOW_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <span>
          Updated{' '}
          <time dateTime={snapshot.generatedAt} title={generatedAt.toISOString()}>
            {humanAgo(generatedAt, clock ?? generatedAt)}
          </time>
        </span>
        <Pill variant="neutral" role="status">
          {loading ? 'updating' : connected === false ? 'reconnecting' : 'live'}
        </Pill>
      </PageMeta>

      {error ? (
        <Notice
          tone="error"
          action={
            <Button variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          Couldn&apos;t load the dashboard.
        </Notice>
      ) : null}

      <StatGrid columns={4}>
        <FigureStat
          figure={counts.activeWorkflows}
          name="active workflows"
          label="active workflows"
        />
        <FigureStat figure={counts.runningAgents} name="running agents" label="running agents" />
        <FigureStat
          figure={counts.prsGenerated}
          name={`PRs generated · ${windowLabel}`}
          label={`PRs generated · ${windowLabel}`}
        />
        <FigureStat figure={counts.openFailures} name="open failures" label="open failures" />
      </StatGrid>

      <Section title="Pipeline">
        <Bars
          label={barsLabel}
          values={pipeline.stages.map((s) => ({ value: s.count, label: s.name }))}
        />
        <List aria-label="Pipeline">
          {pipeline.stages.map((s) => (
            <ListRow
              key={s.stage}
              title={s.name}
              href={s.href}
              meta={<Mono>Stage {s.stage}</Mono>}
              trailing={<Mono>{s.count}</Mono>}
            />
          ))}
          {pipeline.unstaged.value > 0 ? (
            <ListRow
              key="unstaged"
              title={`${pipeline.unstaged.value} without a stage`}
              href={pipeline.unstaged.href}
            />
          ) : null}
        </List>
      </Section>

      <Section title="What needs me">
        <StatGrid columns={4}>
          <FigureStat figure={needsMe.approvals} name="approvals" label="approvals" />
          <FigureStat
            figure={needsMe.clarifications}
            name="clarifications"
            label="clarifications"
          />
          <FigureStat figure={needsMe.failed} name="failed workflows" label="failed workflows" />
          <FigureStat figure={needsMe.blocked} name="blocked workflows" label="blocked workflows" />
        </StatGrid>
      </Section>

      <Section title={`Health · ${windowLabel}`}>
        <HealthRows health={health} />
      </Section>

      <Section title="Risk">
        <StatGrid columns={3}>
          <FigureStat
            figure={risk.pendingHighCritical}
            name="pending approvals"
            label={
              <>
                <RiskBadge level="HIGH" /> <RiskBadge level="CRITICAL" /> pending approvals
              </>
            }
          />
          <FigureStat
            figure={risk.auditHighCritical}
            name={`audit events · ${windowLabel}`}
            label={
              <>
                <RiskBadge level="HIGH" /> <RiskBadge level="CRITICAL" /> audit events ·{' '}
                {windowLabel}
              </>
            }
          />
          <Stat value="—" label="security findings" />
        </StatGrid>
        {risk.securityFindings.connected ? null : (
          <Notice tone="info" action={<a href={risk.securityFindings.href}>Open Reviews</a>}>
            Not connected yet — review findings arrive with PR Review (User Story 6).
          </Notice>
        )}
      </Section>

      <Section title={`Active workflows (${snapshot.activeWorkflowsTotal})`}>
        <List aria-label="Active workflows" loading={loading} empty={emptyCards}>
          {snapshot.activeWorkflows.map((card) => (
            <WorkflowRow key={card.workflowId} card={card} />
          ))}
        </List>
        {snapshot.activeWorkflowsTotal > ACTIVE_CARD_LIMIT ? (
          <Button variant="ghost" href={counts.activeWorkflows.href}>
            Show all {snapshot.activeWorkflowsTotal}
          </Button>
        ) : null}
      </Section>
    </div>
  );
}
