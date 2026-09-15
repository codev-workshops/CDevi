'use client';

import type { Me, Requirement, RequirementListPage } from '@cdevi/contracts';
import {
  REQUIREMENTS_PAGE_SIZE,
  REQUIREMENT_STATES,
  REQUIREMENT_STATE_WORDS,
  isSafeExternalUrl,
  type RequirementState,
} from '@cdevi/contracts/requirement-rules';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import {
  Button,
  Field,
  Help,
  List,
  ListRow,
  Mono,
  Notice,
  PageMeta,
  Pill,
  RequirementStatePill,
  Select,
  StatePill,
  Topbar,
} from '../../../lib/ds';
import { humanAgo } from '../../../lib/format';
import { subscribeInboxStream } from '../../../lib/inbox-stream';
import { PROJECT_COOKIE } from '../../../lib/navigation';

export interface RequirementsListScreenProps {
  me: Me;
  initial: RequirementListPage;
}

/** Filter values as they appear in the selects (`''` = not set). */
interface Filters {
  project: string;
  state: RequirementState | '';
  assignee: string;
}

type LoadMode = 'filter' | 'refresh' | 'more';

const REFETCH_DEBOUNCE_MS = 300;

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function filtersFromPage(page: RequirementListPage): Filters {
  return {
    project: page.project,
    state: page.filters.state[0] ?? '',
    assignee: page.filters.assignee ?? '',
  };
}

function query(f: Filters, cursor?: string | null): string {
  const qs = new URLSearchParams({ project: f.project });
  if (f.state) qs.set('state', f.state);
  if (f.assignee) qs.set('assignee', f.assignee);
  if (cursor) qs.set('cursor', cursor);
  return qs.toString();
}

function updateUrl(f: Filters) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('project', f.project);
  if (f.state) url.searchParams.set('state', f.state);
  else url.searchParams.delete('state');
  if (f.assignee) url.searchParams.set('assignee', f.assignee);
  else url.searchParams.delete('assignee');
  url.searchParams.delete('cursor');
  window.history.replaceState(null, '', url);
}

function rememberProject(project: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(project)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
}

type AssigneeOption = readonly [id: string, name: string];

