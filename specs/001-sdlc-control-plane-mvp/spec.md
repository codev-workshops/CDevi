# Feature Specification: CDevi SDLC Control Plane (MVP)

**Feature Branch**: `001-sdlc-control-plane-mvp`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "read the docs folder and get an understanding about this CDevi platform we are going to build."

**Source material**: `docs/SDLC Control Plane — High-Level UI Specification.md` (v0.1 Draft), `docs/architecture.md`, `.specify/memory/constitution.md`

## Overview

CDevi is an enterprise web application that lets an engineering organization **supervise and control autonomous software-engineering agents** across the software development lifecycle. It is a control center, not a chat application. Work enters as a requirement (typically a Jira ticket), moves through a visible, staged **SDLC Workflow** (Requirement → Analysis → Architecture → Implementation → Testing → Review → PR), and humans intervene only at defined **approval** or **clarification** points. Every autonomous action is policy-governed, risk-labelled, evidence-backed, and auditable.

This specification covers the **MVP scope** defined in the source UI specification (§41–42): Dashboard, Projects, Workflow Center, Workflow Detail, Requirements, Agent Activity, Testing, PR Review, Approval Center, Integrations, Policies, and Audit Log. Design/UX proposals, Deployment Center, Incident Center, Knowledge Center, Agent Fleet analytics, and the visual Workflow Designer are **out of scope** for this feature and reserved for later specifications.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Follow one requirement from ticket to PR (Priority: P1)

An engineer or product manager opens a single workflow and understands the entire journey of a requirement — which stages are done, which is running, who (which agent) is working, what has changed, what has been tested, what failed, and what happens next — without switching to Jira, GitHub, CI, or the agent runtime.

**Why this priority**: This is the product's core promise ("open one workflow and understand the entire journey from Jira ticket to PR"). Without it nothing else has value.

**Independent Test**: Seed one workflow with a full history of stage transitions, agent runs, artifacts and test results; a user with no prior context can answer the eight questions in §45 of the UI spec (what is the agent doing, why, what changed, what evidence, what was tested, what failed, what needs approval, what happens next) from the Workflow Detail page alone.

**Acceptance Scenarios**:

1. **Given** a workflow exists for requirement PAY-1391, **When** the user opens Workflow Detail, **Then** they see the ordered stage pipeline with each stage's status (one of the platform workflow states), the current stage highlighted, the assigned agent, elapsed time, a plain-language description of the current activity, and a progress indicator.
2. **Given** a workflow is in progress, **When** the user views the Activity and Artifacts panels, **Then** the activity list shows timestamped stage/agent events in order and the Artifacts panel lists every produced artifact (requirement spec, architecture/impact analysis, implementation plan, test results, code diff, PR link) with the stage that produced it.
3. **Given** a stage is in `WAITING_FOR_HUMAN` or `BLOCKED`, **When** the user opens the workflow, **Then** that state is visibly prominent with the reason and a direct action (answer question / review approval), and it is never collapsed or hidden.
4. **Given** the user is viewing a running workflow, **When** the underlying stage state, activity, test results or findings change, **Then** the page reflects the change within 5 seconds without a manual page refresh.
5. **Given** a workflow has failed at a stage, **When** the user opens it, **Then** they see the failure reason, the stage where it failed, the last successful stage, and available actions (retry, escalate, cancel).

---

### User Story 2 - Act on approvals and clarifications from one place (Priority: P1)

A reviewer, tech lead or product manager sees every request that needs a human — approvals (e.g. approve requirement, approve PR merge, high-risk action) and agent clarification questions — in a single Approval Center, understands the context and risk of each, and resolves it so the workflow resumes.

**Why this priority**: Human-in-the-loop is the defining design principle; blocked workflows create no value until a human acts. Consolidated intervention is what makes supervision of many workflows feasible.

**Independent Test**: Create three pending items (a requirement approval, a PR merge approval with risk MEDIUM, and an agent clarification question); a user resolves each from the Approval Center and the corresponding workflows transition out of `WAITING_FOR_HUMAN`.

**Acceptance Scenarios**:

