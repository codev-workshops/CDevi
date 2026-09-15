# Contract: Requirements — list, detail and create form: regions, states, accessibility

Normative for `apps/web/app/(app)/requirements/` (User Story 4). Every element is an `@cdevi/design-system` component (1.4.0) imported through `apps/web/lib/ds.ts`; no `cd-` markup, no inline styles, no literal colours in the app (DR-06…DR-09). Data comes only from `GET /api/requirements`, `GET /api/requirements/{id}`, `POST /api/requirements`, `POST /api/requirements/{id}/submit|approve|reject` ([openapi.yaml](openapi.yaml) after Phase 9a; shapes in [data-model.md §23](../data-model.md)); rules from `@cdevi/contracts/requirement-rules` ([research R32, R39, R41–R42, R45](../research.md)). The screens derive nothing except display strings: `humanAgo(createdAt)`, `humanAgo(generatedAt)`. Requirement states render only through `RequirementStatePill`; workflow states only through `StatePill` (DR-01, R41).

## 1. Routes and composition

- `requirements/page.tsx` (server): reads the project cookie (`cdevi_project`, shared with Inbox/Approval Center/Dashboard) and `?state=`, `?assignee=`, `?cursor=` → `getRequirementList(filters)` (`lib/session.ts`, cached) → `apiFetch<RequirementListPage>('/api/requirements?…', { cookie })`; any error renders §5.1 *error*. Success renders `<RequirementsListScreen initial={page} me={me} />`. `lib/navigation.ts` `BUILT_SECTIONS` gains `/requirements` so the `[section]` placeholder no longer serves it.
- `RequirementsListScreen.tsx` (client): owns the three filter controls (project `Select` writes the cookie and `?project=` like the Inbox — FR-025; state and assignee write `?state=`/`?assignee=` with `router.replace`), the "Load more" cursor button, and subscribes with `subscribeInboxStream({ onChange })` (debounced 300 ms) → refetch first page (FR-034). Renders §2 from the page only.
- `requirements/[id]/page.tsx` (server): `getRequirementDetail(id)` → `apiFetch<RequirementDetail>`; 400/403/404/5xx all render §5.2 *not available* (same copy as Workflow Detail: "This item isn't available to you." + ghost `Button href="/requirements"` "Back to Requirements"). Success renders `<RequirementDetailScreen initial={detail} me={me} />`.
- `RequirementDetailScreen.tsx` (client): renders §3, performs the actions (`POST …/submit|approve|reject` via `apiFetch`, replaces the detail with the response), subscribes with `subscribeInboxStream({ onChange, requirementId, workflowId: linkedWorkflow?.id })` → refetch (FR-034, R40).
- `requirements/new/page.tsx` (server): replaces the stub; keeps the existing `Notice tone="info"` for roles without `canCreateRequirement` (the `new-requirement.test.tsx` expectations on the Inbox button are unchanged) and renders `<CreateRequirementForm projects={me.projects} defaultProject={cookie} />` for creators.
- `CreateRequirementForm.tsx` (client): §4; on 201 navigates to `detail.requirement.href`.
- Shell (`AppShell`, `Side`, `Main`, `Panel`) from `(app)/layout.tsx`; no `Panel` content is added; header `NavItem` counts (FR-035) are unchanged.

