# Feature Specification: Inbox Home Page

**Feature Branch**: `003-inbox-home`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "refer the packages/design-system/reference-screens/inbox.html which is a reference screen named as inbox. this is the home page of the CDevi app I want to build, something similar but in a MVP scope the feature is very minimal."

**Source material**: `packages/design-system/reference-screens/inbox.html` (pattern reference only), `specs/001-sdlc-control-plane-mvp/spec.md` (states, risk levels, entities, navigation), `packages/design-system/DESIGN.md`, `.specify/memory/constitution.md`

## Overview

The **Inbox** is the first screen a signed-in CDevi user sees. It answers one question before anything else: **"What needs me right now?"** It lists every workflow that is waiting for a human — approvals, clarification questions, blocked stages and failures awaiting retry or cancellation — with the exact question being asked, so that a reviewer can decide what to open first without visiting each workflow. Beneath the decisions, the Inbox shows work that is currently running and work that has recently finished, plus a small summary of today's activity.

This feature deliberately delivers a **minimal** version of the reference pattern: a prioritised list, three tabs, one primary action and a compact side panel, together with the first persisted workflow, approval and clarification records and the read services that supply them. It does not replace the Dashboard, Approval Center or Workflow Detail defined in `specs/001`; it is the front door that routes people to them. Concepts visible in the reference page that are not CDevi product features (personal API keys, laptop vs cloud runtime, per-run dollar budgets, linked laptops) are **excluded**.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See what needs me, decide what to open first (Priority: P1)

A reviewer, tech lead or product manager signs in and lands on the Inbox. The **Needs you** tab is selected. Each row is one workflow that is waiting for a human and shows: the workflow title, a "needs you", "blocked" or "failed" state word, the exact request in one line ("Approve: open a pull request against `main`", "Question: keep the legacy `/session/v1` endpoint during migration?", "Blocked: issue tracker unreachable", "Failed at Testing: 3 unit tests failing"), its risk level when the request is an approval, the project and agent, how long ago it was asked, and — when the request will expire — how long remains. Rows are ordered so the most urgent decision is on top. Selecting a row opens the place where the decision is made.

**Why this priority**: Human-in-the-loop is CDevi's defining principle; a blocked workflow creates no value until a person acts. Making every pending decision visible from the home page, with enough context to triage, is the core value of this feature and is independently useful even with nothing else on the page.

**Independent Test**: Seed two approvals (one MEDIUM risk asked 4 minutes ago with a 4-hour expiry, one HIGH risk asked 40 minutes ago), one clarification with a recommended answer, one blocked stage and one failed workflow. Open the Inbox: all five appear under **Needs you** with the correct state words, asks, risk badges and ordering (HIGH approval first, then MEDIUM, then the risk-less items oldest first); selecting each row lands on the correct target.

**Acceptance Scenarios**:

1. **Given** at least one workflow is in `WAITING_FOR_HUMAN`, `BLOCKED` or `FAILED`, **When** the user opens the Inbox, **Then** the **Needs you** tab is selected by default and shows one row per such workflow, none collapsed or hidden.
2. **Given** a row represents an approval request, **When** the user reads the row, **Then** it shows the state word "needs you", the requested action as a one-line ask, the risk level as a labelled badge (HIGH and CRITICAL visually prominent), the project, the requesting agent, the time since it was asked, and the time remaining before it expires if an expiry exists.
3. **Given** a row represents a clarification question, **When** the user reads the row, **Then** it shows the state word "needs you", the question text as the ask, the project, the agent, the time since it was asked, and an indicator when a recommended answer is available.
4. **Given** a row represents a blocked stage, **When** the user reads the row, **Then** it shows the state word "blocked" (distinct from "failed"), the blocking reason as the ask, the project and the time since it became blocked.
5. **Given** a row represents a failed workflow, **When** the user reads the row, **Then** it shows the state word "failed", the failure reason and the stage that failed as the ask, the project, the agent and the time since it failed.
6. **Given** several items need a human, **When** the list is displayed, **Then** items are ordered by risk level (CRITICAL, HIGH, MEDIUM, LOW, then items without a risk level — blocked, failed and clarifications) and, within the same level, oldest first.
7. **Given** the user selects a row, **When** the selection is made by pointer or keyboard, **Then** the user is taken to the screen where the request is resolved (the Approval Center item for approvals and clarifications; the Workflow Detail for blocked and failed workflows).
8. **Given** nothing needs a human, **When** the user opens the Inbox, **Then** the **Needs you** tab shows an empty state stating that nothing is waiting on them and pointing to the **Running** tab.
9. **Given** an item has been waiting for more than 24 hours, **When** it is displayed, **Then** it is flagged as stale in its row and remains in the list; it is never auto-resolved.

