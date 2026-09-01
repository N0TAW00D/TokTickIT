# Lab 2 UI Specification — Zen Green Theme & Requester Screens

> Status: **Draft for review**. Companion to [`specification.md`](./specification.md) and
> [`api-spec.md`](./api-spec.md). This document is the visual and interaction contract; the
> automated UI-style checks and screenshot checklist in [`tests.md`](./tests.md) assert against it.
> Reference illustration: labsheet Figure 1 (Ticket Detail), §8.1 (Requester Selection), §8.4
> (My Tickets). Modest aesthetic improvement is allowed; the interface must stay recognizably the
> Zen Green system.

---

## 1. Design principles

1. **One system, reused.** Later sprints reuse these tokens and components rather than inventing a
   new look per screen.
2. **State is never ambiguous.** Every data screen visibly distinguishes initial, loading,
   validation-error, submitting, success, and failure; lists add empty and no-results.
3. **Never color alone.** Priority, status, success, error, and warning are always carried by text
   or icon **and** color (WCAG-friendly).
4. **Read-only looks read-only.** System-generated and view-mode fields are visually distinct from
   editable inputs.
5. **Keyboard-first.** Every control is reachable and operable by keyboard with a visible focus ring.

---

## 2. Color tokens

Defined once as CSS custom properties in `client/src/styles/theme.css` on `:root`. Components
reference tokens only — no hard-coded hex outside this file.

| Token | Value | Intended use |
|---|---|---|
| `--zen-primary` | `#006B3C` | App header background, primary buttons, strong emphasis. |
| `--zen-primary-hover` | `#005A32` | Primary button hover/active. |
| `--zen-secondary` | `#0B7A46` | Active tab, focus ring, links, secondary-button border/text, hover accents. |
| `--zen-pale` | `#EAF6EF` | Selected rows, success background, subtle section emphasis, read-only accent. |
| `--zen-page-bg` | `#F5F7F6` | Page background. |
| `--zen-surface` | `#FFFFFF` | Cards, form surfaces, table background. |
| `--zen-border` | `#D7E0DB` | Card border, input border, table rules. |
| `--zen-border-strong` | `#B7C6BD` | Hovered input border, dividers needing weight. |
| `--zen-text` | `#1B2B23` | Primary text (dark charcoal-green, not pure black). |
| `--zen-text-muted` | `#5B6B62` | Labels' helper text, counters, metadata, placeholder. |
| `--zen-readonly-bg` | `#EEF3F0` | Read-only / disabled field background. |
| `--zen-readonly-text` | `#3A4A42` | Read-only field text. |
| `--zen-error` | `#B3261E` | Error text, error border, destructive button. |
| `--zen-error-bg` | `#FCECEA` | Error callout background. |
| `--zen-warning` | `#8A5A00` | Warning text. |
| `--zen-warning-bg` | `#FFF4E5` | Warning callout/badge background. |
| `--zen-success` | `#0B7A46` | Success text/icon. |
| `--zen-focus-ring` | `#0B7A46` | 2px outline + 2px offset on `:focus-visible`. |

Priority / status badge palettes are in §7.

---

## 3. Typography, spacing, layout

