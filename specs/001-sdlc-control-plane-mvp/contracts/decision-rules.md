# Contract: Human decision rules (Approval Center)

Normative for `packages/contracts/src/decision-rules.ts` (pure, zod-free, exported from `@cdevi/contracts/read-model`), `apps/api/src/services/decisions.ts` and the Approval Center screens (User Story 2, FR-011…FR-015, FR-032). Tested without a database in `packages/contracts/tests/decision-rules.test.ts`; the API tests prove the same rules against real Postgres.

## 1. Who may decide (FR-032)

`canDecide(role)` → `true` for `approver` and `administrator`, `false` for `engineer` and `viewer`.

- API: a session whose role is not allowed receives **403** `urn:cdevi:problem:forbidden` before any row is read.
- Web: `ApprovalCenterDetail.canDecide === false` renders every decision control `disabled` with the `ActionBar help` text "Only approvers and administrators can decide." — the item, its context and its resolution stay readable.

## 2. Which items appear (FR-011, FR-025)

An item is **pending** when it belongs to a visible project (administrators: all projects; other roles: memberships), its workflow is in `WAITING_FOR_HUMAN`, and for approvals `decision IS NULL`, for clarifications `answered_at IS NULL`. `project=all` includes every visible project; `project={uuid}` narrows to that one (an invisible uuid yields an empty list, not 404).

## 3. Ordering (scenario 1)

`orderApprovalCenter(items)` sorts by `rank(riskLevel)` **descending**, then `requestedAt` **ascending**, then `id` ascending, where `rank` is the Inbox `riskRank` (CRITICAL 3 · HIGH 2 · MEDIUM 1 · LOW 0) and a clarification (`riskLevel: null`) ranks **−1**, i.e. after every approval.

Worked example — input: `A(MEDIUM, 09:00)`, `B(CRITICAL, 09:30)`, `C(clarification, 08:00)`, `D(MEDIUM, 08:30)`, `E(LOW, 07:00)` → output `B, D, A, E, C`.

## 4. Confirmation (FR-013, scenario 4)

`requiresConfirmation(riskLevel)` → `true` for `HIGH` and `CRITICAL`.

- API: `POST /approvals/{id}/approve` with `confirmed !== true` for such an approval → **400** `validation`, `errors: [{ path: 'confirmed', message: 'Explicit confirmation is required for HIGH and CRITICAL approvals.' }]`; nothing is written.
- Web: the first "Approve" click on such an item does not post; it renders the confirmation step (§ui-approval-center.md 3.6) restating the ask, the risk word and "This will resume the workflow." The saffron control becomes "Confirm approval"; Escape or "Back" reverts. LOW / MEDIUM approve on the first click.

## 5. Resulting state (scenarios 3–5)

`resultingState(decision)`:

| decision | to |
|----------|----|
| `approve` | `RUNNING` |
| `answer` | `RUNNING` |
| `reject` with `target` | `target` (`BLOCKED` default in the UI, or `CANCELLED`) |

`decisionAllowed(workflowState, itemPending)` is `workflowState === 'WAITING_FOR_HUMAN' && itemPending`. Every target above satisfies `canTransition('WAITING_FOR_HUMAN', to)` from the 0001 state machine — the transition rules are reused, not redefined. A workflow not in `WAITING_FOR_HUMAN` → **409** `invalid-transition`, nothing written.

## 6. Rejection (FR-013, scenario 5)

`RejectRequest.reason` is required (trimmed, 1–500 chars) and `target ∈ { BLOCKED, CANCELLED }`. The reason is stored on the approval (`rejection_reason`, `rejection_target`), copied to the workflow transition's `reason` (so the Workflow Detail activity feed and the requesting agent's run show it), and echoed in the audit event `details.reason`. `CANCELLED` also sets `workflows.finished_at`.

## 7. Answers (FR-014, scenarios 2–3)

`answerIsValid(body, options)`:

- exactly one of `option` or `text` is present;
- `option` must equal one `options[].value` (unknown → 400 `validation`, path `option`);
- `text` is trimmed and 1–2 000 chars.

Persisted: `answered_at = now`, `answered_by = user.displayName`, `answered_by_user_id = user.id`, `answer_option` (when an option) and `answer_text` (the option's label, or the free text). The answer appears in `ApprovalCenterDetail.resolution` (the requirement record) and as `clarification.answered` in `audit[]`.

## 8. Exactly once (FR-015, edge case)

The item row is read `FOR UPDATE` first. If it is already decided/answered the request is refused with **409** `urn:cdevi:problem:already-resolved` and the body carries `resolution { outcome, by { id, displayName }, at, reason, target, answerOption, answerText, workflowState }`. `resolution.workflowState` is the state the decision produced (`resultingState`), not the workflow's current state — it reads the same after the workflow moves on. Two concurrent callers: the first commit wins; the second receives the 409 with the first caller's resolution. The web renders it as `Notice tone="info"` "Already resolved — {outcome} by {displayName} {relative at}." and disables the controls.

## 9. Audit (FR-029, SC-004)

Every successful decision inserts exactly one `audit_events` row in the same transaction:

| field | value |
|-------|-------|
| actor_type / actor_id / actor_name | `user` / `user.id` / `user.displayName` |
| action | `approval.approved` \| `approval.rejected` \| `clarification.answered` |
| target_type / target_id | `approval` \| `clarification` / item id |
| workflow_id, project_id | the item's |
| risk_level | approval's risk; `null` for clarifications |
| result | the resulting workflow state |
| details | `{ ask }` + `{ reason, target }` (reject) or `{ question, answerOption, answerText }` (answer) |
| occurred_at | request clock = `decided_at` / `answered_at` |

The table refuses `UPDATE`/`DELETE` (trigger). `GET /approvals/{id}` returns the newest 20 events for the target as `AuditEventView` (id, time, actor, action, target, workflow, policy, risk, result) — the shape of the design-system `AuditTable` row.

## 10. Live propagation (FR-034, scenario 6)

No new notification: the `UPDATE`s on `approvals` / `clarifications` / `workflows` fire the existing `notify_inbox_changed()` triggers. Clients on `GET /inbox/stream` receive `inbox.changed` with the `workflowId`; the header count (`NavItem count` → `/approvals`), the Inbox and both Approval Center screens refetch.
