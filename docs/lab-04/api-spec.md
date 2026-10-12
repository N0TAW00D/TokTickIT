# Lab 4 API Specification — TokTickIT

> Status: draft — Issue #92. All Lab 2 and Lab 3 endpoints in `docs/lab-03/api-spec.md` remain in force
> unless changed here (§7). Contract: [`specification.md`](./specification.md) §8; tests:
> [`tests.md`](./tests.md).

## 1. Conventions

`GET /api/health` (`server/src/app.ts`) is unchanged: unauthenticated, `200 {"status":"ok","service":"TokTickIT API"}` (AC-51).

Base URL, JSON/UTF-8, ISO 8601 UTC timestamps, the `toktickit.sid` session cookie, the
`PASSWORD_CHANGE_REQUIRED` gate, the `415` content-type rule and the status-code meanings are exactly
those of Lab 3 §1.1–§1.7 and are not repeated.

### 1.1 Authentication and authorization

Every route below is mounted `authenticate → passwordChangeGate → requireRole(...)` in that order.
The Lab 3 §1.4 precedence applies:

| Case | Code |
|---|---|
| No session | `401 UNAUTHENTICATED` |
| Role-gated collection the caller's role never reaches (the two dashboards) | `403 FORBIDDEN` before any lookup |
| Ticket-addressed route, caller has **no read path** (a Requester and another Requester's Ticket) | `404 NOT_FOUND`, byte-identical to a nonexistent Ticket |
| Ticket-addressed route, caller **can read** the Ticket but may not write (Requester creating an Action; Administrator changing status) | `403 FORBIDDEN` |

The Administrator now has a read path to the staff queue and Ticket Detail (`specification.md` D-13).

**Order of checks** (`specification.md` BR-34, same as the Lab 3 code): 415 non-JSON `Content-Type` (before authentication, L3-BR-40) → 401 → password-change gate 403 → malformed path id 404 → request-body shape 400 → access lookup (404 / 403 as in the table) → record-dependent 400 → `409 STALE_UPDATE` → business 409s. Role-gated collections (the dashboards) answer 403 immediately after the gate.

### 1.2 Error envelope and status codes

Same envelope as Lab 3 §1.3 (`error`, `message`, optional `fields`). Lab 4 adds two optional members,
each present **only** with its code and absent otherwise:

| Member | Present only on | Content |
|---|---|---|
| `current` | `STALE_UPDATE` | The resource as it is now, in the same shape the corresponding `GET` returns. |
| `reasons` | `RESOLUTION_BLOCKED` | Array of `{ "code", "message", "count"? }` — one entry for every failed gate condition. |

`409` is used for all new conflict codes (§6). `422` is still not used.

### 1.3 Stale-update and conflict handling

`Ticket` and `ActionTaken` each have an integer `version` (starts at 1) returned in every read and write
response. A guarded write must send the `version` it last read.

1. Body-shape validation and the access lookup first (`version` missing or not a positive integer → `400 VALIDATION_FAILED`, field
   `version`).
2. The server runs `UPDATE … WHERE id = :id AND version = :version` and increments `version` in the same
   statement, inside the transaction that also writes any `TicketStatusChange` row. Zero rows updated
   → `409 STALE_UPDATE` with `current`.
3. Domain checks (§3, §2) run **after** the stale check (`specification.md` BR-34) on the row that was
   just compared.
4. Status changes and Action create/update additionally take `SELECT … FOR UPDATE` on the Ticket row at
   the start of their transaction, before reading the Ticket status or evaluating the resolution gate
   (BR-39). Action writes do not bump `Ticket.version`, so the lock, not `version`, is what stops a
   concurrent Action create from slipping past a Resolve.

```json
{
  "error": "STALE_UPDATE",
  "message": "This record was changed by someone else. Review the current version and try again.",
  "current": { "id": 41, "status": "IN_PROGRESS", "version": 7 }
}
```

Guarded: `PATCH /api/tickets/:id/status`, `/owner`, `/it-priority`, and
`PATCH /api/tickets/:id/actions-taken/:actionId`. Not guarded (append-only or advisory): comments,
notes, `requester-resolved`, Action create.

### 1.4 Idempotent create

`POST …/actions-taken` accepts an optional `clientRequestId` (UUID v4 string). The pair
`(ticketId, clientRequestId)` is unique: a repeat returns the **existing** Action with `200` and writes
nothing, even if the repeated body differs. Without a key there is no deduplication. A malformed key is
`400 VALIDATION_FAILED`.

---

## 2. Actions Taken

### 2.1 Action Taken shape

```json
{
  "id": 18,
  "ticketId": 41,
  "actionAt": "2026-10-12T03:15:00.000Z",
  "description": "Reset the VPN profile on the laptop.",
  "result": "VPN reconnected; stable for 30 minutes.",
  "status": "COMPLETED",
  "performedBy": { "id": 7, "name": "Priya Natarajan", "role": "IT_STAFF" },
  "assignee": { "id": 8, "name": "Carlos Mendes" },
  "followUpRequired": true,
  "followUpNote": "Check again after the Friday firmware push.",
  "attachmentNotes": "See screenshot vpn-error.png on the Ticket.",
  "lastUpdatedBy": { "id": 8, "name": "Carlos Mendes" },
  "createdAt": "2026-10-12T03:20:11.000Z",
  "updatedAt": "2026-10-12T04:02:40.000Z",
  "version": 3
}
```

`result`, `assignee`, `followUpNote`, `attachmentNotes` are `null` when unset. `clientRequestId` is never returned.

### 2.2 `GET /api/tickets/:id/actions-taken`

- **Auth:** the owning Requester, any IT Staff, any Administrator.
- **200:** array, ordered `actionAt` ascending then `id` ascending (BR-14); `[]` when none.
- **404** for a Ticket the caller has no read path to or a non-integer id; **401**, **403** (gate), **500**.
- No pagination (D-21).
- **Traceability:** FR-02, FR-06; BR-13, BR-14; AC-12, AC-14, AC-39.

### 2.3 `POST /api/tickets/:id/actions-taken`

- **Auth:** IT Staff, Administrator. Requester → `403` (they can read the Ticket, §1.1).
- **Body:**

| Field | Required | Rule |
|---|---|---|
| `description` | yes | string, 1–2000 after trim (BR-05) |
| `result` | when `status` is `COMPLETED` | string, 1–2000 after trim; optional (absent/`null`/blank = none) for `PLANNED`/`IN_PROGRESS` (BR-05) |
| `actionAt` | no | ISO 8601 with offset; default server now; not before the Ticket's `createdAt`; in the future only when `status` is `PLANNED` (BR-04) |
| `status` | no | `PLANNED` (default) \| `IN_PROGRESS` \| `COMPLETED`; `CANCELLED` is not a valid initial value (BR-09) |
| `assigneeId` | no | integer or `null`; active IT Staff/Administrator (BR-08) |
| `followUpRequired` | no | boolean, default `false` |
| `followUpNote` | iff `followUpRequired` | 1–1000 trimmed; must be absent/`null` when `followUpRequired` is `false` (BR-06) |
| `attachmentNotes` | no | string ≤ 500, or `null` (BR-07) |
| `clientRequestId` | no | UUID string (§1.4) |

`performedBy`, `createdAt`, `lastUpdatedBy`, `ticketId`, `id` and `version` in the body are ignored (BR-03).

- **201:** the created Action (§2.1), `version` 1, `performedBy = lastUpdatedBy = caller`. The Ticket's
  `updatedAt` is set to now; its `version` is unchanged (BR-15).
- **200:** the existing Action when `clientRequestId` repeats (§1.4).
- **400 `VALIDATION_FAILED`** with `fields` for every rule above; nothing is written.
- **409 `INVALID_ASSIGNEE`** — assignee is inactive, a Requester, or nonexistent; one message for all three.
- **409 `TICKET_CLOSED`** — Ticket is `CLOSED` or `CANCELLED` (BR-12).
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-01, FR-05, FR-07, FR-08; BR-01–BR-08, BR-12, BR-15, BR-35; AC-01, AC-03–AC-08, AC-11, AC-13, AC-15, AC-16.

### 2.4 `PATCH /api/tickets/:id/actions-taken/:actionId`

- **Auth:** IT Staff, Administrator, regardless of who created the Action or owns the Ticket (BR-11).
- **Body:** `version` (required) plus any subset of `description`, `result`, `actionAt`, `status`,
  `assigneeId`, `followUpRequired`, `followUpNote`, `attachmentNotes`. Validation per §2.3, applied to
  the **merged** result (so a transition to `COMPLETED` needs a non-empty `result` in the request or already stored, BR-05) (e.g. `{"followUpRequired": false}` clears the stored note; supplying a note
  with `followUpRequired: false` is `400`). Server-owned fields are ignored. An empty change set (only
  `version`) is `400`.
- **200:** the updated Action; `version` incremented; `lastUpdatedBy` = caller; `performedBy` unchanged;
  Ticket `updatedAt` touched.
- **409 `STALE_UPDATE`** — `version` outdated; body carries `current` (the Action, §2.1).
- **409 `ACTION_LOCKED`** — the stored Action is `COMPLETED` or `CANCELLED` (BR-10).
- **409 `INVALID_ACTION_TRANSITION`** — `status` not permitted from the stored status, including a no-op
  (BR-09): allowed pairs are PLANNED→IN_PROGRESS, IN_PROGRESS→COMPLETED, PLANNED→CANCELLED,
  IN_PROGRESS→CANCELLED.
- **409 `INVALID_ASSIGNEE`**, **409 `TICKET_CLOSED`** as §2.3.
- **404** — Ticket unreadable, Action not on this Ticket, or non-integer ids. **400**, **401**, **403**, **415**, **500**.
- There is **no** `DELETE` route and no route to upload a file for an Action; both are `404`.
- **Traceability:** FR-03, FR-04, FR-05, FR-08, FR-12; BR-03, BR-09–BR-12, BR-33, BR-34; AC-03, AC-08–AC-10, AC-13, AC-15, AC-17.

---

## 3. Ticket workflow

### 3.1 `GET /api/tickets/:id` (Lab 3 §5, extended)

Adds `version` (integer) to the response for every role. Everything else is unchanged, including that a
Requester never sees `itPriority`.

### 3.2 `PATCH /api/tickets/:id/status`

- **Auth:** IT Staff only. Administrator → `403`; a Requester → `403` on their own Ticket and `404` on
  anyone else's (Lab 3 §1.4 case 3 / case 2, unchanged).
- **Body:** `{ "status": <one of the eight>, "version": integer }` — `version` is now required (D-18).
- **200:** the updated Ticket (Lab 3 shape plus `version`), after the transaction wrote the Ticket and
  one `TicketStatusChange` row.
- Check order (BR-34): shape 400 → access 404/403 → **409 `STALE_UPDATE`** → **409 `INVALID_TRANSITION`** (pair absent from
  `specification.md` §5.1, incl. no-op) → **409 `OWNER_REQUIRED`** (target `IN_PROGRESS`, no owner) →
  **409 `RESOLUTION_BLOCKED`** (target `RESOLVED` and the gate fails).
- **409 `RESOLUTION_BLOCKED`** body:

```json
{
  "error": "RESOLUTION_BLOCKED",
  "message": "This ticket can't be resolved yet.",
  "reasons": [
    { "code": "OWNER_MISSING", "message": "Assign a Ticket Owner first." },
    { "code": "NO_COMPLETED_ACTION", "message": "Complete at least one Action Taken." },
    { "code": "OPEN_ACTIONS_REMAIN", "message": "2 Actions Taken are still Planned or In Progress.", "count": 2 }
  ]
}
```

  `reasons` lists every failed condition (BR-17), in this order; a requester-resolved indication
  satisfies none of them (BR-18).
- **Closing:** `RESOLVED → CLOSED` with any `PLANNED`/`IN_PROGRESS` Action → `409 RESOLUTION_BLOCKED` with `reasons: [{ "code": "OPEN_ACTIONS_REMAIN", … }]` only (BR-40; message "This ticket can't be closed yet.").
- **Cancelling:** a successful transition to `CANCELLED` also cancels every non-terminal Action of the Ticket in the same transaction (`status`, `version`, `lastUpdatedBy` = caller; BR-41). The response is the Ticket; clients re-read `…/actions-taken`.
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-09, FR-10, FR-11, FR-12, FR-13; BR-16–BR-19, BR-33, BR-34, BR-39–BR-41; AC-18–AC-23, AC-25, AC-48–AC-50.

### 3.3 `PATCH /api/tickets/:id/owner` and `/it-priority`

Lab 3 §5.1 and §5.2 unchanged except: the body gains a required `version` (D-18), the response gains
`version`, a stale version → `409 STALE_UPDATE` with `current` (the Ticket), and both increment the
Ticket `version`. `INVALID_OWNER` (owner route) is unchanged.

- **Traceability:** FR-12; BR-33; AC-25.

### 3.4 `GET /api/tickets/:id/status-history`

- **Auth:** the owning Requester, any IT Staff, any Administrator. Another Requester → `404`.
- **200:** array ordered `changedAt` ascending then `id` ascending (BR-14); `[]` for a Ticket that has
  never changed status (every legacy Ticket, D-10).

```json
[
  {
    "id": 5,
    "fromStatus": "OPEN",
    "toStatus": "IN_PROGRESS",
    "changedBy": { "id": 7, "name": "Priya Natarajan", "role": "IT_STAFF" },
    "changedAt": "2026-10-11T08:00:00.000Z"
  }
]
```

- No `POST`, `PATCH` or `DELETE` exists for history (BR-19); each is `404`. **401**, **403** (gate), **500**.
- **Traceability:** FR-06, FR-11; BR-13, BR-14, BR-19; AC-24, AC-39.

---

## 4. Requester dashboard

### `GET /api/dashboard/requester`

- **Auth:** Requester only. IT Staff and Administrator → `403 FORBIDDEN` before any lookup. Ownership is
  the authenticated user; no parameter selects a user (BR-20).
- **Query:** none. Any query parameter is ignored.
- **200:**

```json
{
  "generatedAt": "2026-10-12T05:00:00.000Z",
  "timeZone": "Asia/Bangkok",
  "windowStart": "2026-10-05T17:00:00.000Z",
  "metrics": { "openTickets": 3, "waitingForMe": 1 },
  "recentlyUpdated": {
    "total": 4,
    "items": [
      { "id": 41, "ticketNumber": "TKT-2026-000041", "summary": "VPN drops every few minutes",
        "status": "WAITING_FOR_REQUESTER", "updatedAt": "2026-10-12T03:00:00.000Z" }
    ]
  },
  "recentlyResolved": {
    "total": 1,
    "items": [
      { "id": 37, "ticketNumber": "TKT-2026-000037", "summary": "Printer jam on floor 2",
        "status": "RESOLVED", "updatedAt": "2026-10-11T10:00:00.000Z", "resolvedAt": "2026-10-11T10:00:00.000Z" }
    ]
  }
}
```

| Metric (exact name) | Definition (Prisma/SQL level) | Empty behavior | Drill-down (UI route → API) |
|---|---|---|---|
| `metrics.openTickets` — "Open Tickets" | `count(Ticket where requesterId = me AND status NOT IN (RESOLVED, CLOSED, CANCELLED))` | `0` | `/tickets?scope=open` → `GET /api/tickets?scope=open` |
| `metrics.waitingForMe` — "Waiting for Me" | `count(Ticket where requesterId = me AND status = WAITING_FOR_REQUESTER)` | `0` | `/tickets?status=WAITING_FOR_REQUESTER` |
| `recentlyUpdated` — "Recently Updated" | `Ticket where requesterId = me AND updatedAt >= windowStart`, `total` = full count, `items` = first 5 by `updatedAt desc, id desc` | `total: 0, items: []` | `/tickets?scope=recent&sort=updatedAt&order=desc` |
| `recentlyResolved` — "Recently Resolved" | `Ticket where requesterId = me AND status IN (RESOLVED, CLOSED) AND` latest `TicketStatusChange.toStatus IN (RESOLVED, CLOSED)` has `changedAt >= windowStart` (BR-23); `resolvedAt` = that `changedAt`; Tickets with no history are excluded | `total: 0, items: []` | `/tickets?scope=recently-resolved` |

Each list item's own link is `/tickets/:id`. Items never carry `itPriority`, owner, or Internal data
(L3-BR-04). `windowStart` is 00:00 Asia/Bangkok on the day six days before today, as a UTC instant
(BR-22). All metrics are computed in one request; the response never exceeds 4 + 5 + 5 Ticket rows.

- **401**, **403**, **500**. **Traceability:** FR-14, FR-17; BR-20–BR-24, BR-30, BR-31; AC-02, AC-27, AC-30, AC-32–AC-34.

---

## 5. IT Staff dashboard

### `GET /api/dashboard/staff`

- **Auth:** IT Staff and Administrator. Requester → `403 FORBIDDEN` before any lookup.
- **Query:** none.
- **200:**

```json
{
  "generatedAt": "2026-10-12T05:00:00.000Z",
  "timeZone": "Asia/Bangkok",
  "windowStart": "2026-10-05T17:00:00.000Z",
  "metrics": { "unassigned": 2, "ownedByMe": 3, "urgent": 1, "followUpsRequired": 2 },
  "byStatus": { "NEW": 1, "OPEN": 2, "IN_PROGRESS": 3, "WAITING_FOR_REQUESTER": 1,
                "RESOLVED": 2, "CLOSED": 4, "REOPENED": 0, "CANCELLED": 1 },
  "byItPriority": { "LOW": 2, "MEDIUM": 3, "HIGH": 1 },
  "myOpenActions": {
    "actions": 3, "tickets": 2,
    "items": [
      { "id": 18, "ticketId": 41, "ticketNumber": "TKT-2026-000041", "description": "Reset the VPN profile…",
        "status": "PLANNED", "actionAt": "2026-10-12T03:15:00.000Z", "followUpRequired": false }
    ]
  },
  "urgentTickets": {
    "total": 1,
    "items": [
      { "id": 41, "ticketNumber": "TKT-2026-000041", "summary": "VPN drops every few minutes",
        "status": "IN_PROGRESS", "itPriority": "HIGH", "owner": { "id": 7, "name": "Priya Natarajan" },
        "updatedAt": "2026-10-12T03:00:00.000Z" }
    ]
  },
  "recentlyUpdated": { "total": 9, "items": [ { "…": "same item shape as urgentTickets" } ] },
  "userCounts": [
    { "role": "REQUESTER", "active": 4, "inactive": 1 },
    { "role": "IT_STAFF", "active": 3, "inactive": 1 },
    { "role": "ADMINISTRATOR", "active": 2, "inactive": 0 }
  ]
}
```

`userCounts` is present **only** for an Administrator caller (BR-32); for IT Staff the key is absent.
"Open" below is BR-21. `item` lists are capped at 5 (BR-24); `myOpenActions.items` is ordered
`actionAt asc, id asc`.

| Metric (exact name) | Definition | Empty behavior | Drill-down (UI route → API) |
|---|---|---|---|
| `metrics.unassigned` — "Unassigned" | `count(Ticket open AND ownerId IS NULL)` | `0` | `/staff/tickets?owner=unassigned&scope=open` |
| `metrics.ownedByMe` — "Owned by Me" | `count(Ticket open AND ownerId = me)` | `0` | `/staff/tickets?owner=me&scope=open` |
| `byStatus.<STATUS>` — "Tickets by Status" (8 cards/rows) | `count(Ticket where status = S)` over **all** Tickets; all eight keys always present | each `0` | `/staff/tickets?status=<STATUS>` |
| `byItPriority.<P>` — "Open by IT Priority" (3) | `count(Ticket open AND itPriority = P)`; three keys always present | each `0` | `/staff/tickets?itPriority=<P>&scope=open` |
| `myOpenActions` — "My Open Actions" | Actions with `status IN (PLANNED, IN_PROGRESS)` on an open Ticket where `assigneeId = me OR (assigneeId IS NULL AND performedById = me)` (BR-25); `actions` = rows, `tickets` = distinct `ticketId` | `actions: 0, tickets: 0, items: []` | `/staff/tickets?myActions=true&scope=open` (lists the `tickets`); item → `/staff/tickets/:ticketId` |
| `metrics.followUpsRequired` — "Follow-ups Required" | `count(distinct ticketId)` of Actions with `followUpRequired = true AND status <> CANCELLED` on an open Ticket (BR-26) | `0` | `/staff/tickets?followUp=true&scope=open` |
| `metrics.urgent`, `urgentTickets` — "Urgent" | open Tickets with `itPriority = HIGH` (BR-27); `total` = `metrics.urgent`; items by `updatedAt desc, id desc` | `0`, `total: 0, items: []` | `/staff/tickets?itPriority=HIGH&scope=open` |
| `recentlyUpdated` — "Recently Updated" | all Tickets with `updatedAt >= windowStart` (any status); `total` + first 5 | `total: 0, items: []` | `/staff/tickets?scope=recent&sort=updatedAt&direction=desc` |
| `userCounts` — "Users" (Administrator) | `groupBy(role, isActive)` counts; all three roles always listed; the linked value is the **total** `active + inactive` | `active: 0, inactive: 0` | `/admin/users?role=<ROLE>` → `GET /api/users?role=<ROLE>`, which lists active and inactive users, so rows = total |

Metrics other than `myOpenActions` and `userCounts` cover the whole shared queue, not only the caller's
work. `byStatus` counts every status including closed ones; `byItPriority` is open Tickets only.

- **401**, **403**, **500**. **Traceability:** FR-15, FR-16, FR-17; BR-20–BR-32; AC-28–AC-34.

---

## 6. Drill-down filters on existing lists

The Dashboard opens the existing lists with filters; the lists gain parameters so each card's count
equals the list total (BR-31). Parsing errors are `400 INVALID_QUERY` with `fields`, as in Lab 3.

### 6.1 `GET /api/tickets` (Requester My Tickets) — changes

| Param | Lab 2/3 | Lab 4 |
|---|---|---|
| `status` | accepted only `NEW` | any of the eight status values |
| `scope` | — | new: `open` (BR-21) \| `recent` (`updatedAt >= windowStart`) \| `recently-resolved` (BR-23). Combines with other filters by AND. |

Always restricted to the caller's own Tickets (L3-BR-13). Other params unchanged.

### 6.2 `GET /api/staff/tickets` — changes

| Param | Lab 3 | Lab 4 |
|---|---|---|
| auth | IT Staff only | IT Staff **and Administrator** (read; D-13) |
| `scope` | — | new: `open` \| `recent` |
| `myActions` | — | new: only `true`; Tickets having ≥ 1 Action matching BR-25 for the caller |
| `followUp` | — | new: only `true`; Tickets matching BR-26 |

`GET /api/staff/assignable-users` is likewise widened to IT Staff **and Administrator** (the Actions
Taken assignee picker needs it). A `myActions`/`followUp` value other than `true` is `INVALID_QUERY`.

- **Traceability:** FR-17; BR-31; AC-34.

---

## 7. Changes to the Lab 3 contract

| Lab 3 | Lab 4 |
|---|---|
| `PATCH /api/tickets/:id/status`, `/owner`, `/it-priority` body `{ … }` | Body also requires `version` (D-18); responses carry `version`; new `409 STALE_UPDATE`. |
| `PATCH …/status` → `RESOLVED` allowed from the §5.1 rows | Same rows, plus the resolution gate → `409 RESOLUTION_BLOCKED`. |
| `GET /api/tickets/:id` | Adds `version`. |
| `GET /api/tickets` `status` = `NEW` only | All eight statuses; new `scope`. |
| `GET /api/staff/tickets`, `/assignable-users` IT Staff only | IT Staff and Administrator (read); new `scope`, `myActions`, `followUp`. |
| No Actions Taken, history or dashboard routes | §2, §3.4, §4, §5. |
| Landing route per role | `/dashboard` for all (UI, `ui-spec.md` §2). |

Everything else — auth, comments, notes, attachments, user administration — is unchanged.

## 8. Endpoint → requirement matrix

| Endpoint | FR | Key BRs | ACs |
|---|---|---|---|
| `GET …/actions-taken` | 02, 06 | 13, 14 | 12, 14, 39 |
| `POST …/actions-taken` | 01, 05, 07, 08 | 01–08, 12, 15, 35, 39 | 01, 03–08, 11, 13, 15, 16 |
| `PATCH …/actions-taken/:actionId` | 03, 04, 05, 12 | 03, 09–12, 33, 34 | 03, 08–10, 13, 17 |
| `PATCH …/status` | 09–13 | 16–19, 33, 34, 39–41 | 18–23, 25, 48–50 |
| `PATCH …/owner`, `…/it-priority` | 12 | 33 | 25 |
| `GET …/status-history` | 06, 11 | 13, 14, 19 | 24, 39 |
| `GET /api/dashboard/requester` | 14, 17 | 20–24, 30, 31 | 02, 27, 30, 32–34 |
| `GET /api/dashboard/staff` | 15, 16, 17 | 20–32 | 28–34 |
| `GET /api/tickets`, `GET /api/staff/tickets` (filters) | 17 | 31 | 34 |
| every Lab 4 route | 22 | 34, 37 | 30, 45, 47 |

## 9. Error code catalogue

Lab 3 §8 codes are reused unchanged (`UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`,
`VALIDATION_FAILED`, `INVALID_QUERY`, `MALFORMED_BODY`, `UNSUPPORTED_MEDIA_TYPE`, `NOT_FOUND`,
`INVALID_OWNER`, `INVALID_TRANSITION`, `OWNER_REQUIRED`, `INVALID_STATE`, `INTERNAL`, …). Lab 4 adds:

| Code | Status | Raised by |
|---|---|---|
| `INVALID_ASSIGNEE` | 409 | Action assignee is inactive, a Requester, or nonexistent (BR-08). |
| `TICKET_CLOSED` | 409 | Action create/update on a `CLOSED` or `CANCELLED` Ticket (BR-12). |
| `ACTION_LOCKED` | 409 | Update of a `COMPLETED` or `CANCELLED` Action (BR-10). |
| `INVALID_ACTION_TRANSITION` | 409 | Action status pair not permitted, incl. no-op (BR-09). |
| `STALE_UPDATE` | 409 | Outdated `version` on a guarded write; carries `current` (BR-33). |
| `RESOLUTION_BLOCKED` | 409 | Resolved requested while the gate fails, or Closed while Actions are open; carries `reasons` (BR-17, BR-40). |

`reasons[].code` values: `OWNER_MISSING`, `NO_COMPLETED_ACTION`, `OPEN_ACTIONS_REMAIN`.