## 2. Requirements list — regions (top to bottom inside `Main`)

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 2.1 | Topbar | `Topbar` (`<h1>` "Requirements"), `actions` = `Button variant="primary" href="/requirements/new"` "New requirement" (creators) or `Button variant="primary" href="/requirements/new" aria-disabled="true"` + `Help` "Your role ({role}) cannot create requirements" (others) | Exactly one `<h1>`. **Not saffron** (§7): the saffron entry point is the Inbox button; this screen offers no "person needed" action |
| 2.2 | Filters | `PageMeta`: `Field label="Project"` + `Select id="requirements-project"` ("All projects" + one per `me.projects`); `Field label="State"` + `Select id="requirements-state"` ("Any state" + the eight words from `REQUIREMENT_STATE_WORDS`, in lifecycle order); `Field label="Assignee"` + `Select id="requirements-assignee"` ("Anyone", "Me", "Unassigned", then organization members visible in the page's rows); "Updated {humanAgo(generatedAt)}"; `Pill variant="neutral"` "live" / "reconnecting" | Scenario 5, FR-025. Selecting a filter resets the cursor. Filter values are reflected in the URL so views are linkable (R39) |
| 2.3 | Summary | `Mono` "{items.length} of {total} requirements" (+ " · filtered" when any filter is set) | Bounded list made visible (50 per page) |
| 2.4 | List | `List aria-label="Requirements"` of ≤ 50 `ListRow`: `title` = "{title}" with `href={row.href}`; `meta` = `Mono externalId` · "{project.key}" · "{assignee?.name ?? 'Unassigned'}" · "created {humanAgo(createdAt)}" · when `openQuestionCount > 0`: "{n} open question(s)"; `trailing` = `RequirementStatePill state={row.state}` **and**, when `linkedWorkflow`: `Link href={linkedWorkflow.href}` (accessible name "Workflow {externalId}, stage {index} of {count}") wrapping `StatePill state={linkedWorkflow.state}`; when `externalRef`: `<a href={externalRef.url} target="_blank" rel="noopener noreferrer">` `Mono` "{key}" (name "Open {key} in Jira (opens in a new tab)"); when `externalFlag`: `Pill variant="blocked"` "Jira {flag}" | Scenario 5 (state, project, assignee, linked workflow status), Scenario 2 (Jira link shown), R42. Rows in API order (`createdAt desc, id desc`). `Needs clarification` rows are never collapsed or hidden |
| 2.5 | Pager | when `nextCursor`: `Button variant="ghost"` "Load more" (appends the next page, keeps focus on the button, announces "{n} more loaded" via the `List`'s `aria-live="polite"` status) | Keyset pagination (R39); never more than 50 per request |
| 2.6 | **Saffron rule** | — | **Zero** `Button variant="saffron"` on the list in every state (§7) |

## 3. Requirement Detail — regions (top to bottom inside `Main`)

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 3.1 | Crumbs + Topbar | `Crumbs` "Requirements › {externalId}"; `Topbar` (`<h1>` "{title}"), `actions` = §3.6 `ActionBar` | Exactly one `<h1>` |
| 3.2 | Meta | `PageMeta`: `RequirementStatePill state={state}` (first, always visible), `Mono externalId`, "{project.name}", "Assignee: {assignee?.name ?? 'Unassigned'}", "Created {humanAgo(createdAt)} by {createdBy?.name ?? 'Jira'}", `Pill variant="neutral"` "live"/"reconnecting" | FR-009 state as a word in a pill; updates live (R40) |
| 3.3 | External link / flag | when `externalRef`: `KeyValue` "Jira" → `<a href target="_blank" rel="noopener noreferrer">` "{key}" (name "Open {key} in Jira (opens in a new tab)"); when `externalFlag`: `Notice tone="warning"` "The linked Jira issue {key} was {flag} on {date}. The linked workflow is paused in BLOCKED until a person decides." (+ `Link` to the workflow when present) | Scenario 2, FR-008, edge case (R36). The notice is never collapsible |
| 3.4 | Business objective | `Card as="section"` heading "Business objective" → `<p>` text (platform record, not a `Message`) | FR-007 |
| 3.5 | Analysis | `Card as="section"` heading "Analysis" → when `analysis.observedAt` is null: `Notice tone="info"` "No analysis yet — submit the requirement for analysis." (DRAFT) or "Analysis in progress — results appear here automatically." (ANALYZING). Otherwise `Message who="{analysis.agent} · analysis" variant="summary"` (DESIGN.md: summaries are not evidence) containing: optional `<p>` summary with `Pill variant="neutral"` "AI-generated"; `<h3>` "Acceptance criteria" → `<ol>` of items, each `<li>` text + `Pill variant="neutral"` "AI-generated" when `aiGenerated`, else `Pill variant="neutral"` "Authored by {source without 'user:'}"; `<h3>` "Identified business rules" → `<ol>` same; `<h3>` "Open questions ({n})" → `<ol>` same, or `<p>` "None" when empty. Footer `Mono` "Observed {humanAgo(observedAt)}" | Scenario 3, FR-009 (every AI item visibly labelled), DR-03 (agent claims inside `Message`, never as platform evidence). Human-authored criteria that exist before analysis render in the same `<ol>` with the "Authored by" pill, outside any `Message` when no analysis exists yet |
| 3.6 | Actions | `ActionBar` (in the Topbar): from `detail.actions` — `canSubmit` → `Button` "{submitLabel}" (`variant="saffron"` when state is `NEEDS_CLARIFICATION`, `variant="primary"` when `DRAFT`); `canApprove` → `Button variant="saffron"` "Approve"; `canReject` → `Button variant="ghost"` "Reject…" (opens an inline `Field label="Reason"` + `TextArea id="reject-reason"` + `Button variant="danger"` "Confirm rejection" + `Button variant="ghost"` "Cancel"); actions the role/state does not allow are **rendered disabled** with `aria-disabled="true"` and `ActionBar help={actions.reasons.join(' ')}` when the role could ever perform them (e.g. approver on a DRAFT: "Analysis has not finished"), and **omitted** when the role never can (viewer sees no buttons and a `Help` "Your role (viewer) is read-only") | FR-032 (role), FR-009/FR-010 (state); §7 saffron per state. Every action button has `aria-describedby` pointing at the help text when disabled |
| 3.7 | Decision | `Card as="section"` heading "Decision" → `KeyValue` rows: "Submitted" ("{name}, {date}" or "—"), "Approved" / "Rejected" (with reason), "Workflow" → `Link href={linkedWorkflow.href}` "{externalId} · stage {index} of {count}" + `StatePill state={linkedWorkflow.state}`, or "Not started" | Scenario 4 (workflow created, first stage queued → `StatePill` reads "queued"), FR-010, R42 |
| 3.8 | History | `Card as="section"` heading "History" → `List aria-label="Requirement history"` of ≤ 40 `ListRow`: `title` "{from ?? 'created'} → {to}" as words, `meta` "{actorName} · {humanAgo(occurredAt)}" + reason; below it `AuditTable rows={audit}` (≤ 20) | FR-002-style traceability (R32) |
| 3.9 | **Saffron rule** | — | At most **one** `Button variant="saffron"`: "Approve" (READY × decider) or "Resubmit for analysis" (NEEDS_CLARIFICATION × creator); **zero** otherwise (§7) |

## 4. Create requirement form (`/requirements/new`) — regions

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 4.1 | Topbar | `Topbar` (`<h1>` "New requirement") | Unchanged from the stub |
| 4.2 | Form | `Card` → `<form aria-labelledby>` with: `Field label="Project" required` + `Select id="req-project"` (one per `me.projects`, default = cookie project; "All projects" is **not** an option); `Field label="Title" required hint="3–200 characters"` + `Input id="req-title" maxLength=200`; `Field label="Business objective" required hint="10–4 000 characters"` + `TextArea id="req-objective" rows=6`; `Field label="Acceptance criteria (optional)" hint="One per line, up to 20"` + `TextArea id="req-criteria" rows=4` (split on newlines, trimmed, empty lines dropped) | FR-007 |
| 4.3 | Validation | `Field error` messages (R45): "Enter a title (3–200 characters)", "Describe the business objective (10–4 000 characters)", "Each acceptance criterion must be 1–1 000 characters", "At most 20 acceptance criteria", "Choose a project". Validated on submit (and on blur after the first submit); the first invalid field receives focus; each `Field` sets `aria-invalid` and `aria-describedby` to its error. API 400 `errors[]` are mapped to the same fields by `pointer` | Constitution III (defined invalid state) |
| 4.4 | Actions | `ActionBar`: `Button type="submit" variant="saffron"` "Create requirement"; `Button variant="ghost" href="/requirements"` "Cancel" | §7 — the single saffron control |
| 4.5 | Result | 201 → `router.push(detail.requirement.href)`; the detail's state pill reads "draft" and "Submit for analysis" is offered (Scenario 1) | SC-008 start of the primary journey |

## 5. States (Constitution III)

### 5.1 List
| State | Rendering |
|-------|-----------|
| loading | server first paint carries the page; on client refetch the `List` gets `aria-busy="true"` and rows stay visible (no skeleton flash) |
| populated | §2 |
| empty (no filters) | `Notice tone="info"` "No requirements yet." + `Button variant="primary" href="/requirements/new"` "Create the first requirement" (creators only); the `List` is not rendered |
| empty (filters set) | `Notice tone="info"` "No requirements match these filters." + `Button variant="ghost"` "Clear filters" |
| error | `Notice tone="error"` "Requirements couldn't be loaded." + `Button variant="ghost"` "Retry" (refetch); last good page stays rendered below on a refetch failure |
| refreshing (SSE) | `Pill` "live" pulses briefly; no layout shift |

### 5.2 Detail
| State | Rendering |
|-------|-----------|
| loading | server first paint; client actions set `aria-busy="true"` on the `ActionBar` and disable all its buttons while a request is in flight |
| populated | §3 per state: DRAFT (no analysis notice, Submit primary), ANALYZING (in-progress notice, no actions except disabled Reject with help), NEEDS_CLARIFICATION (analysis with open questions, Resubmit saffron, Reject ghost), READY (analysis, Approve saffron for deciders, Reject ghost), APPROVED / IN_IMPLEMENTATION / COMPLETED (analysis, Decision shows the workflow, no actions), REJECTED (Decision shows reason, no actions) |
| not available | `Topbar` "Requirement" + `Notice tone="error"` "This item isn't available to you." + ghost "Back to Requirements" (400/403/404/5xx alike — no existence leak) |
| action error | `Notice tone="error"` under the Topbar with the Problem `title` ("This requirement was already decided." for 409, "You can't do that with your role." for 403, otherwise "The action couldn't be completed."); focus moves to the notice; buttons re-enabled |
| flagged | §3.3 warning notice present in addition to the state above |

### 5.3 Create
| State | Rendering |
|-------|-----------|
| idle | §4 |
| invalid | §4.3 field errors, focus on the first invalid field, submit stays enabled |
| submitting | submit button `aria-busy="true"` and disabled, fields read-only |
| error | `Notice tone="error"` "The requirement couldn't be created." + Problem `title`; focus on the notice; form values preserved |
| forbidden | existing stub behaviour: `Notice tone="info"` "Your role ({role}) cannot create requirements…" and no form |

## 6. Keyboard and focus

- List: Tab order — "New requirement" → Project → State → Assignee → row titles (each `ListRow` title is the link; the workflow `StatePill` link and the Jira link are separate tab stops in that order) → "Load more". Changing a `Select` refetches without moving focus. "Load more" keeps focus on itself.
- Detail: Tab order — Crumbs → actions (Submit/Approve → Reject) → Jira link → workflow link → history rows. Opening "Reject…" moves focus to the reason `TextArea`; "Cancel" returns it to "Reject…". After a successful action focus moves to the `RequirementStatePill` container (`tabIndex=-1`) so the new state word is announced.
- Create: natural DOM order Project → Title → Objective → Criteria → Create → Cancel; `Enter` in `Input` submits; invalid submit focuses the first errored control.
- All controls are native `button`/`a`/`select`/`input`/`textarea` with visible focus rings from the design system (no `outline: none`).

## 7. Saffron decisions (DR-02 — justified per screen)

| Screen | Saffron control | Justification |
|--------|-----------------|---------------|
| List | none | Read/navigate only; no "person needed" action lives here. The Inbox already carries the saffron "New requirement" entry point; repeating it here would be a second saffron on the Inbox→list journey without a new human obligation |
| Detail — READY, decider | "Approve" | A person's decision is what the requirement waits for (FR-010) |
| Detail — NEEDS_CLARIFICATION, creator | "Resubmit for analysis" | The agent has stopped on open questions; a person must resolve them and resubmit |
| Detail — any other state/role | none | Nothing waits on a person: DRAFT's "Submit for analysis" is `primary`; Reject is `ghost`; ANALYZING/APPROVED/… have no human action |
| Create form | "Create requirement" | The screen exists only for a person to enter new work; it is the single primary action; consistent with the saffron Inbox link that leads here (R45) |

Tests assert the exact `.cd-saffron` count per state: list 0; detail 1 for the two rows above and 0 otherwise; create 1.

## 8. Accessible names asserted by tests

- `h1`: "Requirements" / "{title}" / "New requirement".
- Selects: "Project", "State", "Assignee" (list); "Project", "Title", "Business objective", "Acceptance criteria (optional)" (create).
- Lists: `aria-label="Requirements"`, `aria-label="Requirement history"`.
- Row links: "{title}"; "Workflow {externalId}, stage {i} of {n}"; "Open {key} in Jira (opens in a new tab)".
- Pills: text equals `REQUIREMENT_STATE_WORDS[state]` (e.g. "needs clarification"); workflow pills equal `stateToPill(state).word`; "AI-generated"; "Authored by {name}"; "Jira closed" / "Jira deleted".
- Buttons: "New requirement", "Load more", "Submit for analysis", "Resubmit for analysis", "Approve", "Reject…", "Confirm rejection", "Cancel", "Create requirement", "Retry", "Clear filters".
- Notices: role `status` for info, `alert` for error/warning.

## 9. Accessibility acceptance

- axe (WCAG 2.2 AA rules) passes in every §5 state in component tests and on the three populated screens in Playwright (SC-010).
- No information is conveyed by colour alone: every state is a word; AI provenance is a word; the Jira flag is a word.
- Live updates announce through the `List`/`PageMeta` `aria-live="polite"` region ("Requirement updated") and never steal focus.

## 10. Performance (plan Part D budgets)

- Initial list content ≤ 2 s p95 (SC-007); first page in the server render; ≤ 50 rows.
- Detail ≤ 2 s p95; analysis items ≤ 120, history ≤ 40, audit ≤ 20.
- `inbox.changed` → updated pill ≤ 5 s p95 (SC-003); debounce 300 ms.
- Route JS ≤ 200 KB gzip; browser imports only `@cdevi/contracts/requirement-rules`, `/vocabulary`, `/read-model`.
