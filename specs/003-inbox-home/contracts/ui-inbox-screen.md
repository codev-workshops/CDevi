# Contract: Inbox screens — components, states, accessibility

**Feature**: 003-inbox-home | Rules: `packages/design-system/DESIGN.md` (DR-01…DR-10) | Data: [openapi.yaml](openapi.yaml) `InboxSnapshot`, `Me`

Every element below is an `@cdevi/design-system` export. Components marked **(new, 1.2.0)** are added to the package first (research R10). No `cd-` class is written in `apps/web`; no `style=`; every state is a word in a pill.

## 1. Shell (all signed-in routes) — `apps/web/app/(app)/layout.tsx`

| region | component | content / props | a11y |
|---|---|---|---|
| root | `ThemeProvider theme="system"` → `AppShell variant="full"` | | landmarks from children |
| side | `Side` → `Brand` | "CDevi" + Sinhala wordmark | `lang="si"` on wordmark |
| nav | `Nav` → `NavItem href="/inbox" active count={counts.needsYou}` first, then `NavItem`s for Dashboard, Projects, Workflows, Requirements, Reviews, Testing, Approvals, Agents; `NavGroup "Administration"` → Integrations, Policies, Audit | count from the current snapshot (§5) | active → `aria-current="page"`; count → `aria-label="Inbox, n pending"` |
| side footer | text: `organization.name · user.displayName` + `Button variant="ghost"` "Sign out" (posts `/api/auth/sign-out`) | FR-003 | button has visible label |
| main | `Main` | page content | `<main>` |
| panel | `Panel` | Inbox only (other routes render without panel) | `<aside aria-label="Details">` |

Rule: **no sticky/fixed positioning** (DR-05); the shell scrolls with the page.

## 2. Inbox — `/inbox` (`InboxScreen`)

### 2.1 Topbar and meta
| element | component | notes |
|---|---|---|
| title | `Topbar` with `<h1>Inbox</h1>` | |
| primary action | `Button variant="saffron"` **New requirement** → `/requirements/new` | the **only** saffron control on the page (DR-02, SC-006). Viewer: `disabled` and wrapped in `ActionBar help="Your role (Viewer) cannot create requirements."`; the help text is `aria-describedby` of the button |
| scope | `PageMeta` items: project scope (`Field label="Project"` → `Select` with "All projects" + visible projects; changing it updates `?project=` and refetches), `Pill variant="neutral"` **demonstration data** when `organization.isDemo` | `Select` has a visible label; selected project is visibly indicated (FR-028) |

### 2.2 Tabs
`Tabs label="Inbox" value={tab} onChange` → `Tab value="needsYou" count={counts.needsYou}` **Needs you** · `Tab value="running" count={counts.running}` **Running** · `Tab value="done" count={counts.done}` **Done**. Default `needsYou` (FR-006). URL `?tab=` is the source of truth (deep-linkable from Today). Keyboard: ←/→/Home/End roving focus, Enter/Space selects (provided by `Tabs`). Accessible name: "Needs you, 5" (count read as part of the tab name).

### 2.3 Rows — one `List` per `TabPanel`
`List` props: `loading` **(new)** while the first snapshot for the scope is loading; `empty` per tab (below). Each item → `ListRow`:

| prop | needsYou | running | done |
|---|---|---|---|
| `title` | `item.title` | same | same |
| `href` | `item.href` (`/approvals/{requestId}` or `/workflows/{workflowId}`) | `/workflows/{id}` | `/workflows/{id}` |
| `trailing` | `StatePill state={item.state}` + (`RiskBadge level` if approval) + (`Pill neutral` "stale" if `isStale`) + (`Pill neutral` "expired" if `expiry.isExpired`) | `StatePill` | `StatePill` (cancelled renders struck through via mapping) |
| `ask` | `item.ask` — backtick fragments → `Mono` | — | — |
| `meta` | `project.key · agent · asked 4 min ago · times out in 3 h 56 m` / `· recommended answer available` (clarification with `hasRecommendedAnswer`) / `· blocked 10 min ago` / `· failed 3 d ago` | `project.key · agent · stage 2 of 7 · Implementation · 12 min` | `project.key · agent · completed 2 h ago · PR #412` |

Row semantics (from `ListRow`): `role="listitem"`, title is the `<a>`, gate rows have `aria-describedby` pointing at the ask; a row is a gate row **iff** `ask` is present, so every needsYou row is a gate row and no running/done row is. State word comes from `stateToPill` (never typed in app code). Rows never truncate the ask below one line; long titles/asks use the package's single-line ellipsis and the full text is the link's `title` attribute.

Load more: when `nextCursor` is present, a `Button variant="ghost"` **Load more (n remaining)** under the list appends the next page; focus moves to the first newly added row's link.

