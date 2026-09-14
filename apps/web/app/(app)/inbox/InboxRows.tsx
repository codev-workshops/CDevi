'use client';

import type { InboxItem } from '@cdevi/contracts';
import { ListRow, Mono, Pill, RiskBadge, StatePill } from '@cdevi/design-system';
import { forwardRef, Fragment, type ReactNode } from 'react';
import { askSegments, expiryLabel, humanAgo, humanDuration } from '../../../lib/format';

interface RowProps {
  item: InboxItem;
  now: Date;
}

const Sep = () => <> · </>;

function Ask({ ask }: { ask: string }) {
  return (
    <>
      {askSegments(ask).map((s, i) => (
        <Fragment key={i}>{s.mono ? <Mono>{s.text}</Mono> : s.text}</Fragment>
      ))}
    </>
  );
}

function meta(parts: ReactNode[]): ReactNode {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== '');
  return shown.map((p, i) => (
    <Fragment key={i}>
      {i > 0 ? <Sep /> : null}
      {p}
    </Fragment>
  ));
}

/** Needs-you row: always a gate row (it carries the ask) — FR-007…FR-011. */
export const InboxRowNeedsYou = forwardRef<HTMLDivElement, RowProps>(function InboxRowNeedsYou(
  { item, now },
  ref,
) {
  const raised = new Date(item.raisedAt);
  const ageVerb = item.kind === 'blocked' ? 'blocked' : item.kind === 'failed' ? 'failed' : 'asked';
  return (
    <ListRow
      ref={ref}
      title={item.title}
      href={item.href}
      trailing={
        <>
          <StatePill state={item.state} />
          {item.riskLevel ? <RiskBadge level={item.riskLevel} /> : null}
          {item.isStale ? <Pill variant="neutral">stale</Pill> : null}
          {item.expiry?.isExpired ? <Pill variant="neutral">expired</Pill> : null}
          {item.hasRecommendedAnswer ? <Pill variant="neutral">recommended answer</Pill> : null}
        </>
      }
      ask={<Ask ask={item.ask ?? ''} />}
      meta={meta([
        item.project.key,
        item.agent,
        `${ageVerb} ${humanAgo(raised, now)}`,
        item.expiry && !item.expiry.isExpired
          ? expiryLabel(new Date(item.expiry.expiresAt), now)
          : null,
      ])}
    />
  );
});

/** Running row — FR-014. */
export const InboxRowRunning = forwardRef<HTMLDivElement, RowProps>(function InboxRowRunning(
  { item, now },
  ref,
) {
  const stage = item.stage
    ? `stage ${item.stage.index} of ${item.stage.count}${item.stage.name ? ` · ${item.stage.name}` : ''}`
    : null;
  const elapsed = item.startedAt
    ? humanDuration(now.getTime() - new Date(item.startedAt).getTime())
    : `queued ${humanAgo(new Date(item.raisedAt), now)}`;
  return (
    <ListRow
      ref={ref}
      title={item.title}
      href={item.href}
      trailing={<StatePill state={item.state} />}
      meta={meta([item.project.key, item.agent, stage, elapsed])}
    />
  );
});

/** Done row — FR-015. */
export const InboxRowDone = forwardRef<HTMLDivElement, RowProps>(function InboxRowDone(
  { item, now },
  ref,
) {
  const finished = item.finishedAt
    ? `${item.state === 'CANCELLED' ? 'cancelled' : 'completed'} ${humanAgo(new Date(item.finishedAt), now)}`
    : null;
  return (
    <ListRow
      ref={ref}
      title={item.title}
      href={item.href}
      trailing={<StatePill state={item.state} />}
      meta={meta([item.project.key, item.agent, finished, item.pullRequestRef])}
    />
  );
});
