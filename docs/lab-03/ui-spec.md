# Lab 3 UI Specification — Authentication, Role Shell, IT Staff and Admin Screens

Extends [`../lab-02/ui-spec.md`](../lab-02/ui-spec.md). Everything defined there — colour tokens
(§2), typography and spacing (§3), component states (§5), button hierarchy, validation placement,
responsive breakpoints (§11) and accessibility rules (§12) — **remains in force unchanged**. This
document specifies only what Lab 3 adds or changes.

Contract: [`specification.md`](./specification.md). Tests: [`tests.md`](./tests.md).

---

## 1. What changes from Lab 2

| Lab 2 | Lab 3 |
|---|---|
| Development Requester Selection screen | **Deleted.** Replaced by Login. |
| `RequesterBadge` showing the chosen requester + "Change Requester" | `UserBadge` showing the authenticated user's name and role, with Logout and Change Password. |
| Nav: My Tickets, Create Ticket (fixed) | Nav is role-specific (§4.2). |
| `StatusBadge` renders `NEW` only | Renders all eight statuses (§3.1). |
| No IT Priority anywhere | `PriorityBadge` gains an IT Priority variant (§3.2). |
| No role concept in the UI | `RoleBadge` (§3.3). |

New screens: Login, Change Password, IT Staff Ticket Queue, IT Staff Ticket Detail, Administrator
User Management. Modified screen: Requester Ticket Detail (Public Comments + resolution indication).

## 2. New colour tokens

Added to `client/src/styles/theme.css` on `:root`, alongside the Lab 2 set. No hard-coded hex
outside that file.

| Token | Value | Intended use |
|---|---|---|
| `--zen-private-bg` | `#F4F1E8` | Internal Note surface — warm, deliberately *not* green, so private content never reads as ordinary page content. |
| `--zen-private-border` | `#C9BFA3` | Internal Note border and composer outline. |
| `--zen-private-text` | `#6B5A2E` | "Internal note" label and private badge text. |
| `--zen-unassigned` | `#7A5D2B` | "Unassigned" owner token in the queue. 5.55:1 on `--zen-unassigned-bg`; the lighter `#8A6D3B` was rejected at 4.40:1, below AA. |
| `--zen-unassigned-bg` | `#FBF3E4` | Background for that token. |
| `--zen-role-bg` | `#ECF1FA` | Role badge background. |
| `--zen-role-text` | `#3A3F58` | Role badge text — desaturated blue-grey. Deliberately moved off `#2C4A7C`, which sat in the same dark-blue-on-pale-blue family as the `OPEN` status badge; role badges sit beside status badges in the queue and user list, so the two must not read as one family. |

## 3. Badges

Shared rules from Lab 2 §7 apply to all three: 999px radius, `0.75rem/600`, 2–8px padding, the text
label always rendered, colour never the only signal.

### 3.1 Status badge (`StatusBadge`) — all eight statuses

| Value | Text | Background | Text colour |
|---|---|---|---|
| `NEW` | "New" | `--zen-pale` | `--zen-secondary` |
| `OPEN` | "Open" | `#E3EEF7` | `#215C84` |
| `IN_PROGRESS` | "In Progress" | `#EDE7F6` | `#4A3A78` |
| `WAITING_FOR_REQUESTER` | "Waiting for Requester" | `#FBEFD9` | `#7A5320` |
| `RESOLVED` | "Resolved" | `#E4F3EA` | `#166534` |
| `CLOSED` | "Closed" | `#ECEFED` | `#4A5A52` |
| `REOPENED` | "Reopened" | `#FBE4E4` | `#9B2C2C` |
| `CANCELLED` | "Cancelled" | `#EFEDED` | `#6B6B6B` |

Unknown value → default neutral style, label rendered verbatim.

**No status pair shares both background and text colour with a priority badge.** The three that
would naturally reach for the Lab 2 priority palette — In Progress, Waiting for Requester and
Reopened — are deliberately given their own violet, deep-amber and deep-red pairs instead, because
status and priority appear on the same queue row and `specification.md` §6 requires the two families
to stay distinct. Every pair above clears WCAG AA (≥ 4.5:1) on its own background.

### 3.2 Priority badges

`PriorityBadge` takes a `variant` prop: `requested` (Lab 2 colours, unchanged) or `it`. The IT
variant uses the same three colours with a **solid 2px left border** in the text colour and the
prefix "IT:", so that Requested Priority and IT Priority are never confused when shown side by side
on the same row.

| Value | Requested | IT Priority |
|---|---|---|
| `LOW` | "Low" | "IT: Low" |
| `MEDIUM` | "Medium" | "IT: Medium" |
| `HIGH` | "High" | "IT: High" |

