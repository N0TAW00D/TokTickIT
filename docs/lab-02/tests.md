# Lab 2 Test Plan and Results — TokTickIT Requester Ticketing MVP

> Status: **Draft for review**. Companion to [`specification.md`](./specification.md),
> [`api-spec.md`](./api-spec.md), [`ui-spec.md`](./ui-spec.md). This plan is written **from the
> specification, before implementation is declared complete**. It is not reconstructed from whatever
> the coding agent generated. Every acceptance criterion (AC-01…AC-43) maps to at least one planned
> test; every planned automated test names its real file path.

---

## 1. Test Strategy

### 1.1 Levels and tools

| Level | Tool | Location | What it covers |
|---|---|---|---|
| Unit | Vitest | `server/tests/lab-02/` | Pure logic: Ticket Number format/sequence, validation helpers, query-param parsing. |
| API / integration | Vitest + Supertest, real Postgres (test DB) | `server/tests/lab-02/*.api.test.ts` | Every endpoint in `api-spec.md`: success, validation, ownership, missing-resource, boundary, status codes. |
| UI component | Vitest + React Testing Library + jsdom, `fetch` mocked | `client/tests/lab-02/*.test.tsx` | Screen behavior and states: rendering, validation messages, busy state, success/failure/empty/no-results. |
| UI style | Vitest + RTL assertions on classes/tokens/roles | `client/tests/lab-02/ui-style.test.tsx` | Required tokens/classes, read-only vs editable, asterisks, message placement, badge consistency, button states. |
| Responsive | Playwright, 3 viewports | `e2e/lab-02/responsive.spec.ts` | No horizontal scroll, table→cards, nav collapse, no clipped labels/hidden actions; screenshot capture. |
| E2E | Playwright, real client + server + test DB | `e2e/lab-02/requester-ticket-flow.spec.ts` | Full requester journey + cross-requester isolation. |

### 1.2 TDD workflow