- **Font family:** system stack —
  `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- **Scale:** page title `1.5rem/700`; section heading `1.125rem/600`; body `1rem/400`; label
  `0.875rem/600`; helper & counter `0.75rem/400`; error message `0.8125rem/500`.
- **Line-height:** 1.5 body, 1.3 headings.
- **Spacing unit:** 4px base. Field vertical rhythm 16px between fields, 24px between field groups,
  32px between form sections. Card padding 24px desktop / 16px mobile.
- **Radius:** 8px cards, 6px inputs and buttons, 999px badges.
- **Shadow:** cards `0 1px 2px rgba(16,40,28,0.06), 0 1px 3px rgba(16,40,28,0.10)` — restrained.
- **Container:** centered, `max-width: 1120px`, 24px side gutters desktop, 16px mobile.
- **Grid:** 12-col conceptual; forms use CSS grid with `gap: 16px 24px`.

---

## 4. Application shell

Present on every screen except Requester Selection.

```
┌───────────────────────────────────────────────────────────────────────┐
│  ⌚ TokTickIT      My Tickets   Create Ticket        Jennifer Anderson ▾ │   ← --zen-primary bg, white text
├───────────────────────────────────────────────────────────────────────┤
│  My Tickets  ›  Ticket Details                        (breadcrumb, per screen)
│                                                                        │
│  … screen content on --zen-page-bg …                                   │
└───────────────────────────────────────────────────────────────────────┘
```

- **Identity:** clock glyph + "TokTickIT" wordmark, left, links to `/tickets`.
- **Primary nav:** "My Tickets" (`/tickets`), "Create Ticket" (`/tickets/new`). The active route's
  link is underlined in a lighter tint and has `aria-current="page"` (clear active-page indication).
- **Requester area:** current Requester name with a caret opening a menu containing
  **"Change Requester"** (routes to `/select-requester`). Name is text, not just an avatar.
- **Responsive:**
  - `≥ 768px`: nav links inline in the header.
  - `< 768px`: nav collapses to a hamburger button (`aria-expanded`, `aria-controls`); the menu
    panel lists My Tickets, Create Ticket, current Requester, Change Requester, stacked and
    touch-sized (min 44px targets). No horizontal scroll.
- **Component:** `AppShell` wraps `RequesterBadge` + nav; renders `children` in the content area.

---

## 5. Component states

### 5.1 Buttons (`Button`)

| Variant | Look | Use |
|---|---|---|
| `primary` | filled `--zen-primary`, white text | one per view: Submit, Continue, Create Ticket |
| `secondary` | white surface, `--zen-secondary` 1px border + text | Cancel, Back, secondary actions |
| `tertiary` | no border, `--zen-secondary` text, underline on hover | low-emphasis inline actions (Clear Filters) |
| `destructive` | `--zen-error` text + border; filled `--zen-error` when it is the confirm action in a dialog | Remove attachment |
| `disabled` | `--zen-readonly-bg` bg, `--zen-text-muted` text, `cursor: not-allowed`, `aria-disabled` | any button whose action is unavailable |
| `busy` | spinner glyph + label unchanged, `disabled` while pending | Submit during request (BR-24) |

- All buttons have visible text. Icons may accompany text, never replace it. Min height 40px
  (44px touch on mobile).
- `:focus-visible` → `--zen-focus-ring` outline.

### 5.2 Form field wrapper (`FormField`)

```
Label *                         ← 0.875rem/600, --zen-text; red * for required (BR: asterisk ≠ message)
┌─────────────────────────────┐
│ control                     │
└─────────────────────────────┘
Helper text / 0/140            ← 0.75rem, --zen-text-muted, right-aligned counter
⚠ Error message text           ← 0.8125rem, --zen-error, directly below the field (never only top-of-form)
```

- Label is a real `<label htmlFor>`; required fields render `*` with `aria-hidden` plus the field
  gets `aria-required`.
- Error: field border → `--zen-error`, `aria-invalid="true"`, `aria-describedby` points at the
  message; message has `role="alert"` on first appearance. Focus moves to the first errored field
  on submit (AC-11).
- Character counter appears for `summary` (`x/140`) and `description` (`x/5000`); turns
  `--zen-error` past the max.

### 5.3 Inputs

| Kind | Editable style | Read-only style |
|---|---|---|
| Text / select | `--zen-surface` bg, `--zen-border` 1px, 40px height, 6px radius | `--zen-readonly-bg` bg, `--zen-readonly-text`, no caret, `readonly`/rendered as static text, still announced by SR |
| Textarea (`description`) | same, min 120px, vertical-resize only, max-resize capped so layout never breaks | n/a in Lab 2 |
| Select | native `<select>` for accessibility; chevron affordance | — |

All five control states the labsheet Appendix C §17 enumerates, in one place:

| Control state | Presentation | Attributes |
|---|---|---|
| Editable (default) | `--zen-surface` bg, `--zen-border` 1px | — |
| Read-only | `--zen-readonly-bg` bg, `--zen-readonly-text`, no caret / static text | `readonly`, still SR-announced |
| Invalid | border → `--zen-error`, message below (§5.2) | `aria-invalid="true"`, `aria-describedby` → message |
| Disabled | `--zen-readonly-bg` bg, `--zen-text-muted`, not focusable | `disabled` / `aria-disabled` |
| Focused | `--zen-focus-ring` 2px outline + 2px offset | via `:focus-visible` |

- One consistent input height (40px) across the app; the textarea is the only taller control.

### 5.4 Feedback blocks

| Block | Component | Markup / role | Look |
|---|---|---|---|
| Loading | `LoadingState` | `role="status"`, text "Loading…" + spinner | centered, `--zen-text-muted` |
| Empty (no data yet) | `EmptyState` | plain region | icon + headline + one-line explanation + primary CTA |
| No results (query matched nothing) | `NoResultsState` | plain region | icon + "No tickets match your filters" + `Clear Filters` tertiary button; filters stay visible |
| Error / failure | `ErrorState` | `role="alert"` | `--zen-error-bg` callout, `--zen-error` text, `Retry` secondary button |
| Success | inline panel | `role="status"` | `--zen-pale` bg, `--zen-success` check icon, text |
| Warning | inline callout | `role="note"` | `--zen-warning-bg` / `--zen-warning`; used sparingly (e.g. partial attachment upload) |

---

## 6. Screen: Development Requester Selection  (`/select-requester`)

Stands in for login. A slim **wordmark-only** top bar (`--zen-primary` background, "⌚ TokTickIT"
only — no nav links, no Requester menu) above a centered card on `--zen-page-bg`.

> **Intentional deviation from labsheet §8.1 illustration.** The §8.1 mockup shows the full
> application header (My Tickets / Create Ticket / Jennifer Anderson ▾) on this screen. We show only
> the wordmark: there is no current Requester yet, so the nav targets and the Requester menu would
> be non-functional or misleading. This mirrors the scope call recorded in `specification.md` A-14.

```
                 ┌────────────────────────────────────────────┐
                 │                  ( 👤⚙ )                    │
                 │        Select Development Requester         │   1.5rem/700
                 │  Choose a development requester to simulate │   0.875rem muted, centered
                 │  the current requester context for Lab 2.   │
                 │  This is for testing only and is not a      │
                 │  login screen.                              │
                 │ ────────────────────────────────────────── │
                 │  Development Requester *                    │
                 │  ┌──────────────────────────────────────┐  │
                 │  │ Jennifer Anderson                  ▾ │  │   native select, active requesters
                 │  └──────────────────────────────────────┘  │
                 │  ⓘ Only active development requesters are   │   --zen-pale info line
                 │     shown.                                  │
                 │  ┌──────────────────────────────────────┐  │
                 │  │ 🛡 Authentication coming in Lab 3      │  │   --zen-pale callout
                 │  │ In Lab 3 this selection is replaced   │  │
                 │  │ with secure authentication.          │  │
                 │  └──────────────────────────────────────┘  │
                 │                       [ Cancel ] [ Continue → ] │
                 └────────────────────────────────────────────┘
