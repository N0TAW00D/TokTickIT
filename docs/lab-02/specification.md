# Lab 2 Sprint Engineering Specification — TokTickIT Requester Ticketing MVP

> Status: **Draft for review**. This is the engineering contract for Sprint 2. It must be approved
> before implementation PRs are merged. Companion documents: [`api-spec.md`](./api-spec.md),
> [`ui-spec.md`](./ui-spec.md), [`tests.md`](./tests.md).

---

## 1. Sprint Goal

Deliver a professional, responsive **Requester-facing** ticketing experience. A Requester (selected
through a temporary Development Requester screen that stands in for login) can create an IT support
ticket with supporting attachments, receive a backend-generated Ticket Number, find the ticket in a
searchable/filterable/sortable/paginated **My Tickets** list, open a read-only **Ticket Detail**
screen, and add or soft-remove permitted attachments — with the backend guaranteeing that one
Requester can never see or touch another Requester's ticket. The sprint also establishes the reusable
**Zen Green** visual system (form, list, badge, validation, loading, empty, error, responsive
conventions) that later sprints reuse.

---

## 2. Stakeholder Request Interpretation

The IT department wants to start taking real requests. We build only the end-user (Requester) half of
the product now; IT Staff handling comes later. Because authentication ships in Lab 3, Lab 2 uses a
**Development Requester Selection** screen: the tester picks one of several seeded Requesters, and
that choice becomes the "current user" for every subsequent screen. The system owns the official
Ticket Number, stores data durably in PostgreSQL, and enforces per-Requester data isolation in the
backend (not just by hiding UI). Attachments have fixed constraints (types, size, count) and must be
removed with a soft-delete that keeps the metadata but blocks the file. All screens follow one
consistent Zen Green style so later screens do not reinvent the interface.

---

## 3. Scope

### 3.1 Included

- **Development Requester Selection** ("fake login"): load active Requesters from the DB, choose one,
  persist the choice on the client, show it in the app shell, allow switching, handle loading / empty
  / API-failure states.
- **Create Ticket**: capture classification + summary + description + requested priority + optional
  attachments; backend validation; backend-generated Ticket Number; success confirmation.
- **My Tickets**: Requester-owned paginated ticket list with search, filters, sorting, pagination,
  and meaningful loading / empty / no-results / failure states.
- **Requester Ticket Detail** (view mode): read-only ticket header fields + attachment section.
- **Attachment lifecycle**: upload (at creation and later), metadata retrieval, download of active
  attachments, and soft removal with a required reason.
- **Ownership protection**: backend-enforced; a Requester can only list/read/modify their own tickets
  and attachments.
- **Zen Green UI system**: color tokens, form/list/badge/state conventions, responsive rules,
  accessibility rules, reusable components.
- **Application shell**: identity, navigation, current-Requester display, active-page indication,
  responsive mobile navigation.
- **Automated tests**: unit, API/integration, UI component, UI style, responsive, and E2E, with a
  traceability matrix to acceptance criteria.

### 3.2 Explicitly Excluded

- Authentication & security: login, logout, passwords, hashing, sessions, tokens, real
  authenticated identities, real role-based authorization. The Development Requester selector is a
  **testing mechanism only** and must not be presented or implemented as secure authentication.
- IT Staff workflow: staff dashboard/queue, claiming/reassigning tickets, setting **IT Priority**,
  assigning a **Ticket Owner**, and any other ticket-owner functions.
- Ticket collaboration & work tracking: Public Comments, Internal Notes, Actions Taken, Event Log.
- Ticket lifecycle after creation: any status change beyond the initial `NEW` (resolve, close,
  reopen, cancel, resolution confirmation).
- Administration: managing users, Requesters, roles, or reference data through the UI.
- Editing ticket header fields after creation (Ticket Detail is read-only for header fields; only
  attachments are mutable).

---

## 4. Functional Requirements

Every FR is covered by at least one acceptance criterion in §9 and at least one planned test in
`tests.md`.

### Development Requester context

- **FR-01** The system provides a Development Requester Selection screen listing only **active**
  Requesters loaded from PostgreSQL, ordered by name.
- **FR-02** Selecting a Requester and confirming stores that Requester as the current testing context
  on the client and navigates to My Tickets.
- **FR-03** The current Requester's name is shown in the application shell on every authenticated-area
  screen.
- **FR-04** A "Change Requester" action returns the user to the selection screen; choosing a
  different Requester reloads all Requester-scoped data.
- **FR-05** If no Requester is selected (or the stored selection is no longer valid), any attempt to
  open a Requester-scoped screen redirects to the selection screen.
- **FR-06** The selection screen renders distinct **loading**, **empty** (no active Requesters), and
  **API-failure** states, and its controls are keyboard accessible.

### Create Ticket

- **FR-07** The Create Ticket screen loads reference data (Categories, Related Systems) from the DB
  and shows a read-only Requester field populated from the current context.
- **FR-08** The screen captures: Category, Related System, Requested Priority, Ticket Summary,
  Description, and optional Attachments.
- **FR-09** Ticket Number and Ticket Date are shown as system-generated / read-only and are produced
  by the backend on successful creation.
- **FR-10** On submit, the client sends the ticket to the backend, which validates all fields, and on
  success persists exactly one Ticket owned by the current Requester with status `NEW`.
- **FR-11** Client-side and server-side validation both enforce the field rules in §4-fields and §5;
  server-side validation is authoritative.
- **FR-12** While the create request is in flight, the Submit button shows a busy state and is
  disabled, preventing duplicate submission.
- **FR-13** On a validation or server failure, no Ticket is persisted, an informative error is shown
  near the relevant field(s) (not only a single top-level message), and all entered values plus the
  selected attachment list are preserved for retry.
