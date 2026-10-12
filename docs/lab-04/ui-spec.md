# Lab 4 UI Specification — TokTickIT (Zen Green)

> Status: proposed — PR #101 (Issue #92). Extends `docs/lab-03/ui-spec.md`. Contract:
> [`specification.md`](./specification.md); API: [`api-spec.md`](./api-spec.md); tests:
> [`tests.md`](./tests.md).

Everything in Lab 2 `ui-spec.md` (tokens §2, type/spacing §3, component states §5, validation
placement §5.2, badges §7, responsive §11, accessibility §12) and Lab 3 `ui-spec.md` (badges §3,
shell §4, queue §9, Ticket Detail §10, responsive §12, accessibility §13) **remains in force
unchanged**. This document specifies only what Lab 4 adds or changes.

## 1. Zen Green reuse and extensions

Reused as-is: `Button` variants, `FormField`, inputs, `StatusBadge` (eight statuses), `PriorityBadge`
(requested and IT variants), `RoleBadge`, `OwnerCell`, `LoadingState`, `EmptyState`,
`NoResultsState`, `ErrorState`, success panel, confirm dialog, table-to-card pattern, `MessageThread`
card styling, the `--zen-readonly-bg` convention for read-only fields. Obsolete or duplicate UI left
over from earlier labs (dead links, leftover scaffolding text) is removed (FR-23).

New components (all in `client/src/`): `MetricCard`, `DashboardList`, `ActionTakenTable`/`ActionCard`,
`ActionTakenForm`, `ActionStatusBadge`, `FollowUpTag`, `StatusHistory`, `ResolutionChecklist`.

New tokens in `client/src/styles/theme.css` (no hard-coded hex elsewhere):

| Token | Value | Use |
|---|---|---|
| `--zen-action-planned-bg` / `-text` | `#EEF1F5` / `#3A4656` | Action status Planned |
| `--zen-action-progress-bg` / `-text` | `#FFF4D6` / `#6B4A00` | Action status In Progress |
| `--zen-action-done-bg` / `-text` | `#E4F3EA` / `#166534` | Action status Completed |
| `--zen-action-cancelled-bg` / `-text` | `#EFEDED` / `#6B6B6B` | Action status Cancelled |
| `--zen-metric-attention` | `--zen-warning` | Left accent on a card that needs action (never the only cue) |

Every pair must clear AA 4.5:1 (asserted by S-04).

**`ActionStatusBadge`** is deliberately *not* a pill: 4px radius, 0.75rem/600, text label always shown
("Planned", "In progress", "Completed", "Cancelled"), so it cannot be mistaken for the 999px-radius
Ticket `StatusBadge` that has overlapping words. **`FollowUpTag`**: "⚑ Follow-up" with text, shown
only when follow-up is required.

## 2. Navigation and role landing

Changes Lab 3 §4.2 and the `RoleLandingRedirect` behavior (`specification.md` D-12).

| Role | Nav destinations (in order) |
|---|---|
| Requester | **Dashboard**, My Tickets, Create Ticket |
| IT Staff | **Dashboard**, Ticket Queue |
| Administrator | **Dashboard**, Ticket Queue, User Management |

- Dashboard is first for every role and is the role landing route: `/` and a successful login/forced
  password change redirect to `/dashboard`. The wordmark links to `/dashboard`.
- Active page uses `aria-current="page"` (Lab 2 rule). "Dashboard" is active only on `/dashboard`;
  "My Tickets" and "Ticket Queue" stay active on their own list only, as in Lab 2/3.