```

**Required elements** (labsheet §8.1): TokTickIT title; "testing only" explanation; Development
Requester dropdown; options from `GET /api/requesters`; Continue button; loading state; empty state;
API-failure state; keyboard-accessible controls; responsive Zen Green styling.

**States**

| State | Presentation |
|---|---|
| Loading | card shows `LoadingState` in place of the select; Continue `disabled` (AC-04). |
| Loaded | select populated, alphabetical; nothing pre-selected → Continue `disabled` until a choice is made; once chosen, `enabled`. |
| Empty (`[]`) | `EmptyState`: "No active development requesters. Ask an administrator to add one, then reload." No select. Continue `disabled` (AC-06). |
| API failure | `ErrorState` (`role="alert"`) with `Retry`; no select rendered (AC-05). |
| Continue clicked | store `requesterId` in `localStorage` (`toktickit.requesterId`), navigate to `/tickets`. |
| Returning with an invalid stored id | on app load the guard clears it and lands here with a `role="status"` notice: "Your previous development requester is no longer available. Please choose again." (AC-08) |

- **Cancel:** if a valid Requester is already selected, returns to `/tickets`; otherwise disabled.
- **Accessibility:** `<label for>` on the select; card has an `<h1>`; focus lands on the select (or
  the error/empty heading) on mount; Continue reachable by Tab.
- **Responsive:** card `max-width: 480px`, full-bleed with 16px gutters `< 768px`; buttons stack
  full-width `< 480px`.

---

## 7. Badges

### 7.1 Priority badge (`PriorityBadge`) — Requested Priority

| Value | Text | Background | Text color | Icon |
|---|---|---|---|---|
| `LOW` | "Low" | `#E7F0EA` | `#2F6B49` | ▽ |
| `MEDIUM` | "Medium" | `--zen-warning-bg` | `--zen-warning` | ▷ |
| `HIGH` | "High" | `--zen-error-bg` | `--zen-error` | △ |

