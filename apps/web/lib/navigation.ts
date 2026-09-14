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

export const PLACEHOLDER_SECTIONS: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.filter((n) => n.href !== '/inbox').map((n) => [n.href.slice(1), n.label]),
);

export const PROJECT_COOKIE = 'cdevi_project';
