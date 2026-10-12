# Lab 4 Test Plan and Traceability — TokTickIT

> Status: draft — Issue #92. Written **before** implementation, alongside
> [`specification.md`](./specification.md), [`api-spec.md`](./api-spec.md) and
> [`ui-spec.md`](./ui-spec.md). Every row's Final column is `Planned` until a real run on `main`
> replaces it with `Pass`/`Fail` and §5 holds the verbatim output.

## 1. Commands

### 1.1 Levels and tools

| Level (ID prefix) | Tool | Location |
|---|---|---|
| Unit (UNIT) | Vitest | `server/tests/lab-04/*.test.ts` |
| API / integration (API) | Vitest + Supertest, real Postgres test DB | `server/tests/lab-04/*.api.test.ts` |
| Workflow (WF) | Vitest + Supertest, state and concurrency scenarios | `server/tests/lab-04/ticket-workflow.api.test.ts` |
| Authorization (SEC) | Vitest + Supertest, HTTP layer only | `server/tests/lab-04/authorization.api.test.ts` |
| Migration / seed (MIG) | Vitest against a Lab 3-shaped database | `server/tests/lab-04/migration.test.ts`, `seed.test.ts` |
| Performance-smoke (PERF) | Vitest + Supertest on a volume-seeded DB | `server/tests/lab-04/performance-smoke.api.test.ts` |
| UI component (C) | Vitest + Testing Library | `client/tests/lab-04/*.test.tsx` |
| UI style (S) | Vitest + Testing Library | `client/tests/lab-04/ui-style.test.tsx` |
| Responsive (R) | Playwright, three viewports plus 320 px | `e2e/lab-04/responsive.spec.ts` |
| Accessibility (A11Y) | Playwright + `@axe-core/playwright` | `e2e/lab-04/accessibility.spec.ts` |
| End-to-end (E2E) | Playwright, real server + client + DB | `e2e/lab-04/*.spec.ts` |
| Regression (REG) | Existing Lab 1–3 suites, unmodified except §4.2 | `server|client|e2e/…/lab-0[123]/` |

Handout §12 files all exist: `actions-taken`, `ticket-workflow`, `requester-dashboard`,
`staff-dashboard` (server); `StaffDashboard`, `RequesterDashboard`, `ActionsTaken`, `TicketWorkflow`
(client); `actions-taken-flow`, `ticket-resolution`, `dashboards` (E2E). Planned **additions** (not
substitutions): `action-rules.test.ts`, `ticket-transitions.test.ts`, `dashboard-window.test.ts`,
`authorization.api.test.ts`, `route-inventory.test.ts`, `migration.test.ts`, `seed.test.ts`,
`performance-smoke.api.test.ts`, `AppShellNav.test.tsx`, `RequesterActionsView.test.tsx`,
`ui-style.test.tsx`, `responsive.spec.ts`, `accessibility.spec.ts`, `regression-smoke.spec.ts`,
`screenshots.spec.ts`.

### 1.2 Run commands

```bash
npm run bootstrap                 # one-time: install server/, client/, e2e/ + Chromium
npm run db:test:reset             # test database after a schema change (includes the Lab 4 migration)
npm run db:test:lab3-fixture      # NEW: restore a Lab 3-shaped database for MIG-01…MIG-05 and MIG-09
npm run test:server               # unit + API + workflow + authorization + migration + performance-smoke
npm run test:client               # UI component + UI style
npm run test:e2e                  # E2E + responsive + accessibility + screenshots
npm run test:all                  # everything, from the repository root
```

### 1.3 Rules

- **TDD per Issue:** write the failing rows for that Issue → implement → green → audit. A test counts
  only if it can fail for the right reason: each authorization test is checked by temporarily granting the
  permission; the `version` check, the idempotency key, the resolution gate (each of its three
  conditions) and the append-only history are each checked by removing the guard and watching the named
  test fail.
- **Authorization rows are HTTP-level only;** the UI's forbidden states are separate C/E2E rows.
- **Database:** reuses `toktickit_test` with `fileParallelism: false`; suites truncate between tests.
  Dashboard tests freeze the clock and recompute expected values with independent SQL, never with the
  service code under test. `performance-smoke` seeds its own volume data and cleans up.
- **Viewports:** desktop 1440×900, tablet 820×1180, mobile 390×844, plus 320 px for overflow.
- **No** skipped, disabled or `.only` tests at hand-in.