### 7.2 Status badge (`StatusBadge`) — Current Status

| Value | Text | Background | Text color |
|---|---|---|---|
| `NEW` | "New" | `--zen-pale` | `--zen-secondary` |

(Lab 3+ status values get their own rows here; the component switches on value, default style for
unknown.)

- Both badges: 999px radius, `0.75rem/600`, 2–8px padding, always render the text label. Consistent
  wherever priority/status appears (list rows, cards, detail) — the visual check asserts this
  (labsheet §8.8).
- **IT Priority badge:** out of Lab 2 scope (`specification.md` A-14). The labsheet §8.8
  badge-consistency check names "Requested Priority, IT Priority, and Current Status"; only
  Requested Priority and Current Status are rendered in Lab 2, so the check applies to those two.

---

## 8. Screen: Create Ticket  (`/tickets/new`)  — create mode

```
My Tickets  ›  Create Ticket

┌─ Ticket information ─────────────────────────────────────────────────┐
│  Ticket No.            Ticket Date                                   │
│  ┌───────────────┐    ┌───────────────┐                              │  read-only style
│  │ Generated on  │    │ Set on submit │                              │
│  │ submit        │    │               │                              │
│  └───────────────┘    └───────────────┘                              │
│  Requester                                                           │
│  ┌───────────────────────────┐                                       │  read-only, from context
│  │ Jennifer Anderson         │                                       │
│  └───────────────────────────┘                                       │
├─ Classification ────────────────────────────────────────────────────┤
│  Category *              Related System *        Requested Priority * │
│  ┌──────────────┐        ┌──────────────┐        ┌──────────────┐     │
│  │ Select…    ▾ │        │ Select…    ▾ │        │ Medium     ▾ │     │
│  └──────────────┘        └──────────────┘        └──────────────┘     │
├─ Details ───────────────────────────────────────────────────────────┤
│  Ticket Summary *                                             12/140 │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│  Description *                                               64/5000 │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                                                                 │ │
│  │                                                                 │ │  taller, resizable
│  └─────────────────────────────────────────────────────────────────┘ │
├─ Attachments (0/5) ─────────────────────────────────────────────────┤
│  [ + Add files ]   JPG, PNG, WEBP, or PDF · up to 5 MB each          │
│  • battery-report.pdf   243 KB              [ Remove ]               │
│  • virus.exe   ✗ Unsupported file type — not added                  │  per-file error, --zen-error
├─────────────────────────────────────────────────────────────────────┤
│                                        [ Cancel ]   [ Submit ticket ]│
└─────────────────────────────────────────────────────────────────────┘
```

**Layout rules** (labsheet §8.2): system-generated fields near the top and visually distinct;
classification fields grouped; Summary and Description given full width; Attachments below the main
fields; primary + secondary actions at the bottom right (primary rightmost).

**Field behavior:** per `specification.md` §4-fields. Client validation on blur and on submit;
submit blocked while invalid. `requestedPriority` pre-selects "Medium".

**States**

