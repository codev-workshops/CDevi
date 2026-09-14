'use client';

import type { InboxItem, InboxSnapshot, Me, Tab } from '@cdevi/contracts';
import {
  Button,
  Field,
  List,
  Notice,
  PageMeta,
  Pill,
  Select,
  Tab as TabButton,
  TabPanel,
  Tabs,
  Topbar,
} from '@cdevi/design-system';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import { subscribeInboxStream } from '../../../lib/inbox-stream';
import { PROJECT_COOKIE } from '../../../lib/navigation';
import { useInboxCount } from '../AppFrame';
import { InboxPanel } from './InboxPanel';
import { InboxRowDone, InboxRowNeedsYou, InboxRowRunning } from './InboxRows';
import { NewRequirementButton } from './NewRequirementButton';

export interface InboxScreenProps {
  me: Me;
  initial: InboxSnapshot;
}

const TAB_LABEL: Record<Tab, string> = { needsYou: 'Needs you', running: 'Running', done: 'Done' };
const EMPTY: Record<Exclude<Tab, 'needsYou'>, string> = {
  running: 'No workflows are running.',
  done: 'Nothing finished in the last 7 days.',
};

function updateUrl(tab: Tab, project: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  url.searchParams.set('project', project);
  window.history.replaceState(null, '', url);
}

function rememberProject(project: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(project)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
}