## 2. Planned tests

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| UNIT-01 | Unit | AC-04, BR-05 | Description/result validator | Description: `""`, `"   "`, `"\n\t"` rejected; 2000 accepted; 2001 rejected; trimmed before measuring. Result: 2001 rejected | `server/tests/lab-04/action-rules.test.ts` | Planned |
| UNIT-02 | Unit | AC-05, BR-04 | `actionAt` bounds | Future instant rejected for IN_PROGRESS/COMPLETED and accepted for PLANNED; instant before Ticket `createdAt` rejected; equal-to-createdAt and now accepted; omitted → now; moving a future-dated PLANNED Action to IN_PROGRESS/COMPLETED rejected | `server/tests/lab-04/action-rules.test.ts` | Planned |
| UNIT-03 | Unit | AC-06, AC-07, BR-06, BR-07 | Follow-up and attachment-notes validators | Flag on + no/blank note rejected; flag off + note rejected; note 1000 ok / 1001 rejected; attachment notes 500 ok / 501 rejected; merge-on-update clears the note when the flag turns off | `server/tests/lab-04/action-rules.test.ts` | Planned |
| UNIT-04 | Unit | AC-09, BR-09 | Action lifecycle table | Exactly PLANNED→IN_PROGRESS, IN_PROGRESS→COMPLETED, PLANNED→CANCELLED, IN_PROGRESS→CANCELLED permitted; every other pair and every no-op rejected; CANCELLED invalid as initial status | `server/tests/lab-04/action-rules.test.ts` | Planned |
| UNIT-05 | Unit | AC-18, AC-19, BR-16 | Ticket transition matrix is unchanged | Every pair in `specification.md` §5.1 permitted; every other pair, incl. status→itself, rejected | `server/tests/lab-04/ticket-transitions.test.ts` | Planned |
| UNIT-06 | Unit | AC-20, AC-21, AC-22, BR-17 | Resolution-gate function | Each of owner / completed Action / no open Actions can fail alone; `reasons` lists every failed condition in order `OWNER_MISSING`, `NO_COMPLETED_ACTION`, `OPEN_ACTIONS_REMAIN` with `count`; CANCELLED Actions neither satisfy (b) nor block (c) | `server/tests/lab-04/ticket-transitions.test.ts` | Planned |
| UNIT-07 | Unit | AC-33, BR-22 | Bangkok window start | Fixed clocks: 16:59:59Z and 17:00:00Z straddle the Bangkok day change; `windowStart` is 00:00 Bangkok six days back as a UTC instant; no DST shift | `server/tests/lab-04/dashboard-window.test.ts` | Planned |
| UNIT-08 | Unit | AC-27, BR-23 | Resolution-time rule | Latest history row to RESOLVED/CLOSED supplies the resolution time; a Ticket with no history is excluded even if `updatedAt` is recent | `server/tests/lab-04/dashboard-window.test.ts` | Planned |
| UNIT-09 | Unit | AC-25, BR-33 | `version` validator | Missing, `0`, negative, `1.5`, string rejected with field `version`; positive integer accepted | `server/tests/lab-04/action-rules.test.ts` | Planned |
| UNIT-10 | Unit | AC-16, BR-35 | `clientRequestId` validator and body hash | UUID accepted; malformed rejected; omitted accepted; hash equal for bodies differing only in whitespace/defaults/server-owned fields, different for any real field change | `server/tests/lab-04/action-rules.test.ts` | Planned |
| UNIT-12 | Unit | AC-52, BR-05 | Result-required-to-complete rule | Result absent/blank accepted for PLANNED and IN_PROGRESS; create-as-COMPLETED and transition to COMPLETED with no request result and none stored rejected; stored result satisfies completion without resending | `server/tests/lab-04/action-rules.test.ts` | Planned |
| UNIT-11 | Unit | AC-34 | Drill-down query parsers | `scope`, `myActions`, `followUp`, extended `status` parse; `myActions=false`, unknown `scope`, `status=BOGUS` each give an `INVALID_QUERY` field entry | `server/tests/lab-04/dashboard-window.test.ts` | Planned |
| API-01 | API | AC-01, FR-01, FR-05 | Create a valid Action Taken | `201`; saved under the correct Ticket; `performedBy` and `lastUpdatedBy` = caller; assignee stored; `version` 1; Ticket `updatedAt` touched, Ticket `version` unchanged | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-02 | API | AC-03, BR-03 | Server-owned fields ignored; second editor | Client `performedBy`/`createdAt`/`lastUpdatedBy` ignored on create and update; edit by a second IT Staff keeps `performedBy`, sets `lastUpdatedBy` to the editor | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-32 | API | AC-52, BR-05 | Result optional until completion | POST PLANNED without result `201` (`result: null`); POST COMPLETED without result `400` on `result`; PATCH to COMPLETED with no result `400` and Action unchanged; with result in the request `200`; with a stored result and none resent `200` | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-03 | API | AC-04, BR-05 | Description/result validation over HTTP | Empty, whitespace-only, 2001-char description and 2001-char result each `400 VALIDATION_FAILED` with the field named; no row written | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-04 | API | AC-05, BR-04 | Action date rules over HTTP | Future date `400` for IN_PROGRESS/COMPLETED, `201` for PLANNED; pre-creation dates `400`; omitted defaults to now; PATCH of a future PLANNED Action to COMPLETED `400` | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-05 | API | AC-06, BR-06 | Follow-up rules over HTTP | Flag + no note `400`; note + no flag `400`; PATCH flag off clears stored note | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-06 | API | AC-07, BR-07 | Attachment notes | 501 chars `400`; valid text stored and returned verbatim as text; `POST …/actions-taken/:id/files` and `…/attachments` for an Action are `404` | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-07 | API | AC-08, BR-08 | Invalid assignee | Inactive user, Requester, nonexistent id each `409 INVALID_ASSIGNEE` with one message, on create and update; nothing changed | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-08 | API | AC-09, FR-04 | Action lifecycle over HTTP | Each permitted transition `200`; PLANNED→COMPLETED, terminal→anything and no-op `409 INVALID_ACTION_TRANSITION` | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-09 | API | AC-10, BR-10 | Terminal Actions are locked; no delete | PATCH of COMPLETED/CANCELLED `409 ACTION_LOCKED`; `DELETE` on an Action `404` | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-10 | API | AC-11, BR-02, BR-11 | Several staff on one Ticket | Ticket Owner A, Actions by B, C and an Administrator: list shows each performer; non-owner B creates and edits; no Owner needed | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-11 | API | AC-12, BR-14 | Stable ordering | Equal and differing `actionAt` values: order is `actionAt` asc, `id` asc, identical across repeated calls and after an edit | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-12 | API | AC-13, BR-12 | Closed Tickets | Create/update on CLOSED and CANCELLED `409 TICKET_CLOSED`; on RESOLVED `201`/`200` | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-13 | API | AC-16, BR-35, FR-07 | Idempotent create | Same `clientRequestId` twice → first `201`, second `200` with the same `id`; exactly one row; omitting the key creates two rows; concurrent duplicates still yield one row | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-33 | API | AC-16, BR-35 | Idempotency key reuse with a different body | Same `clientRequestId`, changed description/status/assignee → `409 IDEMPOTENCY_CONFLICT`, no new row, stored Action unchanged; identical retry after the Action was edited still `200` with the edited row | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-14 | API | AC-17, BR-33 | Stale Action update | Second writer with the old `version` `409 STALE_UPDATE`, body `current` equals the stored Action, first writer's change intact | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-15 | API | AC-14, FR-06 | Requester reads own Actions | Own Ticket: all Actions returned in order with every field incl. follow-up note and attachment notes | `server/tests/lab-04/actions-taken.api.test.ts` | Planned |
| API-16 | API | AC-24, BR-14 | Status history read | Entries in `changedAt` asc, `id` asc with from/to/changedBy; `[]` for a never-changed Ticket | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| API-17 | API | AC-02, AC-27, BR-20 | Requester dashboard values match the database | `openTickets`, `waitingForMe`, `recentlyUpdated`, `recentlyResolved` equal independent SQL over the seed; response carries `generatedAt`, `timeZone`, `windowStart` | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-18 | API | AC-02, BR-20 | Only own Tickets | Another Requester's Tickets never counted or listed; a `requesterId` query/body value is ignored | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-19 | API | AC-27, BR-24 | List caps and order | Seven recent Tickets → 5 items, `total` 7, order `updatedAt` desc then `id` desc; items carry no `itPriority` | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-20 | API | AC-32, BR-30 | Requester dashboard empty | User with no Tickets (David Lee window) → `200`, counts `0`, lists `total: 0, items: []` | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-21 | API | AC-33, BR-22 | Requester window boundary | Ticket updated 1 s before `windowStart` excluded, at `windowStart` included (frozen clock) | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-22 | API | AC-34, BR-31 | Requester drill-down equals count | `GET /api/tickets?scope=open`, `?status=WAITING_FOR_REQUESTER`, `?scope=recent`, `?scope=recently-resolved` `totalItems` equals the matching dashboard value and lists only own Tickets | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-23 | API | AC-28, BR-29, BR-28 | Staff dashboard ticket metrics | `unassigned`, `ownedByMe`, `byStatus` (all eight keys, zeros included) and `byItPriority` (open only, three keys) equal independent SQL | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-24 | API | AC-29, BR-25 | My Open Actions rule | Counts PLANNED/IN_PROGRESS on open Tickets for assignee = me, or no assignee and performer = me; excludes COMPLETED/CANCELLED, other users', and Actions on RESOLVED/CLOSED/CANCELLED Tickets; `actions` vs distinct `tickets`; items `actionAt` asc | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-25 | API | AC-29, BR-26, BR-27 | Follow-ups, Urgent, Recently Updated | Follow-ups count distinct open Tickets, excludes CANCELLED Actions; Urgent = open + HIGH only; Recently Updated spans all statuses | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-26 | API | AC-31, BR-32 | User counts | Administrator response has `userCounts` (3 roles, active/inactive correct); IT Staff response has no such key | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-27 | API | AC-32, BR-30 | Staff dashboard empty | Emma Fischer: `ownedByMe` 0, `myOpenActions` `{actions:0,tickets:0,items:[]}`; all-zero maps keep their keys | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-28 | API | AC-34, BR-31 | Staff drill-down equals count | Queue with `owner=unassigned&scope=open`, `owner=me&scope=open`, `status=X`, `itPriority=X&scope=open`, `itPriority=HIGH&scope=open`, `myActions=true`, `followUp=true`, `scope=recent` has `totalItems` (or distinct Ticket count) equal to the card | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-31 | API | AC-34, BR-32 | User-count drill-down | Each `userCounts` role `active + inactive` equals the length of `GET /api/users?role=<ROLE>` | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-29 | API | AC-34 | New list parameters validated | `myActions=false`, `scope=bogus`, `followUp=1` each `400 INVALID_QUERY` with `fields`; never ignored, never `500` | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| API-30 | API | AC-47 | Route inventory | Enumerating the Express router yields exactly the `api-spec.md` Lab 4 routes; no DELETE for Actions, no history write route, no Action file upload, no export route | `server/tests/lab-04/route-inventory.test.ts` | Planned |
| WF-01 | Workflow | AC-18, FR-09 | Every permitted transition succeeds | Each §5.1 pair given its preconditions → `200`, new status and incremented `version` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-02 | Workflow | AC-19 | Forbidden transitions and owner rule | Every pair absent from §5.1 and every no-op `409 INVALID_TRANSITION`; `IN_PROGRESS` with no owner `409 OWNER_REQUIRED` from each source | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-03 | Workflow | AC-20, BR-17 | Gate: no completed Action | Resolved via direct PATCH with an Owner but no COMPLETED Action → `409 RESOLUTION_BLOCKED`, `reasons` includes `NO_COMPLETED_ACTION`; status unchanged; no history row | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-04 | Workflow | AC-21, BR-17 | Gate: open Actions remain | PLANNED and IN_PROGRESS Actions each block with `OPEN_ACTIONS_REMAIN` and `count`; after completing/cancelling them Resolved succeeds | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-05 | Workflow | AC-22, BR-17 | Gate: owner missing, and success | No Owner → blocked with `OWNER_MISSING`; Owner + one COMPLETED + nothing open → `200` and a history row | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-06 | Workflow | AC-21 | Gate counts every failed condition | All three failing returns all three reasons in order; CANCELLED-only Actions give `NO_COMPLETED_ACTION` but not `OPEN_ACTIONS_REMAIN` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-07 | Workflow | AC-23, BR-18, FR-13 | Requester advisory is not resolution | `requester-resolved` leaves status unchanged and the gate still blocks; a Requester PATCH to RESOLVED/CLOSED is refused | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-08 | Workflow | AC-24, BR-19 | History written transactionally | One row per change with correct from/to/changedBy; a forced failure after the Ticket update rolls both back | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-09 | Workflow | AC-24, BR-13, BR-19 | History is append-only and scoped | POST/PATCH/DELETE on `…/status-history` `404`; owning Requester reads it; another Requester's Ticket `404` identical to nonexistent | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-10 | Workflow | AC-25, BR-33 | Stale Ticket writes | Status, owner and IT Priority PATCH with an outdated `version` each `409 STALE_UPDATE` with `current` Ticket; nothing written | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-11 | Workflow | AC-25, BR-33 | Missing or invalid `version` | Absent/non-integer → `400 VALIDATION_FAILED` field `version` on all three routes | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-12 | Workflow | AC-25, AC-17, BR-33 | Concurrent writers | Two simultaneous PATCHes with the same `version` → exactly one `200`, one `409 STALE_UPDATE`; `version` incremented once | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-15 | Workflow | AC-48, BR-40 | Closing gate | Resolved→Closed with a PLANNED or IN_PROGRESS Action `409 RESOLUTION_BLOCKED` with only `OPEN_ACTIONS_REMAIN` and `count`; succeeds once they are completed/cancelled; Action logged on a RESOLVED Ticket then blocks Close | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-16 | Workflow | AC-49, BR-41 | Cancel cascade | Cancelling a Ticket with PLANNED, IN_PROGRESS and COMPLETED Actions: the first two become CANCELLED with `lastUpdatedBy` = canceller and `version`+1, COMPLETED untouched, one history row, all in one transaction (forced failure rolls back all) | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-14 | Workflow | AC-50, BR-39 | Action write racing a Resolve | With a test hook that pauses each transaction after it takes the Ticket lock, concurrent "create PLANNED Action" vs "PATCH status RESOLVED" in both orders: if the Action commits first the Resolve is `409 RESOLUTION_BLOCKED`; if the Resolve commits first the Action is created afterwards on a RESOLVED Ticket; a Resolve is never `200` while an earlier-committed open Action exists. Sabotage check: without the row lock the first order fails | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-13 | Workflow | AC-25, BR-34 | Check order | A `text/plain` body with no session returns `415` before `401`; stale + invalid transition returns `STALE_UPDATE` first; fresh + invalid returns `INVALID_TRANSITION`; malformed body on another Requester's Ticket returns `400` before `404` exactly as Lab 3; unknown Ticket + valid body `404` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| SEC-01 | Authorization | AC-14, BR-13 | Requester cannot write Actions | Own Ticket POST/PATCH `403`; another Requester's Ticket (read, write, history) `404` byte-identical to a nonexistent Ticket; nothing written | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| SEC-02 | Authorization | AC-15, FR-08 | Administrator Actions access and retained limits | Administrator POST/PATCH Actions `201`/`200`, can read the staff queue; status change, owner change and note creation still `403` | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| SEC-03 | Authorization | AC-30 | Dashboard role matrix | Requester→staff dashboard `403`; IT Staff and Administrator→requester dashboard `403` before any lookup; permitted pairs `200` | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| SEC-04 | Authorization | AC-30 | Unauthenticated and gated | Every Lab 4 route without a session `401` (no write performed); with `mustChangePassword` `403 PASSWORD_CHANGE_REQUIRED` | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| SEC-05 | Authorization | AC-02, AC-14 | Identity from the session only | Body/query `requesterId`, `performedById` or another user's id never changes whose data is read or written | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| SEC-06 | Authorization | AC-45 | Safe failure on Lab 4 routes | A forced internal error on each Lab 4 route returns the generic `INTERNAL` body — no stack, SQL or path | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| SEC-07 | Authorization | AC-45, BR-37 | Content-type enforcement | Every new state-changing route with `text/plain` → `415`; nothing written | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| SEC-08 | Authorization | AC-14, AC-15 | Staff Ticket access for Requester and Administrator on the queue | `GET /api/staff/tickets` and `/assignable-users`: Requester `403`; Administrator `200` | `server/tests/lab-04/authorization.api.test.ts` | Planned |
| MIG-01 | Migration | AC-40, FR-20 | Data preserved | Migrating a Lab 3-shaped database leaves row counts and ids of User, Ticket, Attachment, PublicComment, InternalNote, Category, RelatedSystem identical | `server/tests/lab-04/migration.test.ts` | Planned |
| MIG-02 | Migration | AC-40, BR-38 | Legacy Ticket shape | Every existing Ticket `version = 1`, zero ActionTaken, zero TicketStatusChange; a legacy RESOLVED Ticket can still be closed or reopened | `server/tests/lab-04/migration.test.ts` | Planned |
| MIG-03 | Migration | AC-40, D-20 | Hand-written constraint and indexes | The follow-up `CHECK` rejects invalid pairs at the database; unique `(ticketId, clientRequestId)` exists; the Lab 3 `lower(email)` unique index still exists | `server/tests/lab-04/migration.test.ts` | Planned |
| MIG-04 | Migration | AC-40, FR-20 | Recovery script | `lab-04-down.sql` returns the schema to the Lab 3 shape with all Lab 3 data intact | `server/tests/lab-04/migration.test.ts` | Planned |
| MIG-05 | Migration | AC-40 | Re-run is a no-op | Applying migrations twice changes nothing and raises no error | `server/tests/lab-04/migration.test.ts` | Planned |
| MIG-09 | Migration | AC-40, FR-20 | Recovery by dump/restore | `pg_dump` a Lab 3-shaped database, apply the Lab 4 migration and write Lab 4 rows, restore the dump: row counts and ids of every Lab 3 table equal the originals and no Lab 4 table or `Ticket.version` remains | `server/tests/lab-04/migration.test.ts` | Planned |
| MIG-06 | Migration | AC-41, FR-21 | Seed is idempotent | Running the seed twice leaves identical row counts for every table, including Actions and history | `server/tests/lab-04/seed.test.ts` | Planned |
| MIG-07 | Migration | AC-41 | Seed coverage | All eight statuses and three IT Priorities; assigned and unassigned; Tickets with 0, 1 and 4+ Actions; one Ticket with three different performers; all four Action statuses; follow-ups; one gate-passing and one gate-blocked Resolved candidate | `server/tests/lab-04/seed.test.ts` | Planned |
| MIG-08 | Migration | AC-41, §7.5 | Seeded zero and non-zero metrics | Priya Natarajan and Jennifer Anderson non-zero on every metric (Recently Resolved from seeded history rows); Emma Fischer `ownedByMe` and `myOpenActions` = 0; David Lee Open, Waiting, Recently Updated, Recently Resolved = 0 | `server/tests/lab-04/seed.test.ts` | Planned |
| PERF-01 | Performance-smoke | AC-46 | Dashboards at volume | Seeded 1,000 Tickets / 3,000 Actions: each dashboard endpoint median < 500 ms over 20 calls | `server/tests/lab-04/performance-smoke.api.test.ts` | Planned |
| PERF-02 | Performance-smoke | AC-46 | Actions list and queue drill-down | `…/actions-taken` for a 200-Action Ticket and `GET /api/staff/tickets?myActions=true` median < 500 ms over 20 calls | `server/tests/lab-04/performance-smoke.api.test.ts` | Planned |
| C-01 | UI component | AC-35, FR-18 | Navigation per role | Requester: Dashboard, My Tickets, Create Ticket; IT Staff: Dashboard, Ticket Queue; Administrator: Dashboard, Ticket Queue, User Management; Dashboard first; `aria-current="page"` on `/dashboard`; wordmark → `/dashboard` | `client/tests/lab-04/AppShellNav.test.tsx` | Planned |
| C-02 | UI component | AC-35 | Role landing redirect | `/` for each role navigates to `/dashboard` | `client/tests/lab-04/AppShellNav.test.tsx` | Planned |
| C-03 | UI component | AC-36, FR-15 | Staff dashboard cards | Unassigned, Owned by Me, Urgent, Follow-ups, My Open Actions render label, value, sub-label; accessible names like "Unassigned: 2, view list" | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| C-04 | UI component | AC-28, AC-29 | Staff dashboard breakdowns and lists | Eight status counts and three priority counts incl. zeros; Urgent and Recently Updated lists ≤ 5 with "View all (N)" | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| C-05 | UI component | AC-34 | Staff dashboard drill-down links | Every card and list item has the `href` from `api-spec.md` §5 | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| C-06 | UI component | AC-32, AC-36 | Staff dashboard states | Loading skeleton `role="status"`; zero cards and empty-list messages; failure `ErrorState` with Retry that refetches; a `403` from the endpoint renders the forbidden state with no numbers; no partial numbers on failure | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| C-07 | UI component | AC-31 | Users strip | Rendered for Administrator with the total (active + inactive) as the value, active/inactive sub-label and `/admin/users?role=…` links; absent for IT Staff | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| C-08 | UI component | AC-02, AC-36 | Requester dashboard | Open Tickets and Waiting for Me cards, two lists, accessible names, needs-attention text when Waiting > 0; no IT Priority shown | `client/tests/lab-04/RequesterDashboard.test.tsx` | Planned |
| C-09 | UI component | AC-32, AC-34, AC-36 | Requester dashboard links and states | Hrefs per `api-spec.md` §4; empty messages; loading; failure with Retry; a `403` from the endpoint renders the forbidden state | `client/tests/lab-04/RequesterDashboard.test.tsx` | Planned |
| C-10 | UI component | AC-37 | Actions list rendering | Table with caption and columns on wide layout; card list on narrow layout; empty state with Add action; Edit only on non-terminal rows; header shows "Visible to the requester" | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-11 | UI component | AC-37, AC-01 | Create form | All fields present; Performed by is static text; date defaults to now; status offers Planned/In progress/Completed; required fields marked; Result becomes required (`aria-required`, `*`) only when Completed is selected | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-29 | UI component | AC-52 | Result required only for Completed | Selecting Completed with an empty Result shows the message below the field and keeps values; Planned/In progress save without a result; the `*` toggles with the Status select | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-12 | UI component | AC-04, AC-05, AC-07 | Form validation placement | Empty description, over-long result, future date on a non-planned Action, over-length fields show messages directly below the field with `aria-invalid`; focus moves to first invalid; counters present | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-13 | UI component | AC-06 | Follow-up note behavior | Note field appears only when the checkbox is on, is required then, and is hidden and cleared when switched off | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-14 | UI component | AC-38 | Entered data survives failures | After a validation (400), stale (409) or network failure the typed values remain and the failure shows beside them | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-15 | UI component | AC-38, AC-17 | Stale callout | Callout names the editor and time; "Use latest version" adopts the new `version` while keeping the user's typed edits; the next Save sends the new version | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-16 | UI component | AC-38, FR-07 | Duplicate submit | Double click sends one request; control disabled while pending; Retry reuses the same `clientRequestId` | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-17 | UI component | AC-10 | Terminal Actions read-only | COMPLETED/CANCELLED rows have no Edit button; View shows static read-only fields and the read-only note | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-18 | UI component | AC-09 | Action status control | Edit offers the current status plus only the permitted next states; Cancelled opens a confirm dialog that traps and restores focus | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-19 | UI component | AC-08 | Invalid assignee message | `INVALID_ASSIGNEE` renders on the Assignee field with the entered values kept | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-20 | UI component | AC-13 | Closed Ticket | CLOSED/CANCELLED hides Add action and shows the closed notice; RESOLVED keeps it | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-21 | UI component | AC-15 | Administrator view | Actions Taken fully usable; owner select, status control, comment and note composers not rendered; IT Priority editable | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| C-22 | UI component | AC-26, AC-49, FR-09 | Permitted transitions only | For each of the eight statuses the status control lists exactly the §5.1 targets; the Cancel confirm dialog shows "Open actions on this ticket will be cancelled."; after a successful cancel the Actions list reloads and shows the open Actions as CANCELLED | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| C-23 | UI component | AC-26 | Success refreshes the summary | After a successful change the summary `StatusBadge`, permitted list and history card update without reload | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| C-24 | UI component | AC-20, AC-21, AC-22, AC-48 | Resolution checklist and blocked callout | Checklist ✓/✗ matches loaded owner/Actions; `RESOLUTION_BLOCKED` shows the returned reasons in an `role="alert"` callout and leaves status unchanged; closing with open Actions shows the same callout worded "closed yet" with only the open-actions reason | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| C-25 | UI component | AC-25 | Stale Ticket write | `STALE_UPDATE` shows the callout, reverts the select, Refresh loads the current Ticket | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| C-26 | UI component | AC-24 | Status history card | Oldest first with from→to text and `StatusBadge`s; empty message for no history | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| C-27 | UI component | AC-39, FR-06 | Requester Ticket Detail | Actions Taken (all fields) and status history visible; no Add/Edit/status controls; no Internal Note content; no IT Priority | `client/tests/lab-04/RequesterActionsView.test.tsx` | Planned |
| C-28 | UI component | AC-45 | Safe failure | A failing Actions list/dashboard shows `ErrorState` with Retry and no raw error text | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| S-01 | UI style | AC-43, V-01 | Token discipline | No hard-coded hex in Lab 4 component CSS; new tokens exist in `theme.css` | `client/tests/lab-04/ui-style.test.tsx` | Planned |
| S-02 | UI style | AC-43, V-08 | Action badge distinct | `ActionStatusBadge` renders its text label with a non-pill radius class; Ticket `StatusBadge` unchanged | `client/tests/lab-04/ui-style.test.tsx` | Planned |
| S-03 | UI style | AC-36, V-04 | Needs-attention variant | The accent class is always accompanied by sub-label text | `client/tests/lab-04/ui-style.test.tsx` | Planned |
| S-04 | UI style | AC-43 | Contrast of new tokens | Every `--zen-action-*` pair computes ≥ 4.5:1 | `client/tests/lab-04/ui-style.test.tsx` | Planned |
| S-05 | UI style | AC-37, V-06 | Editable vs read-only | Form controls use the editable class; View mode and Performed by use the read-only class | `client/tests/lab-04/ui-style.test.tsx` | Planned |
| R-01 | Responsive | AC-43, V-12 | Staff and Administrator dashboard | At 320, 768, 992, 1440 px (and 820×1180, 390×844): `scrollWidth <= clientWidth`; metrics 4/2/1-up as specified; no clipped card | `e2e/lab-04/responsive.spec.ts` | Planned |
| R-02 | Responsive | AC-43, V-12 | Requester dashboard | Same width checks; two cards and lists reflow | `e2e/lab-04/responsive.spec.ts` | Planned |
| R-03 | Responsive | AC-37, AC-43 | Staff Ticket Detail Actions Taken | Table ≥ 768 px, stacked cards < 768 px; no overflow; form usable; View/Edit targets ≥ 44 px on mobile | `e2e/lab-04/responsive.spec.ts` | Planned |
| R-04 | Responsive | AC-43, AC-39 | Requester Ticket Detail | Read-only Actions and history reflow, no overflow | `e2e/lab-04/responsive.spec.ts` | Planned |
| R-05 | Responsive | AC-43, V-14 | Dialogs and callouts | Cancel-action and Close dialogs become full-screen sheets on mobile; stale/blocked callouts do not overlap controls | `e2e/lab-04/responsive.spec.ts` | Planned |
| A11Y-01 | Accessibility | AC-44 | axe: Staff dashboard | No serious/critical violations (IT Staff and Administrator variants) | `e2e/lab-04/accessibility.spec.ts` | Planned |
| A11Y-02 | Accessibility | AC-44 | axe: Requester dashboard | No serious/critical violations | `e2e/lab-04/accessibility.spec.ts` | Planned |
| A11Y-03 | Accessibility | AC-44 | axe: Staff Ticket Detail | Actions list, create form, validation, stale callout and status history have no serious/critical violations | `e2e/lab-04/accessibility.spec.ts` | Planned |
| A11Y-04 | Accessibility | AC-44, AC-39 | axe: Requester Ticket Detail | No serious/critical violations on the read-only Actions and history | `e2e/lab-04/accessibility.spec.ts` | Planned |
| A11Y-05 | Accessibility | AC-44 | Keyboard-only Actions flow | Create, edit, complete an Action and open/confirm dialogs using only the keyboard; focus visible and restored | `e2e/lab-04/accessibility.spec.ts` | Planned |
| A11Y-06 | Accessibility | AC-44, AC-36 | Keyboard dashboard | Tab order reaches every card and list link; Enter follows the drill-down; focus ring visible | `e2e/lab-04/accessibility.spec.ts` | Planned |
| E2E-01 | E2E | AC-01, AC-37 | Staff records an Action | IT Staff signs in, opens a Ticket, adds an Action; it appears with their name as performer and the chosen assignee | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-02 | E2E | AC-11 | Different staff on one Ticket | Owner Priya and Carlos each record Actions; both listed with own performer; Carlos edits Priya's open Action | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-03 | E2E | AC-09, AC-10 | Edit, progress, complete, cancel | Planned→In progress→Completed; completed row loses Edit; another Action cancelled through the confirm dialog | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-04 | E2E | AC-04, AC-05, AC-06, AC-08 | Validation and inactive assignee | Invalid fields show messages below the field with values kept; picking an assignee deactivated meanwhile shows the field error | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-05 | E2E | AC-17, AC-38 | Stale edit between two users | Two browser contexts edit one Action; second Save shows the stale callout with the first user's version and keeps its typed edits | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-06 | E2E | AC-38, AC-16 | Duplicate submit and retry | Double click and a dropped-then-retried request create exactly one Action | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-07 | E2E | AC-20, AC-21, AC-22, AC-26, AC-48 | Resolution gate end to end | Resolve is blocked with reasons; after completing the open Action the same control succeeds and the summary badge and history update; an Action logged after Resolving blocks Close with the callout until it is completed | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-08 | E2E | AC-23 | Requester indication is advisory | Requester clicks Problem Appears Resolved; status stays; IT Staff see the indication and still must resolve | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-09 | E2E | AC-24, AC-39 | History and Requester view | History shows each change in order; the owning Requester sees Actions and history read-only; another Requester gets not found | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-10 | E2E | AC-25 | Stale Ticket status | Two staff sessions; the second status change shows the stale callout and the refreshed state | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-11 | E2E | AC-28, AC-29, AC-34 | Staff dashboard and drill-down | Each card value equals the queue total it opens; Recently Updated and My Open Actions items open the right Ticket | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-12 | E2E | AC-02, AC-27, AC-34 | Requester dashboard and ownership | Jennifer's cards match her My Tickets drill-downs; a pasted other-Requester `/tickets/:id` is not found | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-13 | E2E | AC-31, AC-15 | Administrator dashboard | Users strip links to `/admin/users?role=…` and the list row count equals the card value; Administrator adds an Action but has no status/owner controls | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-14 | E2E | AC-32 | Zero dashboards | Emma Fischer and David Lee see zero cards and empty messages, no errors | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-15 | E2E | AC-35 | Landing and nav per role | Login lands on `/dashboard` for each role; Dashboard first and active; wordmark goes there; forbidden state for a wrong-role URL with no protected request | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-16 | E2E | AC-45, AC-36 | Safe failure in the browser | Intercepted `500` on dashboard and Actions list shows the failure state with Retry; Retry succeeds; no console error | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-17 | E2E | AC-45 | Console, links, placeholders | Walking every main journey for each role logs no console errors, follows no broken link, shows no placeholder text | `e2e/lab-04/regression-smoke.spec.ts` | Planned |
| E2E-18 | E2E | AC-42 | Representative Labs 1–3 regression | Login/forced password change; My Tickets; Ticket Detail; attachments; Public Comments; staff queue; Internal Notes; Administrator user management all still work | `e2e/lab-04/regression-smoke.spec.ts` | Planned |
| E2E-19 | E2E | AC-43 | Screenshots | Captures every state in `ui-spec.md` §11 at desktop, tablet and mobile into `artifacts/lab-04/screenshots/` | `e2e/lab-04/screenshots.spec.ts` | Planned |
| REG-01 | Regression | AC-42, FR-19 | Lab 1 server suite | All pass unchanged | `server/tests/lab-01/*.test.ts` | Planned |
| REG-02 | Regression | AC-42, FR-19 | Lab 2 server suite | All pass unchanged | `server/tests/lab-02/*.test.ts` | Planned |
| REG-03 | Regression | AC-42, FR-19 | Lab 3 server suite | All pass, unchanged except sending `version` on status/owner/it-priority calls (D-18), the Administrator queue-read cases (D-13), and seeding one COMPLETED Action before the transitions into Resolved in `ticket-status.api.test.ts` (D-27) (§4.2) | `server/tests/lab-03/*.test.ts` | Planned |
| REG-04 | Regression | AC-42, FR-19 | Lab 1–3 client suites | All pass, unchanged except the nav and forbidden-link edits of D-12 (§4.2) | `client/tests/lab-01/*.test.tsx, client/tests/lab-02/*.test.tsx, client/tests/lab-03/*.test.tsx` | Planned |
| REG-05 | Regression | AC-42, FR-19 | Lab 2 E2E suite | All pass, unchanged except the landing-URL edits of D-12 (§4.2) | `e2e/lab-02/*.spec.ts` | Planned |
| REG-06 | Regression | AC-42, FR-19 | Lab 3 E2E suite | All pass, unchanged except the landing-URL and forbidden-link edits of D-12, `version` use (D-18) and the seeded COMPLETED Action before Resolve in `submission-evidence.spec.ts` (D-27) (§4.2) | `e2e/lab-03/*.spec.ts` | Planned |
| REG-07 | Regression | AC-51, FR-19 | Health endpoint unchanged | `GET /api/health` unauthenticated → `200 {"status":"ok","service":"TokTickIT API"}` | `server/tests/lab-01/app.test.ts` | Planned |