function mergeAssignees(prev: AssigneeOption[], rows: Requirement[]): AssigneeOption[] {
  const byId = new Map<string, string>(prev);
  for (const r of rows) if (r.assignee) byId.set(r.assignee.id, r.assignee.name);
  return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function workflowName(wf: NonNullable<Requirement['workflow']>): string {
  return wf.stage
    ? `Workflow ${wf.externalId}, stage ${wf.stage.index} of ${wf.stage.count}`
    : `Workflow ${wf.externalId}`;
}

/** One requirement (ui-requirements.md §2.4): state word, linked workflow state, Jira link and flag. */
function RequirementRow({ row, now }: { row: Requirement; now: Date }) {
  const created = new Date(row.createdAt);
  const jira = row.externalRef && isSafeExternalUrl(row.externalRef.url) ? row.externalRef : null;
  return (
    <ListRow
      title={row.title}
      href={row.href}
      trailing={
        <>
          <RequirementStatePill state={row.state} />
          {row.workflow ? (
            <a href={row.workflow.href} aria-label={workflowName(row.workflow)}>
              <StatePill state={row.workflow.state} />
            </a>
          ) : null}
          {jira ? (
            <a
              href={jira.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${jira.key} in Jira (opens in a new tab)`}
            >
              <Mono>{jira.key}</Mono>
            </a>
          ) : null}
          {row.externalFlag ? <Pill variant="blocked">Jira {row.externalFlag}</Pill> : null}
        </>
      }
      meta={meta([
        <Mono key="ext">{row.externalId}</Mono>,
        row.project.key,
        row.assignee?.name ?? 'Unassigned',
        <time key="at" dateTime={row.createdAt} title={created.toISOString()}>
          created {humanAgo(created, now)}
        </time>,
        row.openQuestionCount > 0 ? plural(row.openQuestionCount, 'open question') : null,
      ])}
    />
  );
}

/** Requirements list (specs/001 US4 scenario 5; ui-requirements.md §2/§5.1). Rows are in API order. */
export function RequirementsListScreen({ me, initial }: RequirementsListScreenProps) {
  const [page, setPage] = useState<RequirementListPage>(initial);
  const [filters, setFilters] = useState<Filters>(() => filtersFromPage(initial));
  const [loading, setLoading] = useState<LoadMode | null>(null);
  const [error, setError] = useState<LoadMode | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  // The wall clock is read only after mount so server and client render the same "Updated" label.
  const [clock, setClock] = useState<Date | null>(null);
  // Assignees seen in any page so far: filtering by one person must not hide the others from the select.
  const [assignees, setAssignees] = useState<AssigneeOption[]>(() =>
    mergeAssignees([], initial.items),
  );
  const requestSeq = useRef(0);
  const moreRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const helpId = useId();
  const now = useMemo(() => new Date(page.generatedAt), [page.generatedAt]);

  const load = useCallback(async (f: Filters, mode: LoadMode, cursor: string | null = null) => {
    const seq = ++requestSeq.current;
    setLoading(mode);
    setError(null);
    try {
      const next = await apiFetch<RequirementListPage>(`/api/requirements?${query(f, cursor)}`);
      if (seq !== requestSeq.current) return;
      setAssignees((prev) => mergeAssignees(prev, next.items));
      if (mode === 'more') {
        const added = next.items.slice(0, REQUIREMENTS_PAGE_SIZE);
        setAnnouncement(`${added.length} more loaded`);
        setPage((prev) => {
          const seen = new Set(prev.items.map((r) => r.id));
          return { ...next, items: [...prev.items, ...added.filter((r) => !seen.has(r.id))] };
        });
      } else {
        setAnnouncement('');
        setPage(next);
      }
    } catch (e) {
      if (seq !== requestSeq.current) return;
      if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined') {
        window.location.assign('/sign-in?reason=expired&next=/requirements');
        return;
      }
      setError(mode);
    } finally {
      if (seq === requestSeq.current) setLoading(null);
    }
  }, []);

  useEffect(
    () =>
      subscribeInboxStream({
        debounceMs: REFETCH_DEBOUNCE_MS,
        onChange: () => void load(filters, 'refresh'),
        onStatus: setConnected,
      }),
    [load, filters],
  );

  useEffect(() => {
    const tick = () => setClock(new Date());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  // After "Load more": stay on the button while pages remain, otherwise land on the summary (never <body>).
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current || loading !== null) return;
    pendingFocus.current = false;
    if (page.nextCursor) moreRef.current?.focus();
    else summaryRef.current?.focus();
  }, [loading, page.nextCursor]);

  const applyFilters = (next: Filters) => {
    setFilters(next);
    updateUrl(next);
    void load(next, 'filter');
  };

  const onProject = (project: string) => {
    rememberProject(project);
    applyFilters({ ...filters, project });
  };

  const onMore = () => {
    if (!page.nextCursor) return;
    pendingFocus.current = true;
    void load(filters, 'more', page.nextCursor);
  };

  const clearFilters = () => applyFilters({ ...filters, state: '', assignee: '' });

  const filtered = filters.project !== 'all' || filters.state !== '' || filters.assignee !== '';
  const assigneeKnown =
    filters.assignee === '' ||
    filters.assignee === 'me' ||
    filters.assignee === 'unassigned' ||
    assignees.some(([id]) => id === filters.assignee);

  const empty = page.items.length === 0 && loading !== 'filter';
  const roleWord = me.user.role;

  return (
    <>
      <Topbar
        title="Requirements"
        actions={
          me.canCreateRequirement ? (
            <Button variant="primary" href="/requirements/new">
              New requirement
            </Button>
          ) : (
            <>
              <Button variant="primary" href="/requirements/new" disabled aria-describedby={helpId}>
                New requirement
              </Button>
              <Help id={helpId}>Your role ({roleWord}) cannot create requirements</Help>
            </>
          )
        }
      />
      <PageMeta>
        <Field label="Project" htmlFor="requirements-project">
          <Select
            id="requirements-project"
            value={filters.project}
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
        <Field label="State" htmlFor="requirements-state">
          <Select
            id="requirements-state"
            value={filters.state}
            onChange={(e) =>
              applyFilters({ ...filters, state: e.target.value as RequirementState | '' })
            }
          >
            <option value="">Any state</option>
            {REQUIREMENT_STATES.map((s) => (
              <option key={s} value={s}>
                {REQUIREMENT_STATE_WORDS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assignee" htmlFor="requirements-assignee">
          <Select
            id="requirements-assignee"
            value={filters.assignee}
            onChange={(e) => applyFilters({ ...filters, assignee: e.target.value })}
          >
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
            {assignees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {assigneeKnown ? null : <option value={filters.assignee}>Selected assignee</option>}
          </Select>
        </Field>
        <span>
          Updated{' '}
          <time dateTime={page.generatedAt} title={now.toISOString()}>
            {clock ? humanAgo(now, clock) : 'just now'}
          </time>
        </span>
        <Pill variant="neutral" pulse={loading === 'refresh'}>
          {connected === false ? 'reconnecting' : 'live'}
        </Pill>
      </PageMeta>
      <p>
        <Mono ref={summaryRef} tabIndex={-1}>
          {page.items.length} of {page.total} requirements{filtered ? ' · filtered' : ''}
        </Mono>
      </p>
      <Help aria-live="polite">{announcement}</Help>
      {error ? (
        <Notice
          tone="error"
          action={
            <Button
              variant="ghost"
              onClick={() =>
                error === 'more'
                  ? onMore()
                  : void load(filters, error === 'refresh' ? 'refresh' : 'filter')
              }
            >
              Retry
            </Button>
          }
        >
          Requirements couldn&apos;t be loaded.
        </Notice>
      ) : null}
      {empty && !error ? (
        filtered && (filters.state !== '' || filters.assignee !== '') ? (
          <Notice
            tone="info"
            action={
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            No requirements match these filters.
          </Notice>
        ) : (
          <Notice
            tone="info"
            action={
              me.canCreateRequirement ? (
                <Button variant="primary" href="/requirements/new">
                  Create the first requirement
                </Button>
              ) : undefined
            }
          >
            No requirements yet.
          </Notice>
        )
      ) : (
        <List aria-label="Requirements" loading={loading !== null}>
          {page.items.map((row) => (
            <RequirementRow key={row.id} row={row} now={now} />
          ))}
        </List>
      )}
      {page.nextCursor && !empty ? (
        <Button ref={moreRef} variant="ghost" onClick={onMore} loading={loading === 'more'}>
          Load more
        </Button>
      ) : null}
    </>
  );
}