1. **Given** pending approvals and clarifications exist, **When** the user opens the Approval Center, **Then** each item shows the requirement/workflow identifier, what is being requested, who/which agent requested it, when, and its risk level, ordered with highest risk and oldest first.
2. **Given** an agent has raised a clarification question, **When** the user opens it, **Then** they see the question, "why this matters", links to the originating requirement, workflow, agent run and external ticket, and can answer with a provided option or free text.
3. **Given** the user answers a clarification, **When** the answer is submitted, **Then** the answer is recorded with author and timestamp, the workflow leaves `WAITING_FOR_HUMAN`, and the answer appears in the requirement's record and the audit log.
4. **Given** a HIGH or CRITICAL risk approval, **When** the user approves, **Then** the system requires an explicit confirmation step that restates the action and its risk before recording the approval.
5. **Given** the user rejects an approval, **When** they submit the rejection, **Then** a reason is required, the workflow moves to `BLOCKED` (or `CANCELLED` if the user chooses), and the requesting agent's run records the rejection.
6. **Given** the user is anywhere in the application, **When** pending approvals exist, **Then** the header shows the pending count and links to the Approval Center.

---

### User Story 3 - See the state of the engineering system at a glance (Priority: P2)

An engineering leader opens the Dashboard and immediately answers: what is happening, what needs me, is engineering healthy, what is the AI doing, and is anything risky.

**Why this priority**: The dashboard is the entry point and the "control center" framing of the product; it is valuable once workflows and approvals exist.

**Independent Test**: With seeded data (18 active workflows, 4 approvals, 2 clarifications, 1 security finding, test pass rate 97.4%), the dashboard displays each figure correctly and every figure links to the filtered list behind it.

**Acceptance Scenarios**:

1. **Given** workflows and agent runs exist, **When** the user opens the Dashboard, **Then** they see counts of active workflows, running agents, PRs generated, and open incidents/failures, plus a pipeline view showing the number of workflows in each SDLC stage; each stage count is clickable and opens the Workflow Center filtered to that stage.
2. **Given** items need human attention, **When** the user views the "What needs me" area, **Then** approvals, clarifications and failed workflows are counted separately and each count links to its list.
3. **Given** health metrics exist, **When** the user views the health area, **Then** they see test pass rate and agent success rate for the selected time window, and human intervention rate (fraction of workflows requiring at least one human action).
4. **Given** high-risk or critical actions are pending or occurred in the window, **When** the user views the risk area, **Then** they are counted and visually prominent, and link to the Audit Log or Approval Center filtered accordingly.
5. **Given** active workflows exist, **When** the user views the Active Workflows section, **Then** each card shows identifier, title, current stage, progress, agent, elapsed time and status, and opens Workflow Detail.

---

### User Story 4 - Manage requirements and start workflows (Priority: P2)

A product manager or engineer creates a requirement (manually or from a linked Jira ticket), reviews the agent's analysis (acceptance criteria, identified business rules, open questions), and approves it to start the SDLC workflow.

**Why this priority**: Requirements are the entry point of the primary journey; this story is what makes new work enter the system.

**Independent Test**: Create a requirement manually, observe it move through `Draft → Analyzing → Needs Clarification / Ready`, approve it, and confirm a workflow is created and appears in the Workflow Center.

**Acceptance Scenarios**:

1. **Given** the user is in a project, **When** they create a requirement with title and business objective, **Then** it is saved in `Draft` state and can be submitted for analysis.
2. **Given** a Jira integration is connected and configured for a project, **When** a matching Jira issue is created or updated, **Then** a requirement is created or updated in the project linked to that issue, and the link is shown on the requirement.
3. **Given** a requirement is submitted for analysis, **When** analysis completes, **Then** the requirement shows acceptance criteria, AI-identified rules, and open questions, each labelled as AI-generated, and its state is `Ready` (no open questions) or `Needs Clarification` (open questions exist).
4. **Given** a requirement is `Ready`, **When** an authorized user approves it, **Then** its state becomes `Approved`, a workflow is created for it, and the workflow's first stage is queued.
5. **Given** a requirement in any state, **When** the user views the Requirements list, **Then** they can filter by state, project and assignee and see the linked workflow's status.

