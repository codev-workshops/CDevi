'use client';

import type { Me, ReviewListItem, ReviewListResponse } from '@cdevi/contracts';
import {
  PULL_REQUEST_STATUSES,
  pullRequestStatusWord,
  reviewStatusWord,
  type PullRequestStatus,
} from '@cdevi/contracts/review-model';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, reviewsPath, type ReviewsQuery } from '../../../lib/api';
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
  Select,
  Topbar,
  type PillVariant,
} from '../../../lib/ds';
import { humanAgo } from '../../../lib/format';
import { subscribeInboxStream } from '../../../lib/inbox-stream';
import { appendPage, meta, plural, redirectIfExpired } from '../../../lib/list-screen';
import { PROJECT_COOKIE } from '../../../lib/navigation';

export interface ReviewsScreenProps {
  me: Me;
  initial: ReviewListResponse;
  /** Server render time (ISO) used as the reference for relative times. */
  now: string;
  project?: string;
  state?: PullRequestStatus | undefined;
}

type LoadMode = 'filter' | 'refresh' | 'more';

const REFETCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;

const REVIEW_PILL: Record<NonNullable<ReviewListItem['reviewStatus']>, PillVariant> = {
  RUNNING: 'run',
  COMPLETE: 'done',
  FAILED: 'fail',
};

function updateUrl(q: ReviewsQuery) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('project', q.project);
  if (q.state) url.searchParams.set('state', q.state);
  else url.searchParams.delete('state');
  url.searchParams.delete('cursor');
  window.history.replaceState(null, '', url);
}

function rememberProject(project: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(project)}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
}

/** One pull request under review (US6 AS-1): PR link, review status word, findings and the FR-022 marker — never hidden. */
function ReviewRow({ row, now }: { row: ReviewListItem; now: Date }) {
  const updated = new Date(row.updatedAt);
  return (
    <ListRow
      title={`#${row.number} ${row.title}`}
      href={row.reviewHref}
      trailing={
        <>
          {row.reviewStatus ? (
            <Pill variant={REVIEW_PILL[row.reviewStatus]} pulse={row.reviewStatus === 'RUNNING'}>
              {reviewStatusWord(row.reviewStatus)}
            </Pill>
          ) : (
            <Pill variant="neutral">no review yet</Pill>
          )}
          {row.readyForMerge ? null : <Pill variant="blocked">Not ready for merge</Pill>}
        </>
      }
      meta={meta([
        <Mono key="ext">{row.externalId}</Mono>,
        row.project.key,
        pullRequestStatusWord(row.status),
        <a key="wf" href={row.workflow.href}>
          {row.workflow.name}
        </a>,
        plural(row.openFindingsCount, 'open finding'),
        row.blockingOpenCount > 0 ? `${row.blockingOpenCount} blocking` : null,
        <time key="at" dateTime={row.updatedAt} title={updated.toISOString()}>
          updated {humanAgo(updated, now)}
        </time>,
      ])}
    />
  );
}

/** Reviews list (specs/001 US6; UI spec §20): bounded `GET /api/reviews` scoped to the remembered project. */
export function ReviewsScreen({ me, initial, now, project = 'all', state }: ReviewsScreenProps) {
  const [page, setPage] = useState<ReviewListResponse>(initial);
  const [query, setQuery] = useState<ReviewsQuery>({ project, state });
  const [loading, setLoading] = useState<LoadMode | null>(null);
  const [error, setError] = useState<LoadMode | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [fetchedAt, setFetchedAt] = useState(now);
  const requestSeq = useRef(0);
  const moreRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const reference = new Date(fetchedAt);

  const load = useCallback(
    async (q: ReviewsQuery, mode: LoadMode, cursor: string | null = null) => {
      const seq = ++requestSeq.current;
      setLoading(mode);
      setError(null);
      try {
        const next = await apiFetch<ReviewListResponse>(reviewsPath(cursor ? { ...q, cursor } : q));
        if (seq !== requestSeq.current) return;
        setFetchedAt(new Date().toISOString());
        if (mode === 'more') {
          const added = next.items.slice(0, PAGE_SIZE);
          setAnnouncement(`${added.length} more loaded`);
          setPage((prev) => appendPage(prev, next, added));
        } else {
          setAnnouncement('');
          setPage(next);
        }
      } catch (e) {
        if (seq !== requestSeq.current) return;
        if (redirectIfExpired(e, '/reviews')) return;
        setError(mode);
      } finally {
        if (seq === requestSeq.current) setLoading(null);
      }
    },
    [],
  );

  useEffect(
    () =>
      subscribeInboxStream({
        debounceMs: REFETCH_DEBOUNCE_MS,
        onChange: () => void load(query, 'refresh'),
        onStatus: setConnected,
      }),
    [load, query],
  );

  // After "Load more": stay on the button while pages remain, otherwise land on the summary.
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current || loading !== null) return;
    pendingFocus.current = false;
    if (page.nextCursor) moreRef.current?.focus();
    else summaryRef.current?.focus();
  }, [loading, page.nextCursor]);

  const applyQuery = (next: ReviewsQuery) => {
    setQuery(next);
    updateUrl(next);
    void load(next, 'filter');
  };

  const onProject = (p: string) => {
    rememberProject(p);
    applyQuery({ ...query, project: p });
  };

  const onMore = () => {
    if (!page.nextCursor) return;
    pendingFocus.current = true;
    void load(query, 'more', page.nextCursor);
  };

  const filtered = query.project !== 'all' || query.state !== undefined;
  const empty = page.items.length === 0 && loading !== 'filter';

  return (
    <>
      <Topbar title="Reviews" />
      <PageMeta>
        <Field label="Project" htmlFor="reviews-project">
          <Select
            id="reviews-project"
            value={query.project}
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
        <Field label="Pull request state" htmlFor="reviews-state">
          <Select
            id="reviews-state"
            value={query.state ?? ''}
            onChange={(e) =>
              applyQuery({
                ...query,
                state: PULL_REQUEST_STATUSES.find((s) => s === e.target.value),
              })
            }
          >
            <option value="">Any state</option>
            {PULL_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {pullRequestStatusWord(s)}
              </option>
            ))}
          </Select>
        </Field>
        <span>
          Updated <time dateTime={fetchedAt}>{humanAgo(reference, reference)}</time>
        </span>
        <Pill variant="neutral" pulse={loading === 'refresh'}>
          {connected === false ? 'reconnecting' : 'live'}
        </Pill>
      </PageMeta>
      <p>
        <Mono ref={summaryRef} tabIndex={-1}>
          {plural(page.items.length, 'pull request')}
          {page.nextCursor ? ' shown · more available' : ''}
          {filtered ? ' · filtered' : ''}
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
                  : void load(query, error === 'refresh' ? 'refresh' : 'filter')
              }
            >
              Retry
            </Button>
          }
        >
          Couldn&apos;t load pull requests under review.
        </Notice>
      ) : null}
      {empty && !error ? (
        <Notice
          tone="info"
          action={
            query.state ? (
              <Button variant="ghost" onClick={() => applyQuery({ ...query, state: undefined })}>
                Clear filters
              </Button>
            ) : undefined
          }
        >
          No pull requests under review{filtered ? ' match these filters' : ' yet'}. Pull requests
          appear here when the agent runtime reports them.
        </Notice>
      ) : (
        <List aria-label="Pull requests under review" loading={loading !== null}>
          {page.items.map((row) => (
            <ReviewRow key={row.id} row={row} now={reference} />
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