### 3.3 Role badge (`RoleBadge`)

| Value | Text |
|---|---|
| `REQUESTER` | "Requester" |
| `IT_STAFF` | "IT Staff" |
| `ADMINISTRATOR` | "Administrator" |

All three use `--zen-role-bg` / `--zen-role-text`.

### 3.4 Owner token (`OwnerCell`)

Assigned → the owner's name as plain text. Unassigned → a badge with the literal text
**"Unassigned"**, `--zen-unassigned-bg` / `--zen-unassigned`, and `data-owner="unassigned"`. The
`data-owner` attribute is the observable AC-32 asserts, so the distinction is testable without
reading colour.

## 4. Application shell

### 4.1 `UserBadge`

Replaces `RequesterBadge`. Shows the authenticated user's name and a `RoleBadge`. Opens a menu with
**Change Password** and **Logout**. No "Change Requester" action exists anywhere in the client.

**Logout** calls the logout endpoint, clears all client-held user state, unmounts the shell and
redirects to `/login`. Afterwards the browser Back button and any directly-typed protected route
both land on Login, never on a cached authenticated view — handout §14 Part 5 asks for logout and
"direct access blocked after logout" as separate evidence.

### 4.2 Role-specific navigation

| Role | Nav destinations |
|---|---|
| Requester | My Tickets, Create Ticket |
| IT Staff | Ticket Queue |
| Administrator | User Management |

A destination a role may not reach is not rendered — not rendered-and-disabled. This is feedback,
not the security control (`specification.md` §2).

### 4.3 Unauthenticated and forbidden shells

- No session → the shell does not render; the user is at Login.
- Authenticated but wrong role for the route → the shell renders with that role's nav, and the
  content area shows the **forbidden state**: heading "You don't have access to this page", one line
  of explanation, and a link to the role's own landing page. No protected data is requested
  (AC-18).

## 5. Screen: Login  (`/login`)

Centred card on `--zen-page-bg`, `max-width: 420px`. TokTickIT wordmark above the card.

| Element | Detail |
|---|---|
| Email | `FormField` + `TextInput`, `type="email"`, `autocomplete="username"`, required. |
| Password | `FormField` + `TextInput`, `type="password"`, `autocomplete="current-password"`, required. |
| Submit | Primary `Button`, full width, label "Sign in" / busy "Signing in…". |

States:

- **Validation** — empty or malformed email, empty password: per-field message below the field, Lab 2
  placement.
- **Busy** — submit disabled and busy-labelled; both inputs `readOnly`; `role="status"` on the busy
  region.
- **Failure** — one `ErrorState` callout above the form: *"We couldn't sign you in. Check your email
  and password and try again."* The same text for a wrong password, an unknown email and an inactive
  account (BR-08). Never "no such user", never "account disabled".
- **Rate-limited** — same callout text as failure, so BR-38 discloses nothing extra.

## 6. Screen: Change Password  (`/change-password`)

Same centred card. Two entry paths:

| Path | Trigger | Current-password field | Dismissible |
|---|---|---|---|
| Forced | `mustChangePassword` is set after login | hidden | No — nav and all other routes redirect back here |
| Voluntary | Shell menu → Change Password | shown, required | Yes — Cancel returns to the previous route |

Fields: Current password (voluntary only), New password, Confirm new password. Rules are stated
above the fields as static helper text: *"At least 8 characters. Must be different from your current
password."*

- Forced mode shows an explanatory banner: *"Choose a new password before continuing."*
- Validation: length, mismatch between new and confirm, and same-as-current each get a field-level
  message.
- Success: brief success state, then redirect to the role's landing page.

## 7. Screen: Requester Ticket Detail — additions

Lab 2's layout, field grouping and Attachment section are unchanged. Added below the Attachment
section:

- **Public Comments thread** (§8 shared component), with composer.
- **IT Priority** is *not* shown to the Requester. Requested Priority continues to show.
- **Ticket Owner** shows as a read-only row, "Unassigned" or the owner's name.
- **Conflict** — if IT Staff have moved the ticket on since the page loaded, a resolution
  indication or comment post returns 409 and the screen shows: *"This ticket has been updated by IT
  Staff. Refresh to see its current state."* with a Refresh action, matching the IT Staff Ticket
  Detail conflict wording in §10.
- **"Problem Appears Resolved"** — secondary `Button` in the header actions, shown only while the
  status is not Resolved, Closed or Cancelled. Opens a confirm dialog: *"Let IT Staff know this looks
  resolved? They'll confirm before the ticket is closed."* After success the button is replaced by a
  read-only note: *"You reported this looks resolved on <date>."* The status badge does not change
  (BR-26).

