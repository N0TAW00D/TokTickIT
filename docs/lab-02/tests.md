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
The `Final` column below was `Pending` until the Issue's PR merged into `lab2-staging` with the
test passing, then `Pass`. Every §2 row is now `Pass`, re-confirmed on `main` — see §6.

### 1.3 Test database

- API tests run against a dedicated database from `server/.env.test` (`toktickit_test`, never the
  dev DB).
- E2E and responsive tests run against a second dedicated database, `toktickit_e2e`, configured in
  `e2e/.env.e2e` — its own workspace (`e2e/`), separate from both the dev database and
  `toktickit_test`, so the E2E suite can never touch either.
- Before a run: migrate + seed the relevant database (reference data + the 4 active / 1 inactive
  Requesters are read-only fixtures).
- Server suite: before every test, truncate `Attachment`, `Ticket`, `TicketCounter` and restart
  their identity sequences. Reference/requester rows are left intact.
- E2E suite: before every `npm run test:e2e` run (there is no per-test hook, unlike the server
  suite), the same truncate — `Attachment`, `Ticket`, `TicketCounter`, identity sequences restarted
  — runs once via `e2e/scripts/reset-e2e-db.ts`, so ticket data does not accumulate across runs.
  Reference/requester rows are left intact there too.
- Uploaded files during tests go to a temp directory cleared in `afterEach`.
- Toolchain for every suite: Node `>=20.19.0`, npm `>=11.18.0` (enforced via each package's
  `engines` + committed `engine-strict=true`). npm 11.18.0 is the first release with the
  `npm install-scripts` command behind the committed `allowScripts` approvals — see §5.

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
| UNIT-01 | U | BR-01 | Ticket Number formatter | `format(2026, 1)` → `"TKT-2026-000001"`; `format(2026, 123456)` → `"TKT-2026-123456"` | `server/tests/lab-02/ticket-number.test.ts` | Pass |
| UNIT-02 | U | BR-01, BR-28 | Per-year sequence increments and is gap-free within a year | consecutive allocations for 2026 return 1,2,3…; a new year restarts at 1 | `server/tests/lab-02/ticket-number.test.ts` | Pass |
| UNIT-03 | U | BR-28 | Concurrent allocation | 20 parallel allocations yield 20 distinct sequential numbers, no duplicate | `server/tests/lab-02/ticket-number.test.ts` | Pass |
| UNIT-04 | U | §4-fields, A-03 | Summary/description trim + length validator | 4 chars → invalid; 5 → valid; 141 → invalid; `"  hi  "` trimmed then judged | `server/tests/lab-02/validation.test.ts` | Pass |
| UNIT-05 | U | BR-16–BR-19 | List query-param parser | `pageSize=7`→error; `sort=bogus`→error; missing→defaults (`createdAt`,`desc`,1,10); blank `search`→undefined | `server/tests/lab-02/validation.test.ts` | Pass |
| UNIT-06 | U | BR-21, BR-29 | Attachment type guard + safe filename | `.exe`/`text/plain`→reject; `report.pdf`+`application/pdf`→accept; `../../etc/passwd`→stored name has no path, `originalFilename` ≤ 255 | `server/tests/lab-02/validation.test.ts` | Pass |
| API-01 | A | AC-10, BR-35 | `GET /api/categories` | `200`; only active; ordered by `id`; Lab 1 four categories still present | `server/tests/lab-02/reference-data.api.test.ts` | Pass |
| API-02 | A | AC-10, BR-35 | `GET /api/related-systems` | `200`; only active; ordered by `name`; ≥ 6 rows | `server/tests/lab-02/reference-data.api.test.ts` | Pass |
| API-03 | A | AC-42, BR-08 | `GET /api/requesters` | `200`; ≥ 4 active, ordered by name; inactive seed Requester absent | `server/tests/lab-02/requesters.api.test.ts` | Pass |
| API-04 | A | AC-05, AC-06 | `GET /api/requesters` failure/empty shape | on DB error → `500 {error:"INTERNAL"}` generic; empty table → `200 []` | `server/tests/lab-02/requesters.api.test.ts` | Pass |
| API-05 | A | AC-01, AC-16, BR-01, BR-02 | `POST /api/tickets` happy path | `201`; body has `ticketNumber` `TKT-YYYY-000001`, `status:"NEW"`, `requester.id` = header id, empty `attachments` | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-06 | A | AC-11–AC-13, BR-25, BR-26 | `POST /api/tickets` field validation | missing summary / summary 4 / summary 141 / description 19 / bad priority → `400 VALIDATION_FAILED` with `fields[]`; DB row count unchanged | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-07 | A | AC-43, BR-36 | `POST /api/tickets` bad references | unknown or inactive `categoryId`/`relatedSystemId` → `404 NOT_FOUND`; nothing persisted | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-08 | A | BR-13, A-01, A-10 | `POST /api/tickets` requester header | missing header → `400 MISSING_REQUESTER`; unknown id → `400 INVALID_REQUESTER`; inactive id → `400 INVALID_REQUESTER`; body `requesterId` ignored (owner = header) | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-09 | A | BR-28 | `POST /api/tickets` concurrency | 15 parallel creates → 15 unique `ticketNumber`, all `TKT-YYYY-NNNNNN`, sequence contiguous | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-10 | A | AC-22, BR-15 | `GET /api/tickets` ownership scope | Requester A sees only A's tickets; `meta.totalItems` matches A's count; B's tickets never appear | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-11 | A | AC-22, BR-18 | `GET /api/tickets` default sort + pagination | default `createdAt desc, id desc`; `pageSize` 10; `meta` correct | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-12 | A | AC-23, BR-16 | `GET /api/tickets?search=` | matches substring of ticketNumber OR summary, case-insensitive; blank search ignored | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-13 | A | AC-24, BR-17 | `GET /api/tickets` filters | `categoryId` alone; `categoryId`+`priority` AND; `status=NEW`; results respect all | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-14 | A | AC-25, BR-18 | `GET /api/tickets` sorting | `sort=ticketNumber&order=asc` orders correctly and is stable across pages | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-15 | A | AC-26, BR-20 | `GET /api/tickets` page 2 | returns next slice; `meta.page=2`, `totalItems`, `totalPages` correct | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-16 | A | AC-27, BR-19 | `GET /api/tickets` page past end | `200`; `items: []`; `meta` still correct; not an error | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-17 | A | AC-28, BR-19, FR-29 | `GET /api/tickets` invalid params | `pageSize=7`, `page=0`, `page=-1`, `sort=bogus`, `priority=SUPER`, unknown `categoryId` → `400 INVALID_QUERY` with `fields[]`; no coercion | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-18 | A | BR-13 | `GET /api/tickets` header rules | missing/unknown/inactive `X-Requester-Id` → `400` | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-19 | A | AC-32, BR-38 | `GET /api/tickets/:id` owned | `200`; full header fields match stored; attachments array present | `server/tests/lab-02/ticket-detail.api.test.ts` | Pass |
| API-20 | A | AC-37, AC-03, BR-14, BR-42 | `GET /api/tickets/:id` not owned / unknown | B requesting A's ticket → `404 NOT_FOUND`; unknown id → `404`; both responses byte-identical | `server/tests/lab-02/ticket-detail.api.test.ts` | Pass |
| API-21 | A | AC-36, BR-33 | `GET /api/tickets/:id` lists removed attachments as metadata | removed attachment present with `isRemoved:true`, `removedAt`, `removedReason`, no download path | `server/tests/lab-02/ticket-detail.api.test.ts` | Pass |
| API-22 | A | AC-18, BR-21 | `POST /tickets/:id/attachments` type rules | `.exe`, `.txt`, `.png` renamed `.pdf` (content mismatch) → `415 UNSUPPORTED_TYPE`; JPEG/PNG/WEBP/PDF → `201` | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-23 | A | AC-19, BR-22 | attachment size | 5 MB + 1 byte → `413 FILE_TOO_LARGE`; exactly 5 MB → `201` | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-24 | A | AC-20, BR-23 | attachment active-count limit | 5 active exist → 6th → `409 ATTACHMENT_LIMIT`; after removing one, upload succeeds | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-25 | A | BR-27, BR-29 | attachment storage safety | stored name is `<uuid>.<ext>` under uploads dir; row exists only after file written; `originalFilename` path-stripped; ticket `updatedAt` bumped | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-26 | A | AC-37, BR-14 | attachment ownership | B uploading to / reading / downloading / deleting A's ticket's attachment → `404` | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-27 | A | AC-33, FR-20 | `GET /api/attachments/:id/download` active | `200`; `Content-Disposition: attachment; filename="..."`; bytes match uploaded file | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-28 | A | AC-34, BR-33 | download of removed attachment | after soft-remove → `410 ATTACHMENT_REMOVED` | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-29 | A | AC-34, BR-31 | `DELETE /api/attachments/:id` happy path | `200`; `isRemoved:true`, `removedAt`, `removedReason`, `removedById` set; disappears from active list; ticket `updatedAt` bumped | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-30 | A | AC-35, BR-31, A-09 | `DELETE` reason validation | no `reason` / 2 chars / 201 chars → `400 VALIDATION_FAILED`; attachment stays active | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-31 | A | BR-32 | `DELETE` already removed | second delete → `409 ALREADY_REMOVED` | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-32 | A | BR-41 | generic error body | forced internal error → `500 {error:"INTERNAL"}`; body has no stack/SQL/path | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| C-01 | C | AC-02, FR-05 | route guard | visiting `/tickets` with no stored requester renders the Requester Selection screen | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| C-02 | C | AC-04 | selection loading | while `GET /api/requesters` pending → `role="status"` shown, Continue disabled | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| C-03 | C | AC-05 | selection API failure | fetch rejects → `role="alert"` with Retry; no `<select>` rendered | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| C-04 | C | AC-06 | selection empty | `[]` → distinct empty-state message; Continue disabled | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| C-05 | C | AC-02, FR-02 | selection success | choose requester + Continue → id in `localStorage`, navigation to `/tickets` | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| C-06 | C | AC-08, BR-10 | stale stored requester | stored id not in active list → cleared, routed to selection with a `role="status"` notice | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| C-07 | C | AC-07, FR-03 | app shell | shell shows current Requester name and a "Change Requester" action; active nav link has `aria-current="page"` | `client/tests/lab-02/AppShell.test.tsx` | Pass |
| C-08 | C | AC-09, BR-11 | requester switch | changing Requester resets filters and triggers a My Tickets reload scoped to the new id | `client/tests/lab-02/AppShell.test.tsx` | Pass |
| C-09 | C | AC-10, FR-07 | create form loads reference data | Category/Related System options come from mocked API; Requester field shows context name and is read-only | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| C-10 | C | AC-11 | create validation — empty summary | submit with empty Summary → message under Summary, focus on Summary, no `POST` fired | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| C-11 | C | AC-12, AC-13 | create validation — lengths | Summary 4 / 141, Description 19 → field-level length messages; no `POST` | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| C-12 | C | AC-14, BR-24 | create busy state | on submit the button shows busy + is disabled until the response resolves; only one `POST` fired on double-click | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| C-13 | C | AC-15 | create success | `201` → confirmation shows returned `ticketNumber` + "View ticket" / "Create another" | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| C-14 | C | AC-17, BR-26 | create API failure | `POST` rejects → safe error state; all field values + pending attachment list preserved; submit re-enabled | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| C-15 | C | AC-18, AC-19 | attachment client validation | `.exe` → per-file "unsupported type", not queued; 6 MB image → "too large", not queued; valid PDF queued with name+size | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| C-16 | C | AC-21, BR-27 | partial attachment failure | create `201` then one upload rejects → success panel + warning callout naming the failed file | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| C-17 | C | AC-20, BR-23 | add-attachment disabled at 5 | 5 active → "Add attachment" disabled with tooltip | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| C-18 | C | AC-34 | remove dialog happy path | Remove → dialog with required reason; submit → row becomes "Removed" with date + reason; `role="status"` toast | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| C-19 | C | AC-35 | remove dialog reason required | empty / 2-char reason → dialog shows field error, stays open, no `DELETE` fired | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| C-20 | C | AC-36, BR-33 | removed attachment presentation | removed row shows name/size/type/removed-date/reason and **no** Download/Preview/Remove control | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| C-21 | C | AC-33, BR-34 | attachment actions | active image → Preview + Download; active PDF → Download only; both → Remove | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| C-22 | C | AC-22 | My Tickets list render | desktop rows show Ticket No., Created, Summary, Category, Related System, Priority badge, Status badge, Last Updated (no attachment-count column); mobile card shows the same fields plus a 📎 count when `> 0`; row links to `/tickets/:id` | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| C-23 | C | AC-23, AC-24, AC-25 | My Tickets controls fire correct query | typing search (debounced), choosing filters, changing sort → request carries the right params | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| C-24 | C | AC-26 | My Tickets pagination | Next → `page=2` request; "Showing 11–20 of 22" from `meta`; Prev disabled on page 1 | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| C-25 | C | AC-29, BR-37 | My Tickets empty state | `meta.totalItems=0` and no active query → empty-state + "Create your first ticket" CTA (not no-results) | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| C-26 | C | AC-30, BR-37 | My Tickets no-results state | active filter, `items:[]` → no-results message + Clear Filters; filter bar still visible/populated | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| C-27 | C | AC-27 | My Tickets last/over page | over-page `items:[]` → "no more tickets" + back-to-page-1 link, not an error | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| C-28 | C | AC-31 | My Tickets failure state | list fetch rejects → `role="alert"` + Retry | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| C-29 | C | AC-32 | Ticket Detail read-only render | all header fields present as static text (no inputs), values match mocked response | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pass |
| C-30 | C | AC-38, BR-14 | Ticket Detail not found | `404` → "Ticket not found" state + Back to My Tickets link | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pass |
| C-31 | C | FR-32 | Ticket Detail failure | `500`/network → `role="alert"` + Retry | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pass |
| C-32 | C | AC-09, BR-11 | Ticket Detail on requester switch | with Ticket Detail open, changing the Requester navigates to `/tickets` (My Tickets) for the new id and does **not** re-fetch the foreign ticket | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pass |
| S-01 | S | AC-41, ui-spec §2 | color tokens applied | header element computed background = `--zen-primary`; primary button uses it; page bg = `--zen-page-bg` | `client/tests/lab-02/ui-style.test.tsx` | Pass |
| S-02 | S | AC-41, ui-spec §5.3 | read-only vs editable | read-only fields carry the read-only class/`readonly`/static markup; editable inputs do not | `client/tests/lab-02/ui-style.test.tsx` | Pass |
| S-03 | S | ui-spec §5.2 | required asterisk + message coexist | required fields render `*`; on error the message **also** appears below the field | `client/tests/lab-02/ui-style.test.tsx` | Pass |
| S-04 | S | ui-spec §5.2 | validation message placement | error node is `aria-describedby`-linked to its field and rendered adjacent, not only at top | `client/tests/lab-02/ui-style.test.tsx` | Pass |
| S-05 | S | AC-14, ui-spec §5.1 | button states | disabled button has `aria-disabled` and cannot activate; Submit gets busy attributes during request | `client/tests/lab-02/ui-style.test.tsx` | Pass |
| S-06 | S | AC-41, ui-spec §7 | badge consistency | same `PriorityBadge`/`StatusBadge` markup + text label in list, card, and detail; text present regardless of color | `client/tests/lab-02/ui-style.test.tsx` | Pass |
| S-07 | S | AC-40, ui-spec §12 | icon-only controls labelled | sort carets / paperclip have `aria-label` + `title` | `client/tests/lab-02/ui-style.test.tsx` | Pass |
| R-01 | R | AC-39 | no horizontal scroll | Create Ticket, My Tickets, Ticket Detail at desktop/tablet/mobile: `scrollWidth <= clientWidth` | `e2e/lab-02/responsive.spec.ts` | Pass |
| R-02 | R | AC-39, ui-spec §9 | table → cards | ticket list renders `<table>` at ≥ 768px and card list at < 768px | `e2e/lab-02/responsive.spec.ts` | Pass |
| R-03 | R | AC-39, ui-spec §4 | nav collapses | header nav links inline at ≥ 768px; hamburger with `aria-expanded` at < 768px | `e2e/lab-02/responsive.spec.ts` | Pass |
| R-04 | R | AC-39 | no clipped label / hidden primary action | on each screen×viewport the primary action and every field label are visible in the layout box | `e2e/lab-02/responsive.spec.ts` | Pass |
| R-05 | R | §8.8, A-13 | screenshot capture | writes `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/{desktop,tablet,mobile}.png` | `e2e/lab-02/responsive.spec.ts` | Pass |
| R-06 | R | AC-40, ui-spec §12 | keyboard traversal | tabbing through Create Ticket / My Tickets / Ticket Detail reaches every interactive control in DOM order and each shows a `:focus-visible` ring (computed outline ≠ none) | `e2e/lab-02/responsive.spec.ts` | Pass |
| E2E-01 | E | AC-01, AC-15, AC-16, AC-23, AC-33 | full requester journey | select Requester → create ticket + 1 attachment → confirmation shows official number → find via search in My Tickets → open detail → download attachment (200) | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pass |
| E2E-02 | E | AC-21, AC-34, AC-36 | attachment failure + soft-removal journey | on Ticket Detail, an upload forced to fail shows the retry affordance and a successful retry adds it; then remove an attachment with a reason → row shows "Removed" + reason → download blocked in UI | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pass |
| E2E-03 | E | AC-03, AC-09, AC-37 | cross-requester isolation | create ticket as A → Change Requester to B → B's My Tickets does not list A's ticket → visiting `/tickets/:idOfA` shows "Ticket not found" | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pass |
| E2E-04 | E | AC-17, BR-26 | create failure preserves input | fill valid form, stop API, submit → safe error, values still present, submit re-enabled | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pass |
| E2E-05 | E | AC-29, AC-30 | empty vs no-results | fresh Requester → empty state; after creating one, a non-matching search → no-results state (visibly different) | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pass |

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