## 3. Acceptance Criterion → test matrix

Every AC in `specification.md` §9 maps to at least one planned test.

| AC | Tests |
|---|---|
| AC-01 | API-01, C-11, E2E-01 |
| AC-02 | API-17, API-18, SEC-05, C-08, E2E-12 |
| AC-03 | API-02 |
| AC-04 | UNIT-01, API-03, C-12, E2E-04 |
| AC-05 | UNIT-02, API-04, C-12, E2E-04 |
| AC-06 | UNIT-03, API-05, C-13, E2E-04 |
| AC-07 | UNIT-03, API-06, C-12 |
| AC-08 | API-07, C-19, E2E-04 |
| AC-09 | UNIT-04, API-08, C-18, E2E-03 |
| AC-10 | API-09, C-17, E2E-03 |
| AC-11 | API-10, E2E-02 |
| AC-12 | API-11 |
| AC-13 | API-12, C-20 |
| AC-14 | API-15, SEC-01, SEC-05, SEC-08 |
| AC-15 | SEC-02, SEC-08, C-21, E2E-13 |
| AC-16 | UNIT-10, API-13, E2E-06 |
| AC-17 | API-14, WF-12, C-15, E2E-05 |
| AC-18 | UNIT-05, WF-01 |
| AC-19 | UNIT-05, WF-02 |
| AC-20 | UNIT-06, WF-03, C-24, E2E-07 |
| AC-21 | UNIT-06, WF-04, WF-06, C-24, E2E-07 |
| AC-22 | UNIT-06, WF-05, C-24, E2E-07 |
| AC-23 | WF-07, E2E-08 |
| AC-24 | API-16, WF-08, WF-09, C-26, E2E-09 |
| AC-25 | UNIT-09, WF-10, WF-11, WF-12, WF-13, C-25, E2E-10 |
| AC-26 | C-22, C-23, E2E-07 |
| AC-27 | UNIT-08, API-17, API-19, E2E-12 |
| AC-28 | API-23, C-04, E2E-11 |
| AC-29 | API-24, API-25, C-04, E2E-11 |
| AC-30 | SEC-03, SEC-04 |
| AC-31 | API-26, C-07, E2E-13 |
| AC-32 | API-20, API-27, C-06, C-09, E2E-14 |
| AC-33 | UNIT-07, API-21 |
| AC-34 | UNIT-11, API-22, API-28, API-31, API-29, C-05, C-09, E2E-11, E2E-12 |
| AC-35 | C-01, C-02, E2E-15 |
| AC-36 | C-03, C-06, C-08, C-09, S-03, A11Y-06, E2E-16 |
| AC-37 | C-10, C-11, S-05, R-03, E2E-01 |
| AC-38 | C-14, C-15, C-16, E2E-05, E2E-06 |
| AC-39 | C-27, R-04, A11Y-04, E2E-09 |
| AC-40 | MIG-01, MIG-02, MIG-03, MIG-04, MIG-05, MIG-09 |
| AC-41 | MIG-06, MIG-07, MIG-08 |
| AC-42 | E2E-18, REG-01, REG-02, REG-03, REG-04, REG-05, REG-06 |
| AC-43 | S-01, S-02, S-04, R-01, R-02, R-03, R-04, R-05, E2E-19 |
| AC-44 | A11Y-01, A11Y-02, A11Y-03, A11Y-04, A11Y-05, A11Y-06 |
| AC-45 | SEC-06, SEC-07, C-28, E2E-16, E2E-17 |
| AC-46 | PERF-01, PERF-02 |
| AC-47 | API-30 |
| AC-48 | WF-15, C-24, E2E-07 |
| AC-49 | WF-16, C-22 |
| AC-50 | WF-14 |
| AC-51 | REG-07 |