### 2.4 States (FR-025)
| state | rendering |
|---|---|
| loading (first snapshot) | `List loading` (skeleton rows, `aria-busy="true"`); tabs show counts only once known — no "0" placeholders |
| refreshing (SSE-triggered) | rows stay; `aria-busy` on the `List`; no skeleton |
| empty · needsYou · all projects | `List empty` = "Nothing needs you right now. See what is **Running**." (link switches tab) |
| empty · needsYou · project selected | "Nothing needs you in **payments-api**. Show **all projects**." (link resets scope) |
| empty · running / done | "No workflows are running." / "Nothing finished in the last 7 days." |
| error | `Notice tone="error" action={<Button>Retry</Button>}` **(new)** above the tabs: "Couldn't load the Inbox. Retry." — nav, primary action and previous rows (if any, marked stale by `aria-busy`) remain; no counts shown as current |
| session expired | redirect to `/sign-in?next=/inbox` with `Notice tone="info"` "Your session expired. Sign in to continue." |
| permission-restricted | nothing is rendered for hidden projects; the project `Select` lists only visible projects |

### 2.5 Panel (Today)
`Panel` → `PanelBlock heading="Today"` → `KeyValue` items: **Runs started** `<a href>{value}</a>`, **Completed**, **Approvals decided**, **Needs you**; values render `0` when zero. `PanelBlock heading="Workspace policy"` → `Card` with `policySummary.text` and a link "Policies" → `/policies`. Below 960 px the panel stacks under the list (shell behaviour); nothing is hidden.

### 2.6 Freshness
`lib/inbox-stream.ts` opens `EventSource('/api/inbox/stream')`; on `inbox.changed` it debounces 250 ms then refetches `GET /api/inbox?tab&project&cursor=∅` and replaces the snapshot (rows, counts, Today from one object — §9 of the read-model contract). Reconnect back-off 1 s → 30 s with `Last-Event-ID`. When a refresh removes the row that currently has focus, focus moves to the tab list (never lost).

## 3. Sign-in — `/sign-in` (`(auth)/sign-in/page.tsx`)

`FocusLayout` **(new)** → `Card` → heading "Sign in to CDevi" → `Field label="Email"` `Input type="email" autoComplete="username"` · `Field label="Password"` `Input type="password" autoComplete="current-password"` · `Button variant="saffron" type="submit"` **Sign in** (the one saffron on this screen) · error: `Field error="Email or password is incorrect."` on the password field (`role="alert"`) — identical for unknown email and wrong password · rate-limited: `Notice tone="error"` "Too many attempts. Try again in a minute." · `?next=` honoured only for same-origin paths. Loading: `Button loading` (`aria-busy`). Successful sign-in lands on `/inbox` (FR-001).

## 4. Record stubs — `/approvals/[id]`, `/workflows/[id]` (research R9)

`Topbar` `<h1>{title}</h1>` (no saffron button) · `PageMeta`: `StatePill`, `RiskBadge` when approval, project, agent · `Notice tone="info"` "Decisions for this item are made in the Approval Center / Workflow Detail, which arrives with specs/001." · `Card` → `KeyValue` of the row facts (ask/question, requested, expires, stage, PR) · `Button variant="ghost"` **Back to Inbox** (`href="/inbox?tab=…&project=…"`). Unknown id → the shell with `Notice tone="error"` "This item isn't available to you." (404 and 403 look identical). Resolved item → `Pill` "resolved" + who/when in `KeyValue` (spec edge case, per `specs/001` FR-015).

## 5. Placeholders — `/[section]`, `/requirements/new`

`Topbar` `<h1>{Section}</h1>` · `Card` → "This screen arrives with specs/001." · no saffron button. `/requirements/new` for a Viewer → same page plus `Notice tone="info"` explaining the role (they can only reach it by URL).

## 6. Accessibility acceptance (SC-005)

- axe (Vitest + Playwright): zero violations on `/sign-in`, `/inbox` × {needsYou, running, done} × {populated, empty, loading, error}, `/approvals/[id]`, `/workflows/[id]`, `/[section]`.
- Keyboard walk-through (Playwright): Tab → Sign out … → project `Select` → tab list → ←/→ → Enter → first row link → Enter → stub page → **Back to Inbox** → focus is on the tab list of the same tab. No focus trap; focus visible at every stop (`:focus-visible` from the package).
- Names asserted: `Inbox, 5 pending`; `Needs you, 5`; row link = title; `aria-describedby` resolves to the ask; `RiskBadge` name ends with "risk"; `StatePill` text ∈ the nine words.
- Contrast: new pairs for `Notice` (info fg/bg, error fg/bg, both themes) and `.cd-skeleton` on `surface` added to `tokens/pairs.json`.
- Reduced motion: skeleton has no animation under `prefers-reduced-motion`.

## 7. Visual baselines

New gallery entries: `Notice` (info, error, with action), `List loading`, `FocusLayout`. New reference in Playwright visual suite: `/inbox` needsYou tab with the S-500 seed at 1440 × 900, light and dark. Baselines committed with the implementing PR.
