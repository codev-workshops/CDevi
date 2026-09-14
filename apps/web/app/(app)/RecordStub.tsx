'use client';

import type { RecordView } from '@cdevi/contracts';
import {
  Button,
  Card,
  KeyValue,
  Mono,
  Notice,
  PageMeta,
  Pill,
  RiskBadge,
  StatePill,
  Topbar,
} from '@cdevi/design-system';
import { Fragment, type ReactNode } from 'react';
import { askSegments, expiryLabel, humanAgo } from '../../lib/format';

const WHERE: Record<'approvals' | 'workflows', string> = {
  approvals: 'the Approval Center',
  workflows: 'Workflow Detail',
};

/** Read-only facts behind a row until specs/001 delivers the real screens (research R9, ui-inbox-screen.md §4). */
export function RecordStub({
  view,
  kind,
  backHref,
  now,
}: {
  view: RecordView;
  kind: 'approvals' | 'workflows';
  backHref: string;
  now: string;
}) {
  const { item, resolution } = view;
  const at = new Date(now);
  const items: ({ term: string; detail: ReactNode } | null)[] = [
    item.ask
      ? {
          term:
            item.kind === 'clarification'
              ? 'Question'
              : item.kind === 'approval'
                ? 'Ask'
                : 'Reason',
          detail: (
            <>
              {askSegments(item.ask).map((s, i) => (
                <Fragment key={i}>{s.mono ? <Mono>{s.text}</Mono> : s.text}</Fragment>
              ))}
            </>
          ),
        }
      : null,
    { term: 'Project', detail: item.project.key },
    item.agent ? { term: 'Agent', detail: item.agent } : null,
    {
      term: item.kind === 'approval' || item.kind === 'clarification' ? 'Requested' : 'Since',
      detail: humanAgo(new Date(item.raisedAt), at),
    },
    item.expiry
      ? { term: 'Expires', detail: expiryLabel(new Date(item.expiry.expiresAt), at) }
      : null,
    item.stage
      ? {
          term: 'Stage',
          detail: `${item.stage.index} of ${item.stage.count}${item.stage.name ? ` · ${item.stage.name}` : ''}`,
        }
      : null,
    item.pullRequestRef ? { term: 'Pull request', detail: item.pullRequestRef } : null,
    resolution
      ? {
          term: 'Resolved',
          detail: `${resolution.outcome} by ${resolution.by ?? 'unknown'} · ${humanAgo(new Date(resolution.at), at)}`,
        }
      : null,
  ];
  const shown = items.filter((x) => x !== null);

  return (
    <>
      <Topbar title={item.title} />
      <PageMeta>
        <StatePill state={item.state} />
        {item.riskLevel ? <RiskBadge level={item.riskLevel} /> : null}
        {resolution ? <Pill variant="neutral">resolved</Pill> : null}
        {item.project.key}
        {item.agent}
      </PageMeta>
      <Notice tone="info">
        Decisions for this item are made in {WHERE[kind]}, which arrives with specs/001. Nothing can
        be approved, rejected or answered here.
      </Notice>
      <Card>
        <KeyValue items={shown} />
      </Card>
      <p>
        <Button variant="ghost" href={backHref}>
          Back to Inbox
        </Button>{' '}
        {kind === 'approvals' ? (
          <Button variant="ghost" href={`/workflows/${encodeURIComponent(item.workflowId)}`}>
            Open workflow
          </Button>
        ) : null}
      </p>
    </>
  );
}