- **FR-14** On success, the UI shows a confirmation state displaying the generated Ticket Number and
  offering "View Ticket" and "Create Another" actions.

### Attachments (creation + detail)

- **FR-15** A Requester may attach files of type JPG/JPEG, PNG, WEBP, or PDF, each ≤ 5 MB, up to a
  maximum of **5 active attachments per ticket**.
- **FR-16** Attachments may be added during ticket creation and later from the Ticket Detail screen.
- **FR-17** If ticket creation succeeds but one or more attachment uploads fail, the ticket is still
  created and the UI reports which files failed and lets the user retry them from Ticket Detail
  (no rollback of the ticket).
- **FR-18** Each attachment stores required metadata (original filename, safe stored filename, MIME
  type, size in bytes, upload timestamp, owning ticket).
- **FR-19** The backend stores files under a safe server-generated name outside any web root and
  serves them only through an ownership-checked download endpoint.
- **FR-20** A Requester may download an **active** attachment of their own ticket.
- **FR-21** A Requester may **soft-remove** an attachment of their own ticket. Removal requires a
  confirmation step and a removal reason.
- **FR-22** A soft-removed attachment remains visible as metadata on Ticket Detail (marked "Removed",
  with removal date and reason) but cannot be downloaded or previewed; its download endpoint returns
  `410 Gone`.
- **FR-23** Removed attachments do not count toward the 5-active limit.

### My Tickets

- **FR-24** My Tickets shows only tickets owned by the current Requester, as a paginated list.
- **FR-25** The list supports free-text **search** over Ticket Number and Summary
  (case-insensitive substring).
- **FR-26** The list supports **filters** by Category, Requested Priority, and Status (combinable,
  AND semantics).
- **FR-27** The list supports **sorting** by creation date (default, newest first), last-updated
  date, and Ticket Number, in ascending or descending order, with a stable secondary sort.
- **FR-28** The list supports **pagination** with a 1-based page number and a selectable page size
  from {10, 20, 50} (default 10); requesting a page past the end returns an empty page with correct
  metadata, not an error.
- **FR-29** Invalid list query parameters (unknown sort field, non-allowed page size, non-positive
  page, unknown filter value) produce a `400` with a field-specific message; parameters are not
  silently coerced.
- **FR-30** The list shows enough information per row/card to identify and open a ticket: Ticket
  Number, Summary, Category, Related System, Requested Priority, Status, Last Updated, and active
  attachment count. Each row/card opens Ticket Detail.
- **FR-31** The screen renders distinct **loading**, **empty** (Requester owns zero tickets),
  **no-results** (filters/search exclude everything), and **failure** (with retry) states, plus a
  **Clear Filters** action and a **Create Ticket** action.

### Ticket Detail (view mode)

- **FR-32** Ticket Detail presents all ticket header fields (Ticket Number, Ticket Date, Requester,
  Category, Related System, Requested Priority, Status, Summary, Description) as **read-only**.
- **FR-33** Ticket Detail presents the attachment section: active attachments with download and
  remove actions, removed attachments as read-only metadata, and an "Add Attachment" control subject
  to the same rules as creation.
- **FR-34** Opening Ticket Detail for a ticket that does not exist or is not owned by the current
  Requester shows a "Ticket not found" state with a link back to My Tickets.

### Ownership & cross-cutting

- **FR-35** Every Requester-scoped API endpoint derives the current Requester from the
  `X-Requester-Id` request header and rejects/hides data not owned by that Requester
  (missing/invalid header → `400`; not-owned or not-found ticket/attachment → `404`).
- **FR-36** All reference-data endpoints (Categories, Related Systems, Requesters) return only active
  rows.
- **FR-37** Every screen is responsive per §6 and `ui-spec.md` (desktop ≥ 992 px, tablet 768–991 px,
  mobile < 768 px) with no horizontal page scrolling, clipped labels, or hidden controls.

---

## 4-fields. Required Fields and Validation

| Field | Source | Editable | Required | Rules |
|---|---|---|---|---|
| Ticket Number | System | Read-only | n/a | Generated by backend on success; format `TKT-<YYYY>-<NNNNNN>` (BR-01). Shown as "Generated on submit" before creation. |
| Ticket Date | System | Read-only | n/a | Backend creation timestamp (BR-04). Shown as "Set on submit" before creation. Displayed in Asia/Bangkok time. |
| Requester | Context | Read-only | yes | Current Development Requester; not user-editable on the form. Sent to backend via `X-Requester-Id`. |
| Category | User | Select | yes | Must reference an **active** Category id. |
| Related System | User | Select | yes | Must reference an **active** Related System id. |
| Requested Priority | User | Select | yes | One of `LOW`, `MEDIUM`, `HIGH`. Form pre-selects `MEDIUM`; stored value is always explicit. |
| Ticket Summary | User | Text | yes | Trimmed. Length **5–140** characters after trim. Rejected if empty/whitespace-only. |
| Description | User | Textarea | yes | Trimmed. Length **20–5000** characters after trim. |
| Attachments | User | File input | no | 0–5 files, each type ∈ {JPEG, PNG, WEBP, PDF}, each ≤ 5 MB (BR-21..23). |
| Status | System | Read-only | n/a | Always `NEW` at creation (BR-02). |

**Trimming**: Summary and Description are trimmed of leading/trailing whitespace before length
checks and before persistence. Internal whitespace is preserved.

**Validation layering**: The client validates on blur and on submit and blocks submission of an
invalid form; the server re-validates every field and is the source of truth. Client and server
error messages use the same wording where practical (see `ui-spec.md`).

**Behavior after failure**: On any create failure the form keeps every entered value and the pending
attachment list; focus moves to the first field with an error; the Submit button returns to its
normal (enabled) state.

---

## 5. Business Rules

