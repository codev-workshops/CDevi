# Contract: Approval Center — list and decision screens, states, accessibility

Normative for `apps/web/app/(app)/approvals/` (User Story 2). Every element is an `@cdevi/design-system` component; no `cd-` markup or inline styles in the app (DR-06…DR-09). Data comes only from `GET /api/approvals`, `GET /api/approvals/{id}` and the three decision routes ([openapi.yaml](openapi.yaml)); rules from [decision-rules.md](decision-rules.md). The screens derive nothing except relative time strings.

## 1. Routes and composition

- `approvals/page.tsx` (server): reads the project cookie (`cdevi_project`, same as the Inbox) → `apiFetch<ApprovalCenterSnapshot>('/api/approvals?project=…', { cookie })`; any error renders §4 *error*. Success renders `<ApprovalCenterScreen initial={snapshot} me={me} />`. Replaces the `[section]` placeholder for `/approvals`.
- `ApprovalCenterScreen.tsx` (client): owns the project `Select` (writes the cookie and `?project=` like the Inbox), refetches on change, subscribes with `subscribeInboxStream({ onChange })` (debounced 300 ms) and refetches.
- `approvals/[id]/page.tsx` (server): `apiFetch<ApprovalCenterDetail>('/api/approvals/{id}', { cookie })`; 404/403 → §4 *not found*; other errors → *error*. Success renders `<ApprovalDecisionScreen initial={detail} />`. `renderRecord`/`RecordStub` are no longer used for approvals.
- `ApprovalDecisionScreen.tsx` (client): renders §3, owns the approve / reject / answer forms, posts through `/api/*`, refetches on `inbox.changed` for its `workflowId`.
- Shell (`AppShell`, `Side`, `Main`, `Panel`) comes from `(app)/layout.tsx`; the header `NavItem` "Approvals" already carries the pending count and links to `/approvals` (scenario 6).

## 2. List screen regions (top to bottom inside `Main`)

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 2.1 | Topbar | `Topbar` (`<h1>` "Approval Center"), `actions` empty | Exactly one `<h1>` |
| 2.2 | Meta | `PageMeta`: `Field label="Project"` + `Select id="approvals-project"` ("All projects" + one option per `me.projects`), then "{counts.approvals} approvals · {counts.clarifications} clarifications", then `Pill variant="neutral"` "live" / "reconnecting" | FR-025 |
| 2.3 | Items | `List aria-label="Needs a decision"` → one `ListRow` per `items[]` **in array order** (already ordered by the API, mirrored by `orderApprovalCenter`): `title` = `ask` linking to `href`; `leading` = `RiskBadge level` (approval) or `Pill variant="neutral"` "clarification"; `meta` = `Mono` `workflowExternalId` · `workflowTitle` · project key · "Requested by {requestedBy ?? 'unknown agent'}" · `<time dateTime>` relative `requestedAt` · "Expires {relative}" when `expiresAt`; `trailing` = `StatePill state="WAITING_FOR_HUMAN"` | Scenario 1: identifier, what, who, when, risk. No decision controls in rows (DR-02) |

## 3. Decision screen regions