---

### User Story 5 - Inspect an agent run and its decisions (Priority: P2)

An engineer drills from a workflow stage into the agent run that executed it, sees a timeline of what the agent did, and inspects each important decision with its reason, evidence, confidence and policy outcome — without being exposed to raw internal reasoning.

**Why this priority**: "Evidence over explanation" is a core principle and is what earns trust; but it is only needed once workflows are visible.

**Independent Test**: Open an agent run with a recorded timeline and three decisions; each decision shows action, reason, evidence references, confidence and policy result, and each evidence reference opens the referenced file, ticket, or artifact.

**Acceptance Scenarios**:

1. **Given** a workflow stage was executed by an agent, **When** the user opens the agent run, **Then** they see agent name, workflow, start time, duration, model used, status, and a timestamped timeline of activity events.
2. **Given** an agent run recorded decisions, **When** the user opens a decision, **Then** they see the action taken, the reason, a list of evidence items, a confidence level, and whether policy allowed, required approval, or denied the action.
3. **Given** the agent run is in progress, **When** the user views it, **Then** the timeline and current activity update live; the UI presents structured progress (checklist of completed/running/pending steps), not a generic "thinking" indicator.
4. **Given** a decision or run, **When** rendered, **Then** raw chain-of-thought or private reasoning text is not displayed; only decision summaries, evidence, tool activity, artifacts and outcomes.

---

### User Story 6 - Review AI findings on a pull request and drive the fix loop (Priority: P3)

A reviewer opens the PR Review Center for a workflow's pull request, sees the result of each review lane (correctness, security, dependencies, edge cases, testing, architecture, general), reads individual findings with severity and evidence, and either applies an agent fix, dismisses, or escalates.

**Why this priority**: Review is the last automated gate before human approval and is where autonomous fix cycles show their value; it depends on implementation and testing stages existing.

**Independent Test**: Seed a PR with 7 findings across lanes; the user dismisses one with a reason, requests a fix for another, and observes a new review cycle with updated counts.

**Acceptance Scenarios**:

1. **Given** a PR exists for a workflow and AI review has completed, **When** the user opens PR Review, **Then** they see the PR identifier, linked requirement, review status, and per-lane pass/warn/fail status.
2. **Given** findings exist, **When** the user opens one, **Then** they see severity (CRITICAL/HIGH/MEDIUM/LOW/INFO), blocking classification (BLOCKING/NON-BLOCKING/SUGGESTION), description, impact, evidence location, and recommended fix, with actions Apply Fix, Dismiss (reason required), Create Issue.
3. **Given** the user chooses Apply Fix, **When** the fix cycle runs, **Then** a Review Cycle record shows findings count, fixed, remaining and iteration progress, and the workflow's Review stage reflects the cycle state.
4. **Given** any BLOCKING finding remains open, **When** the user views the PR, **Then** the PR is clearly marked as not ready for merge approval.

---

### User Story 7 - See test results per workflow (Priority: P3)

An engineer opens the Testing Center for a workflow and sees a unified summary across test categories (unit, integration, API, browser, security, performance) with pass/fail counts and drill-down to failures.

**Why this priority**: Testing evidence is required to trust review and approval decisions; the view depends on implementation runs producing results.

**Independent Test**: Seed a workflow with results in five categories where one browser test failed; the summary shows counts per category with warning state for browser, and the failed test detail shows step results and failure classification.

**Acceptance Scenarios**:

1. **Given** test runs exist for a workflow, **When** the user opens Testing, **Then** each category shows passed/total and an overall status icon.
2. **Given** a test failed, **When** the user opens it, **Then** they see the failing step, any captured screenshot or output, and the agent's failure classification (application defect / environment issue / test issue with percentages) and can trigger Investigate or Generate Fix (subject to policy).

---

### User Story 8 - Administer integrations, policies and audit (Priority: P3)

An administrator connects external systems (source control, issue tracker at minimum), defines policies that govern what agents may do autonomously and what requires approval, and reviews an audit log of every autonomous and human action.

**Why this priority**: Required for safe operation in a real organization, but the platform can be demonstrated with seeded connections and default policies first.