Rules are testable and numbered. Mandatory examples BR-01..BR-03 are retained verbatim from the
handout.

### Identity & defaults

- **BR-01** The official Ticket Number is generated by the backend and must be unique. Format:
  `TKT-<YYYY>-<NNNNNN>` where `YYYY` is the 4-digit year of creation in Asia/Bangkok time and
  `NNNNNN` is a zero-padded, per-year sequence starting at `000001`.
- **BR-02** A new Ticket begins with Current Status `NEW`. No other status value is produced or
  accepted in Lab 2.
- **BR-03** Lab 2 uses a Development Requester selector instead of login. The selected identity is
  for testing only and is not authentication.
- **BR-04** Ticket Date is the backend-assigned creation timestamp (`createdAt`), stored in UTC and
  displayed in Asia/Bangkok time. It is read-only.
- **BR-05** Requested Priority is one of `LOW`, `MEDIUM`, `HIGH` and is required. IT Priority is out
  of scope for Lab 2 and is not stored.
- **BR-06** A Ticket has no assigned Ticket Owner in Lab 2 (out of scope).
- **BR-07** `Last Updated` is the `updatedAt` timestamp, maintained by the backend on any change to
  the ticket or its attachments.

### Requester selection & switching

- **BR-08** The Development Requester selector lists only Requesters with `isActive = true`, ordered
  by name. An inactive Requester never appears in the selector and cannot be selected.
- **BR-09** The selected Requester id is persisted client-side in `localStorage` under
  `toktickit.requesterId`. There is no server-side session.
- **BR-10** On application load, if there is no stored selection, or the stored id does not match a
  currently active Requester, the client clears the value and routes to the selection screen; a
  short notice explains a previously selected Requester is no longer available when applicable.
- **BR-11** Changing the Requester discards all Requester-scoped client state (My Tickets results,
  filters, any open Ticket Detail) and reloads data for the new Requester.

### Ownership

- **BR-12** A Ticket is owned by exactly one Requester, set at creation from the current context and
  never changed in Lab 2.
- **BR-13** Requester-scoped endpoints identify the caller via the `X-Requester-Id` header. A
  missing, non-numeric, or unknown/inactive id → `400`.
- **BR-14** A request for a Ticket or Attachment not owned by the current Requester is answered
  identically to a request for a non-existent one: `404` (existence is not disclosed via `403`).
- **BR-15** List endpoints always filter to the current Requester server-side, regardless of any
  client-supplied filter.

### Search, filter, sort, pagination

- **BR-16** Search matches a case-insensitive substring of Ticket Number **or** Summary. Blank/
  whitespace-only search is treated as "no search".
- **BR-17** Filters: `categoryId` (active category), `priority` (`LOW|MEDIUM|HIGH`), `status`
  (`NEW`). Multiple filters combine with AND. An unrecognized filter value → `400`.
- **BR-18** Sort field ∈ {`createdAt`, `updatedAt`, `ticketNumber`}; order ∈ {`asc`, `desc`}.
  Default sort `createdAt desc`. Secondary sort always `id desc` for deterministic ordering.
- **BR-19** Pagination: `page` ≥ 1 (default 1); `pageSize` ∈ {10, 20, 50} (default 10). `page` past
  the last page returns `items: []` with correct `meta`. Non-positive `page`, non-integer `page`, or
  `pageSize` outside the allowed set → `400`.
- **BR-20** List responses include `meta` with `page`, `pageSize`, `totalItems`, `totalPages`,
  `sort`, `order`.

### Validation & duplicate submission

- **BR-21** Attachment allowed types: JPEG (`image/jpeg`), PNG (`image/png`), WEBP (`image/webp`),
  PDF (`application/pdf`). Type is checked by both file extension and detected content type; a
  mismatch or disallowed type → `415`.
- **BR-22** Maximum attachment size is 5 MB (`5 * 1024 * 1024` bytes). A larger file → `413`.
- **BR-23** A Ticket may have at most **5 active (non-removed) attachments**. An upload that would
  exceed this → `409`. Removed attachments do not count.
- **BR-24** The Create Ticket Submit button is disabled and busy while the request is in flight; the
  client does not issue a second create request until the first resolves.
- **BR-25** Server-side validation failure on create returns `400` with a list of
  `{ field, message }` entries and persists nothing.

### Failure behavior & data retention

- **BR-26** If a create request fails for any reason, the client retains all form input and the
  pending attachment selection; nothing is persisted server-side.
- **BR-27** Ticket creation and its attachment uploads are **not** a single atomic transaction. The
  ticket is created first (its own transaction, including atomic Ticket Number allocation); each
  attachment is uploaded in a separate request. Compensation strategy: a partially-attached ticket
  is valid; the UI surfaces failed uploads and offers retry. No orphaned files: an attachment row is
  written only after its file is safely stored, and a failed file write writes no row and returns
  `500`. An upload that fails from Ticket Detail (existing ticket) leaves the ticket and its other
  attachments untouched, surfaces the error, and allows retry.
- **BR-28** Ticket Number allocation uses a per-year counter row incremented atomically inside the
  ticket-creation transaction; the `ticketNumber` unique constraint is the backstop and creation is
  retried up to 3 times on a unique-violation.

### Attachment metadata, storage, removal

- **BR-29** Stored filename is server-generated as `<uuidv4>.<ext>` where `<ext>` is derived from the
  validated type. The client-supplied name is kept only as `originalFilename` metadata; any path
  components in it are stripped and it is truncated to 255 characters.
- **BR-30** Files are stored under `server/uploads/` (git-ignored, not statically served). Downloads
  go only through `GET /api/attachments/:id/download` after an ownership check.