## 8. Shared component: comment and note threads

One component, `MessageThread`, with a `variant` prop. This is the single mechanism AC-42 asserts.

| | `variant="public"` | `variant="internal"` |
|---|---|---|
| Wrapper class | `.thread--public` | `.thread--internal` |
| Surface | `--zen-surface` | `--zen-private-bg` |
| Border | `--zen-border` | 2px `--zen-private-border` |
| Heading | "Comments" | "Internal notes" |
| Badge on heading | none | "Private — not visible to the Requester", `--zen-private-text` |
| Composer placeholder | "Write a comment the requester can see…" | "Write an internal note. The requester cannot see this." |
| Composer submit label | "Post comment" | "Save internal note" |
| Per-entry | author name, `RoleBadge`, timestamp, body | same, plus a 🔒 glyph before the author |

The two threads never share a composer and are never adjacent without their headings. On IT Staff
Ticket Detail they are rendered in separate cards with the internal card second.

Both: body is 1–2000 characters, a live counter appears from 1800, whitespace-only submission is
blocked client-side and rejected server-side, entries render newest-last, and content renders as
text — never `dangerouslySetInnerHTML` (BR-18).

## 9. Screen: IT Staff Ticket Queue  (`/staff/tickets`)  — list mode

Follows Lab 2 My Tickets (§9) for control layout, pagination and state handling.

**Controls row:** search box (placeholder "Search ticket number or summary"), Status filter, IT
Priority filter, Category filter, Owner filter (options: Anyone, Unassigned, Me, plus each active IT
Staff), sort control, page-size control.

**Desktop table columns** — seven, chosen from the handout's example list and justified:

| Column | Why it earns a column |
|---|---|
| Ticket Number | The identifier staff quote to each other. |
| Summary | The only column that says what the work is. |
| Category | Primary routing signal. |
| IT Priority | What the queue is ordered by. |
| Status | Where it is in the lifecycle. |
| Owner | Whether it is anyone's job yet — `OwnerCell` (§3.4). |
| Last Updated | Staleness. |

Dropped deliberately: Created Date (Last Updated is the operational signal and two dates crowd the
row) and Requested Priority (IT Priority governs the queue; the Requester's value is visible in
Ticket Detail). This keeps the grid readable, per handout §8.3.

**Below 768px** the table becomes cards: Ticket Number + Status on the first line, Summary on the
second, then IT Priority, Owner and Last Updated as a wrapped meta row. Whole card is the link.

**States:** loading (`role="status"` skeleton rows), empty (no tickets at all — "The queue is
empty"), no-results (filters match nothing — "No tickets match these filters" plus a Clear filters
action), forbidden (§4.3), failure (`ErrorState` with Retry). Empty and no-results are distinct
components, as in Lab 2.

## 10. Screen: IT Staff Ticket Detail  (`/staff/tickets/:id`)  — view / editing modes

Extends Lab 2's Requester Ticket Detail layout. Read-only and editable regions are visually
separated using the Lab 2 `--zen-readonly-bg` convention.

**Read-only:** Ticket Number, Requester, Created, Category, Related System, Summary, Description,
Requested Priority, Attachments (Lab 2 list, download only — no upload, no removal), and the
Requester's resolution indication when present.

**Editable (operational panel, one card, `--zen-pale` accent):**

| Control | Behaviour |
|---|---|
| Ticket Owner | Select of active IT Staff and Administrators, plus "Unassigned". A **Claim** button appears beside it when unassigned, assigning the current user in one click. |
| IT Priority | Segmented control, three values. Saves on change. |
| Status | Select listing **only** the transitions §5.1 permits from the current status. A transition the matrix forbids is never offered. Close, Reopen and Cancel open a confirm dialog first. |

Each control shows its own inline busy state and a success tick on save; a failed save restores the
previous value and shows a field-level error. A rejected transition (409) renders the conflict
state: *"That status change is no longer possible — the ticket has moved on. Refresh to see its
current state."*

**Threads:** Public Comments card, then Internal Notes card (§8).

## 11. Screen: Administrator User Management  (`/admin/users`)  — list / create / edit modes

One screen, intentionally simple. No pagination, no multi-column sort, no second simultaneous
filter.

**List mode:** search box ("Search by name or email"), Role filter (All / Requester / IT Staff /
Administrator), and a table: Name, Email, `RoleBadge`, Status ("Active" / "Inactive" badge), Edit
action. A "New user" primary button sits above the table. Below 768px the table becomes cards.