**Independent Test**: Connect a GitHub and a Jira integration, define a policy "PR merge requires human approval", run a workflow to the PR stage, and verify the merge appears as an approval request and every step is recorded in the audit log with agent, action, workflow, policy and result.

**Acceptance Scenarios**:

1. **Given** the Integrations screen, **When** the admin views it, **Then** each supported integration shows connection status, granted permissions, available capabilities, last synchronization time and health; the admin can connect, reconnect or disconnect.
2. **Given** the Policy Center, **When** the admin creates or edits a policy, **Then** they can set its scope (organization, project, repository, environment, agent, workflow), the action or risk level it governs, and the requirements (human approval, required checks such as security review or passing tests), and policies are versioned.
3. **Given** an agent attempts an action covered by a policy, **When** the policy requires approval, **Then** the action is paused as an approval request; **When** the policy denies, **Then** the action is refused and recorded; **When** allowed, **Then** it proceeds and is recorded with the policy version applied.
4. **Given** the Audit Log, **When** the user filters by agent, user, project, repository, workflow, action type, date range or risk level, **Then** matching events show timestamp, actor, action, target, workflow, policy applied and result, and the log is read-only and exportable.

---

### Edge Cases

- A workflow is left in `WAITING_FOR_HUMAN` for a long time (e.g. > 24 hours): it stays visible in the Approval Center and Dashboard "needs me" counts and is flagged as stale; it is never auto-approved.
- Two users act on the same approval concurrently: the first recorded decision wins; the second user is shown that the item was already resolved, by whom, and with what outcome.
- The connected issue tracker or source-control system is unreachable: the integration shows unhealthy status, affected workflow stages move to `BLOCKED` with a clear reason rather than failing silently, and users can retry once the integration is healthy.
- An agent run exceeds its expected duration or budget: the run is shown as `RETRYING` or `FAILED` with reason; the workflow stage inherits the state; no stage appears "running" indefinitely without activity.
- A requirement's linked Jira ticket is deleted or closed externally: the requirement is flagged, linked workflows are paused in `BLOCKED` pending human decision to cancel or continue.
- A policy is changed while a workflow is mid-flight: the policy version in effect at the time of each action is what is recorded; already-granted approvals are not revoked; new actions use the new version.
- Real-time connection to the browser drops: on reconnect the UI catches up on missed events without duplication or loss, and the user is informed if they were offline.
- A user lacks permission to approve a given item: the item is visible (if they can view the workflow) but approval actions are disabled with an explanation.
- Evidence references a file or ticket the user cannot access: the reference is shown with an "access restricted" indicator rather than a broken link.

## Requirements *(mandatory)*

### Functional Requirements

**Workflows and stages**

- **FR-001**: The system MUST represent each unit of work as a Workflow composed of ordered Workflow Stages (at minimum: Requirement, Analysis, Architecture, Implementation, Testing, Review, PR), where each stage records status, assigned agent, start/end time, produced artifacts, errors and approval requirements.
- **FR-002**: Every Workflow and Workflow Stage MUST expose exactly one of the states `QUEUED`, `RUNNING`, `WAITING`, `WAITING_FOR_HUMAN`, `BLOCKED`, `FAILED`, `RETRYING`, `COMPLETED`, `CANCELLED`, and all state transitions MUST be recorded with timestamp and cause.
- **FR-003**: The Workflow Center MUST list all workflows in the selected project with stage pipeline, status, agent, elapsed time and progress, filterable by stage, state, project, and requirement identifier.
- **FR-004**: The Workflow Detail MUST show the stage pipeline, current stage detail, an ordered activity feed, and an artifact list, and MUST update in near real time without a page refresh.
- **FR-005**: The UI MUST never hide or collapse a `WAITING_FOR_HUMAN` or `BLOCKED` state; such states MUST show the reason and a direct action.
- **FR-006**: Users with appropriate permission MUST be able to retry a failed stage, cancel a workflow, or escalate a workflow to a named person or group.

**Requirements**