- Routes: `/dashboard` wrapped in `RequireAuth` (renders the role's variant); `/staff/tickets` and
  `/staff/tickets/:id` allow `IT_STAFF` and `ADMINISTRATOR`; Requester routes unchanged. A role on a
  route it may not use gets the Lab 3 forbidden state with no protected request issued (L3-AC-18);
  its link now reads "Go to Dashboard" and targets `/dashboard`.
- Lists read drill-down parameters from the URL (`scope`, `status`, `owner`, `itPriority`, `myActions`,
  `followUp`, `sort`, `order`/`direction`; and `role` on User Management) so a dashboard link and a browser Back both restore the
  filter state; a filter shown as a chip row makes the active drill-down visible and clearable
  ("Clear filters", Lab 2 `NoResultsState` pattern).

## 3. IT Staff Dashboard  (`/dashboard`, IT Staff and Administrator)

Metrics and definitions: `api-spec.md` §5. The Administrator sees the same screen plus a **Users**
strip.

### 3.1 Layout (desktop ≥ 992 px; content max-width 1120 px)

| Band | Content |
|---|---|
| Header | "Dashboard" `h1`; right side "Updated 14:05 (Bangkok)" and a **Refresh** secondary button. |
| Work queue (4-up) | `MetricCard`: **Unassigned**, **Owned by Me**, **Urgent**, **Follow-ups Required**. |
| My Open Actions | Card: value = actions, sub-label "on N tickets"; below it up to 5 rows (When, description, status, ticket number link). |
| Tickets by status | Eight compact count links, one per status, each with the `StatusBadge` text and the count. Zero shown as "0". |
| Open by IT Priority | Three compact count links (Low/Medium/High) using the IT `PriorityBadge`. |
| Lists (2-up) | **Urgent Tickets** and **Recently Updated**, each ≤ 5 rows: ticket number, summary, status, IT priority/owner, updated. Each row links to `/staff/tickets/:id`; header link "View all (N)". |
| Users (Administrator only) | Three cards: role, **total** (active + inactive) as the value, sub-label "N active · M inactive", linking to `/admin/users?role=…`, whose list shows both active and inactive users (so rows = the value). |

### 3.2 `MetricCard`

```
Unassigned                 ← label, 0.875rem/600
2                          ← value, 2rem/700, tabular numerals
Open tickets with no owner ← sub-label, 0.75rem, --zen-text-muted
View list →                ← visible affordance
```

- The whole card is one `<a>` (`Link`) with `aria-label="Unassigned: 2, view list"`; the visible text
  and the label carry the same number (AC-36).
- Needs-attention variant (Unassigned > 0, Urgent > 0, Follow-ups > 0, Waiting for Me > 0): 4px
  `--zen-metric-attention` left border **and** a sub-label that says so ("Needs an owner"); colour is
  never the only cue.
- A zero card keeps the normal style, shows `0`, sub-label "None right now", and still links to the
  (empty) list.
- Min 44 px target, visible `:focus-visible` ring, hover raises border only (no layout shift).

### 3.3 States

| State | Presentation |
|---|---|
| Loading | `LoadingState` skeleton cards, `role="status"`; no stale numbers shown. |
| Empty lists | Per list, plain text: "No urgent tickets.", "No tickets updated in the last 7 days.", "You have no open actions." |
| All metrics zero | Page still renders every card with `0`; no global empty banner. |
| Forbidden | If the dashboard endpoint answers `403` (e.g. the role changed mid-session), the Lab 3 forbidden state replaces the dashboard; no numbers are shown. The role-matching variant is chosen from the session, so a normal user never triggers it. |
| Failure | `ErrorState` `role="alert"`: "We couldn't load the dashboard." + **Retry**; no partial numbers. |
| Refresh | Button shows busy state; previous data stays visible until the new payload arrives. |

## 4. Requester Dashboard  (`/dashboard`, Requester)

Metrics: `api-spec.md` §4. It summarises only the caller's Tickets and does not duplicate My Tickets.

| Band | Content |
|---|---|
| Header | "Dashboard", Updated time, Refresh. |
| Cards (2-up) | **Open Tickets**, **Waiting for Me** (needs-attention variant when > 0, sub-label "IT Staff are waiting for your reply"). |
| Lists (2-up) | **Recently Updated** and **Recently Resolved**, ≤ 5 rows each: ticket number, summary, `StatusBadge`, date; row → `/tickets/:id`; header link "View all (N)". |

Empty messages: "You have no open tickets.", "Nothing is waiting for you.", "No tickets updated in
the last 7 days.", "No tickets resolved in the last 7 days." States are identical to §3.3. IT Priority,
owner and internal data never appear.

## 5. Actions Taken on Ticket Detail

### 5.1 IT Staff Ticket Detail (`/staff/tickets/:id`, extended)

Card order: details/attachments (Lab 3) → **Actions Taken** → **Status history** → Public Comments →
Internal Notes. The Lab 3 operational panel stays (right column ≥ 992 px). For an **Administrator** the
owner select, status control, comment composer and note composer are not rendered (they are
IT-Staff-only, `specification.md` §4.1); IT Priority stays editable; Actions Taken is fully usable.

**Header of the card:** "Actions Taken (N)", the sub-label "Visible to the requester" (it is shared content, unlike Internal Notes), and a primary **Add action** button (hidden when the
Ticket is `CLOSED`/`CANCELLED`, replaced by *"This ticket is closed. Actions Taken are read-only."*).

**List mode, desktop/tablet (≥ 768 px) — table**, columns chosen for readability:

| Column | Notes |
|---|---|
| When | `actionAt`, formatted with the existing `formatDateTime`. |
| Action | `description`, two-line clamp with `title`. |
| Result | two-line clamp with `title`. |
| Performed by | name (and `RoleBadge` for Administrator). Assignee shown beneath as "→ Name" when set. |
| Status | `ActionStatusBadge`. |
| Follow-up | `FollowUpTag` or empty. |
| (actions) | **View** (always) and **Edit** (non-terminal only), real buttons with `aria-label="Edit action from <date>"`. |

Tablet drops nothing; long text clamps. **Below 768 px** each Action is a stacked card: When +
`ActionStatusBadge` first line; Action; Result; Performed by / Assignee; follow-up tag; View/Edit
buttons ≥ 44 px. **Empty state:** "No actions recorded yet." with Add action.

**View mode** (inline expansion beneath the row/card, or a full-width panel): all fields as read-only
static text on `--zen-readonly-bg`: date, description, result, status, performed by, assignee,
follow-up required, follow-up note, **attachment notes** ("Look for: …"), **Logged at** (`createdAt`), last updated by/at. Terminal
Actions show a note *"Completed actions are read-only."* / *"Cancelled actions are read-only."* and no
Edit button.

**Create / edit form** (same component; inline card, full width; focus moves to the first field):

| Field | Control | Notes |
|---|---|---|
| Action date/time * | `datetime-local`, default now | Helper: "When the work was done, or is planned for. A future time is allowed only for a planned action." |
| Performed by | read-only text, the signed-in user | "Recorded automatically." Not an input. |
| Assignee | select: "Unassigned" + active IT Staff and Administrators | Edit only: unchanged if untouched. |
| Description * | textarea, counter `x/2000` | |
| Result (required when Status is Completed) | textarea, counter `x/2000` | Optional for Planned/In progress; the `*`/`aria-required` appear when Completed is selected. Helper: "What came of it. Required to complete the action." |
| Status * | select | Create: Planned / In progress / Completed. Edit: current status plus **only** permitted next states (`specification.md` BR-09); Cancelled is confirmed in a dialog. |
| Follow-up required? | checkbox | |
| Follow-up note * | textarea `x/1000`, rendered only when the checkbox is on (`aria-controls`/`aria-expanded`); turning the box off hides and clears it | |
| Attachment notes | textarea `x/500` | Helper: "Which existing ticket attachment or file to look at. This does not upload a file." |

Buttons: primary **Save action** (busy: "Saving…", disabled while pending, BR-36), secondary
**Cancel**. Required fields use `*` + `aria-required`; editable fields use surface style, read-only
(View mode, Performed by, terminal Actions) use the read-only style (V-06).

### 5.2 Feedback

| Situation | Presentation |
|---|---|
| Validation (400) | Message directly below each field (`fields[]`), `aria-invalid`, focus to first invalid; entered values kept. |
| Success | Form closes; row/card appears or updates in place; `role="status"` "Action saved." for 4 s. |
| Invalid assignee (409) | Field message on Assignee: "That person can't be assigned. Choose an active IT Staff member."; values kept. |
| Stale (409 `STALE_UPDATE`) | Callout above the form: "This action was changed by *Name* at *time*." with the current values shown read-only next to the form and a button **Use latest version (keep my edits)**, which swaps in the new `version`/non-edited fields while keeping what the user typed. Nothing is lost. |
| Locked / closed (409) | Callout: "This action can no longer be edited." / "This ticket is closed." Form becomes read-only, values still visible. |
| Forbidden (403) | Callout "You don't have permission to change Actions Taken."; Add/Edit controls are not rendered for a Requester in the first place. |
| Not found (404) | Callout "This action or ticket no longer exists." + link to the Ticket Queue. |
| Safe failure (500/network) | `ErrorState` inside the card with **Retry**; the form stays open with entered values. |
| Loading | `LoadingState` in the card. |

Duplicate protection: **Save action** and status controls disable while pending; Retry reuses the same
`clientRequestId` so a network retry cannot create a second Action (BR-35).

### 5.3 Requester Ticket Detail (`/tickets/:id`, extended)

Below Attachments (above Public Comments): **Actions taken** and **Status history**, both read-only,
no buttons. Actions use the same table (≥ 768 px) / cards (< 768 px) with columns When, Action, Result,
Performed by, Status, Follow-up; View expands read-only fields including follow-up note and attachment
notes. Empty states: "No actions have been recorded yet." and "No status changes yet." Internal Notes
never appear. IT Priority stays hidden (Lab 3 §7).

## 6. Ticket workflow and resolution feedback

On Staff Ticket Detail (IT Staff only; Administrator sees status as read-only text).

- **Cancel confirm dialog** adds: "Open actions on this ticket will be cancelled." (BR-41); after success the Actions list reloads.
- **Status control** (Lab 3 §10 select): lists only the transitions `specification.md` §5.1 permits
  from the current status; Resolved, Closed, Reopened and Cancelled keep their confirm dialogs. A
  transition the matrix forbids is never offered.
- **Resolution checklist** (`ResolutionChecklist`): when Resolved is selected, a list appears under the
  control — "✓ / ✗ Ticket has an owner", "✓ / ✗ At least one action is completed", "✓ / ✗ No action is
  planned or in progress (N remaining)" — computed from the loaded data. It is guidance only; the
  button stays enabled so the backend remains the authority.
- **`RESOLUTION_BLOCKED`** → `role="alert"` callout "This ticket can't be resolved yet." ("…closed yet." when closing) listing the
  returned `reasons` in plain language, with a link that scrolls to Actions Taken; status unchanged.
- **Success:** the summary `StatusBadge`, `version`, status-history card and the permitted-transition
  list refresh without a page reload; inline success tick + "Status changed to *X*."
- **`STALE_UPDATE`** (status, owner or IT Priority): callout "This ticket was changed by someone else.
  Review its current state." with **Refresh**; the select reverts to the current value.
- **`INVALID_TRANSITION` / `OWNER_REQUIRED`:** the Lab 3 conflict and owner-required messages, unchanged.
- **Status history card** (`StatusHistory`): oldest first (BR-14), each row "*Open* → *In Progress* ·
  Name · date" using `StatusBadge`s with text, never colour only. Empty: "No status changes yet."
  (always the case for legacy Tickets).

## 7. Feedback conventions

One vocabulary across every Lab 4 screen; components are the Lab 2 ones.

| State | Component | Role | Text pattern |
|---|---|---|---|
| Loading | `LoadingState` / skeleton | `role="status"` | "Loading…" |
| Validation | `FormField` message | `role="alert"` on first appearance | Below the field; never only top-of-form |
| Success | success panel / tick | `role="status"` | "✓ Saved." style, auto-clears |
| Empty | `EmptyState` | region | What is missing + next action |
| No results | `NoResultsState` | region | "No tickets match these filters" + Clear filters |
| Forbidden | Lab 3 forbidden state | region | "You don't have access to this page" + landing link |
| Conflict / stale | callout | `role="alert"` | Says what changed, keeps the user's input, offers one next step |
| Not found | callout | `role="alert"` | "…no longer exists" + safe link |
| Safe failure | `ErrorState` | `role="alert"` | "Something went wrong. Try again." + Retry; never a stack, SQL or path |

## 8. Responsive behavior

Lab 2 §11 and Lab 3 §12 apply (breakpoints 992 / 768; matrix 1440×900, 820×1180, 390×844; also 320 px
for overflow). Lab 4 additions:

| Viewport | Dashboard | Ticket Detail additions |
|---|---|---|
| Desktop ≥ 992 | Metrics 4-up (staff) / 2-up (requester); lists 2-up; status counts in a 4×2 grid | Actions table full width; form 2-up (date + status; assignee + follow-up) |
| Tablet 768–991 | Metrics 2-up; lists stacked; status counts 4×2 | Actions table with clamps; form 1-up |
| Mobile < 768 | Metrics 1-up; lists as cards; status counts 2-up | Actions as cards; form 1-up; buttons full-width ≥ 44 px, primary on top; dialogs full-screen sheets |
| All | No horizontal page scroll; long summaries and descriptions clamp with ellipsis **and** `title` | |

## 9. Accessibility

Lab 2 §12 and Lab 3 §13 apply. Lab 4 additions:

- Every `MetricCard` is one link whose accessible name includes label, value and "view list"; the
  dashboard has one `h1` and `h2` per band; lists are real `<ul>`/`<table>` with `th scope="col"`.
- The status and priority counts expose their label text; zero is announced as "0".
- The Actions Taken table has a caption ("Actions taken on <ticket number>"); View/Edit buttons carry
  row-specific `aria-label`s; the conditional Follow-up note is wired with `aria-expanded`/`aria-controls`
  and receives focus when revealed.
- Stale, blocked and failure callouts use `role="alert"`; success uses `role="status"`; focus is moved
  to the callout or first invalid field, never lost; the form is fully operable by keyboard, and the
  Cancel-action confirm dialog traps and restores focus.
- `ActionStatusBadge`, `FollowUpTag`, needs-attention cards and the resolution checklist all carry a
  text or glyph-plus-text cue.
- axe-core reports no serious or critical violation on `/dashboard` (both variants), Staff Ticket
  Detail with Actions Taken (list, create form, stale callout) and Requester Ticket Detail (A11Y rows).

## 10. Visual and accessibility checklist

Every row is proven by the tests and/or screenshots named in its Evidence column (IDs in [`tests.md`](./tests.md) §2; screenshots per §11) and is checked at desktop, tablet and mobile.

| # | Check | Evidence (test ID / screenshot) |
|---|---|---|
| V-01 | Every colour comes from a token; no hard-coded hex outside `theme.css`. | S-01 |
| V-02 | Dashboard, Actions Taken and history are visually of a piece with Labs 2–3 (card, spacing, type scale). | E2E-19; `artifacts/lab-04/screenshots/{staff-dashboard,requester-dashboard,actions-taken}/` |
| V-03 | Dashboard is first in every role's nav, active state shown, and no unauthorized destination rendered. | C-01, E2E-15 |
| V-04 | Metric cards: label, value, sub-label and link affordance all visible; zero cards are still readable; needs-attention is conveyed by text, not colour alone. | C-03, C-08, S-03; `staff-dashboard/loaded-*.png`, `staff-dashboard/loaded-zero-*.png` |
| V-05 | Dashboard lists ≤ 5 rows, with a "View all (N)" link, and empty lists show their message. | C-04, C-06, C-09; `requester-dashboard/loaded-zero-*.png` |
| V-06 | Editable vs read-only is unmistakable in the Action form and View mode (surface vs `--zen-readonly-bg`; Performed by is static text). | C-11, C-17, S-05; `actions-taken/create-form-*.png`, `actions-taken/view-*.png` |
| V-07 | Validation messages sit directly below their field; the stale and blocked callouts keep user input visible. | C-12, C-14, C-15, C-24; `actions-taken/validation-*.png`, `actions-taken/stale-conflict-*.png` |
| V-08 | `ActionStatusBadge` is distinct from `StatusBadge`; Ticket status, IT Priority and Requested Priority badges stay consistent everywhere. | S-02; `actions-taken/list-*.png` |
| V-09 | The status control offers only permitted transitions; the resolution checklist matches the data. | C-22, C-24, E2E-07; `ticket-workflow/status-options-*.png` |
| V-10 | Visible focus on every interactive element, including metric cards, row buttons and the conditional follow-up note; logical tab order. | A11Y-05, A11Y-06 |
| V-11 | No clipping, no overlap, no hidden primary action; long text clamps with a `title`. | R-01, R-02, R-03, R-04; `actions-taken/list-mobile.png` |
| V-12 | No horizontal page scroll at 320, 768, 992 and 1440 px. | R-01, R-02, R-03, R-04 |
| V-13 | Loading, empty, no-results, forbidden, not-found, stale, blocked and failure states each render distinctly. | C-06, C-09, C-14, C-15, C-24, C-28, C-30; `staff-dashboard/{loading,failure}-*.png`, `actions-taken/{empty,stale-conflict,closed-readonly}-*.png`, `ticket-workflow/resolution-blocked-*.png` |
| V-14 | Dialogs usable at mobile width and restore focus on close. | R-05, C-18 |
| V-15 | Requester Ticket Detail shows Actions Taken and history read-only with no write controls and no Internal Notes. | C-27, R-04, A11Y-04; `actions-taken/requester-readonly-*.png` |
| V-16 | No console errors, broken links, placeholder or lorem text, or unfinished controls on any main journey. | E2E-17 |
| V-17 | Private vs shared content is distinguishable at a glance and without colour: Internal Notes keep the private surface, border and "Private" badge; Actions Taken, status history and Public Comments carry no private styling, and the Actions Taken header states "Visible to the requester". | S-06, C-27; `actions-taken/list-*.png` |

## 11. Screenshot paths

Committed under `artifacts/lab-04/screenshots/`, one file per state per width, named
`<state>-<viewport>.png` (viewports `desktop` 1440×900, `tablet` 820×1180, `mobile` 390×844):

| Folder | States captured |
|---|---|
| `staff-dashboard/` | `loaded` (IT Staff, non-zero), `loaded-zero` (Emma Fischer), `administrator-users`, `loading`, `failure` |
| `requester-dashboard/` | `loaded` (Jennifer Anderson), `loaded-zero` (David Lee), `failure` |
| `actions-taken/` | `list`, `empty`, `create-form`, `validation`, `view`, `edit`, `stale-conflict`, `closed-readonly`, `requester-readonly` |
| `ticket-workflow/` (extra) | `status-options`, `resolution-blocked`, `status-history` |

Produced by `e2e/lab-04/screenshots.spec.ts` (`tests.md` E2E-19) against the seeded database.
