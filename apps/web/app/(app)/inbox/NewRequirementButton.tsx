'use client';

import type { Role } from '@cdevi/contracts';
import { ActionBar, Button } from '@cdevi/design-system';
import { useId } from 'react';

const ROLE_LABEL: Record<Role, string> = {
  administrator: 'Administrator',
  approver: 'Approver',
  engineer: 'Engineer',
  viewer: 'Viewer',
};

/** The single saffron action of the Inbox (DR-02, FR-002). Disabled with an explanation for roles that may not create requirements. */
export function NewRequirementButton({
  canCreate,
  userRole,
}: {
  canCreate: boolean;
  userRole: Role;
}) {
  const helpId = useId();
  if (canCreate) {
    return (
      <Button variant="saffron" href="/requirements/new">
        New requirement
      </Button>
    );
  }
  return (
    <ActionBar
      help={<span id={helpId}>Your role ({ROLE_LABEL[userRole]}) cannot create requirements.</span>}
    >
      <Button variant="saffron" href="/requirements/new" disabled aria-describedby={helpId}>
        New requirement
      </Button>
    </ActionBar>
  );
}