For each implementation Issue (#14–#20): write the planned tests for that Issue first and confirm
they **fail for the expected reason**, implement the smallest correct behavior, refactor while green.
The `Final` column below is `Pending` until the Issue's PR is merged into `lab2-staging` with the
test passing, then `Pass`.

### 1.3 Test database

- API and E2E tests run against a dedicated database from `server/.env.test` (never the dev DB).
- Before a run: migrate + seed the test DB (reference data + the 4 active / 1 inactive Requesters
  are read-only fixtures).
- Between tests: truncate `Attachment`, `Ticket`, `TicketCounter` and restart their identity
  sequences. Reference/requester rows are left intact.
- Uploaded files during tests go to a temp directory cleared in `afterEach`.

### 1.4 Environment matrix (responsive)

| Name | Width × Height |
|---|---|
| desktop | 1280 × 900 |
| tablet | 834 × 1112 |
| mobile | 390 × 844 |

---

## 2. Planned Tests

Type key: U = unit, A = API/integration, C = UI component, S = UI style, R = responsive, E = E2E.

| Test ID | Type | Requirement / AC | What it tests | Expected result | Automated test file | Final |
|---|---|---|---|---|---|---|
| UNIT-01 | U | BR-01 | Ticket Number formatter | `format(2026, 1)` → `"TKT-2026-000001"`; `format(2026, 123456)` → `"TKT-2026-123456"` | `server/tests/lab-02/ticket-number.test.ts` | Pending |
| UNIT-02 | U | BR-01, BR-28 | Per-year sequence increments and is gap-free within a year | consecutive allocations for 2026 return 1,2,3…; a new year restarts at 1 | `server/tests/lab-02/ticket-number.test.ts` | Pending |
| UNIT-03 | U | BR-28 | Concurrent allocation | 20 parallel allocations yield 20 distinct sequential numbers, no duplicate | `server/tests/lab-02/ticket-number.test.ts` | Pending |
| UNIT-04 | U | §4-fields, A-03 | Summary/description trim + length validator | 4 chars → invalid; 5 → valid; 141 → invalid; `"  hi  "` trimmed then judged | `server/tests/lab-02/validation.test.ts` | Pending |
| UNIT-05 | U | BR-16–BR-19 | List query-param parser | `pageSize=7`→error; `sort=bogus`→error; missing→defaults (`createdAt`,`desc`,1,10); blank `search`→undefined | `server/tests/lab-02/validation.test.ts` | Pending |
| UNIT-06 | U | BR-21, BR-29 | Attachment type guard + safe filename | `.exe`/`text/plain`→reject; `report.pdf`+`application/pdf`→accept; `../../etc/passwd`→stored name has no path, `originalFilename` ≤ 255 | `server/tests/lab-02/validation.test.ts` | Pending |
| API-01 | A | AC-10, BR-35 | `GET /api/categories` | `200`; only active; ordered by `id`; Lab 1 four categories still present | `server/tests/lab-02/reference-data.api.test.ts` | Pending |
| API-02 | A | AC-10, BR-35 | `GET /api/related-systems` | `200`; only active; ordered by `name`; ≥ 6 rows | `server/tests/lab-02/reference-data.api.test.ts` | Pending |
| API-03 | A | AC-42, BR-08 | `GET /api/requesters` | `200`; ≥ 4 active, ordered by name; inactive seed Requester absent | `server/tests/lab-02/requesters.api.test.ts` | Pending |
| API-04 | A | AC-05, AC-06 | `GET /api/requesters` failure/empty shape | on DB error → `500 {error:"INTERNAL"}` generic; empty table → `200 []` | `server/tests/lab-02/requesters.api.test.ts` | Pending |
| API-05 | A | AC-01, AC-16, BR-01, BR-02 | `POST /api/tickets` happy path | `201`; body has `ticketNumber` `TKT-YYYY-000001`, `status:"NEW"`, `requester.id` = header id, empty `attachments` | `server/tests/lab-02/create-ticket.api.test.ts` | Pending |
| API-06 | A | AC-11–AC-13, BR-25, BR-26 | `POST /api/tickets` field validation | missing summary / summary 4 / summary 141 / description 19 / bad priority → `400 VALIDATION_FAILED` with `fields[]`; DB row count unchanged | `server/tests/lab-02/create-ticket.api.test.ts` | Pending |
| API-07 | A | AC-43, BR-36 | `POST /api/tickets` bad references | unknown or inactive `categoryId`/`relatedSystemId` → `404 NOT_FOUND`; nothing persisted | `server/tests/lab-02/create-ticket.api.test.ts` | Pending |
| API-08 | A | BR-13, A-01, A-10 | `POST /api/tickets` requester header | missing header → `400 MISSING_REQUESTER`; unknown id → `400 INVALID_REQUESTER`; inactive id → `400 INVALID_REQUESTER`; body `requesterId` ignored (owner = header) | `server/tests/lab-02/create-ticket.api.test.ts` | Pending |
| API-09 | A | BR-28 | `POST /api/tickets` concurrency | 15 parallel creates → 15 unique `ticketNumber`, all `TKT-YYYY-NNNNNN`, sequence contiguous | `server/tests/lab-02/create-ticket.api.test.ts` | Pending |
| API-10 | A | AC-22, BR-15 | `GET /api/tickets` ownership scope | Requester A sees only A's tickets; `meta.totalItems` matches A's count; B's tickets never appear | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-11 | A | AC-22, BR-18 | `GET /api/tickets` default sort + pagination | default `createdAt desc, id desc`; `pageSize` 10; `meta` correct | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-12 | A | AC-23, BR-16 | `GET /api/tickets?search=` | matches substring of ticketNumber OR summary, case-insensitive; blank search ignored | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-13 | A | AC-24, BR-17 | `GET /api/tickets` filters | `categoryId` alone; `categoryId`+`priority` AND; `status=NEW`; results respect all | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-14 | A | AC-25, BR-18 | `GET /api/tickets` sorting | `sort=ticketNumber&order=asc` orders correctly and is stable across pages | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-15 | A | AC-26, BR-20 | `GET /api/tickets` page 2 | returns next slice; `meta.page=2`, `totalItems`, `totalPages` correct | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-16 | A | AC-27, BR-19 | `GET /api/tickets` page past end | `200`; `items: []`; `meta` still correct; not an error | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-17 | A | AC-28, BR-19, FR-29 | `GET /api/tickets` invalid params | `pageSize=7`, `page=0`, `page=-1`, `sort=bogus`, `priority=SUPER`, unknown `categoryId` → `400 INVALID_QUERY` with `fields[]`; no coercion | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-18 | A | BR-13 | `GET /api/tickets` header rules | missing/unknown/inactive `X-Requester-Id` → `400` | `server/tests/lab-02/my-tickets.api.test.ts` | Pending |
| API-19 | A | AC-32, BR-38 | `GET /api/tickets/:id` owned | `200`; full header fields match stored; attachments array present | `server/tests/lab-02/ticket-detail.api.test.ts` | Pending |
| API-20 | A | AC-37, AC-03, BR-14, BR-42 | `GET /api/tickets/:id` not owned / unknown | B requesting A's ticket → `404 NOT_FOUND`; unknown id → `404`; both responses byte-identical | `server/tests/lab-02/ticket-detail.api.test.ts` | Pending |
| API-21 | A | AC-36, BR-33 | `GET /api/tickets/:id` lists removed attachments as metadata | removed attachment present with `isRemoved:true`, `removedAt`, `removedReason`, no download path | `server/tests/lab-02/ticket-detail.api.test.ts` | Pending |
| API-22 | A | AC-18, BR-21 | `POST /tickets/:id/attachments` type rules | `.exe`, `.txt`, `.png` renamed `.pdf` (content mismatch) → `415 UNSUPPORTED_TYPE`; JPEG/PNG/WEBP/PDF → `201` | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-23 | A | AC-19, BR-22 | attachment size | 5 MB + 1 byte → `413 FILE_TOO_LARGE`; exactly 5 MB → `201` | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-24 | A | AC-20, BR-23 | attachment active-count limit | 5 active exist → 6th → `409 ATTACHMENT_LIMIT`; after removing one, upload succeeds | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-25 | A | BR-27, BR-29 | attachment storage safety | stored name is `<uuid>.<ext>` under uploads dir; row exists only after file written; `originalFilename` path-stripped; ticket `updatedAt` bumped | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-26 | A | AC-37, BR-14 | attachment ownership | B uploading to / reading / downloading / deleting A's ticket's attachment → `404` | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-27 | A | AC-33, FR-20 | `GET /api/attachments/:id/download` active | `200`; `Content-Disposition: attachment; filename="..."`; bytes match uploaded file | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-28 | A | AC-34, BR-33 | download of removed attachment | after soft-remove → `410 ATTACHMENT_REMOVED` | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-29 | A | AC-34, BR-31 | `DELETE /api/attachments/:id` happy path | `200`; `isRemoved:true`, `removedAt`, `removedReason`, `removedById` set; disappears from active list; ticket `updatedAt` bumped | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-30 | A | AC-35, BR-31, A-09 | `DELETE` reason validation | no `reason` / 2 chars / 201 chars → `400 VALIDATION_FAILED`; attachment stays active | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-31 | A | BR-32 | `DELETE` already removed | second delete → `409 ALREADY_REMOVED` | `server/tests/lab-02/attachments.api.test.ts` | Pending |
| API-32 | A | BR-41 | generic error body | forced internal error → `500 {error:"INTERNAL"}`; body has no stack/SQL/path | `server/tests/lab-02/create-ticket.api.test.ts` | Pending |
| C-01 | C | AC-02, FR-05 | route guard | visiting `/tickets` with no stored requester renders the Requester Selection screen | `client/tests/lab-02/RequesterSelection.test.tsx` | Pending |
| C-02 | C | AC-04 | selection loading | while `GET /api/requesters` pending → `role="status"` shown, Continue disabled | `client/tests/lab-02/RequesterSelection.test.tsx` | Pending |
| C-03 | C | AC-05 | selection API failure | fetch rejects → `role="alert"` with Retry; no `<select>` rendered | `client/tests/lab-02/RequesterSelection.test.tsx` | Pending |
| C-04 | C | AC-06 | selection empty | `[]` → distinct empty-state message; Continue disabled | `client/tests/lab-02/RequesterSelection.test.tsx` | Pending |
| C-05 | C | AC-02, FR-02 | selection success | choose requester + Continue → id in `localStorage`, navigation to `/tickets` | `client/tests/lab-02/RequesterSelection.test.tsx` | Pending |
| C-06 | C | AC-08, BR-10 | stale stored requester | stored id not in active list → cleared, routed to selection with a `role="status"` notice | `client/tests/lab-02/RequesterSelection.test.tsx` | Pending |
| C-07 | C | AC-07, FR-03 | app shell | shell shows current Requester name and a "Change Requester" action; active nav link has `aria-current="page"` | `client/tests/lab-02/AppShell.test.tsx` | Pending |
| C-08 | C | AC-09, BR-11 | requester switch | changing Requester resets filters and triggers a My Tickets reload scoped to the new id | `client/tests/lab-02/AppShell.test.tsx` | Pending |
| C-09 | C | AC-10, FR-07 | create form loads reference data | Category/Related System options come from mocked API; Requester field shows context name and is read-only | `client/tests/lab-02/CreateTicket.test.tsx` | Pending |
| C-10 | C | AC-11 | create validation — empty summary | submit with empty Summary → message under Summary, focus on Summary, no `POST` fired | `client/tests/lab-02/CreateTicket.test.tsx` | Pending |
| C-11 | C | AC-12, AC-13 | create validation — lengths | Summary 4 / 141, Description 19 → field-level length messages; no `POST` | `client/tests/lab-02/CreateTicket.test.tsx` | Pending |
| C-12 | C | AC-14, BR-24 | create busy state | on submit the button shows busy + is disabled until the response resolves; only one `POST` fired on double-click | `client/tests/lab-02/CreateTicket.test.tsx` | Pending |
| C-13 | C | AC-15 | create success | `201` → confirmation shows returned `ticketNumber` + "View ticket" / "Create another" | `client/tests/lab-02/CreateTicket.test.tsx` | Pending |
| C-14 | C | AC-17, BR-26 | create API failure | `POST` rejects → safe error state; all field values + pending attachment list preserved; submit re-enabled | `client/tests/lab-02/CreateTicket.test.tsx` | Pending |
| C-15 | C | AC-18, AC-19 | attachment client validation | `.exe` → per-file "unsupported type", not queued; 6 MB image → "too large", not queued; valid PDF queued with name+size | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| C-16 | C | AC-21, BR-27 | partial attachment failure | create `201` then one upload rejects → success panel + warning callout naming the failed file | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| C-17 | C | AC-20, BR-23 | add-attachment disabled at 5 | 5 active → "Add attachment" disabled with tooltip | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| C-18 | C | AC-34 | remove dialog happy path | Remove → dialog with required reason; submit → row becomes "Removed" with date + reason; `role="status"` toast | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| C-19 | C | AC-35 | remove dialog reason required | empty / 2-char reason → dialog shows field error, stays open, no `DELETE` fired | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| C-20 | C | AC-36, BR-33 | removed attachment presentation | removed row shows name/size/type/removed-date/reason and **no** Download/Preview/Remove control | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| C-21 | C | AC-33, BR-34 | attachment actions | active image → Preview + Download; active PDF → Download only; both → Remove | `client/tests/lab-02/AttachmentSection.test.tsx` | Pending |
| C-22 | C | AC-22 | My Tickets list render | desktop rows show Ticket No., Created, Summary, Category, Related System, Priority badge, Status badge, Last Updated (no attachment-count column); mobile card shows the same fields plus a 📎 count when `> 0`; row links to `/tickets/:id` | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| C-23 | C | AC-23, AC-24, AC-25 | My Tickets controls fire correct query | typing search (debounced), choosing filters, changing sort → request carries the right params | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| C-24 | C | AC-26 | My Tickets pagination | Next → `page=2` request; "Showing 11–20 of 22" from `meta`; Prev disabled on page 1 | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| C-25 | C | AC-29, BR-37 | My Tickets empty state | `meta.totalItems=0` and no active query → empty-state + "Create your first ticket" CTA (not no-results) | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| C-26 | C | AC-30, BR-37 | My Tickets no-results state | active filter, `items:[]` → no-results message + Clear Filters; filter bar still visible/populated | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| C-27 | C | AC-27 | My Tickets last/over page | over-page `items:[]` → "no more tickets" + back-to-page-1 link, not an error | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| C-28 | C | AC-31 | My Tickets failure state | list fetch rejects → `role="alert"` + Retry | `client/tests/lab-02/MyTickets.test.tsx` | Pending |
| C-29 | C | AC-32 | Ticket Detail read-only render | all header fields present as static text (no inputs), values match mocked response | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pending |
| C-30 | C | AC-38, BR-14 | Ticket Detail not found | `404` → "Ticket not found" state + Back to My Tickets link | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pending |
| C-31 | C | FR-32 | Ticket Detail failure | `500`/network → `role="alert"` + Retry | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pending |
| C-32 | C | AC-09, BR-11 | Ticket Detail on requester switch | with Ticket Detail open, changing the Requester navigates to `/tickets` (My Tickets) for the new id and does **not** re-fetch the foreign ticket | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pending |
| S-01 | S | AC-41, ui-spec §2 | color tokens applied | header element computed background = `--zen-primary`; primary button uses it; page bg = `--zen-page-bg` | `client/tests/lab-02/ui-style.test.tsx` | Pending |
| S-02 | S | AC-41, ui-spec §5.3 | read-only vs editable | read-only fields carry the read-only class/`readonly`/static markup; editable inputs do not | `client/tests/lab-02/ui-style.test.tsx` | Pending |
| S-03 | S | ui-spec §5.2 | required asterisk + message coexist | required fields render `*`; on error the message **also** appears below the field | `client/tests/lab-02/ui-style.test.tsx` | Pending |
| S-04 | S | ui-spec §5.2 | validation message placement | error node is `aria-describedby`-linked to its field and rendered adjacent, not only at top | `client/tests/lab-02/ui-style.test.tsx` | Pending |
| S-05 | S | AC-14, ui-spec §5.1 | button states | disabled button has `aria-disabled` and cannot activate; Submit gets busy attributes during request | `client/tests/lab-02/ui-style.test.tsx` | Pending |
| S-06 | S | AC-41, ui-spec §7 | badge consistency | same `PriorityBadge`/`StatusBadge` markup + text label in list, card, and detail; text present regardless of color | `client/tests/lab-02/ui-style.test.tsx` | Pending |
| S-07 | S | AC-40, ui-spec §12 | icon-only controls labelled | sort carets / paperclip have `aria-label` + `title` | `client/tests/lab-02/ui-style.test.tsx` | Pending |
| R-01 | R | AC-39 | no horizontal scroll | Create Ticket, My Tickets, Ticket Detail at desktop/tablet/mobile: `scrollWidth <= clientWidth` | `e2e/lab-02/responsive.spec.ts` | Pending |
| R-02 | R | AC-39, ui-spec §9 | table → cards | ticket list renders `<table>` at ≥ 768px and card list at < 768px | `e2e/lab-02/responsive.spec.ts` | Pending |
| R-03 | R | AC-39, ui-spec §4 | nav collapses | header nav links inline at ≥ 768px; hamburger with `aria-expanded` at < 768px | `e2e/lab-02/responsive.spec.ts` | Pending |
| R-04 | R | AC-39 | no clipped label / hidden primary action | on each screen×viewport the primary action and every field label are visible in the layout box | `e2e/lab-02/responsive.spec.ts` | Pending |
| R-05 | R | §8.8, A-13 | screenshot capture | writes `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/{desktop,tablet,mobile}.png` | `e2e/lab-02/responsive.spec.ts` | Pending |
| R-06 | R | AC-40, ui-spec §12 | keyboard traversal | tabbing through Create Ticket / My Tickets / Ticket Detail reaches every interactive control in DOM order and each shows a `:focus-visible` ring (computed outline ≠ none) | `e2e/lab-02/responsive.spec.ts` | Pending |
| E2E-01 | E | AC-01, AC-15, AC-16, AC-23, AC-33 | full requester journey | select Requester → create ticket + 1 attachment → confirmation shows official number → find via search in My Tickets → open detail → download attachment (200) | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pending |
| E2E-02 | E | AC-21, AC-34, AC-36 | attachment failure + soft-removal journey | on Ticket Detail, an upload forced to fail shows the retry affordance and a successful retry adds it; then remove an attachment with a reason → row shows "Removed" + reason → download blocked in UI | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pending |
| E2E-03 | E | AC-03, AC-09, AC-37 | cross-requester isolation | create ticket as A → Change Requester to B → B's My Tickets does not list A's ticket → visiting `/tickets/:idOfA` shows "Ticket not found" | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pending |
| E2E-04 | E | AC-17, BR-26 | create failure preserves input | fill valid form, stop API, submit → safe error, values still present, submit re-enabled | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pending |
| E2E-05 | E | AC-29, AC-30 | empty vs no-results | fresh Requester → empty state; after creating one, a non-matching search → no-results state (visibly different) | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pending |

---

## 3. Acceptance-Criterion Traceability

Every AC has ≥ 1 planned test. (`✓` via that test.)

| AC | Planned tests |
|---|---|
| AC-01 | API-05, E2E-01 |
| AC-02 | C-01 |
| AC-03 | API-20, E2E-03 |
| AC-04 | C-02 |
| AC-05 | API-04, C-03 |
| AC-06 | API-04, C-04 |
| AC-07 | C-07 |
| AC-08 | C-06 |
| AC-09 | C-08, C-32, E2E-03 |
| AC-10 | API-01, API-02, C-09 |
| AC-11 | API-06, C-10 |
| AC-12 | API-06, C-11 |
| AC-13 | API-06, C-11 |
| AC-14 | C-12, S-05 |
| AC-15 | C-13, E2E-01 |
| AC-16 | API-05, E2E-01 |
| AC-17 | C-14, E2E-04 |
| AC-18 | UNIT-06, API-22, C-15 |
| AC-19 | API-23, C-15 |
| AC-20 | API-24, C-17 |
| AC-21 | C-16, E2E-02 |
| AC-22 | API-10, API-11, C-22 |
| AC-23 | API-12, C-23, E2E-01 |
| AC-24 | API-13, C-23 |
| AC-25 | API-14, C-23 |
| AC-26 | API-15, C-24 |
| AC-27 | API-16, C-27 |
| AC-28 | UNIT-05, API-17 |
| AC-29 | C-25, E2E-05 |
| AC-30 | C-26, E2E-05 |
| AC-31 | C-28 |
| AC-32 | API-19, C-29 |
| AC-33 | API-27, C-21, E2E-01 |
| AC-34 | API-28, API-29, C-18, E2E-02 |
| AC-35 | API-30, C-19 |
| AC-36 | API-21, C-20, E2E-02 |
| AC-37 | API-20, API-26, E2E-03 |
| AC-38 | C-30, E2E-03 |
| AC-39 | R-01, R-02, R-03, R-04 |
| AC-40 | S-07, R-06, V-12 |
| AC-41 | S-01, S-02, S-06 |
| AC-42 | API-03 |
| AC-43 | API-07 |

Business rules without a dedicated AC but still covered: BR-24 (C-12), BR-28 (UNIT-03, API-09),
BR-41 (API-32), BR-42 (API-20), BR-27 (API-25, C-16).

---

## 4. Responsive and Visual Checklist

Run after the screens are built, at desktop / tablet / mobile, comparing against `ui-spec.md` §14
and the approved illustrations (not memory). Record the result and attach screenshots.

| # | Check | ui-spec ref | Result |
|---|---|---|---|
| V-01 | Header, primary buttons use `--zen-primary`; active nav marked + `aria-current` | §2, §4 | ☐ |
| V-02 | Page bg `--zen-page-bg`; cards white + restrained shadow + `--zen-border` | §3 | ☐ |
| V-03 | Editable fields white/neutral border; read-only fields clearly distinct | §5.3 | ☐ |
| V-04 | Required `*` present **and** a validation message shows on error, directly under the field | §5.2 | ☐ |
| V-05 | One input height; Description textarea taller, resizes without breaking layout | §5.3 | ☐ |
| V-06 | Buttons show text; disabled distinct + inert; Submit busy during request | §5.1 | ☐ |
| V-07 | Priority + Status badges consistent everywhere and carry a text label | §7 | ☐ |
| V-08 | Ticket list = table at ≥ 768px, cards at < 768px; card carries the same identifying fields plus the mobile-only 📎 attachment count | §9 | ☐ |
| V-09 | Filters, sort, Clear Filters, pagination usable + unclipped at all viewports | §9, §11 | ☐ |
| V-10 | Attachment controls + removed-metadata usable at all viewports; names readable (wrap not clip) | §10, §11 | ☐ |
| V-11 | Empty state vs no-results state visibly different | §9 | ☐ |
| V-12 | Visible focus ring when tabbing; keyboard reaches every control | §12 | ☐ |
| V-13 | No horizontal page scroll, no overlap, no hidden primary action at desktop/tablet/mobile | §11 | ☐ |
| V-14 | Create Ticket matches Figure-1-style field grouping (system fields top, classification grouped, Summary/Description wide, Attachments below, actions bottom) | §8 | ☐ |
| V-15 | Screenshots saved under `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/` | §14 | ☐ |

---

## 5. Test Commands

> The `.env.test.example`, `npm run db:test:reset` / `db:test` scripts, the root `test:all` script,
> and the `e2e/` workspace do **not exist yet** — they are created by Issue #14 (test DB) and Issue
> #20 (E2E). Until then, only `cd server && npm test` (existing Lab 1 tests) and `cd client && npm
> test` run.

Run from the repository root.

```bash
# --- one-time: test database (created in #14) ---
cd server
cp .env.test.example .env.test           # points DATABASE_URL at the toktickit_test DB
npm run db:test:reset                     # migrate + seed the test DB

# --- server: unit + API/integration ---
npm test                                  # vitest run (uses .env.test, truncates Ticket/Attachment per test)

# --- client: UI component + UI style ---
cd ../client
npm test                                  # vitest run (jsdom, fetch mocked)

# --- E2E + responsive + screenshots ---
cd ../e2e
npm install
npx playwright install --with-deps
npm run test:e2e                          # boots client + server against the test DB, runs Playwright

# --- everything, from repo root ---
cd ..
npm run test:all                          # server + client + e2e
```

All commands must pass from a clean checkout of `main` after the release PR is merged.

---

## 6. Final Results

Filled in as Issues merge into `lab2-staging`, then re-confirmed on `main`.

| Suite | Command | Tests | Pass | Fail | Skipped | Run on | Evidence |
|---|---|---|---|---|---|---|---|
| Server unit + API | `cd server && npm test` | — | — | — | 0 (required) | _pending_ | _screenshot / CI link_ |
| Client component + style | `cd client && npm test` | — | — | — | 0 (required) | _pending_ | _screenshot / CI link_ |
| E2E + responsive | `cd e2e && npm run test:e2e` | — | — | — | 0 (required) | _pending_ | _screenshot / CI link_ |

Definition-of-Done gate (from `specification.md` §10.1): no test skipped, disabled, `.only`, or
commented out; every AC row above shows a passing test; screenshots committed.

---

## 7. Known Limitations / Deferred Tests

- **Load / stress testing** is out of scope; UNIT-03 and API-09 cover only small-N concurrency for
  the Ticket Number race, not sustained load.
- **`summary` substring search** is asserted for correctness, not performance (unindexed scan —
  `specification.md` §7.5).
- **Visual regression / pixel diffing** is not automated; §4 is a human checklist plus committed
  screenshots, per labsheet §8.8.
- **Cross-browser**: Playwright runs Chromium only in Lab 2.
- **Accessibility** is covered by role/label/focus assertions (S-04, S-05, S-07), a Playwright
  tab-order + focus-ring check (R-06), nav-collapse (R-03), and a manual keyboard walkthrough
  (V-12) — not a full automated axe audit.
- **Physical file cleanup** of soft-removed attachments is not implemented or tested (A-08); only
  access-blocking (`410`) is tested.
- Auth, IT-Staff, comments, and post-`NEW` status transitions are out of scope and have no tests
  (by design).