---

### User Story 2 - See running and recently finished work (Priority: P2)

The same user switches to the **Running** tab to see workflows an agent is currently working on (title, "running" state word, project, agent, current stage and elapsed time), and to the **Done** tab to see workflows that finished recently (title, terminal state word — completed or cancelled — project, agent, when it finished and the pull request reference when one exists). Each tab label shows its item count.

**Why this priority**: After "what needs me", the next supervision questions are "what is the AI doing" and "what just finished". This gives the home page a complete picture without the depth of the Workflow Center, but the P1 list is valuable on its own.

**Independent Test**: Seed three running workflows at different stages and five finished workflows (four completed, one cancelled). The **Running** tab shows "3" and lists the three with stage and elapsed time; the **Done** tab shows "5" and lists the five with the correct terminal state words, newest first; selecting any row opens its Workflow Detail.

**Acceptance Scenarios**:

1. **Given** workflows exist in `RUNNING`, `RETRYING`, `WAITING` or `QUEUED`, **When** the user selects the **Running** tab, **Then** each appears as a row showing title, its exact state word, project, agent, current stage (e.g. "stage 2 of 7 · Implementation") and elapsed time, ordered most recently started first.
2. **Given** workflows reached `COMPLETED` or `CANCELLED` within the last 7 days, **When** the user selects the **Done** tab, **Then** each appears as a row showing title, its terminal state word (cancelled shown struck through), project, agent, time finished and the pull request reference when one exists, ordered most recently finished first.
3. **Given** the Inbox is open, **When** the tabs are displayed, **Then** each tab label carries the current count of items in that tab, and the **Needs you** count matches the pending count shown beside the Inbox entry in the navigation.
4. **Given** a tab has no items, **When** it is selected, **Then** a short empty state explains that there is nothing in that category.
5. **Given** the user uses only a keyboard, **When** they move between tabs and rows, **Then** the focused element is always visibly indicated and tabs follow standard arrow-key/Enter behaviour.

---

### User Story 3 - Start new work from the home page (Priority: P3)

A product manager or engineer wants to bring new work into CDevi. The Inbox carries exactly one primary action, **New requirement**, which takes them to the requirement creation flow.

**Why this priority**: It completes the home page as an entry point for both supervising and starting work, but it depends on the requirement-creation flow from `specs/001` and adds no value until that flow exists.

**Independent Test**: With a user who may create requirements, the primary action is present and enabled and opens requirement creation; with a Viewer, the action is disabled with an explanation on focus/hover.

**Acceptance Scenarios**:

1. **Given** the signed-in user may create requirements (Engineer, Approver or Administrator), **When** they activate **New requirement**, **Then** they are taken to the requirement creation flow.
2. **Given** the signed-in user is a Viewer, **When** they view the Inbox, **Then** **New requirement** is visible but disabled and explains that their role cannot create requirements.
3. **Given** the Inbox is displayed, **When** its controls are inspected, **Then** **New requirement** is the only primary (saffron) action on the screen.

---

### User Story 4 - See today's numbers at a glance (Priority: P3)

The right-hand panel shows a **Today** block with a handful of counts for the current day — workflows started, workflows completed, approvals decided, items currently needing a human — and a one-line reminder of the workspace's autonomy policy (e.g. "Pull request merges and all HIGH/CRITICAL actions require human approval.").

**Why this priority**: It mirrors the reference pattern's "day's numbers and a one-line reminder of policy" and helps leaders sense the day's activity, but the list is complete without it.

**Independent Test**: Seed activity for today (9 started, 5 completed, 3 approvals decided, 2 needing a human). The **Today** block shows those four figures and the policy line; each figure links to the corresponding filtered list.

**Acceptance Scenarios**:

1. **Given** activity occurred today, **When** the user views the panel, **Then** the **Today** block shows counts of workflows started, workflows completed, approvals decided and items needing a human, each linking to the list behind it.
2. **Given** the organisation has default policies, **When** the user views the panel, **Then** a one-line plain-language summary of the current autonomy policy is shown and links to the Policies screen.
3. **Given** no activity occurred today, **When** the user views the panel, **Then** the counts show zero rather than being hidden.

---

### Edge Cases

- An item is resolved by another user while the Inbox is open: on the next refresh the row leaves **Needs you** (and appears in **Running** or **Done** as appropriate); if the user selects the row before that, the target screen shows who resolved it and with what outcome (per `specs/001` FR-015) rather than an error.
- More than 50 items exist in a tab: the list shows the first 50 in priority order and offers a way to load more; the tab count still shows the true total.
- Risk level is absent (clarifications, blocked stages, failed workflows): such items sort after items with a risk level but are never dropped.
- An ingestion write arrives for a workflow in a state that does not permit the transition (e.g. `COMPLETED` → `RUNNING`), or with an unknown risk level or project: the write is rejected with a reason and recorded as rejected; the Inbox is unaffected.
- Two ingestion writes for the same workflow arrive out of order: the later-timestamped state wins and the earlier one is recorded but does not overwrite it; the Inbox never shows a state older than the one it has already displayed.
- A failed workflow is retried: it leaves **Needs you** and appears under **Running** as "retrying" or "running"; if cancelled instead, it appears under **Done** as "cancelled".
- An approval's expiry has passed but the item is still pending: the row shows "expired" instead of a remaining time and stays in **Needs you**; nothing is auto-approved.
- The user has no permission to view some workflows: those items are excluded from the user's Inbox and from the counts they see.
- The session expires while the Inbox is open: the next data refresh fails with an authentication error, the user is returned to sign-in with a message, and after signing in lands back on the Inbox; no partial data is shown to an unauthenticated session.
- Data cannot be loaded: the list area shows an error state with a retry action; the navigation and primary action remain usable; no stale counts are presented as current.
- Very long titles or asks: text truncates on one line with the full text available (e.g. on hover/focus and in the target screen); rows keep a consistent height.
- Viewport narrower than the three-column layout: the side panel moves below the list; nothing needing a human is hidden.
- A project is selected but items needing a human exist in other projects: the Inbox shows only the selected project's items, and the navigation count reflects the same filter, so counts on the page never disagree; the empty state for a filtered view says which project is selected and offers "all projects".

## Requirements _(mandatory)_

### Functional Requirements

**Home page and navigation**

- **FR-001**: The Inbox MUST be the page shown immediately after sign-in and MUST be reachable as the first entry in the primary navigation, which carries the count of items currently needing the user.
- **FR-002**: The Inbox MUST present exactly one primary action, **New requirement**, which opens the requirement creation flow; the action MUST be disabled with an explanation for users whose role may not create requirements.
- **FR-003**: The Inbox MUST show the organisation name and the signed-in user's name in the navigation area.
- **FR-004**: Users MUST sign in with an email address and password to a CDevi-managed account before any Inbox data is shown; each account carries exactly one role (Administrator, Approver, Engineer, Viewer per `specs/001` FR-032) and a set of project memberships, which the read and ingestion services use for every permission decision. Passwords MUST be stored only as strong one-way hashes, sign-in failures MUST NOT reveal whether the email exists, repeated failures MUST be rate-limited, and a signed-out or expired session MUST return the user to sign-in and then back to the Inbox.
- **FR-005**: Accounts, roles and project memberships MUST be creatable by an Administrator through an administrative path (which MAY be the seed or a command-line/administrative interface rather than a screen in this feature); self-service sign-up and password reset by email are out of scope.

**Needs you**