- **FR-007**: Users MUST be able to create requirements with title, business objective and optional acceptance criteria within a project.
- **FR-008**: The system MUST create or update a requirement from a linked issue-tracker item when the integration is connected and a project mapping exists, preserving the link in both directions.
- **FR-009**: Requirements MUST move through the states `Draft`, `Analyzing`, `Needs Clarification`, `Ready`, `Approved`, `In Implementation`, `Completed`, `Rejected`, with AI-generated content (acceptance criteria, rules, open questions) visibly labelled as AI-generated.
- **FR-010**: Approving a `Ready` requirement MUST create a Workflow for it and queue its first stage.

**Approvals and clarifications**

- **FR-011**: The system MUST consolidate all pending human interventions — approvals and clarification questions — in an Approval Center and show a pending count in the global header.
- **FR-012**: Each approval request MUST record requester (agent or user), workflow, requested action, risk level (LOW/MEDIUM/HIGH/CRITICAL), created time, decision, decider, decision time and optional reason.
- **FR-013**: Approvals of HIGH or CRITICAL risk MUST require an explicit confirmation that restates the action and risk; rejections MUST require a reason.
- **FR-014**: Each clarification request MUST include the question, why it matters, suggested answers where available, and links to the requirement, workflow, agent run and external ticket; answers MUST be recorded with author and time and MUST resume the waiting workflow.
- **FR-015**: An approval or clarification MUST be resolvable exactly once; later attempts MUST be refused with the existing outcome shown.

**Agent runs and decisions**

- **FR-016**: Each Agent Run MUST record agent, workflow and stage, model used, start time, duration, status, and a timestamped activity timeline.
- **FR-017**: Each significant Agent Decision MUST record action, reason, evidence references, confidence level, and policy outcome (allowed / approval required / denied), and evidence references MUST be navigable.
- **FR-018**: The UI MUST NOT display raw model chain-of-thought or private reasoning; it MUST display decision summaries, evidence, tool activity, artifacts and outcomes.

**Testing and review**

- **FR-019**: The system MUST record test runs per workflow grouped by category (unit, integration, API, browser, security, performance) with passed/total counts and per-test detail including failure output, screenshots where available, and failure classification.
- **FR-020**: The system MUST record AI reviews per pull request with per-lane results (correctness, security, dependencies, edge cases, testing, architecture, general) and individual findings carrying severity, blocking classification, description, impact, evidence location and recommended fix.
- **FR-021**: Users MUST be able to dismiss a finding (with reason), request an automated fix, or create an issue from a finding; fix requests MUST produce a Review Cycle record with findings/fixed/remaining counts.
- **FR-022**: A pull request with any open BLOCKING finding MUST be marked not ready for merge approval.

**Dashboard**

- **FR-023**: The Dashboard MUST show, for the selected project or all projects: active workflows, running agents, PRs generated, workflows per stage, pending approvals, pending clarifications, failed workflows, test pass rate, agent success rate, human intervention rate, and counts of high-risk/critical actions; every figure MUST link to the filtered list behind it.

**Projects**

- **FR-024**: Users MUST be able to create projects and link repositories to them; the project list MUST show repositories, active workflows, open PRs, incidents/failures and a health status per project.
- **FR-025**: A global project selector MUST scope all SDLC screens to the chosen project, with an "all projects" option for the Dashboard and Approval Center.

**Policies, risk and audit**

- **FR-026**: Every autonomous action MUST carry a risk level (LOW/MEDIUM/HIGH/CRITICAL); the UI MUST make HIGH and CRITICAL actions visually prominent wherever they appear.
- **FR-027**: Administrators MUST be able to define versioned Policies scoped to organization, project, repository, environment, agent or workflow that specify, for an action or risk level, whether it is allowed autonomously, requires human approval, requires named checks (e.g. security review, passing tests), or is denied.
- **FR-028**: Every agent action MUST be evaluated against applicable policies before execution; the policy version applied and the outcome MUST be recorded on the action and in the audit log.
- **FR-029**: The system MUST maintain an immutable Audit Log of every autonomous action and every human decision, with timestamp, actor, action, target, workflow, policy applied, risk level and result, filterable by agent, user, project, repository, workflow, action, date and risk, and exportable.

**Integrations**

