# Contract: Inbox read model

**Feature**: 003-inbox-home | Implemented by `packages/contracts/src/read-model.ts` (pure, normative) and mirrored in `apps/api/src/services/inbox-query.ts` (SQL). `contracts/tests/read-model.test.ts` runs every example below; `api/tests/inbox.test.ts › paging over S-500 equals pure ordering` proves the SQL agrees.

All times are compared against `now` = the API's `generatedAt` for the snapshot (never the browser clock), so age, stale and expiry are consistent across users.

## 1. Tab classification (FR-006, FR-014, FR-015)

| state | tab | extra condition |
|---|---|---|
| `WAITING_FOR_HUMAN`, `BLOCKED`, `FAILED` | `needsYou` | — |
| `QUEUED`, `RUNNING`, `RETRYING`, `WAITING` | `running` | — |
| `COMPLETED`, `CANCELLED` | `done` | `finishedAt ≥ now − 7 days`; otherwise **not in the Inbox at all** |

`classifyTab('COMPLETED', finishedAt = now − 8d) → null`.

## 2. Kind (drives ask, badge, href)

Evaluated in this order; first match wins:

1. state `WAITING_FOR_HUMAN` **and** a pending approval exists → `approval`
2. state `WAITING_FOR_HUMAN` **and** a pending clarification exists → `clarification`
3. state `WAITING_FOR_HUMAN` with neither (data inconsistency from ingestion) → `approval`-less **`blocked`-style row**: kind `blocked`, ask `"Waiting for a person — no request recorded"`, logged as a warning. The item is still shown (never hidden).
4. state `BLOCKED` → `blocked`
5. state `FAILED` → `failed`
6. tab `running` → `running`
7. tab `done` → `done`

## 3. Ask (FR-007)

| kind | ask |
|---|---|
| `approval` | `approval.ask` verbatim (already one line, ≤ 240) |
| `clarification` | `clarification.question` verbatim |
| `blocked` | `"Blocked: " + (stateReason ?? "reason not provided")` |
| `failed` | `"Failed at " + (stageName ?? "stage " + stageIndex ?? "unknown stage") + ": " + (stateReason ?? "reason not provided")` |
| `running`, `done` | `null` (row is not a gate row) |

Asks are rendered as text; fragments the ingesting system wraps in backticks (`` `main` ``) are rendered with `Mono` by the web (no other markup is interpreted).

## 4. Risk rank and ordering (FR-010)

`riskRank`: `CRITICAL → 0`, `HIGH → 1`, `MEDIUM → 2`, `LOW → 3`, `null → 4`. Only `approval` items have a risk level.

| tab | ORDER BY |
|---|---|
| `needsYou` | `riskRank ASC, raisedAt ASC, workflowId ASC` |
| `running` | `startedAt DESC NULLS LAST, workflowId ASC` (QUEUED rows have no `startedAt` and sort last) |
| `done` | `finishedAt DESC, workflowId ASC` |

`raisedAt` = approval `requestedAt` | clarification `requestedAt` | otherwise `stateObservedAt`.

Examples (needsYou):
```
[HIGH approval 40m ago, MEDIUM approval 4m ago, clarification 2h ago, blocked 10m ago, failed 3d ago]
→ HIGH(40m), MEDIUM(4m), failed(3d), clarification(2h), blocked(10m)
```
Ties on `raisedAt` are broken by `workflowId` so pages are stable.

## 5. Stale and expiry (FR-008, FR-011)

- `isStale = tab === 'needsYou' && now − raisedAt > 24h` (strictly greater).
- `expiry` (approval only): `{ expiresAt, isExpired: now ≥ expiresAt }`. Web label: `isExpired ? "expired" : "times out in " + humanDuration(expiresAt − now)`; `humanDuration` rounds down to the largest two units (`3 h 56 m`, `2 d 4 h`, `< 1 m`).
- Both flags are computed server-side per snapshot; the web must not recompute with its own clock (it may re-render the same values).

## 6. Age and elapsed labels (web, using `generatedAt`)

- needsYou: `"asked " + humanAgo(raisedAt)` for approval/clarification; `"blocked " + humanAgo` / `"failed " + humanAgo`.
- running: `"stage " + index + " of " + count + (name ? " · " + name : "")`, then `humanDuration(now − startedAt)` (QUEUED: `"queued " + humanAgo(stateObservedAt)`).
- done: `humanAgo(finishedAt)`, `pullRequestRef` when present.
- `humanAgo`: `< 1 m` → "just now", minutes → "4 min ago", hours → "3 h ago", days → "2 d ago".

## 7. Keyset cursor

`cursor = base64url(JSON.stringify([key1, key2, workflowId]))` where the keys are the tab's ORDER BY values of the last row (`[riskRank, raisedAt, id]`, `[startedAt|null, id]`, `[finishedAt, id]`). The API rejects a cursor whose shape does not match the requested tab (`400 urn:cdevi:problem:invalid-cursor`). `limit` is always 50.

## 8. Project scope and permissions (FR-027, FR-028)

- `visibleProjects(user)` = all organization projects for `administrator`, else memberships.
- `project=all` → rows and counts over `visibleProjects`; `project=<id>` must be in `visibleProjects` else `404` (not `403`, to avoid confirming existence).
- Counts (`needsYou`, `running`, `done`), items and Today are computed in one `REPEATABLE READ` transaction with the same scope.

## 9. Counts invariant (SC-004)

For any snapshot: `counts.needsYou` = number of needsYou items across all pages of the same scope = `today.needsYou.value` = the `NavItem count` the web renders. The web renders all three from the **same snapshot object**; it never derives one from another.

## 10. Today summary (FR-017)

`windowStart = startOfDay(now, organization.timezone)`; counts as in data-model.md §5. `href`s: `/inbox?tab=running&project=…`, `/inbox?tab=done&project=…`, `/approvals?decided=today&project=…` (placeholder route), `/inbox?tab=needsYou&project=…`.