- **BR-31** Soft removal sets `isRemoved = true`, `removedAt = now()`, `removedReason` (required,
  trimmed, 3–200 chars), and `removedById` = current Requester. The metadata row is never deleted.
  The physical file is retained on disk in Lab 2 but is unreachable through any endpoint.
- **BR-32** Only the owning Requester may remove an attachment. A removal attempt by any other
  Requester → `404`. Removing an already-removed attachment → `409`.
- **BR-33** A removed attachment is listed on Ticket Detail as metadata only: original filename,
  size, type, "Removed on `<date>`", and reason. No download link, no inline preview. Its download
  endpoint returns `410 Gone`.
- **BR-34** Inline preview is offered only for active image attachments (JPEG/PNG/WEBP). PDFs are
  offered as a download/open link. Removed attachments have neither.

### Reference data & inactive rows

- **BR-35** `GET /api/categories`, `GET /api/related-systems`, and `GET /api/requesters` return only
  rows with `isActive = true`.
- **BR-36** A Ticket may only be created against an active Category and an active Related System;
  referencing an inactive or unknown id → `404` (resource not found for creation input) — see
  `api-spec.md` for the exact mapping.

### Safe errors

- **BR-41** An unexpected server error returns `500` with a generic body
  (`{ "error": "Internal Server Error" }`) — never a stack trace, SQL text, file path, or raw
  exception message. Details are logged server-side only.
- **BR-42** No endpoint discloses whether a resource exists to a Requester who does not own it
  (reinforces BR-14): the not-owned and not-found responses are byte-identical.

### Empty / no-results states

- **BR-37** "Empty" (the Requester has created no tickets) and "no results" (a search/filter query
  matched nothing) are different states with different messages; the no-results state keeps the
  active filters visible and offers Clear Filters.

### Ticket Detail access

- **BR-38** Ticket Detail data comes from `GET /api/tickets/:id` scoped by `X-Requester-Id`; a
  not-owned or unknown id → `404` → "Ticket not found" UI.
- **BR-39** No Ticket Detail field except the attachment section is editable in Lab 2.

### Transition to Lab 3

- **BR-40** The `X-Requester-Id` header is a stand-in for the future `Authorization` credential. In
  Lab 3 the current-Requester derivation moves from this header to the authenticated principal; the
  `Ticket.requesterId` foreign key and the `RequesterUser` table are designed so `RequesterUser`
  can be linked to / merged into a real `User` table without dropping columns or rewriting ticket
  ownership.

---

## 6. UI Specification Summary

Full detail, tokens, and per-state layout are in [`ui-spec.md`](./ui-spec.md). Summary:

- **Application shell**: fixed header in Primary green `#006B3C` with the TokTickIT identity,
  primary nav (My Tickets, Create Ticket), current Requester name + "Change Requester", a clear
  active-page indicator, and a responsive collapsed nav below 768 px.
- **Screens**: Development Requester Selection, Create Ticket (create mode), My Tickets (list),
  Requester Ticket Detail (view mode).
- **Zen Green tokens**: Primary `#006B3C`, Secondary `#0B7A46`, Pale `#EAF6EF`, Page bg `#F5F7F6`,
  Surface white with subtle border + restrained shadow, text dark charcoal-green (not pure black),
  editable fields white with neutral border, read-only fields soft gray-green shading, error dark
  red text + border with the message directly under the field, warning amber callout, success green
  with text (never color alone).
- **Components** (reusable): `AppShell`, `RequesterBadge`, `FormField` (label above control, `*` for
  required, message slot below), `TextField`, `TextArea` (taller, resizable within layout),
  `SelectField`, `PriorityBadge`, `StatusBadge`, `Button` (primary / secondary / tertiary /
  destructive / disabled / busy), `AttachmentList`, `AttachmentUploader`, `Pagination`,
  `EmptyState`, `NoResultsState`, `ErrorState`, `LoadingState`, `TicketTable` (desktop) /
  `TicketCardList` (mobile).
- **Form-state coverage** (every data screen): initial, loading, validation error, submitting/busy,
  success, and failure.
- **List behavior**: desktop table with columns {Ticket No., Summary, Category, Related System,
  Priority, Status, Last Updated}; below 768 px each row becomes a card with the same fields
  stacked. Badges are consistent for Requested Priority and Status and never rely on color alone.
- **Responsive**: `≥ 992 px` multi-column form (classification fields two-up; Summary/Description
  full width); `768–991 px` two columns where practical; `< 768 px` single-column stack, touch-sized
  buttons, table → cards, no horizontal page scroll.
- **Accessibility**: labels bound to controls, visible focus ring in Secondary green, keyboard
  operability for all controls, `role="status"` for loading and `role="alert"` for errors, icon-only
  controls have an accessible name + tooltip, non-color status indicators.

---

## 7. Data Changes

Full schema and rationale below; the authoritative version lives in `server/prisma/schema.prisma`
with a migration under `server/prisma/migrations/`.

### 7.1 Models

**`RequesterUser`** — temporary Lab 2 Requester identity ("fake login").

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK `@default(autoincrement())` | |
| `name` | `String` | Display name. |
| `email` | `String` `@unique` | Realistic address; unique for idempotent seed. |
| `isActive` | `Boolean` `@default(true)` | Inactive Requesters excluded from selector (BR-08). |
| `createdAt` | `DateTime` `@default(now())` | |
| `updatedAt` | `DateTime` `@updatedAt` | |
| `tickets` | `Ticket[]` | Relation. |
| `removedAttachments` | `Attachment[]` (relation `AttachmentRemovedBy`) | Attachments this Requester removed. |

**`Category`** — extends the Lab 1 model.

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK `@default(autoincrement())` | |
| `name` | `String` `@unique` | |
| `isActive` | `Boolean` `@default(true)` | **New**. |
| `createdAt` | `DateTime` `@default(now())` | Existing. |
| `tickets` | `Ticket[]` | Relation. |