**Create mode** (dialog): Name, Email, Role select, Active checkbox (default on), Initial password.
Helper text under the password: *"The user must change this the first time they sign in."*

**Edit mode** (dialog, same fields minus password): Name, Email, Role, Active. Plus a separate
**Set new initial password** section with its own field and button, so a password reset cannot
happen by accident while editing a name.

**Guard-rail feedback** — these are server rules (BR-31, BR-32), surfaced as clear messages, not as
the enforcement:

| Situation | Message |
|---|---|
| Editing own account | The Active checkbox is disabled with helper text *"You can't deactivate your own account."* |
| Last active Administrator | On rejection: *"This is the last active administrator. Promote another administrator first."* |
| Duplicate email | Field-level on Email: *"That email address is already in use."* |

**States:** loading, empty (no users — unreachable in practice, still implemented), no-results
(search/filter matched nothing), forbidden (§4.3), failure, plus per-dialog validation, busy and
success.

## 12. Responsive requirements

Lab 2 §11 applies unchanged. Lab 3 additions:

| Viewport | Requirement |
|---|---|
| Desktop ≥ 992px | Queue is a seven-column table; Ticket Detail is two-column (read-only left, operational panel right); User Management table full width. |
| Tablet 768–991px | Queue stays a table but drops Category; Ticket Detail stacks to one column, operational panel first; dialogs go full-width with 24px margin. |
| Mobile < 768px | Queue and user list become cards; operational controls stack full-width, ≥ 44px; threads full-bleed; dialogs become full-screen sheets. |
| All | No horizontal page scroll at any width; long summaries and emails truncate with ellipsis **and** a `title`. |

## 13. Accessibility

Lab 2 §12 applies unchanged. Lab 3 additions:

- Login and Change Password: the failure callout uses `role="alert"`; the form is reachable and
  submittable by keyboard alone; password fields carry correct `autocomplete` values.
- Forced Change Password traps navigation but not focus — the user can still reach Logout.
- The Internal Notes region carries `aria-label="Internal notes, not visible to the requester"`, so
  the privacy distinction is available non-visually as well as through colour (§8).
- Status, priority, role and owner badges all render their text label; the queue is usable without
  colour perception.
- The status select announces only permitted transitions; confirm dialogs trap focus and restore it.
- Queue and user tables use real `<th scope="col">`; the sort control is a button with
  `aria-sort` on the active column.

## 14. Screen mode summary

| Screen | Modes | Feedback states implemented |
|---|---|---|
| Login | view, submitting | validation, busy, failure |
| Change Password | forced, voluntary, submitting | validation, busy, success, failure |
| Requester Ticket Detail | view | Lab 2 set + comment validation, comment busy, conflict |
| IT Staff Ticket Queue | list | loading, empty, no-results, forbidden, failure |
| IT Staff Ticket Detail | view, editing, submitting | validation, busy, success, not-found, conflict, forbidden, failure |
| Administrator User Management | list, create, edit | loading, empty, no-results, validation, busy, success, conflict, forbidden, failure |

## 15. Visual inspection checklist

Executed in [`tests.md`](./tests.md); screenshots committed under
`artifacts/lab-03/screenshots/{authentication,staff-queue,staff-ticket-detail,user-management}/` at
desktop, tablet and mobile. Every row is checked at all three widths.

| # | Check |
|---|---|
| V-01 | Every colour comes from a token; no hard-coded hex outside `theme.css`. |
| V-02 | New screens are visually of a piece with the Lab 2 screens — same card, spacing and type scale. |
| V-03 | Nav shows only the authenticated role's destinations; no unauthorized destination is rendered. |
| V-04 | Status, Requested Priority, IT Priority and Role badges are consistent everywhere they appear. |
| V-05 | IT Priority is never mistakable for Requested Priority where both appear on one row. |
| V-06 | Editable fields are visually distinct from read-only fields on IT Staff Ticket Detail. |
| V-07 | Internal Notes are unmistakably distinct from Public Comments — surface, border, heading, badge and composer all differ. |
| V-08 | Validation messages sit directly below their field, as in Lab 2. |
| V-09 | Focus is visible on every interactive element, including badges-as-links and the claim button. |
| V-10 | No clipping, no overlap, no hidden primary action. |
| V-11 | No horizontal page scroll at 320px, 768px, 992px and 1440px. |
| V-12 | Empty, no-results, forbidden, not-found, conflict and failure states each render distinctly. |
| V-13 | The "Unassigned" owner token is distinguishable from an assigned owner without colour. |
| V-14 | Dialogs are usable at mobile width and restore focus on close. |