| # | Region | Component(s) | Content / rules |
|---|--------|--------------|-----------------|
| 3.1 | Topbar | `Topbar` (`<h1>` = `item.ask`), leading `Button variant="ghost" href="/approvals"` "Back to Approval Center" | |
| 3.2 | Meta | `PageMeta`: `StatePill state={workflowState}`, `RiskBadge` (approvals), `Pill` "clarification" (clarifications), `Mono` external id, project key, "Requested by {requestedBy}", `<time>` requestedAt | Words from `stateToPill` / `riskToVariant` |
| 3.3 | Context | `Card as="section"` heading "Context" → `KeyValue` Workflow (link `/workflows/{workflowId}`) / Project / Requested by / Requested at / Expires (approvals); approval `context` or clarification `whyItMatters` as body text under a heading "Why this matters" (clarifications) or "What is being requested" (approvals) | Scenario 2 |
| 3.4 | Links | `List aria-label="Links"` → `ListRow` per present `links` key: Requirement · Workflow · Agent run · External ticket · Pull request (`href` external opens in same tab) | Empty → `List empty="No links provided."` |
| 3.5 | **Decision (pending, `canDecide`)** — approval | `DecisionCard tone="needs-you"` title "Decision" badge `RiskBadge`, body "Approving resumes the workflow. Rejecting requires a reason." `actions` = `ActionBar`: **saffron `Button` "Approve"** + `Button variant="ghost"` "Reject…" | The saffron button is the only one on the screen |
| 3.6 | Confirmation step (HIGH / CRITICAL) | Replaces 3.5's actions after "Approve": `Notice tone="info"` "Confirm: **{ask}** — risk **{RiskBadge}**. This will resume the workflow." + `ActionBar`: **saffron `Button` "Confirm approval"** + `Button variant="ghost"` "Back" | FR-013; Escape or Back reverts to 3.5; focus moves to "Confirm approval" |
| 3.7 | Reject form | Replaces 3.5's actions after "Reject…": `Field label="Reason" required` + `TextArea id="reject-reason" required maxLength=500`; `fieldset` legend "Then move the workflow to" with two `OptionRow name="target"`: **BLOCKED** (checked by default, `recommended`) "Keeps the workflow so an engineer can fix and retry" · **CANCELLED** "Stops the workflow permanently"; `ActionBar`: `Button variant="danger"` "Reject" + `Button variant="ghost"` "Back" | Scenario 5. Empty reason → `Field error` "A reason is required." and the field gets focus; no request sent. The saffron button is hidden while this form is open (DR-02 still exactly one saffron control — none) |
| 3.8 | **Decision (pending, `canDecide`)** — clarification | `DecisionCard tone="needs-you"` title "Your answer" → `fieldset` legend "Suggested answers" with one `OptionRow name="answer"` per `options[]` (`recommended` flag rendered) **plus** a final `OptionRow value="__text"` "Other (write an answer)"; when it is selected, `Field label="Answer" required` + `TextArea id="answer-text" maxLength=2000`; `ActionBar`: **saffron `Button` "Submit answer"** | Scenario 2. Nothing selected / empty text → `Field error` "Choose an option or write an answer." |
| 3.9 | Permission-disabled | Same cards as 3.5/3.8 with every control `disabled` and `ActionBar help="Only approvers and administrators can decide."` | `canDecide === false` (engineer, viewer). No saffron control on the page (disabled buttons use `variant="primary"`) |
| 3.10 | **Resolved** | `Notice tone="info"` role status: "{Approved \| Rejected \| Answered} by **{by.displayName}** {relative at}." + `KeyValue` rows: Outcome (`StatePill state={resolution.workflowState}`), Reason (reject), Moved to (`StatePill` target), Answer (`answerText`) | Replaces 3.5–3.9 whenever `resolution !== null`, including right after the user's own decision and after a 409 already-resolved (edge case: "already resolved, by whom, with what outcome") |
| 3.11 | Audit (Panel) | `PanelBlock title="Audit"` → `AuditTable` with `audit[]` rows (time, actor, action, target, workflow, risk, result) | Empty → text "No decisions recorded yet." Scenario 3: the answer appears here as `clarification.answered` |
| 3.12 | Freshness (Panel) | `PanelBlock` → "Updated {relative generatedAt}" + `Pill` live / reconnecting | |

## 4. States (Constitution III)

| State | List screen | Decision screen |
|-------|-------------|-----------------|
| loading | `List loading` (3 skeleton rows, `aria-busy`) | server-rendered; client refetch shows `aria-busy` on `Main` and keeps content |
| empty | `List empty` — "Nothing needs a decision." (`all`) or "Nothing needs a decision in **{key}**. Show all projects" (link resets the selector) | — |
| error | `Notice tone="error"` "Couldn't load approvals." + `Button variant="ghost"` "Retry" (refetch) | `Notice tone="error"` "Couldn't load this item." + Retry; page-level fetch error renders the same inside `Main` |
| not found | — | `Notice tone="error"` "This item doesn't exist or you don't have access." + "Back to Approval Center" |
| submitting | — | the clicked button `disabled` with `aria-busy`; other controls disabled; no optimistic update |
| submit error | — | `Notice tone="error"` with the Problem `detail` (400 validation shows field errors instead); controls re-enabled; focus stays on the actioned button |
| already resolved (409) | — | render §3.10 from `problem.resolution` |
| permission-disabled | — | §3.9 |
| refresh | rows re-render in place; the focused row keeps focus | resolution appears via refetch when another user decides |

## 5. Keyboard and focus

Tab order, decision screen: Back → context/links → (pending) Approve → Reject… → panel links. After "Approve" on HIGH/CRITICAL focus moves to "Confirm approval"; after "Reject…" focus moves to the Reason field; after "Back" focus returns to the button that opened the step. After a successful decision focus moves to the resolved `Notice` (`tabIndex=-1`). Escape closes the confirmation/reject step. `OptionRow`s are native radios (arrow keys move within the group).

## 6. Accessible names asserted by tests

- `heading level 1` = "Approval Center" / the item's ask.
- `combobox` "Project"; `list` "Needs a decision"; each row's link name = the ask.
- `button` "Approve", "Confirm approval", "Reject…", "Reject", "Back", "Submit answer", "Back to Approval Center", "Retry".
- `textbox` "Reason" (required), "Answer" (required); `radiogroup` "Then move the workflow to" with radios "BLOCKED" and "CANCELLED"; `radiogroup` "Suggested answers".
- `status` for info notices; `alert` for error notices; `table` "Audit".

## 7. Accessibility acceptance

axe (WCAG 2.2 AA tags, colour contrast excluded in jsdom) passes for: list loading / populated / empty / error; decision pending-approval LOW, pending-approval HIGH (before and after "Approve"), reject form open with validation error, pending-clarification (option and free-text branches), permission-disabled, resolved, already-resolved, not found. Playwright runs page-level axe on the list and one decision screen.

## 8. Performance (plan Part B budgets)

Initial content ≤ 2 s p95 (SC-007 workload); `GET /api/approvals` ≤ 200 ms p95; `GET /api/approvals/{id}` ≤ 150 ms p95; decision POST ≤ 250 ms p95; decision → header count refresh ≤ 5 s p95 (SC-003); route JS ≤ 200 KB gzip (`check:size`); refetch re-render ≤ 100 ms.