/** The Inbox (contracts/ui-inbox-screen.md §2). One snapshot object drives rows, counts and Today (SC-004). */
export function InboxScreen({ me, initial }: InboxScreenProps) {
  const [snapshot, setSnapshot] = useState<InboxSnapshot>(initial);
  const [extra, setExtra] = useState<InboxItem[]>([]);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [project, setProject] = useState<string>(initial.project);
  const [loading, setLoading] = useState<'initial' | 'refresh' | 'more' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setCount, setPanel } = useInboxCount();
  const tabsId = useId();
  const tablistRef = useRef<HTMLDivElement>(null);
  const focusNextRowIndex = useRef<number | null>(null);
  const focusedRowBeforeRefresh = useRef<Element | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const now = useMemo(() => new Date(snapshot.generatedAt), [snapshot.generatedAt]);
  const items = useMemo(() => [...snapshot.items, ...extra], [snapshot.items, extra]);

  useEffect(() => setCount(snapshot.counts.needsYou), [snapshot.counts.needsYou, setCount]);
  // The panel lives in the shell's right rail; publish it from the same snapshot as the rows (SC-004).
  useEffect(
    () => setPanel(<InboxPanel today={snapshot.today} policySummary={snapshot.policySummary} />),
    [setPanel, snapshot.today, snapshot.policySummary],
  );

  const load = useCallback(
    async (
      nextTab: Tab,
      nextProject: string,
      mode: 'initial' | 'refresh' | 'more',
      cursor?: string,
    ) => {
      setLoading(mode);
      setError(null);
      // Remember a focused row so focus can be restored to the tab list if the row disappears (never lost).
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      focusedRowBeforeRefresh.current = active && active.closest('.cd-list') ? active : null;
      try {
        const qs = new URLSearchParams({ tab: nextTab, project: nextProject });
        if (cursor) qs.set('cursor', cursor);
        const s = await apiFetch<InboxSnapshot>(`/api/inbox?${qs}`);
        if (mode === 'more') {
          setSnapshot((prev) => ({
            ...prev,
            counts: s.counts,
            today: s.today,
            nextCursor: s.nextCursor,
            generatedAt: s.generatedAt,
          }));
          setExtra((prev) => {
            focusNextRowIndex.current = snapshot.items.length + prev.length;
            return [...prev, ...s.items];
          });
        } else {
          setSnapshot(s);
          setExtra([]);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
          window.location.assign('/sign-in?reason=expired&next=/inbox');
          return;
        }
        setError("Couldn't load the Inbox.");
      } finally {
        setLoading(null);
      }
    },
    [snapshot.items.length],
  );

  // Coming back from a record stub: put focus on the selected tab (ui-inbox-screen.md §6).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('focus') !== 'tabs') return;
    url.searchParams.delete('focus');
    window.history.replaceState(null, '', url);
    tablistRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
  }, []);

  // Freshness: refetch the current scope on any inbox.changed notification (debounced in the stream helper).
  useEffect(() => {
    return subscribeInboxStream({ onChange: () => void load(tab, project, 'refresh') });
  }, [load, tab, project]);

  // Focus management: first row of a newly loaded page; tab list when the focused row disappeared.
  useEffect(() => {
    if (focusNextRowIndex.current !== null) {
      const el =
        rowRefs.current[focusNextRowIndex.current]?.querySelector<HTMLAnchorElement>('a.cd-title');
      el?.focus();
      focusNextRowIndex.current = null;
    } else if (
      focusedRowBeforeRefresh.current &&
      !document.contains(focusedRowBeforeRefresh.current)
    ) {
      focusedRowBeforeRefresh.current = null;
      tablistRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
    }
  }, [items]);

  const onTab = (v: string) => {
    const next = v as Tab;
    setTab(next);
    updateUrl(next, project);
    void load(next, project, 'initial');
  };
  const onProject = (next: string) => {
    setProject(next);
    rememberProject(next);
    updateUrl(tab, next);
    void load(tab, next, 'initial');
  };
  const remaining = Math.max(0, snapshot.counts[tab] - items.length);
  const selectedProjectKey = me.projects.find((p) => p.id === project)?.key;
  const showSkeleton = loading === 'initial';

  const emptyNeedsYou =
    project === 'all' ? (
      <>
        Nothing needs you right now. See what is{' '}
        <Button variant="ghost" size="sm" onClick={() => onTab('running')}>
          Running
        </Button>
        .
      </>
    ) : (
      <>
        Nothing needs you in <strong>{selectedProjectKey ?? 'this project'}</strong>. Show{' '}
        <Button variant="ghost" size="sm" onClick={() => onProject('all')}>
          all projects
        </Button>
        .
      </>
    );

  const renderRow = (item: InboxItem, i: number) => {
    const ref = (el: HTMLDivElement | null) => {
      rowRefs.current[i] = el;
    };
    if (tab === 'needsYou')
      return <InboxRowNeedsYou key={item.workflowId} ref={ref} item={item} now={now} />;
    if (tab === 'running')
      return <InboxRowRunning key={item.workflowId} ref={ref} item={item} now={now} />;
    return <InboxRowDone key={item.workflowId} ref={ref} item={item} now={now} />;
  };

  return (
    <>
      <Topbar
        title="Inbox"
        actions={
          <NewRequirementButton canCreate={me.canCreateRequirement} userRole={me.user.role} />
        }
      />
      <PageMeta>
        <Field label="Project" htmlFor="inbox-project">
          <Select id="inbox-project" value={project} onChange={(e) => onProject(e.target.value)}>
            <option value="all">All projects</option>
            {me.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {me.organization.isDemo ? <Pill variant="neutral">demonstration data</Pill> : null}
      </PageMeta>
      {error ? (
        <Notice
          tone="error"
          action={
            <Button
              variant="ghost"
              onClick={() => void load(tab, project, showSkeleton ? 'initial' : 'refresh')}
            >
              Retry
            </Button>
          }
        >
          {error} Retry.
        </Notice>
      ) : null}
      <div ref={tablistRef}>
        <Tabs id={tabsId} label="Inbox" value={tab} onChange={onTab}>
          <TabButton value="needsYou" count={snapshot.counts.needsYou}>
            {TAB_LABEL.needsYou}
          </TabButton>
          <TabButton value="running" count={snapshot.counts.running}>
            {TAB_LABEL.running}
          </TabButton>
          <TabButton value="done" count={snapshot.counts.done}>
            {TAB_LABEL.done}
          </TabButton>
        </Tabs>
      </div>
      {(['needsYou', 'running', 'done'] as Tab[]).map((t) => (
        <TabPanel key={t} value={t} current={tab} tabsId={tabsId}>
          <List
            loading={loading !== null}
            aria-label={TAB_LABEL[t]}
            empty={showSkeleton ? undefined : t === 'needsYou' ? emptyNeedsYou : EMPTY[t]}
          >
            {showSkeleton ? null : items.map(renderRow)}
          </List>
          {!showSkeleton && snapshot.nextCursor ? (
            <p>
              <Button
                variant="ghost"
                loading={loading === 'more'}
                onClick={() => void load(tab, project, 'more', snapshot.nextCursor!)}
              >
                Load more ({remaining} remaining)
              </Button>
            </p>
          ) : null}
        </TabPanel>
      ))}
    </>
  );
}