**`RelatedSystem`** — new reference table.

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK `@default(autoincrement())` | |
| `name` | `String` `@unique` | |
| `isActive` | `Boolean` `@default(true)` | |
| `createdAt` | `DateTime` `@default(now())` | |
| `tickets` | `Ticket[]` | Relation. |

**`Ticket`**

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK `@default(autoincrement())` | Internal key. |
| `ticketNumber` | `String` `@unique` | `TKT-YYYY-NNNNNN` (BR-01). |
| `requesterId` | `Int` FK → `RequesterUser.id` | Owner (BR-12). `onDelete: Restrict`. |
| `categoryId` | `Int` FK → `Category.id` | `onDelete: Restrict`. |
| `relatedSystemId` | `Int` FK → `RelatedSystem.id` | `onDelete: Restrict`. |
| `summary` | `String` | 5–140 chars, trimmed (BR / §4-fields). |
| `description` | `String` | 20–5000 chars, trimmed. |
| `requestedPriority` | `Priority` enum | `LOW \| MEDIUM \| HIGH`. |
| `status` | `TicketStatus` enum `@default(NEW)` | Only `NEW` in Lab 2. |
| `createdAt` | `DateTime` `@default(now())` | Ticket Date. |
| `updatedAt` | `DateTime` `@updatedAt` | Last Updated. |
| `attachments` | `Attachment[]` | Relation. |

Indexes: `@@index([requesterId, createdAt])`, `@@index([requesterId, updatedAt])`,
`@@index([requesterId, ticketNumber])`, `@@index([categoryId])`. (`ticketNumber` already has a
unique index.)

**`Attachment`**

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK `@default(autoincrement())` | |
| `ticketId` | `Int` FK → `Ticket.id` | `onDelete: Cascade`. |
| `originalFilename` | `String` | Client name, path-stripped (BR-29). |
| `storedFilename` | `String` `@unique` | `<uuid>.<ext>` on disk (BR-29). |
| `mimeType` | `String` | Validated content type. |
| `fileSize` | `Int` | Bytes. |
| `isRemoved` | `Boolean` `@default(false)` | Soft-removal flag (BR-31). |
| `removedAt` | `DateTime?` | |
| `removedReason` | `String?` | 3–200 chars when set. |
| `removedById` | `Int?` FK → `RequesterUser.id` (relation `AttachmentRemovedBy`) | |
| `createdAt` | `DateTime` `@default(now())` | Upload timestamp. |

Indexes: `@@index([ticketId, isRemoved])`.

**`TicketCounter`** — per-year sequence for Ticket Number allocation.

| Field | Type | Notes |
|---|---|---|
| `year` | `Int` PK | 4-digit year. |
| `lastValue` | `Int` `@default(0)` | Last allocated sequence for the year. |

**Enums**

```prisma
enum Priority { LOW MEDIUM HIGH }
enum TicketStatus { NEW }   // Lab 3+ adds OPEN, IN_PROGRESS, PENDING, RESOLVED, CLOSED, CANCELLED
```

### 7.2 Relationships

- `RequesterUser 1 — * Ticket` (a Requester owns many tickets; a ticket has one Requester).
- `Category 1 — * Ticket`.
- `RelatedSystem 1 — * Ticket`.
- `Ticket 1 — * Attachment` (cascade delete; not used in Lab 2 but correct).
- `RequesterUser 1 — * Attachment` via `removedById` (who soft-removed it) — the "additional
  relationship needed for removal metadata" the handout asks for.

### 7.3 Migration decisions

- One additive migration `add_lab2_ticketing`. It adds `Category.isActive` with `@default(true)` so
  existing rows and the Lab 1 categories test are unaffected.
- No data migration needed; the Lab 1 seed rows remain valid.
- `TicketCounter` is seeded lazily (upserted on first ticket of a year), not in `seed.ts`.

### 7.4 Justified design decision (required by handout §5.2)

**Ticket Number is a separate `ticketNumber` string column, not the primary key, and sequencing uses
a dedicated `TicketCounter` table rather than a raw Postgres sequence.**

Rationale: (1) The human-facing number embeds the year and resets its counter annually, which a
plain auto-increment PK cannot express. (2) Keeping an integer `id` as the PK keeps all foreign keys
narrow and keeps URLs/relations stable even if the numbering scheme changes in a later sprint. (3) A
`TicketCounter` row per year, incremented with `UPDATE ... SET lastValue = lastValue + 1` inside the
same transaction that inserts the ticket, gives a gap-free per-year sequence and is trivial to reset
or inspect in tests; a database sequence would be global, could not be per-year without extra
machinery, and leaks/gaps on rollback. The `@unique` constraint on `ticketNumber` plus a bounded
retry protects against the rare concurrent-allocation race.

### 7.5 Index and constraint rationale (required by handout §5.2)

| Access pattern | Query shape | Index that serves it |
|---|---|---|
| My Tickets default list | `WHERE requesterId=? ORDER BY createdAt DESC, id DESC` | `@@index([requesterId, createdAt])` |
| My Tickets sorted by last-updated | `WHERE requesterId=? ORDER BY updatedAt DESC` | `@@index([requesterId, updatedAt])` |
| My Tickets sorted by / searched on Ticket Number | `WHERE requesterId=? AND ticketNumber ILIKE ? ORDER BY ticketNumber` | `@@index([requesterId, ticketNumber])` |
| Category filter | `WHERE requesterId=? AND categoryId=?` | leading col of `@@index([requesterId, createdAt])` + `@@index([categoryId])` (FK) |
| Ticket Detail / attachment ops | `WHERE ticketId=? AND isRemoved=?` | `@@index([ticketId, isRemoved])` |
| Ticket Number uniqueness | insert-time collision check | `@unique` on `ticketNumber` |
| Idempotent seed | `upsert` by natural key | `@unique` on `RequesterUser.email`, `Category.name`, `RelatedSystem.name` |

