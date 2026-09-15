import type { AgentRunDetail } from '@cdevi/contracts';
import type { Metadata } from 'next';
import { Button, Notice, Topbar } from '../../../../../lib/ds';
import { getAgentRunDetail } from '../../../../../lib/session';
import { AgentRunScreen } from './AgentRunScreen';

export const metadata: Metadata = { title: 'Agent run' };
export const dynamic = 'force-dynamic';

/** Agent Run Inspector (specs/001 US5, ui-agent-run.md §1). 400/403/404/5xx all render the same notice (§5.5). */
export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run: AgentRunDetail | null = null;
  try {
    run = await getAgentRunDetail(id);
  } catch {
    run = null;
  }
  if (!run) {
    return (
      <>
        <Topbar title="Agent run" />
        <Notice tone="error">This item isn&apos;t available to you.</Notice>
        <p>
          <Button variant="ghost" href="/workflows">
            Back to Workflows
          </Button>
        </p>
      </>
    );
  }
  return <AgentRunScreen initial={run} now={new Date().toISOString()} />;
}