- **FR-006**: The Inbox MUST list every workflow visible to the user whose state is `WAITING_FOR_HUMAN`, `BLOCKED` or `FAILED` under a **Needs you** tab, which MUST be selected by default; these items MUST never be collapsed, hidden or paged out of view without an explicit count of the remainder.
- **FR-007**: Each **Needs you** row MUST show the workflow title, the state word ("needs you", "blocked" or "failed"), a one-line ask (the requested action, the clarification question, the blocking reason, or the failure reason with the stage that failed), the project, the requesting agent where applicable, and the time since the request was raised.
- **FR-008**: Approval rows MUST show the request's risk level (LOW/MEDIUM/HIGH/CRITICAL) as a labelled badge, with HIGH and CRITICAL visually prominent, and MUST show the time remaining until expiry when the request has one, or "expired" once it has passed.
- **FR-009**: Clarification rows MUST indicate when a recommended answer is available.
- **FR-010**: **Needs you** rows MUST be ordered by risk level descending (CRITICAL, HIGH, MEDIUM, LOW, none), then by oldest request first.
- **FR-011**: Items waiting longer than 24 hours MUST be flagged as stale within the row.
- **FR-012**: Selecting a **Needs you** row MUST take the user to the screen where the request is resolved: the Approval Center item for approvals and clarifications, the Workflow Detail for blocked and failed workflows. The Inbox is a triage list: it MUST NOT offer inline approve, reject or answer actions; all decisions are made on the target screen.

**Running and Done**

- **FR-013**: The Inbox MUST provide **Running** and **Done** tabs alongside **Needs you**; each tab label MUST show the count of items it contains. All three tabs are in scope for this feature.
- **FR-014**: **Running** MUST list workflows in `RUNNING`, `RETRYING`, `WAITING` or `QUEUED`, each with title, exact state word, project, agent, current stage position and name, and elapsed time, ordered most recently started first.
- **FR-015**: **Done** MUST list workflows that reached `COMPLETED` or `CANCELLED` within the last 7 days, each with title, terminal state word, project, agent, time finished and the pull request reference when one exists, ordered most recently finished first.
- **FR-016**: Selecting a **Running** or **Done** row MUST open that workflow's Workflow Detail.

**Side panel**

- **FR-017**: The Inbox MUST show a **Today** block with counts for the current day of workflows started, workflows completed, approvals decided and items currently needing a human; each count MUST link to the filtered list behind it and MUST show zero rather than being hidden when there is no activity.
- **FR-018**: The Inbox MUST show a one-line plain-language summary of the organisation's current autonomy policy, linking to the Policies screen.

**Data, freshness and states**

- **FR-019**: The Inbox MUST be backed by live platform data — the Workflows, Approvals and Clarifications defined in `specs/001` — and MUST reflect changes to them within 5 seconds at p95 without a manual page refresh. Seeded or demonstration data MUST NOT be presented as live data.
- **FR-020**: This feature MUST deliver the persisted records and read services the Inbox depends on: Workflow (with state, current stage, project, agent, timings and pull request reference), Approval (with ask, risk level, requested time, expiry, decision) and Clarification (with question, requested time, suggested-answer flag), using the entity definitions and state vocabulary of `specs/001` so that later features extend rather than replace them. Records MUST carry the organisation and project identifiers required by `specs/001` FR-033 and FR-025.
- **FR-021**: The system MUST provide an authenticated ingestion interface through which an authorised external system (the future agent orchestrator) or an automated test can create a Workflow and record its state transitions, current stage, agent, timings and pull request reference, and can raise, update and resolve Approvals and Clarifications. Every write MUST be validated against the `specs/001` state vocabulary and risk levels, MUST be attributed to the calling principal, and MUST be rejected with an explanatory error when it is invalid, references an unknown project, or the principal lacks permission for that project.
- **FR-022**: A deterministic seed MUST exist for demonstration and test environments that produces a known set of workflows, approvals and clarifications across all three tabs and all Needs-you kinds (approval per risk level, clarification with and without a recommended answer, blocked, failed, stale, expired); seeded environments MUST be visibly labelled as demonstration data and the seed MUST NOT run against a production environment.
- **FR-023**: The read services MUST enforce the signed-in user's project permissions and role (`specs/001` FR-032) on every request, MUST bound every list to a page size with a stable ordering, and MUST expose enough measurement (request latency, item counts) to verify SC-003 without recording sensitive data.
- **FR-024**: Every state MUST be displayed as a word in a pill using the platform's nine workflow states; state MUST never be conveyed by colour or icon alone.
- **FR-025**: The Inbox MUST define and display loading, empty, error (with retry) and permission-restricted states for the list and the side panel; loading MUST not be mistaken for "nothing needs you".
- **FR-026**: Lists MUST be bounded: at most 50 rows are shown per tab initially with an explicit way to load more, and tab counts MUST reflect the true total.
- **FR-027**: The Inbox MUST only include workflows the signed-in user is permitted to view; counts MUST be computed over the same set.
- **FR-028**: The Inbox MUST honour the global project selector (`specs/001` FR-025): with "all projects" (the default) it shows every project the user may view; with a project selected, every list, tab count, navigation count and **Today** figure on the page is limited to that project, and the selected project is visibly indicated.