- **Unique**: `Ticket.ticketNumber`, `Attachment.storedFilename`, `RequesterUser.email`,
  `Category.name`, `RelatedSystem.name`, `TicketCounter.year` (PK).
- **Foreign keys**: `Ticket.requesterId`, `Ticket.categoryId`, `Ticket.relatedSystemId`,
  `Attachment.ticketId`, `Attachment.removedById`. All `onDelete: Restrict` except
  `Attachment.ticketId` (`Cascade`).
- **Optional (nullable)**: `Attachment.removedAt`, `Attachment.removedReason`,
  `Attachment.removedById` only.
- **Accepted limitation**: `summary` substring search runs as an unindexed sequential scan within
  one Requester's (small) ticket set. At lab data volumes this is fine; a trigram / full-text index
  is the documented Lab 3+ upgrade path if the corpus grows.

### 7.6 Required Seed Data (idempotent — `upsert` by unique key, safe to re-run)

- **Categories** (4, `isActive = true`): Account and Access, Hardware, Software, Network. *(Already
  seeded in Lab 1; the Lab 2 seed adds `isActive`.)* Upsert keyed on `name`.
- **Related Systems** (≥ 6, `isActive = true`): Email, Campus Wi-Fi, VPN, LEB2 App, Grade Submission
  App, Printer, Corporate Laptop. Upsert keyed on `name`.
- **Development Requesters — active** (≥ 4): Jennifer Anderson `jennifer.anderson@example.edu`,
  Michael Brown `michael.brown@example.edu`, Sarah Johnson `sarah.johnson@example.edu`, David Lee
  `david.lee@example.edu`. Upsert keyed on `email`.
- **Development Requester — inactive** (≥ 1): Robert Wilson `robert.wilson@example.edu`,
  `isActive = false`. Must never appear in the selector (BR-08) and cannot act (A-10).
- `TicketCounter` is **not** seeded — rows are created lazily on the first ticket of each year.

---

## 8. API Contract

Full contract (paths, request/response shapes, every status code, validation and ownership failure
bodies, pagination metadata) is in [`api-spec.md`](./api-spec.md). Summary of endpoints:

| Method & path | Purpose |
|---|---|
| `GET /api/categories` | Active categories `[{id,name}]`. |
| `GET /api/related-systems` | Active related systems `[{id,name}]`. |
| `GET /api/requesters` | Active Development Requesters `[{id,name,email}]`. |
| `POST /api/tickets` | Create one validated ticket for the current Requester → `201` with full ticket. |
| `GET /api/tickets` | Current Requester's tickets, paginated + searchable + filterable + sortable → `200 {items, meta}`. |
| `GET /api/tickets/:id` | One owned ticket with attachments → `200` / `404`. |
| `POST /api/tickets/:id/attachments` | Upload one attachment (multipart) → `201` / `404` / `413` / `415` / `409`. |
| `GET /api/attachments/:id` | Attachment metadata for an owned ticket → `200` / `404`. |
| `GET /api/attachments/:id/download` | Download an active owned attachment → `200` / `404` / `410`. |
| `DELETE /api/attachments/:id` | Soft-remove an owned attachment (reason required) → `200` / `400` / `404` / `409`. |

All Requester-scoped endpoints require `X-Requester-Id`. Status codes used: `200`, `201`, `400`,
`404`, `409`, `410`, `413`, `415`, `422`(reserved — not used, `400` chosen for validation), `500`.

---

## 9. Acceptance Criteria

Given-When-Then. Every AC maps to ≥ 1 planned test in `tests.md`. `AC-01..AC-03` retained from the
handout.

**Development Requester**

- **AC-01** Given valid Ticket data, when the Requester submits the form, then one Ticket is saved
  and the official Ticket Number is displayed.
- **AC-02** Given no Development Requester is selected, when the user attempts to open My Tickets,
  then the Requester Selection screen is shown.
- **AC-03** Given Requester B is selected, when a Ticket belonging to Requester A is requested, then
  the Ticket data is not returned (`404`).
- **AC-04** Given the Requester API is loading, when the selection screen renders, then a loading
  indicator with `role="status"` is shown and the Continue button is disabled.
- **AC-05** Given the Requester API returns an error, when the selection screen renders, then a safe
  error state with a retry action is shown and no dropdown is rendered.
- **AC-06** Given there are zero active Requesters, when the selection screen renders, then a
  distinct empty-state message is shown and Continue stays disabled.
- **AC-07** Given a Requester is selected, when any authenticated-area screen renders, then the app
  shell shows that Requester's name and a "Change Requester" action.
- **AC-08** Given a stored selection whose Requester is now inactive, when the app loads, then the
  stored value is cleared and the user is routed to the selection screen with a notice.
- **AC-09** Given Requester A is viewing My Tickets with active filters (and/or an open Ticket
  Detail), when the user changes to Requester B, then the list reloads showing only Requester B's
  tickets, A's tickets are gone, the filters/search are reset, and any open Ticket Detail for an
  A-owned ticket is closed.
- **AC-42** Given one seeded Requester is inactive, when the selection screen loads, then that
  Requester is absent from the dropdown; and when a request is made with `X-Requester-Id` pointing
  at that inactive Requester, then the API returns `400`.
- **AC-43** Given an inactive (or unknown) Category or Related System id, when `POST /api/tickets`
  is called with it, then the API returns `404` and no ticket is persisted.

**Create Ticket**

- **AC-10** Given the Create Ticket screen at a desktop viewport, when it loads, then Category and
  Related System options come from the database and the Requester field shows the current Requester
  and is read-only.