| State | Presentation |
|---|---|
| Initial | empty editable fields; read-only block shows placeholder text; Submit `enabled` (validation on click). |
| Loading reference data | Category / Related System selects show a `LoadingState` inline; Submit `disabled` until loaded (AC-10). |
| Reference-data load failure | `ErrorState` at the top of the Classification group with `Retry`; Submit `disabled`. |
| Validation error | per-field messages below each field; focus to first error; no request sent (AC-11–AC-13). |
| Submitting | Submit → `busy` (spinner + "Submitting…"), `disabled`; other controls remain but a second submit is impossible (AC-14, BR-24). |
| Success | form replaced by a success panel (`role="status"`): big check, "Ticket TKT-2026-000001 created", the entered summary, and `[ View ticket ]` (primary → `/tickets/:id`) + `[ Create another ]` (secondary → reset form) (AC-15). |
| Success with a failed attachment | same panel plus a `--zen-warning` callout: "1 attachment could not be uploaded: screenshot.png. You can retry it from the ticket." `View ticket` deep-links to the attachment section (AC-21, BR-27). |
| API failure on submit | `ErrorState` above the actions: "Could not create the ticket. Please check your connection and try again." All entered values + the pending attachment list preserved; Submit returns to `enabled` (AC-17, BR-26). |

**Attachment sub-component** (`AttachmentUploader`): file input (`accept=".jpg,.jpeg,.png,.webp,.pdf"`),
"Add files" is a `secondary` button that triggers it. Each selected file is validated client-side
(extension, size, running count ≤ 5); invalid files are listed with a red per-file reason and are
**not** queued (AC-18, AC-19). Valid files show name + size + `Remove`. The count header reads
`Attachments (n/5)`.

**Responsive**

| Viewport | Layout |
|---|---|
| `≥ 992px` | Ticket No. + Ticket Date side by side; Category / Related System / Priority in a 3-up row; Summary + Description full width. |
| `768–991px` | Ticket No. + Ticket Date side by side; classification 2-up then 1; Summary/Description full width. |
| `< 768px` | everything stacks to one column; Add files + file rows wrap; actions become full-width stacked buttons (primary on top). No horizontal scroll. |

---

## 9. Screen: My Tickets  (`/tickets`)  — list mode

```
My Tickets                                          [ Clear filters ]  [ + Create Ticket ]
View and track all of your support requests.

┌──────────────────────────────────────────────────────────────────────────────┐
│ 🔍 Search by ticket number or summary       Category ▾  Priority ▾  Status ▾  │
│                                             Sort: Created (newest) ▾          │
└──────────────────────────────────────────────────────────────────────────────┘

Desktop (≥ 768px) — table
┌────────────────┬─────────────┬──────────────────────┬──────────┬────────────────┬──────────┬────────┬───────────────┐
│ Ticket No.  ⇅  │ Created  ⇅  │ Summary              │ Category │ Related System │ Priority │ Status │ Last Updated ⇅│
├────────────────┼─────────────┼──────────────────────┼──────────┼────────────────┼──────────┼────────┼───────────────┤
│ TKT-2026-000012│ 1 Sep 09:45 │ Cannot connect to VPN│ Network  │ VPN            │ [High]   │ [New]  │ 1 Sep, 09:45  │
│ TKT-2026-000011│ 1 Sep 09:14 │ Laptop battery drains│ Hardware │ Corporate Lap… │ [Medium] │ [New]  │ 1 Sep, 09:14  │
└────────────────┴─────────────┴──────────────────────┴──────────┴────────────────┴──────────┴────────┴───────────────┘
Showing 1–10 of 12               [ ‹ Prev ]  1  2  [ Next › ]     Rows: [10 ▾]

Mobile (< 768px) — cards
┌──────────────────────────────────────────┐
│ TKT-2026-000012            [High] [New]   │
│ Cannot connect to VPN                     │
│ Network · VPN                             │
│ Created 1 Sep, 09:14                      │
│ Updated 1 Sep, 09:45          📎 1        │
└──────────────────────────────────────────┘
```

**Controls**

- **Search:** single text input; debounced 300ms; drives `search` param; case-insensitive substring
  on ticket number or summary (AC-23).