- **FR-030**: Administrators MUST be able to connect, view and disconnect integrations with, at minimum, a source-control system and an issue tracker; each MUST show connection status, granted permissions, capabilities, last synchronization and health.
- **FR-031**: When an integration is unhealthy, dependent workflow stages MUST enter `BLOCKED` with a clear reason rather than fail silently.

**Identity, access and tenancy**

- **FR-032**: Users MUST authenticate before accessing any screen; the system MUST support at least the roles Administrator, Approver (may approve/reject and answer clarifications), Engineer (may create requirements, retry/cancel workflows, act on findings) and Viewer (read-only), enforced on every action.
- **FR-033**: The MVP is deployed for a single organization per installation. Access MUST be scoped by project and role within that organization; every record MUST nevertheless carry its organization so that multi-organization isolation can be introduced later without data migration. Self-service organization sign-up and organization administration are out of scope.

**Real-time and notifications**

- **FR-034**: Workflow state, agent activity, test results, review findings and approval counts MUST propagate to open browser sessions without manual refresh, and sessions MUST recover missed events after a disconnect without loss or duplication.
- **FR-035**: The header MUST show notification counts for workflow failures, approval requests, clarifications and new review findings, each linking to the relevant list.

**Scope of autonomy in MVP**

- **FR-036**: The MVP MUST execute the primary journey end to end with agents: Requirement Analysis, Architecture/Impact Analysis, Implementation, Testing, AI Review and PR creation MUST each be performed by an agent run triggered by the control plane for a linked repository, with humans intervening only at clarification and approval points. The control plane MUST both trigger agent runs and observe their events and artifacts.

### Key Entities

- **Organization**: The enterprise using the installation (exactly one in the MVP); owns projects, users, policies, integrations and the audit log, and is the future tenant boundary.
- **Project**: A grouping of repositories and environments with its own workflows, requirements and settings; has a health status.
- **Repository**: A linked source-control repository belonging to a project.
- **Requirement**: A unit of business intent (optionally linked to an external issue) with business objective, acceptance criteria, AI-identified rules, open questions and a lifecycle state; produces at most one active Workflow.
- **Workflow**: The staged execution of a requirement through the SDLC; has an overall state, ordered stages, and links to artifacts, PR, approvals and audit events.
- **Workflow Stage**: One step of a workflow (Requirement, Analysis, Architecture, Implementation, Testing, Review, PR) with state, agent run(s), duration, artifacts, errors and approval requirements.
- **Agent**: A named autonomous role (e.g. Requirement Agent, Implementation Agent, Review Agent) with configured model, tools and permissions.
- **Agent Run**: One execution of an agent for a stage; has timeline, status, model, duration and decisions.
- **Agent Decision**: A significant action taken in a run with reason, evidence references, confidence and policy outcome.
- **Artifact**: An output of a stage (requirement spec, impact analysis, implementation plan, code diff, test results, PR); immutable once the stage completes.
- **Test Run**: Results of a test category for a workflow with per-test outcomes, output and failure classification.
- **Pull Request**: The source-control PR produced by a workflow; linked to Reviews and merge approval.
- **Review / Review Finding / Review Cycle**: An AI review with per-lane results; findings with severity, blocking class, evidence and recommended fix; cycles tracking autonomous fix iterations.
- **Approval**: A pending or resolved request for human decision with risk level, requester, decision, decider and reason.
- **Clarification**: A question raised by an agent that blocks progress until answered; linked to requirement, workflow and run.
- **Policy**: A versioned, scoped rule defining autonomy, approval and check requirements for actions or risk levels.
- **Integration**: A connection to an external system with status, permissions, capabilities, last sync and health.
- **Audit Event**: An immutable record of an autonomous or human action with actor, target, workflow, policy, risk and result.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user unfamiliar with a workflow can correctly answer all eight supervision questions (what the agent is doing, why, what changed, what evidence, what was tested, what failed, what needs approval, what happens next) from Workflow Detail alone in under 2 minutes, for 90% of test participants.
- **SC-002**: 100% of workflows in `WAITING_FOR_HUMAN` or `BLOCKED` appear in the Approval Center or Dashboard "needs me" area within 5 seconds of entering that state.
- **SC-003**: State changes (stage transitions, activity events, findings, approvals) are visible in open browser sessions within 5 seconds at p95 without a page refresh.
- **SC-004**: 100% of autonomous actions and human decisions in a test run appear in the Audit Log with actor, workflow, policy version and result; no action can be found in the runtime that is missing from the log.
- **SC-005**: 100% of actions governed by a "requires approval" policy are paused as approval requests, and 0% of actions governed by a "deny" policy execute, across the policy test suite.
- **SC-006**: A reviewer can resolve an approval or clarification (open, understand context, decide, confirm) in under 60 seconds at the median.
- **SC-007**: Dashboard, Workflow Center and Approval Center render their initial content within 2 seconds at p95 with 500 workflows, 5,000 agent runs and 50,000 audit events in the organization.
- **SC-008**: The primary journey (requirement created → workflow through all stages → PR with review → human approval) can be completed end to end in a demonstration environment with humans intervening only at clarification and approval points.
- **SC-009**: No screen displays raw model reasoning text; verified by review of every agent run and decision view against a checklist.
- **SC-010**: All MVP screens pass WCAG 2.2 AA automated checks and keyboard-only manual verification of the critical flows (approve/reject, answer clarification, open workflow detail).