- **AC-11** Given the Summary field is empty, when the user submits, then a field-level message is
  shown under Summary, focus moves to it, and no create request is sent.
- **AC-12** Given a Summary of 4 characters (below minimum) or 141 (above maximum), when the user
  submits, then a field-level length message is shown and nothing is persisted.
- **AC-13** Given a Description of 19 characters, when the user submits, then a field-level length
  message is shown and nothing is persisted.
- **AC-14** Given valid data, when the user submits, then the Submit button shows a busy state and is
  disabled until the response arrives.
- **AC-15** Given a successful create, when the response arrives, then the confirmation state shows
  the returned Ticket Number and "View Ticket" / "Create Another" actions.
- **AC-16** Given a successful create, when the ticket is retrieved, then its `requesterId` equals
  the Requester selected before entering the application and its status is `NEW`.
- **AC-17** Given the backend is unreachable, when the user submits valid data, then a safe error
  state is shown, every entered value and the pending attachment list are preserved, and the Submit
  button returns to enabled.
- **AC-18** Given two files — one PDF ≤ 5 MB and one `.exe` — selected as attachments, when the user
  reviews the list, then the PDF is accepted and the `.exe` is rejected with a per-file message and
  is not uploaded.
- **AC-19** Given an image file of 6 MB, when the user selects it, then it is rejected with a
  size message and not uploaded.
- **AC-20** Given a ticket already has 5 active attachments, when a 6th upload is attempted, then the
  API returns `409` and the UI explains the limit.
- **AC-21** Given a ticket is created but one attachment upload fails, when the confirmation renders,
  then the ticket exists, the failure is reported, and the user can retry the upload from Ticket
  Detail.

**My Tickets**

- **AC-22** Given the current Requester owns tickets, when My Tickets loads, then only that
  Requester's tickets are listed, newest first, paginated with page size 10.
- **AC-23** Given a search term matching a Ticket Number or Summary substring (case-insensitive),
  when the user searches, then only matching owned tickets are shown.
- **AC-24** Given a Category filter, when applied, then only owned tickets in that Category are
  shown; combining it with a Priority filter narrows further (AND).
- **AC-25** Given the sort control set to "Ticket Number ascending", when applied, then the list
  order changes accordingly and remains stable across pages.
- **AC-26** Given more tickets than one page, when the user goes to page 2, then the next slice is
  shown and `meta` reports the correct `page`, `totalItems`, `totalPages`.
- **AC-27** Given a page number past the last page, when requested, then the API returns `items: []`
  with correct `meta` and the UI shows a no-results/last-page message, not an error.
- **AC-28** Given `pageSize=7` or `sort=bogus`, when requested, then the API returns `400` with a
  field-specific message.
- **AC-29** Given the current Requester owns zero tickets, when My Tickets loads, then the
  empty-state message and a Create Ticket call-to-action are shown (not the no-results state).
- **AC-30** Given a filter/search that matches nothing, when applied, then the no-results state is
  shown with filters still visible and a Clear Filters action.
- **AC-31** Given the list API fails, when My Tickets loads, then a failure state with a retry action
  is shown.

**Ticket Detail & attachments**

- **AC-32** Given an owned ticket, when Ticket Detail opens, then all header fields render read-only
  and match the stored values.
- **AC-33** Given an owned ticket with an active attachment, when the user clicks download, then the
  file is served with a `Content-Disposition: attachment` header.
- **AC-34** Given an owned ticket, when the user soft-removes an attachment with a reason, then the
  attachment is marked Removed with the date and reason, disappears from the active list, and its
  download endpoint returns `410`.
- **AC-35** Given a removal attempt without a reason (or a reason under 3 chars), when submitted,
  then the API returns `400` and the attachment stays active.
- **AC-36** Given a removed attachment, when Ticket Detail renders, then its metadata (name, size,
  type, removed date, reason) is visible and no download or preview control is offered.
- **AC-37** Given Requester B, when B requests `GET /api/tickets/:id` or
  `GET /api/attachments/:id/download` for Requester A's ticket/attachment, then the response is
  `404` and no data or file is returned.
- **AC-38** Given a non-existent ticket id, when Ticket Detail opens, then the "Ticket not found"
  state with a link back to My Tickets is shown.

**Responsive & accessibility**

- **AC-39** Given desktop (≥ 992 px), tablet (768–991 px), and mobile (< 768 px) viewports, when
  Create Ticket, My Tickets, and Ticket Detail render, then there is no horizontal page scroll, no
  clipped label, no hidden primary action, and the ticket list switches from table to cards below
  768 px.
- **AC-40** Given keyboard-only navigation, when the user tabs through any screen, then every
  interactive control is reachable, shows a visible focus indicator, and icon-only controls expose
  an accessible name.
- **AC-41** Given the Zen Green spec, when any screen renders, then the documented color tokens are
  applied to header/primary actions, read-only fields are visually distinct from editable fields,
  and status/priority are conveyed with text, not color alone.

---

## 10. Definition of Done

### 10.1 Part 1 — Product Completion (the coding agent may claim "done" only when all hold)

- [ ] All FR-01..FR-37 implemented within the approved scope; nothing from §3.2 built.
- [ ] Every acceptance criterion AC-01..AC-43 satisfied and linked to passing test evidence in
      `tests.md`.
- [ ] Prisma schema matches §7; one additive migration committed and applied; `seed.ts` idempotent
      and matching §7.6.
- [ ] All API endpoints match `api-spec.md` for success, validation failure, ownership failure,
      missing-resource, and unexpected-error behavior, including exact status codes.
- [ ] Ownership is enforced in the backend for every Requester-scoped endpoint (verified by
      cross-Requester tests), not only hidden in the UI.