- **Filters:** Category (options from `GET /api/categories`), Priority (`LOW/MEDIUM/HIGH`), Status
  ("All", "New"). Each is a native `<select>` with an "All …" first option. Combined AND (AC-24).
- **Sort:** one `<select>` with "Created (newest)", "Created (oldest)", "Last updated (newest)",
  "Last updated (oldest)", "Ticket number (A→Z)", "Ticket number (Z→A)", mapping to `sort` + `order`.
  Column headers for Ticket No., **Created**, and Last Updated also toggle sort and show a
  ⇅ / ▲ / ▼ affordance. Default is "Created (newest)" (`sort=createdAt`, `order=desc`).
- **Clear filters:** tertiary button; resets search + all filters + sort to defaults; visible
  whenever any is non-default.
- **Create Ticket:** primary button, top right, → `/tickets/new`.
- **Pagination** (`Pagination`): "Showing `a`–`b` of `total`", Prev/Next (disabled at ends), numbered
  pages, and a Rows-per-page select (`10/20/50`). Values come from `meta` (AC-26).

**Columns / card fields decision** (labsheet §8.4 requires justification):
Ticket No. (identity, links to detail), Created (ticket date — matches the labsheet My Tickets
illustration and gives every "Created" sort option a visible column to confirm), Summary (what it
is), Category + Related System (classification context to disambiguate similar summaries), Requested
Priority (the requester's own urgency), Status (lifecycle position — "New" for all in Lab 2 but shown
for consistency and Lab 3 readiness), Last Updated (recency for scanning). **IT Priority, Ticket
Owner, and Resolution Summary are omitted** — they are IT-Staff / post-creation scope
(`specification.md` A-14).

**The mobile card shows the same fields as a desktop row** — Ticket No., Created, Summary, Category,
Related System, Requested Priority, Status, Last Updated (see the card example above; Category and
Related System render as `Category · Related System`, the two timestamps on their own lines). No
FR-30 field is dropped at any viewport.

**The attachment count (📎) is the one field that is mobile-only.** The API returns
`activeAttachmentCount` on every list item; the mobile card renders it as a 📎 paperclip with the
count when `> 0`. The desktop table does **not** add a column for it — the table already carries
eight columns, and on a wide screen the requester confirms attachment presence by opening the ticket.
(The labsheet My Tickets illustration also shows no attachment column on desktop.)

**States**

| State | Presentation |
|---|---|
| Loading | table/card region shows `LoadingState` (`role="status"`); controls disabled. |
| Loaded with rows | table (`≥ 768px`) or card list (`< 768px`); each row/card is a link to `/tickets/:id` (whole row clickable + an explicit "View" affordance for SR/keyboard). |
| Empty — Requester owns zero tickets | `EmptyState`: "You haven't created any tickets yet." + `[ + Create your first ticket ]`. Filters/search hidden or disabled (nothing to filter) (AC-29). |
| No results — query matched nothing | `NoResultsState`: "No tickets match your search or filters." + `Clear filters`. Search + filter bar stays visible and populated (AC-30, BR-37). |
| Last/over page | same as no-results but message "No more tickets on this page." with a "Back to page 1" link (AC-27). |
| Failure | `ErrorState` (`role="alert"`) replacing the list, `Retry` button (AC-31). |
| Requester switched | full reload; filters/search/sort reset to defaults; list shows only the new Requester's tickets (AC-09). |

**Responsive:** table at `≥ 768px`; below that each row becomes a card with the same fields stacked;
filter controls wrap to full-width stacked selects; no horizontal page scroll; long summaries and
related-system names truncate with an ellipsis and a `title`, never clip silently.

---

## 10. Screen: Requester Ticket Detail  (`/tickets/:id`)  — view mode