## 4. Labs 1–3 regression

### 4.1 Suites that must stay green

Lab 4 re-runs, rather than re-lists, the earlier suites (REG-01…REG-07). Lab 3's own regression rows
(`docs/lab-03/tests.md` §2.6) and Lab 2's (`docs/lab-02/tests.md`) define their content. E2E-18 adds a
single Lab 4 journey touching authentication, My Tickets, Ticket Detail, Attachments, Public Comments,
the staff queue, Internal Notes and Administrator user management, as handout §14 Part 8 asks.

### 4.2 Permitted edits to earlier tests (the full list)

D-12 moves the post-login landing route (and the forbidden state's "go home" link) to `/dashboard`, so
every assertion of the old landing changes. Found with `grep -rnE 'tickets\$' e2e client/tests server/tests`
and a search for the forbidden-state links.

| Change | Reason | Tests touched |
|---|---|---|
| `toHaveURL(/\/tickets$/)` after login becomes `/\/dashboard$/` | D-12 | `e2e/lab-02/requester-ticket-flow.spec.ts:96,116`; `e2e/lab-02/submission-evidence.spec.ts:533`; `e2e/lab-02/responsive.spec.ts:122,198`; `e2e/lab-03/authentication.spec.ts:89,153,206`; `e2e/lab-03/accessibility.spec.ts:157,301`; `e2e/lab-03/user-administration.spec.ts:500`; `e2e/lab-03/submission-evidence.spec.ts:143,232,1199` |
| Forbidden state links to the Dashboard ("Go to Dashboard", `href="/dashboard"`) instead of the role's first list | D-12 | `client/tests/lab-03/RequireRole.test.tsx:136-150` (both link cases); `e2e/lab-03/user-administration.spec.ts:526-528` |
| Nav gains Dashboard first; `RoleLandingRedirect` target | D-12 | `client/tests/lab-03/AppShell.test.tsx` nav assertions |
| Seed one `COMPLETED` Action (with an Owner already present) on the Ticket before the transition into Resolved (BR-17, D-06, D-27); a following Resolved→Closed then passes BR-40 because no Action is open | D-06, D-27 | `server/tests/lab-03/ticket-status.api.test.ts` `PERMITTED_TRANSITIONS` rows `OPEN→RESOLVED` (:143), `IN_PROGRESS→RESOLVED` (:146), `WAITING_FOR_REQUESTER→RESOLVED` (:149), `REOPENED→RESOLVED` (:156), exercised by the `it.each` at :191; `e2e/lab-03/submission-evidence.spec.ts:670-686` (OPEN→RESOLVED→CLOSED through the UI). The seeded-RESOLVED rows `RESOLVED→CLOSED/REOPENED` (:151-152) and `CLOSED→REOPENED` (:153) need no edit, and `NEW→RESOLVED` (:234) still expects `409 INVALID_TRANSITION` |
| Send `version` on `PATCH …/status`, `/owner`, `/it-priority` | D-18 | `server/tests/lab-03/ticket-status.api.test.ts`, `ticket-owner.api.test.ts`, `ticket-it-priority.api.test.ts`, and any E2E helper that calls them |
| Administrator may read the staff queue | D-13 | `server/tests/lab-03/staff-queue.api.test.ts`, `staff-assignable-users.api.test.ts` Administrator `403` cases become `200` |

Searched for every earlier test or helper that moves a Ticket into Resolved or Closed (`grep -rnE 'RESOLVED|CLOSED|Resolved|Closed'` over `server/tests`, `e2e/lab-02`, `e2e/lab-03`, `e2e/support`, `e2e/scripts`, `server/scripts`, `client/tests`): only the two files above do so through the API or UI. Client tests mock the API and are unaffected; the e2e support fixtures and `server/scripts` write status directly and bypass the gate.

Everything else asserting `/tickets` (`page.goto`, breadcrumb and "Back to My Tickets" links, route
stubs in client tests) is the My Tickets screen itself and is unchanged. Any other failing earlier test
is a regression to fix in code, not a test to edit.

## 5. Final test output

To be filled from a real run on `main` after the implementation PRs merge: the Final column of §2 and
the verbatim output blocks below. Nothing here has been run yet.

| Suite | Command | Result |
|---|---|---|
| Server (unit, API, workflow, authorization, migration, performance-smoke) | `npm run test:server` | Planned |
| Client (component, style) | `npm run test:client` | Planned |
| E2E (flows, responsive, accessibility, screenshots) | `npm run test:e2e` | Planned |
| Labs 1–3 regression (within the three runs above) | `npm run test:all` | Planned |
