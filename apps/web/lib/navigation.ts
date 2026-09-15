/** Primary navigation per specs/001 §41; only Inbox is real in specs/003, the rest are placeholders. */
export interface NavEntry {
  href: string;
  label: string;
  group?: 'Administration';
}

export const NAV_ITEMS: readonly NavEntry[] = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/projects', label: 'Projects' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/requirements', label: 'Requirements' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/testing', label: 'Testing' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/agents', label: 'Agents' },
  { href: '/integrations', label: 'Integrations', group: 'Administration' },
  { href: '/policies', label: 'Policies', group: 'Administration' },
  { href: '/audit', label: 'Audit', group: 'Administration' },
];

/** Sections that have their own route (specs/001 US1, US3, US4, US6); everything else is the `[section]` placeholder. */
const BUILT_SECTIONS: ReadonlySet<string> = new Set([
  '/inbox',
  '/dashboard',
  '/requirements',
  '/reviews',
]);

export const PLACEHOLDER_SECTIONS: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.filter((n) => !BUILT_SECTIONS.has(n.href)).map((n) => [n.href.slice(1), n.label]),
);

export const PROJECT_COOKIE = 'cdevi_project';