Completed 2026-09-07 against `ui-spec.md` §14 at the three viewports the canonical
responsive suite (`e2e/lab-02/responsive.spec.ts`) captures at — desktop 1280×900,
tablet 820×1024, mobile 375×812. (§1.4 lists 834×1112 / 390×844 for tablet / mobile; the
suite's values are what the committed screenshots were actually taken at and are used here.) Evidence: the committed screenshots under
`artifacts/lab-02/screenshots/` (the `{create-ticket,my-tickets,ticket-detail}/{desktop,tablet,mobile}`
set plus `submission/part-6*/`, `submission/part-7*/`, `submission/part-8*/`), the S-01
stylesheet token check in `client/tests/lab-02/ui-style.test.tsx` and the R-01/R-04/R-06
responsive tests in `e2e/lab-02/responsive.spec.ts`.

| # | Check | ui-spec ref | Result | Evidence / note |
|---|---|---|---|---|
| V-01 | Header, primary buttons use `--zen-primary`; active nav marked + `aria-current` | §2, §4 | ☑ | Header + `+ Create Ticket` render `--zen-primary` = `rgb(0, 107, 60)` (`#006b3c`); S-01 verifies theme.css defines the token and the components reference it. Active nav link underlined and carries `aria-current="page"` (`AppShell.tsx:53`). |
| V-02 | Page bg `--zen-page-bg`; cards white + restrained shadow + `--zen-border` | §3 | ☑ | `body` background is `--zen-page-bg` = `rgb(245, 247, 246)` (`#f5f7f6`) — S-01. Cards white with a 1px `--zen-border` and a low-spread shadow on every screen shot. |
| V-03 | Editable fields white/neutral border; read-only fields clearly distinct | §5.3 | ☑ | Create Ticket: Ticket No./Date/Requester render filled grey-green with no input border; Category/Related System/Summary/Description are white with a neutral border. Ticket Detail: every field in the read-only style. |
| V-04 | Required `*` present **and** a validation message shows on error, directly under the field | §5.2 | ☑ | `part-6*/08-create-ticket-validation-failure.png`: red `*` on every required field; on submit each errored field shows a red message immediately below it ("Category is required.", "Summary must be between 5 and 140 characters.", etc.). |
| V-05 | One input height; Description textarea taller, resizes without breaking layout | §5.3 | ☑ | Text inputs and selects share one height; the Description textarea is taller with a visible resize handle; the layout holds at all three viewports. |
| V-06 | Buttons show text; disabled distinct + inert; Submit busy during request | §5.1 | ☑ | `07-create-ticket-initial.png` shows Submit pale-green and disabled; `08` / `10` show it filled green and enabled; `09-create-ticket-submitting.png` shows the "Submitting…" busy state. All buttons are text, not icon-only. |
| V-07 | Priority + Status badges consistent everywhere and carry a text label | §7 | ☑ | The same `PriorityBadge` / `StatusBadge` markup and text label ("▽ Low" / "▷ Medium" / "△ High"; "New") appear in the desktop table, the mobile cards and Ticket Detail — verified by S-06 and visible across the list/card/detail shots. |
| V-08 | Ticket list = table at ≥ 768px, cards at < 768px; card carries the same identifying fields plus the mobile-only 📎 attachment count | §9 | ☑ | `my-tickets/desktop.png` and `my-tickets/tablet.png` render a `<table>`; `my-tickets/mobile.png` renders cards with Ticket No., Created, Updated, Summary, Category·Related System, Priority + Status badges and a View link. The mobile-only 📎 count shows only when a ticket has attachments (R-02); the sample tickets in the shots have none, so its absence is correct. |
| V-09 | Filters, sort, Clear Filters, pagination usable + unclipped at all viewports | §9, §11 | ☑ (see note) | Filters, Sort, Clear filters and the pagination controls (Prev / page / Next, Rows selector) are present and unclipped at every viewport — `my-tickets/{desktop,mobile}.png`, `part-7*/06-pagination-page2.png`. **Note:** at tablet the eight-column table is wider than the 820px tablet viewport and scrolls inside its own `overflow-x: auto` container (`ui-spec.md` §9 keeps the table at ≥ 768px); the columns right of Related System require scrolling the table box. The page itself never scrolls horizontally (R-01). |
| V-10 | Attachment controls + removed-metadata usable at all viewports; names readable (wrap not clip) | §10, §11 | ☑ | `part-8*/`: active rows show name + size + Download / Preview / Remove; removed rows show the retained name/size/type and `Removed <date> · "<reason>"` with no controls. File names wrap. Row actions stack below the file name at < 768px (`AttachmentList.css` `@media (max-width: 767px)`); every control is reachable by keyboard at all three viewports (R-06). The Upload-failed row (Retry / Dismiss) is not in the Part 8 screenshot set — it is covered by the component tests in `AttachmentSection.test.tsx` and by `E2E-02`. |
| V-11 | Empty state vs no-results state visibly different | §9 | ☑ | `part-7*/07-empty-state.png`: "You haven't created any tickets yet." + a primary "Create your first ticket" CTA, no filter bar. `part-7*/08-no-results-state.png`: "No tickets match your search or filters." + a 🔍 icon + a Clear filters link, with the search/filter bar visible and populated. Different message, different structure. |
| V-12 | Visible focus ring when tabbing; keyboard reaches every control | §12 | ☑ | A green `--zen-focus-ring` outline is visible on the focused Category select in `part-6*/08`. R-06 tabs through every interactive control on all three screens × three viewports and asserts a computed outline ≠ `none` on each — passing. |
| V-13 | No horizontal page scroll, no overlap, no hidden primary action at desktop/tablet/mobile | §11 | ☑ (see V-09 note) | R-01 asserts `documentElement.scrollWidth ≤ clientWidth` on all three screens × three viewports — passing (a real 105px tablet overflow was found and fixed during #44). No overlapping messages; R-04 asserts the primary action and every field label sit inside the layout box at every viewport. The only horizontal scroll anywhere is the My Tickets table's own container at tablet (V-09). |
| V-14 | Create Ticket matches Figure-1-style field grouping (system fields top, classification grouped, Summary/Description wide, Attachments below, actions bottom) | §8 | ☑ | `create-ticket/desktop.png`: "Ticket information" (Ticket No./Date/Requester) at the top, a "Classification" group (Category / Related System / Requested Priority), Summary and Description full-width, "Attachments (n/5)" below, Cancel + Submit ticket bottom-right. |
| V-15 | Screenshots saved under `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/` | §14 | ☑ | All nine `{screen}/{viewport}.png` files are committed (R-05 capture), alongside the `submission/part-6*/`, `part-7*/` and `part-8*/` state-specific sets. |

**Overall:** every check passes. The one rough edge is the My Tickets table at the tablet
viewport (V-09 / V-13): with eight columns and `ui-spec.md` §9 fixing the table layout at
≥ 768px, the table is wider than an 820px viewport and scrolls within its own container.
The page never scrolls horizontally and no control is hidden or clipped.

---

## 5. Test Commands

> `server/.env.test.example`, `npm run db:test:reset` / `db:test`, the root `test:all` script, and
> the `e2e/` workspace (created by Issue #14 and Issue #20) now exist. The commands below are the
> actual working commands, verified against a clean checkout — see `README.md` for the full setup
> walkthrough.

**Toolchain.** The root, `server/`, `client/`, and `e2e/` packages each declare
`engines` (Node `>=20.19.0`, npm `>=11.18.0`) and commit `.npmrc` with `engine-strict=true`, so a
mismatched toolchain fails fast instead of silently. npm **11.18.0** is the first release that
ships the `npm install-scripts` subcommand, which maintains the committed `allowScripts`
approvals that let `esbuild` / `fsevents` / `prisma` / `@prisma/engines` run their install
scripts on a fresh `npm install` (the `allowScripts` policy itself landed in npm 11.16.0 as
`npm approve-scripts`; npm 12 makes install-script approval the default). Verified on npm
11.19.0 / Node 26. On an older npm the committed approvals still take effect on a plain
`npm install` / `npm run bootstrap`, but the `npm install-scripts` diagnostic is unavailable —
upgrade npm rather than working around it.

Run from the repository root.

```bash
# --- one-time: install server/, client/, and e2e/ dependencies + Playwright's Chromium ---
npm run bootstrap

# --- one-time: server test database ---
cd server
cp .env.test.example .env.test           # points DATABASE_URL at the toktickit_test DB
npm run db:test:reset                     # migrate + seed the test DB

# --- server: unit + API/integration ---
npm test                                  # vitest run (uses .env.test, truncates Ticket/Attachment/TicketCounter per test)

# --- client: UI component + UI style ---
cd ../client
npm test                                  # vitest run (jsdom, fetch mocked)

# --- one-time: E2E database config ---
cd ../e2e
cp .env.e2e.example .env.e2e             # points DATABASE_URL at toktickit_e2e, VITE_API_BASE_URL at the server

# --- E2E + responsive + screenshots ---
npm run test:e2e                          # resets+seeds toktickit_e2e, boots the real client+server, runs Playwright

# --- everything, from repo root ---
cd ..
npm run test:all                          # server + client + e2e
```

`npm run test:e2e`'s `pretest:e2e` hook (`e2e/scripts/reset-e2e-db.ts`) creates `toktickit_e2e` if
needed, applies migrations, truncates `Attachment`/`Ticket`/`TicketCounter` (restarting their
identity sequences, so ticket data never accumulates across runs), and re-seeds the reference/
requester fixtures, before Playwright boots the real client and server against it.

All commands must pass from a clean checkout of `main` after the release PR is merged.

---

## 6. Final Results

Re-confirmed on `main` at `77e3142` (the PR #64 release merge). The doc-only commits after
`77e3142` do not touch any test or source file.

| Suite | Command | Files | Tests | Pass | Fail | Skipped | Run on | Evidence |
|---|---|---|---|---|---|---|---|---|
| Server unit + API | `cd server && npm test` | 13 | 187 | 187 | 0 | 0 | `main` `77e3142` | `artifacts/lab-02/screenshots/submission/part-3-tests/test-server.png` |
| Client component + style | `cd client && npm test` | 11 | 206 | 206 | 0 | 0 | `main` `77e3142` | `artifacts/lab-02/screenshots/submission/part-3-tests/test-client.png` |
| E2E + responsive | `cd e2e && npm run test:e2e` | 4 | 77 | 77 | 0 | 0 | `main` `77e3142` | `artifacts/lab-02/screenshots/submission/part-3-tests/test-e2e.png` |
| **Total** | `npm run test:all` | 28 | **470** | **470** | 0 | 0 | `main` `77e3142` | — |

Definition-of-Done gate (from `specification.md` §10.1): no test skipped, disabled, `.only`, or
commented out; every AC row above shows a passing test; screenshots committed. All hold.

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
