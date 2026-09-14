'use client';

import type { InboxSnapshot, TodaySummary } from '@cdevi/contracts';
import { Card, KeyValue, PanelBlock } from '@cdevi/design-system';

/** Right rail: Today counts (each a link) and the one-line workspace policy (FR-017, FR-018). */
export function InboxPanel({
  today,
  policySummary,
}: {
  today: TodaySummary;
  policySummary: InboxSnapshot['policySummary'];
}) {
  const link = (c: { value: number; href: string }) => <a href={c.href}>{c.value}</a>;
  return (
    <>
      <PanelBlock title="Today">
        <KeyValue
          items={[
            { term: 'Runs started', detail: link(today.workflowsStarted) },
            { term: 'Completed', detail: link(today.workflowsCompleted) },
            { term: 'Approvals decided', detail: link(today.approvalsDecided) },
            { term: 'Needs you', detail: link(today.needsYou) },
          ]}
        />
      </PanelBlock>
      <PanelBlock title="Workspace policy">
        <Card>
          <p>{policySummary.text}</p>
          <p>
            <a href={policySummary.href}>Policies</a>
          </p>
        </Card>
      </PanelBlock>
    </>
  );
}