- [ ] Attachment rules (type, size, 5-active limit, soft removal, `410` on removed, safe stored
      names, files outside web root) all enforced server-side.
- [ ] Ticket Number is backend-generated, unique, `TKT-YYYY-NNNNNN`, with the concurrency backstop.
- [ ] Every screen implements initial / loading / validation / submitting / success / failure and
      (for lists) empty / no-results states, matching `ui-spec.md`.
- [ ] Zen Green tokens and component rules applied; UI-style assertions and the visual checklist in
      `tests.md` pass.
- [ ] Responsive behavior verified at desktop/tablet/mobile with Playwright screenshots committed
      under `artifacts/lab-02/screenshots/`.
- [ ] Full test suite (unit, API, UI, UI-style, responsive, E2E) passes from documented commands on
      the final `main` branch; no test skipped, disabled, `.only`, or commented out.
- [ ] Every failure and boundary state is **demonstrable** and captured for the submission PDF: API
      unreachable on create (values preserved), field validation, oversized attachment, disallowed
      attachment type, 6th-attachment `409`, cross-Requester `404` on ticket and attachment
      download, `410` on a removed attachment's download, empty vs no-results list states.
- [ ] `README.md` setup, environment, migration, seed, run, and test instructions are current;
      `.gitignore` excludes `server/uploads/`, `.env*` (except examples), and build artifacts.

### 10.2 Part 2 — Course Delivery Requirements

- [ ] `lab2-staging` cut from `main`; every Issue on its own feature branch; each merged into
      `lab2-staging` via a peer-reviewed PR; one release PR `lab2-staging` → `main`. No direct
      commits to `main` or `lab2-staging`.
- [ ] GitHub Project board updated; all Lab 2 Issues in **Done**; Kanban columns Backlog → Specified
      → Started → PR Review → (Fixing) → Done used.
- [ ] `docs/lab-02/reviewer.md` completed: reviewer identity, PR links, comments given and received,
      responses, approvals.
- [ ] `docs/lab-02/ai-use.md` completed: LLM used + 6–10 key prompts + brief reflection.
- [ ] `docs/lab-02/specification.md`, `tests.md`, `ui-spec.md`, `api-spec.md` present, rendered, and
      approved; screenshot proving the spec existed before the implementation PRs were completed.
- [ ] One submission PDF assembled with headings "Answer Part 1" … "Answer Part 9".

---

## 11. Assumptions and Decisions

Only choices not already fixed by the handout.

- **A-01** Requester context is transmitted via the `X-Requester-Id` HTTP header on all
  Requester-scoped endpoints (not a query param or body field). The illustrative `"requesterId": 1`
  in the handout's partial JSON is treated as illustrative only; `POST /api/tickets` takes the owner
  from the header, not the body.
- **A-02** Not-owned resources return `404` (not `403`) so existence is not disclosed (BR-14).
- **A-03** Summary length **5–140**; Description length **20–5000**. Rationale: a summary is a
  one-line headline that must fit list rows and card titles without truncation dominating the UI; a
  20-char description floor rejects "it broke" while 5000 chars is generous for a support narrative
  and bounds storage / render cost.
- **A-04** Requested Priority values are `LOW | MEDIUM | HIGH` (matching the Figure 1 badges); no
  `URGENT`. The form pre-selects `MEDIUM`.
- **A-05** `TicketStatus` enum contains only `NEW` in Lab 2; later statuses are listed in a comment
  for Lab 3+. The My Tickets status filter is still built (values: All, New) for forward
  compatibility.
- **A-06** Page sizes are restricted to `{10, 20, 50}`; default 10. Rationale: bounded page size
  caps query and render cost and keeps pagination tests deterministic.
- **A-07** Ticket creation and attachment upload are separate requests (BR-27); the client uploads
  attachments sequentially after a `201` from `POST /api/tickets`.
- **A-08** Removed attachment files are retained on disk in Lab 2 (only access is blocked). Physical
  deletion / lifecycle cleanup is deferred. Rationale: keeps removal reversible for grading/demo and
  avoids a second failure mode (file unlink) inside the removal path.
- **A-09** The soft-removal reason is required (3–200 chars). Rationale: the handout lists
  "confirmation and removal-reason requirements" as a rule students must define; a required reason
  makes removals auditable and testable.
- **A-10** `X-Requester-Id` pointing at an inactive Requester is rejected with `400` (same as
  unknown). Rationale: an inactive Requester should not be able to act, mirroring a disabled account.
- **A-11** Timestamps are stored in UTC (Prisma default) and formatted for display in Asia/Bangkok
  on the client. The Ticket Number year uses Asia/Bangkok time on the server.
- **A-12** E2E tests use Playwright in a new top-level `e2e/` workspace; API/integration tests run
  against a dedicated test database configured by `server/.env.test`, migrated and seeded before the
  run, with `Ticket`, `Attachment`, and `TicketCounter` tables truncated (and their identity
  sequences reset) between tests. Reference-data and Requester rows are seeded once and treated as
  read-only fixtures.
- **A-13** `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/` holds the
  committed Playwright screenshots at the three viewport sizes. Automated test-file paths use the
  exact names mandated by handout §12 (see `tests.md`).
- **A-14** The My Tickets illustration (handout p.11) shows `IT Priority`, `Ticket Owner`, and a
  `Resolution Summary` field; these are **intentionally omitted** as IT-Staff / post-creation scope
  (§3.2). The visual check compares against `ui-spec.md`, which reflects this reduced column set.
- **A-15** Duplicate-submission prevention is **client-side only** (Submit disabled + busy, BR-24);
  there is no server-side idempotency key. Rationale: Lab 2 is a single-user test tool with a
  deliberate double-click as the only realistic duplicate path, which the disabled button covers;
  server idempotency is noted as a Lab 3+ addition once concurrent real users exist.