**Accessibility and layout**

- **FR-029**: All rows, tabs, links and actions MUST be operable by keyboard with a visible focus indicator and an accessible name; tabs MUST follow standard tab-list behaviour.
- **FR-030**: The layout MUST use the standard application shell (navigation, main content, side panel) without fixed or sticky headers, and MUST reflow on narrower viewports so that no **Needs you** item becomes unreachable.

### Key Entities

- **Inbox Item**: A read-model row derived from a Workflow for display in the Inbox; carries the workflow identifier, title, project, agent, state, the tab it belongs to, the one-line ask, risk level (approvals only), raised/started/finished timestamps, expiry, stale flag, recommended-answer flag, pull request reference and the navigation target. It has no lifecycle of its own.
- **Workflow / Workflow Stage** (defined in `specs/001`, first persisted by this feature): source of state (one of the nine workflow states), current stage position and name, project, agent, start/finish timestamps and pull request reference.
- **Approval** (defined in `specs/001`, first persisted by this feature): source of the approval ask, risk level, requested time, expiry and decision; belongs to exactly one Workflow.
- **Clarification** (defined in `specs/001`, first persisted by this feature): source of the question text, requested time and whether a suggested answer exists; belongs to exactly one Workflow.
- **Project / Organisation** (defined in `specs/001`): scoping identifiers carried by every record above; the Inbox filters and permission checks operate on them.
- **User Account**: A CDevi-managed identity with email, password hash, display name, one role and a set of project memberships within the organisation; the subject of every permission check in this feature.
- **Ingestion Principal**: The authenticated external system or test identity permitted to write records for specific projects; every write is attributed to it and appears in the record's history.
- **Today Summary**: Counts for the current calendar day in the organisation's time zone — workflows started, workflows completed, approvals decided, items needing a human — plus the policy summary line.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of workflows in `WAITING_FOR_HUMAN`, `BLOCKED` or `FAILED` that the user may view appear in **Needs you**, with the correct state word and ask, in every scenario of the acceptance test set.
- **SC-002**: A reviewer can identify the single most urgent pending decision and open it within 10 seconds of the Inbox appearing, for 90% of test participants, without opening any other item.
- **SC-003**: The Inbox shows its first meaningful content within 2 seconds at p95 with 500 workflows (50 needing a human, 100 running, 350 finished) in the organisation.
- **SC-004**: The **Needs you** count in the navigation, the tab label and the **Today** block agree with each other 100% of the time in automated tests, under both "all projects" and a selected project.
- **SC-005**: The Inbox passes WCAG 2.2 AA automated checks with zero violations and a keyboard-only walk-through (land on page → switch tab → open row → return) with no focus loss.
- **SC-006**: Exactly one saffron primary action is present on the page, every state is rendered as a word in a pill, and no `WAITING_FOR_HUMAN`, `BLOCKED` or `FAILED` item is hidden — verified by automated design-system checks.
- **SC-007**: A record created or updated through the ingestion interface appears (or moves tabs) in an open Inbox within 5 seconds at p95, and 100% of invalid writes in the ingestion test suite are rejected with a reason and never reach the Inbox.
- **SC-008**: 0% of Inbox or ingestion requests without a valid session or principal return data, and a Viewer account sees the same rows as an Approver in the same projects but with **New requirement** disabled — verified by automated permission tests covering every role.
- **SC-009**: Concepts excluded from scope (API keys, runtime/laptop indicators, dollar budgets, linked laptops) appear nowhere on the page — verified by review against this specification.

## Clarifications

### Session 2026-09-14