```
My Tickets  ›  Ticket Details                                   [ ← Back to My Tickets ]

┌─ Ticket information ────────────────────────────────────────────────────────┐
│  Ticket No.               Ticket Date            Category                   │
│  TKT-2026-000001          1 Sep 2026, 15:14      Hardware                   │  all read-only style
│  Requester                Requested Priority     Current Status             │
│  Jennifer Anderson        [ Medium ]             [ New ]                     │
│  Related System                                                             │
│  Corporate Laptop                                                           │
│  Summary                                                                    │
│  Laptop battery drains quickly                                              │
│  Description                                                                │
│  My laptop battery is draining much faster than usual even when idle.       │
└────────────────────────────────────────────────────────────────────────────┘

┌─ Attachments (2 active / 3 total) ─────────────────────────────────────────┐
│  [ + Add attachment ]   JPG, PNG, WEBP, or PDF · up to 5 MB · 5 max        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 📄 battery-report.pdf   243 KB      [ Download ]   [ Remove ]          │ │  active
│  │ 🖼 photo.png   812 KB   [ Preview ] [ Download ]   [ Remove ]          │ │  active image
│  │ 🚫 screenshot.png   — Removed 1 Sep, 09:02 · "Wrong screenshot"        │ │  removed: metadata only
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Header fields:** all render in the read-only style (§5.3), grouped: identity (Ticket No.,
  Ticket Date), people/priority (Requester, Requested Priority, Status), classification (Category,
  Related System), then Summary and Description full width. Nothing is an input (BR-39).
- **Clear separation** between ticket information (top card) and attachment actions (second card),
  per labsheet §8.5.
- **Not implemented here:** Public Comments, Internal Notes, Service/Actions Taken, Event Log,
  status controls, edit buttons, and the Figure-1 fields **Ticket Owner**, **IT Priority**, and
  **Resolution Summary** (all IT-Staff / post-creation scope — `specification.md` §3.2, A-14).

**Attachment section** (`AttachmentList` + `AttachmentUploader`)

| Attachment state | Row presentation |
|---|---|
| Active, image (JPEG/PNG/WEBP) | thumbnail/icon, name, size, `Preview` (opens inline lightbox), `Download`, `Remove` (BR-34). |
| Active, PDF | doc icon, name, size, `Download` (opens/saves), `Remove`. |
| Uploading | name + progress/`LoadingState`, controls hidden. |
| Upload failed | name + `--zen-error` "Upload failed — retry", `Retry` + `Dismiss`. |
| Removed | 🚫 icon, name, size, type, "Removed `<date>` · `\"<reason>\"`" in `--zen-text-muted`; **no** Download/Preview/Remove (BR-33, AC-36). |
| Unavailable (active row but file 500s on download) | inline `ErrorState` on that row, `Retry`. |

- **Add attachment:** same `AttachmentUploader` rules as creation; disabled with a tooltip
  ("Maximum of 5 active attachments") when 5 active exist (AC-20).
- **Remove flow:** `Remove` (destructive style) opens a modal dialog:
  - title "Remove attachment", body names the file,
  - **required** "Reason for removal" textarea (3–200 chars, counter, validation message),
  - `[ Cancel ]` (secondary) + `[ Remove attachment ]` (destructive, `busy` while pending),
  - focus trapped in the dialog, `Esc` cancels, returns focus to the triggering `Remove` button.
  - On success the row moves to the "Removed" presentation and a `role="status"` toast confirms
    (AC-34). On `400` (bad reason) the dialog shows the field error and stays open (AC-35).

**States**

| State | Presentation |
|---|---|
| Loading | full-card `LoadingState`. |
| Loaded | as above. |
| `404` (unknown or not owned) | `EmptyState`-style "Ticket not found", body "This ticket doesn't exist or isn't associated with the current development requester.", `[ ← Back to My Tickets ]` (AC-37, AC-38, BR-14). |
| Failure (`500`/network) | `ErrorState` with `Retry`. |
| Requester changed while open | the screen does **not** re-fetch this (now-foreign) ticket; the client immediately navigates to `/tickets` (My Tickets) for the new Requester (BR-11, AC-09). |

