import type { Metadata } from 'next';
import { Card, Notice, Topbar } from '../../../../lib/ds';
import { getMe } from '../../../../lib/session';

export const metadata: Metadata = { title: 'New requirement' };
export const dynamic = 'force-dynamic';

/** Target of the Inbox's primary action (FR-002); the creation flow itself arrives with specs/001 US4. */
export default async function NewRequirementPlaceholder() {
  const me = (await getMe())!;
  return (
    <>
      <Topbar title="New requirement" />
      {!me.canCreateRequirement ? (
        <Notice tone="info">
          Your role ({me.user.role}) cannot create requirements. Ask an administrator if you need
          this.
        </Notice>
      ) : null}
      <Card>
        <p>
          Requirement creation arrives with specs/001. For now, new work enters through the
          ingestion API.
        </p>
      </Card>
    </>
  );
}