- Q: Live platform data or a fixed seeded dataset? → A: Live data from the platform (`specs/001` records); the Inbox follows or is planned together with those read models.
- Q: Resolve items inline from the row, or navigate only? → A: Navigate only; the Inbox is a triage list.
- Q: Which tabs in the minimal version? → A: All three — Needs you, Running, Done.
- Q: Does the Inbox show all projects or follow the global project selector? → A: Follows the global project selector, defaulting to "all projects"; a chosen project filters every list and count on the page.
- Q: Does this feature include building the backing data services, or only the screen against a contract? → A: Full stack — this feature delivers the read models/services for workflows, approvals and clarifications that the Inbox needs, and the screen.
- Q: Where do `FAILED` workflows appear? → A: Needs you, with the state word "failed", the failure reason as the ask, sorted after items with a risk level; Done holds only `COMPLETED` and `CANCELLED`.
- Q: How do records enter the system without the agent runtime? → A: An authenticated ingestion interface for creating/updating workflows, approvals and clarifications (used by external systems and tests), plus a deterministic seed for demo/test environments.
- Q: How do users sign in and get roles/project permissions? → A: Email/password accounts managed by CDevi, with role and project membership stored alongside the account; no external identity provider in this feature.

## Assumptions

- The Inbox is the post-sign-in **home page**; the Dashboard from `specs/001` (US3, FR-023) remains a separate, deeper analytics screen reachable from the navigation. The Inbox does not need to satisfy that requirement.
- The primary navigation follows `specs/001` (Inbox, Dashboard, Projects, Workflows, Requirements, Reviews, Testing, Approvals, Agents, Administration: Integrations, Policies, Audit). Only the Inbox entry and its pending count are in this feature's scope; other entries may be placeholders until their features are built.
- "Needs you" is the display word for `WAITING_FOR_HUMAN` and "blocked" for `BLOCKED`, per the normative state mapping in `specs/002-adopt-design-system/contracts/state-risk-mapping.md`.
- Approval expiry ("times out in …") exists as an attribute on Approval; when the platform does not set one, the row simply omits the remaining time.
- Stale threshold is 24 hours, matching the `specs/001` edge case.
- "Recently finished" for the **Done** tab means within the last 7 days; older workflows are found in the Workflow Center.
- This feature is the first to persist Workflow, Approval and Clarification records (FR-020); it uses the `specs/001` definitions (its FR-001, FR-002, FR-011–FR-015) so that `specs/001` features later extend the same records. It does not build the agent runtime, stage execution or approval decision flows — records enter through the ingestion interface (FR-021) and, in non-production environments, the seed (FR-022). Freshness follows `specs/001` SC-002/SC-003 (5 seconds at p95); the delivery mechanism is decided in the plan. Counts and lists are refreshed together so they never disagree.
- Decisions are made on the Approval Center and Workflow Detail screens (`specs/001` US2, US1); the Inbox never duplicates their approve/reject/answer flows.
- The **Today** window is the current calendar day in the organisation's configured time zone.
- The policy summary line is generated from the default policies that ship with the MVP ("PR merge requires human approval; any HIGH or CRITICAL action requires human approval"); administrators editing policies is out of scope here.
- Roles and permissions are those of `specs/001` FR-032 (Administrator, Approver, Engineer, Viewer); the Inbox reads them and does not define new ones. Authentication is CDevi-managed email/password (FR-004), superseding the `specs/001` assumption of an external identity provider for this feature; single sign-on can be added later without changing roles or memberships.
- Excluded from scope, even though shown in the reference page: personal API key fingerprints, laptop-vs-cloud runtime indicators, per-run dollar cost and budget, cloud minutes, linked laptops, "paused offline" state, workspace switching. (A light/dark/system theme switch in the shell footer was added at the product owner's request during implementation; it applies to the whole app and is remembered in a cookie.) Also excluded: inline filtering/search, bulk actions, per-user inbox preferences, notifications outside the page.
- All UI is built from `@cdevi/design-system` components and tokens as required by the constitution (Principle III); any pattern missing from the package (e.g. a row variant that carries the one-line ask, a stale flag) is added to the package first and recorded in the plan.
- Performance budgets beyond SC-003 (e.g. tab switch latency, payload size) are set in the plan per Principle IV.