**Responsive:** header field grid is 3-up `≥ 992px`, 2-up `768–991px`, 1-up `< 768px`; attachment
rows stack their action buttons below the filename on mobile and remain full-width touch targets;
removed-attachment reason text wraps, never truncates to unreadable (labsheet §8.7 "unreadable
attachment names" prohibition).

---

## 11. Responsive requirements (all screens)

| Viewport | Required behavior |
|---|---|
| Desktop `≥ 992px` | Multi-column layouts as specified; content centered, `max-width: 1120px`. |
| Tablet `768–991px` | Two-column where practical; Summary/Description keep full width; ticket list stays a table. |
| Mobile `< 768px` | Single-column stack; ticket table → cards; nav → hamburger; buttons full-width & ≥ 44px; **no horizontal page scroll**. |
| All | No clipped labels, no overlapping messages, no hidden primary action, no unreadable attachment names. Long text truncates with ellipsis **and** a `title`, never silently clips. |

---

## 12. Accessibility rules

- Every input has a programmatically associated `<label>`; required state via `aria-required` and a
  visible `*`.
- Validation messages: `aria-describedby` links field → message; `aria-invalid` on error; the
  message container uses `role="alert"` when it first appears; the summary of errors is **not** the
  only place errors are shown.
- Loading regions: `role="status"` (polite). Failure/error regions: `role="alert"` (assertive).
- Focus: visible `--zen-focus-ring` on `:focus-visible` for all interactive elements; on submit with
  errors, focus moves to the first invalid field; dialogs trap focus and restore it on close.
- Icon-only controls (e.g. sort carets, paperclip): `aria-label` + a `title` tooltip.
- Color is never the sole signal: priority/status via text label; success via check icon + text;
  error via ⚠ + text.
- Keyboard: all flows (select requester → create → list → detail → download → remove) are completable
  without a mouse; row links are real `<a>`/`<Link>` elements; the row-level "View" affordance is
  keyboard reachable even when the whole row is clickable.
- Nav exposes `aria-current="page"` on the active route.
- Contrast: body text on surface ≥ 4.5:1; `--zen-text` on `--zen-surface` and white on
  `--zen-primary` both pass.

---

## 13. Screen mode summary

| Screen | Mode(s) | Feedback covered |
|---|---|---|
| Requester Selection | select | loading, empty, failure, invalid-stored-id notice |
| Create Ticket | create | initial, loading ref-data, validation, submitting, success, success-with-warning, failure |
| My Tickets | list | loading, rows, empty, no-results, last-page, failure, requester-switch reload |
| Ticket Detail | view (+ attachment sub-actions: upload, remove-dialog) | loading, loaded, not-found, failure; per-attachment: active/image/pdf/uploading/failed/removed/unavailable |

---

## 14. Visual inspection checklist  (executed in `tests.md` §4; screenshots in `artifacts/lab-02/screenshots/`)

For **Create Ticket**, **My Tickets**, and **Ticket Detail**, at **desktop / tablet / mobile**:

- [ ] Header uses `--zen-primary`; primary button uses `--zen-primary`; active nav link marked and
      `aria-current`.
- [ ] Page background `--zen-page-bg`; cards white with the restrained shadow and `--zen-border`.
- [ ] Editable fields are white with a neutral border; read-only / system fields use
      `--zen-readonly-bg` and are unmistakably distinct.
- [ ] Required fields show a red `*`; a validation message still appears on error (asterisk does not
      replace it); message sits directly under its field.
- [ ] Inputs share one height; Description textarea is taller and resizes without breaking layout.
- [ ] Buttons show visible text; disabled buttons look distinct and cannot be activated; Submit shows
      a busy state during the request.
- [ ] Priority and Status badges are visually consistent everywhere they appear and carry a text
      label (not color only).
- [ ] Ticket list is a table on desktop/tablet and cards on mobile; both show the agreed fields.
- [ ] Filters, sort, Clear Filters, and pagination are usable and unclipped at every viewport.
- [ ] Attachment controls (add / download / remove / removed-metadata) are usable at every viewport;
      attachment names are always readable (wrap, not clip).
- [ ] Empty state and no-results state are visibly different.
- [ ] Focus ring is visible when tabbing; keyboard can reach every control.
- [ ] No horizontal page scroll, no overlapping text, no hidden primary action at any of the three
      widths.