## Assumptions

- The MVP screens and navigation are those listed in the source UI specification §41 (Dashboard, Projects, Workflows, Requirements, Reviews, Testing, Approvals, Agents, Knowledge placeholder, Administration: Integrations, Policies, Audit). Design/UX proposals, Deployment Center, Incident Center, Knowledge Center content, Agent Fleet analytics, Agent/Model configuration UI and the visual Workflow Designer are deferred to later features.
- Workflows in the MVP follow a single default stage sequence; custom workflow definitions come with the Workflow Designer later.
- The minimum integrations for MVP are one source-control system (GitHub) and one issue tracker (Jira); Slack, cloud providers, Kubernetes, observability and wiki integrations are later.
- Agents are executed by an underlying agent runtime that the control plane drives and observes; the runtime is replaceable and its identity is not exposed as a product concept to end users.
- The MVP serves a single organization per installation (confirmed); multi-organization SaaS tenancy is deferred but the data model keeps an organization identifier on every record.
- All SDLC stages are agent-executed in the MVP (confirmed); the control plane triggers agent runs through the underlying runtime and records their events, decisions and artifacts.
- Authentication reuses a standard enterprise sign-in (single sign-on or email/password with an identity provider); user management beyond role assignment is out of scope.
- A workflow has one active pull request in the MVP; multi-PR workflows are out of scope.
- Real-time delivery targets a small team per organization (tens of concurrent viewers), not thousands.
- Default risk levels follow the source spec §35: LOW (read repository, run tests), MEDIUM (modify code, create PR, create issue), HIGH (merge PR, modify infrastructure, deploy staging), CRITICAL (deploy production, modify production database, change security policy). Administrators can override per policy.
- Default policies ship with the MVP: PR merge requires human approval; any HIGH or CRITICAL action requires human approval; agents may write only to feature branches.
- Audit events are retained for at least 1 year; other operational data follows standard retention and is not deleted while a workflow is active.
- The `docs/architecture.md` file describes a five-service, single-region, row-level-security architecture and repository layout for a product code-named "obvious" with workbooks and billing; parts of it (service split, outbox/eventing, tenancy enforcement, agent permission checks) are relevant guidance for planning, while the workbook/data-engine/billing portions do not correspond to the SDLC Control Plane and are assumed to be carry-over from another project. This must be reconciled during `/speckit-plan`.
- All screens are built from `@cdevi/design-system` (`packages/design-system`, rules in `DESIGN.md`); the nine workflow states and four risk levels render through its normative mapping (`specs/002-adopt-design-system/contracts/state-risk-mapping.md`).
- Constitution requirements (testable acceptance criteria, defined loading/empty/error states, WCAG 2.2 AA, numeric performance budgets) apply to every screen in this feature; budgets beyond SC-003 and SC-007 will be set in the plan.
