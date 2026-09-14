import { Card, Topbar } from '../../../lib/ds';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PLACEHOLDER_SECTIONS } from '../../../lib/navigation';

type Params = Promise<{ section: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { section } = await params;
  return { title: PLACEHOLDER_SECTIONS[section] ?? 'Not found' };
}

/** Placeholder for the specs/001 screens that are not built yet (ui-inbox-screen.md §5). No saffron button. */
export default async function SectionPlaceholder({ params }: { params: Params }) {
  const { section } = await params;
  const label = PLACEHOLDER_SECTIONS[section];
  if (!label) notFound();
  return (
    <>
      <Topbar title={label} />
      <Card>
        <p>This screen arrives with specs/001. The Inbox is the home page for now.</p>
      </Card>
    </>
  );
}
