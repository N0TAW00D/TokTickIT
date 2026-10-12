# Lab 4 Sprint Engineering Specification — TokTickIT Actions Taken, Dashboards and Final Regression

> Status: draft — Issue #92. Extends `docs/lab-03/specification.md`; Lab 3 rules are referenced as
> `L3-BR-nn` / `L3-AC-nn`. Lab 4 numbering restarts at BR-01, FR-01, AC-01, D-01.

Companion documents: [`api-spec.md`](./api-spec.md), [`ui-spec.md`](./ui-spec.md),
[`tests.md`](./tests.md). The coding agent may report completion only when §10 holds in full.

---

## 1. Sprint Goal

Complete the core service-desk workflow. IT Staff and Administrators record **Actions Taken** under a
Ticket (many per Ticket, by different people); the backend enforces the final Ticket status matrix,
including a **resolution gate** that blocks Resolved until the work is actually done; Requesters, IT
Staff and Administrators land on a concise, backend-calculated **Dashboard** that links to the
detailed lists; and the whole Lab 1–3 application is hardened — migrated without data loss, seeded
repeatably, responsive, accessible, and safe against stale updates and duplicate submits.

## 2. Stakeholder Request Interpretation

**Plan and track the actual work.** A Ticket is a conversation today; the stakeholder wants a work log
beneath it. Each line says when something was done, what, with what result, who did it, and whether
anything is still owed. The Ticket Owner stays the single coordinator, but any IT Staff member may do
and record a piece of work.

**Resolved must mean resolved.** A Requester may still say "looks fixed", but that stays advisory
(L3-BR-26). IT Staff formally resolve, and the backend refuses to do so while work is outstanding, even
if a client bypasses the screen.

**Dashboards summarise, they do not replace.** Few, well-defined numbers per role, each a link into the
existing list or detail screen it summarises, each recomputable from the database.

**Final polish.** Nothing from Labs 1–3 may regress; the product must look and behave as one
application under Zen Green.

## 3. Scope

### 3.1 Included

- Actions Taken: create, list, edit (while not terminal), assign, status lifecycle, complete, cancel.
- Final Ticket status-transition matrix, resolution gate, append-only status history.
- Optimistic-concurrency (`version`) on Ticket workflow writes and Action Taken updates; idempotent
  Action create.
- Requester dashboard and IT Staff dashboard (Administrator reuses it, plus user-account counts);
  drill-down via filters on the existing My Tickets and Ticket Queue lists.
- Additive Prisma migration with recovery script, idempotent extended seed.
- Dashboard as first nav item and landing route for every role; Actions Taken and status history on
  Ticket Detail screens; consistent feedback states; responsive/accessibility/visual polish; README.

### 3.2 Explicitly Excluded

From handout §4.2; none of it is built or stubbed:

- SLA clocks, escalation engines, on-call scheduling, breach notifications.
- Email, SMS, LINE, push or any external notification service.
- Inventory, spare parts, purchasing, service cost accounting.
- Time-sheet billing, payroll, labor-cost calculation (so Actions Taken carry **no** duration or cost).
- Multi-level approvals, electronic signatures.
- BI tools, custom report builders, exports (dashboards have no export, no charts library, no saved views).
- Multi-tenant organizations, production-scale cloud operations.
- Deleting Actions Taken, file upload for Actions Taken (see BR-07), editing or deleting Public
  Comments/Internal Notes (still append-only, L3-BR-15), and any feature not approved here.

## 4. Functional Requirements

### Actions Taken

| ID | Requirement |
|---|---|
| FR-01 | IT Staff and Administrators can create an Action Taken under a Ticket with action date/time, description, result, optional assignee, follow-up flag and note, and attachment notes; the backend records the performer. |
| FR-02 | Every role with a read path can list a Ticket's Actions Taken in a stable order. |
| FR-03 | IT Staff and Administrators can edit a non-terminal Action Taken. |
| FR-04 | An Action Taken moves through a status lifecycle (Planned → In Progress → Completed; Cancelled from either non-terminal state); Completed and Cancelled are read-only. |
| FR-05 | An Action Taken may name one assignee, who must be an active IT Staff or Administrator user. |
| FR-06 | A Requester sees all Actions Taken on their own Tickets, read-only, and can never create or change one. |
| FR-07 | Creating an Action Taken is safe to retry: a repeated request does not create a duplicate. |
| FR-08 | An Administrator can create and update Actions Taken and open the IT Staff queue and Ticket Detail to do so (read access); Lab 3's other Administrator limits stand. |

### Ticket workflow

| ID | Requirement |
|---|---|
| FR-09 | IT Staff change Ticket status only along the final matrix (§5.1); the UI offers only permitted transitions and refreshes the Ticket summary on success. |
| FR-10 | The backend refuses Resolved unless the resolution gate (BR-17) holds, returning the reasons. |
| FR-11 | Every status change is recorded in an append-only history (from, to, who, when), shown in stable order to IT Staff, Administrators and the owning Requester. |
| FR-12 | Ticket status, owner and IT Priority writes, and Action Taken updates, are rejected as stale when the client's `version` is no longer current, and the response carries the current resource. |
| FR-13 | "Problem Appears Resolved" stays advisory and never changes status (L3-FR-17, L3-BR-26). |

### Dashboards

| ID | Requirement |
|---|---|
| FR-14 | A Requester dashboard returns metrics and recent Tickets for the authenticated Requester's own Tickets only. |
| FR-15 | An IT Staff dashboard returns operational metrics, urgent and recently updated Tickets, and the caller's open Actions Taken. |
| FR-16 | The Administrator receives the IT Staff dashboard plus active/inactive user counts per role. |
| FR-17 | Every metric card and list item links to a detailed screen; the filtered lists it opens contain exactly the Tickets counted. |
| FR-18 | "Dashboard" is the first navigation item and the post-login landing route for every role, with active-page indication. |

### Hardening and regression

| ID | Requirement |
|---|---|
| FR-19 | Every Lab 1–3 function, screen, role rule and test keeps working; changed contracts are listed in §11 (D-12, D-13, D-18, D-27) and re-pointed, not removed. |
| FR-20 | The migration preserves all existing data, has a documented and tested recovery path, and treats legacy Tickets as valid. |
| FR-21 | The seed is idempotent and demonstrates every status, priority, ownership state, 0/1/many Actions Taken, and zero and non-zero metrics. |
| FR-22 | Loading, validation, success, empty, forbidden, conflict (stale), not-found and safe-failure feedback is consistent on every Lab 4 screen; forms keep entered data after recoverable failures; repeated clicks cannot duplicate writes. |
| FR-23 | Lab 4 screens meet the responsive, accessibility and visual-consistency rules; no console errors, broken links, placeholder text or unfinished controls remain; README setup, seed, migration, test and demo instructions are current. |

### 4.1 Authorization matrix

Final matrix; it supersedes Lab 3 §4.1. `—` = refused. "Own" = only the caller's own Tickets.
**‡** = changed or added in Lab 4; unmarked rows are unchanged Lab 3 rows. Every row is enforced by
the backend; hiding a control is never authorization.

| Operation | Requester | IT Staff | Administrator |
|---|---|---|---|
| Log in / log out / read own identity / change own password | ✓ | ✓ | ✓ |
| Create Ticket | ✓ | — | — |
| List / view Tickets | Own | All | All (read) |
| Upload / download / remove Attachment | Own | All (read) | All (read) |
| Post Public Comment | Own | All | — |
| Read Public Comments | Own | All | All |
| Indicate "Problem Appears Resolved" | Own | — | — |
| IT Staff Ticket Queue (read) | — | ✓ | ✓ ‡ |
| Claim / assign / reassign owner | — | ✓ | — |
| Be assigned as Ticket Owner | — | ✓ | ✓ |
| Set IT Priority | — | ✓ | ✓ |
| Change Ticket status (incl. Resolved, Closed, Cancelled) | — | ✓ | — |
| Create Internal Note | — | ✓ | — |
| Read Internal Note | — | ✓ | ✓ |
| Read Actions Taken ‡ | Own | All | All |
| Create / update Action Taken ‡ | — | ✓ | ✓ |
| Be named Action Taken assignee ‡ | — | ✓ | ✓ |
| Read Ticket status history ‡ | Own | All | All |
| Requester dashboard ‡ | ✓ | — | — |
| IT Staff dashboard ‡ | — | ✓ | ✓ |
| User counts inside the dashboard ‡ | — | — | ✓ |
| List / create / edit users, set initial password | — | — | ✓ |

Reasons for the only changed Lab 3 row: handout §4.3 says the Administrator "performs IT Staff
behavior" for Actions Taken and §4.6 lets the Administrator "reuse the IT Staff dashboard". Both need
a way to reach a Ticket, so the queue and Staff Ticket Detail open to the Administrator read-only
(D-13). Lab 3's L3-AC-68 remains true: an Administrator is still refused status, claim/assign and note
writes.

## 5. Business Rules

### Actions Taken

| ID | Rule |
|---|---|
| BR-01 | An Action Taken belongs to exactly one Ticket, fixed at creation. |
| BR-02 | The Ticket Owner coordinates the Ticket, but an Action Taken may be performed by a different IT Staff member; no Ticket Owner is required to create or edit one. |
| BR-03 | `performedBy` is set by the backend from the authenticated user at creation and never changes; a client-supplied performer, `createdAt` or `lastUpdatedBy` is ignored. Each update records `lastUpdatedBy` and `updatedAt`. |
| BR-04 | `actionAt` is when the work was performed or, for a `PLANNED` Action, when it is scheduled. It is user-entered (the UI defaults it to now), may not precede the Ticket's `createdAt`, and may be in the future **only while the status is `PLANNED`**; `IN_PROGRESS` and `COMPLETED` require `actionAt <=` server now (also when an update moves a future-dated Action into those states). `createdAt` is the separate, server-set time the line was logged. |
| BR-05 | `description` is required, 1–2000 characters after trimming. `result` is optional while the Action is `PLANNED` or `IN_PROGRESS` (absent, `null` or blank = none) and, when given, is 1–2000 after trimming; it is **required** for `COMPLETED`: a create with status `COMPLETED` must carry one, and the request that moves an Action to `COMPLETED` must carry one unless a non-empty result is already stored. Both are stored and rendered as plain text (L3-BR-18). |
| BR-06 | `followUpRequired` defaults to `false`. `followUpNote` is required (1–1000 trimmed) when it is `true` and must be absent/null when `false`; switching the flag off clears the stored note. |
| BR-07 | `attachmentNotes` is optional free text (≤ 500) saying which existing Ticket Attachment or file to look at. It is text only; no file is uploaded or linked through it. |
| BR-08 | `assignee` is optional. When set it must be an active IT Staff or Administrator user; an inactive user, a Requester or a nonexistent user is rejected (`INVALID_ASSIGNEE`). The check applies when the assignee is set or changed, not retroactively. |
| BR-09 | Action status is `PLANNED`, `IN_PROGRESS`, `COMPLETED` or `CANCELLED`. A new Action starts as `PLANNED` (default), `IN_PROGRESS` or `COMPLETED`. Afterwards only: PLANNED → IN_PROGRESS, IN_PROGRESS → COMPLETED, PLANNED → CANCELLED, IN_PROGRESS → CANCELLED. Anything else, including a no-op, is rejected (`INVALID_ACTION_TRANSITION`). |
| BR-10 | `COMPLETED` and `CANCELLED` Actions are terminal and read-only (`ACTION_LOCKED`). Actions Taken are never deleted; no delete route exists. |
| BR-11 | Any IT Staff or Administrator may edit a non-terminal Action on any accessible Ticket, regardless of who created it or owns the Ticket. |
| BR-12 | Creating or editing an Action on a Ticket whose status is `CLOSED` or `CANCELLED` is rejected (`TICKET_CLOSED`). A `RESOLVED` Ticket still accepts Actions (follow-up work); the resolution gate is evaluated only at transition time. |
| BR-13 | A Requester reads all Actions Taken and the status history of their own Tickets; for another Requester's Ticket the response is identical to a nonexistent Ticket (L3-BR-13). Internal Notes remain staff-only (L3-BR-04). |
| BR-14 | Actions list order is `actionAt` ascending, then `id` ascending. Status history order is `changedAt` ascending, then `id` ascending. |
| BR-15 | Creating or updating an Action sets the Ticket's `updatedAt` to now (so Recently Updated reflects work) but does not change the Ticket's `version`; it does take the Ticket row lock (BR-39). |

### Ticket status and resolution

| ID | Rule |
|---|---|
| BR-16 | A status change is permitted only if the pair is in the §5.1 matrix and the caller is IT Staff. L3-BR-24 (owner required for In Progress) and L3-BR-05/25 (Requester cannot set Resolved/Closed) stand. |
| BR-17 | **Resolution gate.** A transition to `RESOLVED` requires (a) a Ticket Owner, (b) at least one `COMPLETED` Action Taken, and (c) no Action Taken in `PLANNED` or `IN_PROGRESS`. Otherwise `RESOLUTION_BLOCKED`, listing every failed condition. Enforced by the backend for any client. |
| BR-18 | "Problem Appears Resolved" records the Requester's indication only (L3-BR-26). It satisfies no part of BR-17 and changes no status. |
| BR-40 | **Closing gate.** A transition `RESOLVED → CLOSED` is refused with `RESOLUTION_BLOCKED` (single reason `OPEN_ACTIONS_REMAIN`, with `count`) while any Action is `PLANNED` or `IN_PROGRESS`; this catches Actions logged after the Resolve (BR-12). |
| BR-41 | **Cancel cascade.** A transition to `CANCELLED` sets every non-terminal Action of the Ticket to `CANCELLED` in the same transaction (under the BR-39 lock), incrementing each Action's `version` and setting `lastUpdatedBy` to the canceller; `COMPLETED` Actions are untouched. |
| BR-19 | Every successful status change inserts exactly one status-history row (from, to, changedBy, changedAt) in the same transaction as the update. History is append-only: no edit, no delete, no endpoint to write it directly. |

### 5.1 Status transition matrix

Statuses: New, Open, In Progress, Waiting for Requester, Resolved, Closed, Reopened, Cancelled. Every
transition is IT Staff only. **Unchanged from Lab 3 §5.1**; the only Lab 4 addition is the gate on every
row that arrives at Resolved.

| From | Permitted next | Notes |
|---|---|---|
| New | Open, In Progress, Cancelled | In Progress needs an owner (L3-BR-24). |
| Open | In Progress, Waiting for Requester, Resolved, Cancelled | Resolved needs BR-17. |
| In Progress | Waiting for Requester, Resolved, Cancelled | Resolved needs BR-17. |
| Waiting for Requester | In Progress, Resolved, Cancelled | In Progress needs an owner; Resolved needs BR-17. |
| Resolved | Closed, Reopened | Closing and reopening are confirmed in the UI; Closed needs BR-40. |
| Closed | Reopened | Terminal for work: no Action writes (BR-12). |
| Reopened | In Progress, Waiting for Requester, Resolved, Cancelled | Resolved needs BR-17 (counts all Actions on the Ticket, D-17). |
| Cancelled | — | Terminal; confirmed in the UI; no Action writes (BR-12). |

A pair not listed, including a no-op, is rejected (`INVALID_TRANSITION`). No row of the Lab 3 matrix
changed. Every row that arrives at Cancelled also triggers BR-41.


### Dashboard calculations

All metrics are computed by the backend per request; `generatedAt`, `timeZone` and `windowStart` are
returned so a test can recompute them. Full response shapes are in `api-spec.md` §4–5.

| ID | Rule |
|---|---|
| BR-20 | Metrics come from authoritative tables, never from client input. A Requester's metrics see only `Ticket.requesterId = caller`. |
| BR-21 | **Open** Ticket = status not in `RESOLVED`, `CLOSED`, `CANCELLED`. |
| BR-22 | **Recent window**: time zone `Asia/Bangkok` (UTC+7, no DST). `windowStart` = 00:00 Bangkok on the day six days before today, so the window is today plus the six previous Bangkok calendar days. "Updated recently" = `Ticket.updatedAt >= windowStart`. |
| BR-23 | **Recently Resolved** (Requester) = Tickets whose status is `RESOLVED` or `CLOSED` and whose latest status-history row with `toStatus` in (`RESOLVED`,`CLOSED`) has `changedAt >= windowStart`. That `changedAt` is the resolution time. Tickets with no history (legacy, D-10) are excluded; `updatedAt` is never used, because later edits bump it. |
| BR-24 | Every list is capped at 5, ordered `updatedAt` descending then `id` descending, and returns its uncapped `total` beside the items. |
| BR-25 | **My Open Actions** = Actions with status `PLANNED`/`IN_PROGRESS`, on an Open Ticket, where `assigneeId = caller`, or `assigneeId IS NULL AND performedById = caller`. Reported as an action count and the number of distinct Tickets. List order: `actionAt` ascending, then `id`. |
| BR-26 | **Follow-ups Required** = distinct Open Tickets having at least one Action with `followUpRequired = true` and status ≠ `CANCELLED`. |
| BR-27 | **Urgent** = Open Tickets with `itPriority = HIGH` (the highest). |
| BR-28 | **By status** counts all Tickets for all eight statuses, zeros included. **By IT Priority** counts Open Tickets only, three keys, zeros included. |
| BR-29 | **Unassigned** = Open Tickets with `ownerId IS NULL`. **Owned by Me** = Open Tickets with `ownerId = caller`. |
| BR-30 | No matching data is `0` or an empty list with HTTP 200, never an error; the UI shows an explicit empty message (ui-spec §3–4). |
| BR-31 | A card's count and the list its drill-down opens share one predicate, so they are equal for the same data (AC-34). For action-based cards the count is of Actions and the sub-label states the Ticket count that the list shows. |
| BR-32 | The Administrator additionally receives `userCounts`: active and inactive users per role. The IT Staff dashboard omits it. |

### Concurrency and safe failure

| ID | Rule |
|---|---|
| BR-33 | `Ticket` and `ActionTaken` carry an integer `version` starting at 1. Ticket status/owner/IT-Priority writes and Action updates must send the `version` last read; the server updates `WHERE id AND version` atomically and increments it. A mismatch is `STALE_UPDATE` with the current resource in the body. A missing or non-integer `version` is `VALIDATION_FAILED`. |
| BR-34 | Check order for a write, matching the Lab 3 code (non-JSON content type is refused before authentication; body shape is validated before the access lookup): `415` non-JSON `Content-Type` (before authentication, L3-BR-40) → `401` unauthenticated → `403 PASSWORD_CHANGE_REQUIRED` → malformed path id `404` → request-body shape `400` (types, lengths, enums, missing `version`; nothing that needs the record) → access lookup (`404` nonexistent or no read path; `403` readable but role may not write; role-gated collections such as the dashboards answer `403` right after the gate) → record-dependent `400` (e.g. `actionAt` before the Ticket's `createdAt`) → `STALE_UPDATE` → business conflicts (`TICKET_CLOSED`, `ACTION_LOCKED`, `INVALID_ACTION_TRANSITION`, `INVALID_ASSIGNEE`, `INVALID_TRANSITION`, `OWNER_REQUIRED`, `RESOLUTION_BLOCKED`). |
| BR-35 | Action create accepts an optional `clientRequestId` (UUID), unique per Ticket. A repeat returns the existing Action with `200`, not a second row. |
| BR-36 | After a validation, stale or network failure the UI keeps the user's unsaved input and shows the failure beside it; submit controls are disabled while a request is pending. |
| BR-37 | L3-BR-34 (field-level errors, no partial write), L3-BR-35, L3-BR-36 (safe `INTERNAL`) and L3-BR-40 (JSON content type, `415`) apply to every new endpoint. |
| BR-39 | **Serialization.** Every status change and every Action create/update runs inside one database transaction that first locks the Ticket row (`SELECT … FOR UPDATE` in a Prisma `$transaction`). The order is always lock → read → compare `version` → domain checks (BR-17, BR-40, Ticket status) → write (the `UPDATE … WHERE version` stays as belt-and-braces); an Action write follows the same order under the same lock, so an Action created or edited concurrently with a Resolve either lands before it (and blocks it) or waits and then sees the new status. A Ticket can therefore never become Resolved while an open Action already committed exists; an Action logged after the Resolve commits is legitimate follow-up work (BR-12) and is dealt with at closing (BR-40). The `version` check cannot cover this, because Action writes do not bump `Ticket.version` (D-15). |
| BR-38 | Legacy Tickets (from Labs 2–3) have `version = 1`, zero Actions and empty status history after migration, and are treated as ordinary records by every dashboard rule. |

## 6. UI Specification Summary

Detail, tokens, layouts and the checklist are in [`ui-spec.md`](./ui-spec.md); Zen Green, Lab 2 §11
breakpoints and Lab 2 §12 accessibility rules apply unchanged.

| Screen | Modes | Notes |
|---|---|---|
| Dashboard (`/dashboard`) | view | One route for all roles; Requester and IT Staff/Administrator variants of concise metric cards (accessible links) and short lists. |
| IT Staff Ticket Detail (extended) | view, create-action, edit-action, submitting | New Actions Taken section (table ≥ 768 px, cards below), status control with permitted transitions only, status history. Administrator sees the same page without owner/status/comment/note controls. |
| Requester Ticket Detail (extended) | view | Read-only Actions Taken and status history. |
| My Tickets / Ticket Queue (extended) | list | Read drill-down query parameters (`scope`, `status`, …) from the URL. |
| Shell | — | Dashboard first in every role's nav; wordmark and `/` go to the Dashboard. |

## 7. Data Changes

### 7.1 Models

**`ActionTaken`** — new.

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK autoincrement | |
| `ticketId` | `Int` FK → `Ticket` | `onDelete: Cascade`, as comments/notes. Immutable (BR-01). |
| `actionAt` | `DateTime` | User-entered (BR-04). |
| `description` | `String` | 1–2000 (BR-05). |
| `result` | `String?` | 1–2000 when present; required to complete (BR-05). |
| `status` | `ActionStatus` enum | `PLANNED` \| `IN_PROGRESS` \| `COMPLETED` \| `CANCELLED`, default `PLANNED`. |
| `performedById` | `Int` FK → `User` | `Restrict`; set by backend, immutable (BR-03). |
| `assigneeId` | `Int?` FK → `User` | `Restrict`; BR-08. |
| `followUpRequired` | `Boolean` default `false` | |
| `followUpNote` | `String?` | Required iff `followUpRequired` (BR-06). |
| `attachmentNotes` | `String?` | ≤ 500 (BR-07). |
| `lastUpdatedById` | `Int` FK → `User` | `Restrict`; equals `performedById` on create. |
| `clientRequestId` | `String?` (UUID) | Idempotency key (BR-35). |
| `version` | `Int` default `1` | BR-33. |
| `createdAt` / `updatedAt` | `DateTime` | |

**`TicketStatusChange`** — new, append-only.

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK autoincrement | |
| `ticketId` | `Int` FK → `Ticket` | `Cascade`. |
| `fromStatus` | `TicketStatus` | |
| `toStatus` | `TicketStatus` | |
| `changedById` | `Int` FK → `User` | `Restrict`. |
| `changedAt` | `DateTime` default `now()` | |

**`Ticket`** — gains `version Int @default(1)` (BR-33).

### 7.2 Relationships

- One `Ticket` → many `ActionTaken`, many `TicketStatusChange`.
- `User` → many `ActionTaken` through three named relations: `ActionPerformedBy`, `ActionAssignee`,
  `ActionLastUpdatedBy`; → many `TicketStatusChange` as `changedBy`.
- Users, Tickets, Attachments, Public Comments and Internal Notes keep their Lab 3 relations.

### 7.3 Indexes

| Index | Why |
|---|---|
| `ActionTaken(ticketId, actionAt, id)` | Ticket Detail list in BR-14 order. |
| `ActionTaken(ticketId, status)` | Resolution gate (BR-17) and the "Open Actions" count. |
| `ActionTaken(assigneeId, status)`, `ActionTaken(performedById, status)` | My Open Actions (BR-25). |
| `ActionTaken(ticketId, followUpRequired)` | Follow-ups Required (BR-26). |
| unique `ActionTaken(ticketId, clientRequestId)` | Idempotent create (BR-35); `NULL`s are distinct, so omitting the key is allowed. |
| `TicketStatusChange(ticketId, changedAt, id)` | History order (BR-14). |
| `TicketStatusChange(toStatus, changedAt)` | Recently Resolved (BR-23). |
| `Ticket(status, updatedAt)` | Recent-window and by-status dashboard queries. |
| `Ticket(ownerId, status)` | Owned by Me / Unassigned dashboard counts. |
| existing `Ticket(itPriority, createdAt)`, `Ticket(requesterId, …)` | Retained. |

### 7.4 Migration, backfill and recovery

1. **Additive only.** One Prisma migration (`server/prisma/migrations/<timestamp>_lab_04_actions_taken`)
   creates enum `ActionStatus`, tables `ActionTaken` and `TicketStatusChange`, their indexes, and
   `ALTER TABLE "Ticket" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1`. No existing column, table or
   row is altered, renamed or dropped, so Users, Tickets, Attachments, Public Comments and Internal
   Notes remain valid with identical ids.
2. **Hand-written CHECK**, appended to the migration SQL because Prisma cannot express it:
   `CHECK (("followUpRequired" AND "followUpNote" IS NOT NULL) OR (NOT "followUpRequired" AND "followUpNote" IS NULL))`.
   Like Lab 3's `lower(email)` index it is invisible to `prisma migrate` diffing, so it is recorded here
   and asserted by the migration test (MIG-03).
3. **Backfill / legacy behavior (D-10).** Every existing Ticket becomes `version = 1` (column default),
   has zero Actions Taken and an **empty** status history. Dashboards treat such a Ticket normally: it
   counts in Open/by-status metrics by its status, appears in Recently Updated by `updatedAt`, and is
   excluded from Recently Resolved because it has no history (BR-23, D-10). A legacy Ticket sitting in
   Resolved can be closed or reopened; the gate only applies on the way *into* Resolved.
4. **Recovery.** Prisma has no down-migrations. Recovery is (a) take `pg_dump` before `migrate deploy`
   and restore it, or (b) run `server/prisma/recovery/lab-04-down.sql`, which drops `TicketStatusChange`,
   `ActionTaken`, the `Ticket.version` column and `ActionStatus`, then deletes the
   `_prisma_migrations` row for this migration. (b) discards Lab 4 data by design and leaves Lab 3 data
   untouched. Both paths are documented in `README.md` and exercised by MIG-04 (script) and MIG-09 (dump/restore).
5. The migration is verified against a database holding Lab 3-shaped data (`db:test:lab3-fixture`)
   before merge; row counts and ids of all Lab 3 tables must be identical before and after.

### 7.5 Seed (idempotent, safe to re-run)

The Lab 3 seed (users, reference data, example comments/notes) is kept and extended; every insert is an
upsert/find-or-create on a natural key, Actions on a fixed `clientRequestId`, status history on
`(ticketNumber, sequence)`. Re-running re-anchors seeded timestamps to the current time at fixed offsets
so the 7-day metrics are reproducible whenever the seed is run. The seed writes status directly (exempt
from the matrix) and keeps Lab 3's invariants (In Progress rows carry an owner).

| Coverage | Seeded data |
|---|---|
| Statuses and priorities | At least two Tickets in each of the eight statuses; all three IT Priorities among Open Tickets; several unassigned Open Tickets. |
| Actions Taken counts | Tickets with 0, 1 and 4+ Actions; at least one Ticket with Actions by three different IT Staff (including one by an Administrator); all four action statuses; two follow-ups; one Resolved Ticket satisfying the gate and one blocked by a `PLANNED` Action. |
| Non-zero metrics | Priya Natarajan (IT Staff): Owned by Me, My Open Actions, Follow-ups, Urgent, Recently Updated all > 0. Jennifer Anderson (Requester): Open, Waiting for Me, Recently Updated, Recently Resolved all > 0. |
| Zero metrics | Emma Fischer (IT Staff): Owned by Me = 0 and My Open Actions = 0 (she owns no Ticket and has no open Action). David Lee (Requester): Open = 0, Waiting for Me = 0, Recently Updated empty, Recently Resolved = 0 (his only Tickets were resolved 10+ days ago). |
| Status history | Every seeded Ticket except the legacy-shape Tickets (next row) and those in `NEW` has history rows consistent with its status, so history-based metrics are non-zero: Jennifer Anderson's recently resolved Ticket has a `RESOLVED` row inside the window, David Lee's older ones have rows outside it. |
| Legacy shape | A few Tickets deliberately without history to exercise D-10, including at least one `RESOLVED` or `CLOSED` Ticket updated inside the window, so its exclusion from Recently Resolved is testable. |

### 7.6 Design decisions (justified)

| Decision | Justification |
|---|---|
| **D-07** `version` column instead of comparing `updatedAt`. | `updatedAt` is bumped by BR-15 (Action writes) and by any touch, so it would report false conflicts on a Ticket whose status the client did read correctly; and its millisecond precision can collide. A dedicated integer changes exactly when a guarded field changes and makes `WHERE id AND version` a single atomic statement with no read-then-write race. |
| **D-03** Separate append-only `TicketStatusChange` table instead of deriving history from `updatedAt` or a JSON column. | A status change is a fact with a who and a when that outlives later edits; deriving it is impossible, a JSON column cannot be indexed for Recently Resolved (BR-23), and a table with no update/delete path makes "append-only" structural (BR-19), which Part 7 of the handout asks to demonstrate. |
| **D-20** Follow-up consistency as a database `CHECK` as well as service validation. | The rule is cross-field (BR-06). Application validation covers the API; the constraint covers seeds, scripts and future code paths that bypass it, so an invalid pair can never be stored. |
| **D-01/D-02** `status` as a Postgres enum with an explicit lifecycle, `assigneeId` as a nullable FK. | An enum keeps the four values closed and orderable in indexes (My Open Actions); an FK to `User` gives referential integrity and lets BR-08 be checked against real roles. |
| **D-10** Empty history for legacy Tickets rather than fabricated "initial" rows. | A fabricated row would invent a `changedBy` and `changedAt` that never happened and would poison BR-23; absence is honest and the exclusion rule is explicit. |

## 8. API Contract Summary

Shapes, validation, examples and error bodies are in [`api-spec.md`](./api-spec.md). Surface:

| Method & path | Purpose | Role | Statuses |
|---|---|---|---|
| `GET /api/tickets/:id/actions-taken` | List Actions Taken | Requester (own), IT Staff, Admin | 200, 401, 403, 404 |
| `POST /api/tickets/:id/actions-taken` | Create Action Taken | IT Staff, Admin | 201, 200 (retry), 400, 401, 403, 404, 409, 415 |
| `PATCH /api/tickets/:id/actions-taken/:actionId` | Edit / change status of an Action | IT Staff, Admin | 200, 400, 401, 403, 404, 409, 415 |
| `GET /api/tickets/:id/status-history` | Append-only status history | Requester (own), IT Staff, Admin | 200, 401, 403, 404 |
| `GET /api/dashboard/requester` | Requester metrics | Requester | 200, 401, 403 |
| `GET /api/dashboard/staff` | IT Staff / Administrator metrics | IT Staff, Admin | 200, 401, 403 |
| `PATCH /api/tickets/:id/status` · `/owner` · `/it-priority` | Lab 3 writes, now with `version` | as Lab 3 | adds 409 `STALE_UPDATE`, `RESOLUTION_BLOCKED` |
| `GET /api/tickets` · `GET /api/staff/tickets` | Lists, extended filters for drill-down | as Lab 3 (+ Admin on staff queue) | as Lab 3 |

New error codes: `INVALID_ASSIGNEE`, `TICKET_CLOSED`, `ACTION_LOCKED`, `INVALID_ACTION_TRANSITION`,
`STALE_UPDATE`, `RESOLUTION_BLOCKED` (all 409); the latter carries `reasons` with codes `OWNER_MISSING`, `NO_COMPLETED_ACTION`, `OPEN_ACTIONS_REMAIN`. Every other code is a Lab 2/3 code reused unchanged.

## 9. Acceptance Criteria

Every criterion is observable and maps to at least one planned test in [`tests.md`](./tests.md) §3.

### Actions Taken

| ID | Criterion |
|---|---|
| AC-01 | Given a permitted IT Staff user and valid data, when an Action Taken is created, then it is saved under the correct Ticket with the authenticated creator as performer and the approved assignee. |
| AC-02 | Given an authenticated Requester, when dashboard data is retrieved, then only metrics and recent Tickets owned by that Requester are returned. |
| AC-03 | Given a create or update request carrying a client-supplied performer, creation time or last-updated-by, when it is processed, then those values are ignored; and given a second IT Staff user editing the Action, then `performedBy` is unchanged and `lastUpdatedBy` is the editor. |
| AC-04 | Given an empty, whitespace-only, or over-2000-character description, or a result over 2000 characters, when it is submitted, then it is rejected with a field-level message and nothing is written. |
| AC-52 | Given a `PLANNED` or `IN_PROGRESS` Action without a result, when it is created or updated, then it is accepted; given a create as `COMPLETED`, or a transition to `COMPLETED`, with no result in the request and none stored, then it is rejected with a field-level message on `result` and stays unchanged; given a stored result, then completing without resending it succeeds. |
| AC-05 | Given an action date earlier than the Ticket's creation, or in the future for an `IN_PROGRESS`/`COMPLETED` Action, when it is submitted, then it is rejected; given a future date on a `PLANNED` Action, a valid past date, or none, then it is accepted (none defaults to now). |
| AC-06 | Given follow-up required with no note, or a note with follow-up not required, when submitted, then it is rejected; given follow-up switched off on update, then the stored note is cleared. |
| AC-07 | Given attachment notes over 500 characters, when submitted, then it is rejected; given valid notes, then they are stored and rendered as plain text, and no upload route exists for Actions Taken. |
| AC-08 | Given an inactive user, a Requester or a nonexistent user as assignee, when an Action is created or updated, then it is rejected with `INVALID_ASSIGNEE` and nothing changes. |
| AC-09 | Given each permitted Action status transition, when requested, then it succeeds; given any other pair, including a no-op, when requested, then it is rejected with `INVALID_ACTION_TRANSITION`. |
| AC-10 | Given a `COMPLETED` or `CANCELLED` Action, when it is edited, then it is rejected with `ACTION_LOCKED`; and no route can delete an Action. |
| AC-11 | Given a Ticket with an Owner and Actions performed by three different IT Staff users, when the list is retrieved, then each Action shows its own performer, and an IT Staff user who is not the Owner can create and edit Actions. |
| AC-12 | Given several Actions with equal and different action times, when listed repeatedly, then the order is `actionAt` ascending then `id` ascending every time. |
| AC-13 | Given a Ticket in `CLOSED` or `CANCELLED`, when an Action is created or edited, then it is rejected with `TICKET_CLOSED`; given a `RESOLVED` Ticket, then it is accepted. |
| AC-14 | Given a Requester, when they list Actions on their own Ticket, then all are returned read-only; when they attempt create or update, then `403`; when they address another Requester's Ticket, then the response is identical to a nonexistent Ticket. |
| AC-15 | Given an Administrator, when they create or update an Action, then it succeeds; when they attempt a status change, claim/assign or Internal Note, then each is still refused (L3-AC-68). |
| AC-16 | Given the same create request sent twice with one `clientRequestId`, when processed, then exactly one Action exists and the second response returns it with `200`. |
| AC-17 | Given an Action update carrying an outdated `version`, when processed, then it is rejected with `STALE_UPDATE`, the body contains the current Action, and the other user's change is not overwritten. |

### Ticket workflow

| ID | Criterion |
|---|---|
| AC-18 | Given every transition in §5.1 and a Ticket satisfying its preconditions, when IT Staff perform it, then it succeeds and the response carries the new status and `version`. |
| AC-19 | Given a transition absent from §5.1, including a no-op, or `IN_PROGRESS` without an owner, when attempted, then it is rejected (`INVALID_TRANSITION` / `OWNER_REQUIRED`). |
| AC-20 | Given a Ticket with no `COMPLETED` Action, when Resolved is requested directly through the API, then it is rejected with `RESOLUTION_BLOCKED` naming that reason. |
| AC-21 | Given a Ticket with a `PLANNED` or `IN_PROGRESS` Action, when Resolved is requested, then it is rejected with `RESOLUTION_BLOCKED` naming that reason; given the Action then completed or cancelled, then Resolved succeeds. |
| AC-22 | Given a Ticket with no Owner, when Resolved is requested, then it is rejected with `RESOLUTION_BLOCKED` naming that reason; given an Owner, one `COMPLETED` Action and no open Actions, then it succeeds. |
| AC-23 | Given a Requester who indicated the problem appears resolved, or who calls any status route, when Resolved is considered, then the status is unchanged and the gate is unaffected. |
| AC-24 | Given each successful status change, when history is read by IT Staff, Administrator or the owning Requester, then one entry per change exists with from, to, who and when in stable order, no route can edit or delete it, and another Requester's Ticket returns `404`. |
| AC-25 | Given a status, owner or IT Priority write with an outdated `version`, when processed, then it is rejected with `STALE_UPDATE` carrying the current Ticket; given a missing `version`, then `VALIDATION_FAILED`. |
| AC-48 | Given a Resolved Ticket with a `PLANNED` or `IN_PROGRESS` Action, when Closed is requested, then it is rejected with `RESOLUTION_BLOCKED` (`OPEN_ACTIONS_REMAIN`); given none open, then Closed succeeds. |
| AC-49 | Given a Ticket with non-terminal and `COMPLETED` Actions, when it is Cancelled, then the non-terminal Actions become `CANCELLED` with `lastUpdatedBy` = the canceller and incremented `version`, `COMPLETED` Actions are unchanged, and a status-history row exists. |
| AC-50 | Given an Action create racing a Resolve for the same Ticket, when both run, then a Resolve never succeeds while an earlier-committed open Action exists (BR-39). |
| AC-26 | Given the Staff Ticket Detail status control, when it renders, then it offers only permitted transitions for the current status and, after a successful change, the Ticket summary status and history refresh without a reload. |

### Dashboards

| ID | Criterion |
|---|---|
| AC-27 | Given seeded Tickets for a Requester, when the Requester dashboard is retrieved, then Open, Waiting for Me, Recently Updated and Recently Resolved equal the values recomputed directly from the database (BR-21–BR-24). |
| AC-28 | Given seeded Tickets, when the IT Staff dashboard is retrieved, then Unassigned, Owned by Me, by-status (all eight, zeros included) and by-IT-Priority (open only) equal the database values. |
| AC-29 | Given seeded Actions, when the IT Staff dashboard is retrieved, then My Open Actions, Follow-ups Required, Urgent and Recently Updated equal the database values per BR-25–BR-27. |
| AC-30 | Given a Requester, IT Staff and Administrator, when each calls both dashboard endpoints, then only the permitted pairs return `200`, the rest `403`, and no session returns `401`. |
| AC-31 | Given an Administrator, when the staff dashboard is retrieved, then `userCounts` is present and correct; given IT Staff, then it is absent. |
| AC-32 | Given a user with no matching data, when a dashboard is retrieved, then every count is `0`, every list is empty with `total: 0`, status is `200`, and the UI shows the empty messages defined in `ui-spec.md`. |
| AC-33 | Given Tickets updated just inside and just outside the Bangkok window start, when the dashboard is retrieved, then only those inside are counted. |
| AC-34 | Given each dashboard card, when its drill-down link is followed (API query and UI route), then the list's `totalItems` equals the card's count (or, for action cards, lists exactly the Tickets counted) and a Requester's list contains only their own Tickets. |
| AC-35 | Given each role, when the shell renders and after login, then Dashboard is the first nav item, is marked `aria-current="page"` on `/dashboard`, and is the landing route; the wordmark links to it. |
| AC-36 | Given a dashboard, when it is loading, empty, forbidden, or failing, then the corresponding state is shown; metric cards expose accessible names such as "Open Tickets: 3, view list" and carry a text label (not colour only). |

### Actions Taken UI and Requester view

| ID | Criterion |
|---|---|
| AC-37 | Given Staff Ticket Detail, when it renders at desktop, tablet and mobile widths, then Actions Taken appear as a table (≥ 768 px) or stacked cards (< 768 px) with an empty state, a create form, and a view/edit mode whose editable and read-only fields are visually distinct. |
| AC-38 | Given a failed create or edit (validation, stale, network), when the response arrives, then the entered values remain in the form, the failure is shown beside them, the stale case offers the current version, and submit is disabled while pending so a double click sends one request. |
| AC-39 | Given Requester Ticket Detail on an owned Ticket, when it renders, then Actions Taken and status history are visible and read-only, no create/edit/status control exists, and no Internal Note content is present. |

### Hardening and regression

| ID | Criterion |
|---|---|
| AC-40 | Given a database holding Lab 3-shaped data, when the migration is applied, then row counts and ids of all Lab 3 tables are unchanged, every Ticket has `version = 1`, zero Actions and empty history, the CHECK constraint exists, and the recovery script restores the Lab 3 shape. |
| AC-41 | Given the seed run twice, when row counts are compared, then they are identical, and the seeded data meets every coverage row of §7.5, including documented zero and non-zero metrics. |
| AC-42 | Given the Lab 1, Lab 2 and Lab 3 server, client and E2E suites, when run on the Lab 4 codebase, then they pass; the only edits to them are the re-pointings listed in D-12, D-13, D-18 and D-27 (including seeding one `COMPLETED` Action before any transition into Resolved). |
| AC-43 | Given every major Lab 4 screen at desktop, tablet and mobile widths, when measured, then `scrollWidth <= clientWidth` holds and the `ui-spec.md` §10 checklist passes for clipping, overlap and focus. |
| AC-44 | Given the Dashboard, Staff Ticket Detail (Actions Taken) and Requester Ticket Detail, when scanned with axe-core and driven by keyboard only, then there are no serious or critical violations, focus is visible, and every Lab 4 flow is completable without a mouse. |
| AC-45 | Given an unexpected server error on any Lab 4 endpoint, when returned, then the body is the generic `INTERNAL` body with no stack, SQL or path, the UI shows a safe failure with Retry, and the main journeys log no console errors and show no placeholder text or broken link. |
| AC-46 | Given the seeded database at 1,000 Tickets and 3,000 Actions, when each dashboard and the Actions list are requested 20 times, then the median response is under 500 ms. |
| AC-51 | Given the running server, when `GET /api/health` is called, then it still returns `200 {"status":"ok","service":"TokTickIT API"}` without authentication. |
| AC-47 | Given the running server, when its routes are enumerated, then every Lab 4 route is listed in `api-spec.md` and no route exists for deleting an Action, writing history, uploading Action files, exporting, or any other §3.2 exclusion. |

### FR → AC coverage

| FR | AC | FR | AC |
|---|---|---|---|
| FR-01 | 01, 03, 04, 05, 06, 07, 13, 52 | FR-13 | 23 |
| FR-02 | 12, 37 | FR-14 | 02, 27, 32, 33, 46 |
| FR-03 | 03, 10, 11, 17, 37 | FR-15 | 28, 29, 30, 46 |
| FR-04 | 09, 10, 52 | FR-16 | 31 |
| FR-05 | 01, 08 | FR-17 | 34 |
| FR-06 | 14, 39 | FR-18 | 35 |
| FR-07 | 16 | FR-19 | 42, 51 |
| FR-08 | 15 | FR-20 | 40 |
| FR-09 | 18, 19, 26, 48, 49 | FR-21 | 41 |
| FR-10 | 20, 21, 22, 48 | FR-22 | 36, 38, 45 |
| FR-11 | 24 | FR-23 | 43, 44, 45, 47 |
| FR-12 | 17, 25, 50 | | |

## 10. Definition of Done

### 10.1 Product completion — the coding agent may claim "done" only when all hold

- [ ] Every FR in §4 is implemented and every BR in §5 is enforced on the server.
- [ ] Every AC in §9 passes, each covered by at least one automated test in `tests.md` §3.
- [ ] The §4.1 matrix is enforced by the backend on every new and changed route; no control is
      protected by UI visibility alone.
- [ ] The resolution gate (BR-17) holds against a direct API call, with a test that proves each of its
      three conditions can fail independently.
- [ ] Stale updates and duplicate submits are handled as BR-33/BR-35 describe, and each guard is
      sabotage-checked (removing the version check or the idempotency key makes its test fail).
- [ ] Every dashboard metric matches an independent database query (AC-27–AC-29) and every drill-down
      matches its count (AC-34).
- [ ] The migration applies to Lab 3-shaped data with nothing lost, the recovery script works, and the
      seed is idempotent (AC-40, AC-41).
- [ ] The full suite — unit, API/integration, UI component, UI style, responsive, authorization,
      workflow, migration/regression, performance-smoke, accessibility, E2E, and Labs 1–3 regression —
      passes on `main`, with no skipped, disabled or `.only` tests.
- [ ] Every major Lab 4 screen is verified at desktop, tablet and mobile and the `ui-spec.md` §10
      checklist is complete, with screenshots committed.
- [ ] No console errors, broken links, placeholder text, unfinished controls, or duplicate/obsolete UI
      remain; the Administrator-only and IT-Staff-only limits of §4.1 hold in the UI as well.
- [ ] `README.md` documents setup, migration (and recovery), seed, test commands and the demo script.
- [ ] Nothing from §3.2 has been built; no secret or real personal password is committed.

### 10.2 Course delivery

- [ ] `docs/lab-04/` holds `specification.md`, `ui-spec.md`, `api-spec.md`, `tests.md`, `reviewer.md`
      and `ai-use.md`.
- [ ] Test files exist at the handout §12 paths (`server/tests/lab-04/`, `client/tests/lab-04/`,
      `e2e/lab-04/`) plus the additional files named in `tests.md` §1.
- [ ] Screenshots are committed under `artifacts/lab-04/screenshots/{staff-dashboard,requester-dashboard,actions-taken}/`
      at desktop, tablet and mobile.
- [ ] Every Lab 4 Issue is Done on the Kanban board; feature branches merged into `lab4-staging` and then
      `main`.
- [ ] `reviewer.md` records reviewer identity, PR links, comments, responses and approvals; `ai-use.md`
      names the LLM and shows 6–10 key prompts with a reflection.
- [ ] Evidence is captured that this specification existed before the implementation PRs completed.
- [ ] `tests.md` Final column and §5 hold real output from `main`.

## 11. Assumptions and Decisions

| ID | Decision | Justification |
|---|---|---|
| D-01 | Action fields: `actionAt`, `description`, `result`, server-set `performedBy`, `followUpRequired`/`followUpNote`, `attachmentNotes` (text only), `lastUpdatedBy`, timestamps; limits in BR-04–BR-07. | Directly the handout §3 list; limits mirror Lab 3's 2000-character convention and bound storage. |
| D-02 | Add optional `assignee` and an Action `status` lifecycle (PLANNED → IN_PROGRESS → COMPLETED, CANCELLED from either; both terminal). Creation may start at PLANNED, IN_PROGRESS or COMPLETED. | Handout §14 Part 6 grades "assign, status transition, complete, cancel, inactive-assignee rejection" and §9.1 AC-01 names an "approved assignee", but §3's field list has neither. Both are needed to be demonstrable; starting at COMPLETED lets staff log work already done without three round trips. |
| D-03 | Actions are never deleted; non-terminal ones are editable by any IT Staff/Administrator; Ticket status changes go to an append-only `TicketStatusChange` table. | Satisfies Part 7 "append-only behavior, stable ordering" structurally and keeps an audit trail without edit-history UI. |
| D-04 | A Requester sees all Actions Taken and the status history on owned Tickets, read-only; others' Tickets are `404`. | Handout §8.3 "Requesters will see all Actions Taken items" governs over §4.3's "where approved"; `404` keeps L3-BR-13. |
| D-05 | Writes on `CLOSED`/`CANCELLED` Tickets → `409 TICKET_CLOSED`; `RESOLVED` still accepts. | Closed work must not change; Resolved may still need follow-up logging before closure. |
| D-06 | Resolution gate = Owner + ≥ 1 COMPLETED + no PLANNED/IN_PROGRESS, error `RESOLUTION_BLOCKED` with reasons. The Lab 3 matrix is kept unchanged (§5.1); only the gate is added. | Handout §4.5 requires a backend-enforced resolution rule; no reason to alter the proven matrix. |
| D-07 | `version Int` on Ticket and ActionTaken; compare-and-set; `STALE_UPDATE` returns the current resource. | Justified in §7.6; satisfies handout §6.1. |
| D-08 | `clientRequestId` UUID unique per Ticket for idempotent Action create; UI also disables submit while pending. | Handout §8.5 requires duplicate-click and network-retry safety; a key is the only approach safe against retries. |
| D-09 | Dashboards: backend-calculated, concise (counts + lists capped at 5), Asia/Bangkok, 7-day window; endpoints `/api/dashboard/requester` and `/api/dashboard/staff`; definitions BR-20–BR-32. | Handout §4.6, §6.2. Two role-checked endpoints keep each payload minimal and ownership checks simple. |
| D-10 | Legacy Tickets: version 1, zero Actions, **empty** status history (no fabricated rows); Recently Resolved is computed from history only, so legacy Resolved/Closed Tickets never appear in it. | Fabricated rows would invent who/when (§7.6) and an `updatedAt` fallback drifts whenever the Ticket is touched. Known limitation: a legacy Ticket resolved last week is not shown as recently resolved. |
| D-11 | Seed extended, idempotent, with timestamps re-anchored to run time; named zero/non-zero users in §7.5. | Handout §5.3; re-anchoring keeps the 7-day metrics meaningful on demo day. |
| D-12 | Dashboard is first nav item and landing route for every role (`/dashboard`); wordmark and `/` redirect go there. This **changes** Lab 3's `RoleLandingRedirect` (first nav item was My Tickets / Ticket Queue / User Management), the forbidden state's link target, and L3-AC-17 nav expectations. | Handout §7 and §8.1/§8.2. The Lab 3 AppShell, nav and landing tests are re-pointed, not deleted. |
| D-13 | Administrator may read the IT Staff queue, open Staff Ticket Detail and use `GET /api/staff/assignable-users`, create/update Actions Taken, and use the staff dashboard; Lab 3's other limits (status, claim, notes, comments) stand. This **changes** Lab 3 matrix row "IT Staff Ticket Queue" and Lab 3's "no Administrator ticket screen" note. | Handout §4.3 (Administrator performs IT Staff behavior) and §4.6 (reuses the dashboard) need a path to the Ticket; granting only that keeps Lab 3's separation of duties. |
| D-14 | "Recent" is calendar-based in Asia/Bangkok (today + 6 previous days) rather than a rolling 168 hours. | Handout §6.2 asks for time zone and date boundaries; calendar days are what a user means by "last 7 days" and are testable with a fixed clock. |
| D-15 | Action create/update touches `Ticket.updatedAt` but not `Ticket.version`. | Recently Updated should reflect work; a version bump would falsely conflict a staff member who only changed status concurrently with someone logging an Action. |
| D-16 | `result` is optional while an Action is `PLANNED`/`IN_PROGRESS` and required to be `COMPLETED` (BR-05). | A result only exists once work has an outcome; forcing text into a planned line produces filler ("TBD") that then masquerades as a recorded result, whereas requiring it at completion keeps handout §3's Result mandatory on every finished Action. |
| D-17 | The resolution gate counts all Actions in the Ticket's lifetime, including those from before a reopen. | A per-reopen scope is a new rule with no handout basis; a reopened Ticket with new open Actions is still blocked by condition (c). |
| D-18 | `version` is **required** on Lab 3's `PATCH /api/tickets/:id/{status,owner,it-priority}` and is returned by `GET /api/tickets/:id`. This changes the Lab 3 request contract; Lab 3 API and E2E tests that call those routes are re-pointed to send it. | Handout §6.1 requires stale detection on workflow writes; an optional version would leave the unguarded path open and defeat the guarantee. |
| D-19 | Check order BR-34: stale check precedes domain conflicts. | A stale client's domain errors would describe state it no longer sees; returning the current resource first lets it re-evaluate. |
| D-20 | Follow-up consistency also enforced by a DB `CHECK`. | Justified in §7.6. |
| D-21 | No pagination on Actions Taken or status history. | Tens of rows per Ticket; handout asks for none; avoids pagination edge cases in a sprint-limited UI. |
| D-22 | Action-based dashboard cards count Actions but link to the Ticket list containing them, with the Ticket count in the sub-label (BR-31). | Keeps "My Open Actions" meaningful (handout Part 5: current-user Actions Taken) without adding a new Actions list screen. |
| D-24 | Row-lock the Ticket (BR-39) for status changes and Action writes, in addition to `version`. | `Ticket.version` guards stale clients, not a race between an Action write and the gate read; because D-15 keeps Action writes off `version`, only a shared lock closes the window without false conflicts. |
| D-25 | Closing is refused while any Action is open (BR-40); cancelling a Ticket auto-cancels its non-terminal Actions (BR-41). | Actions can legitimately be logged on a Resolved Ticket (D-05), so closure is where leftovers must be caught; a Cancelled Ticket's pending work is moot, and leaving it `PLANNED` forever would be misleading and un-editable (BR-12). |
| D-26 | `actionAt` means when the work was or will be done (future allowed only for PLANNED); the record's `createdAt` is shown in View mode as "Logged at". | Handout §3 says "Action Date/Time" and §8.3 says "Action create date/time"; keeping both fields satisfies each reading, and a planned Action needs a schedulable time while a performed one cannot be in the future. |
| D-27 | **Consequence of the gate (D-06).** Resolution now needs a `COMPLETED` Action, which Lab 3 did not, so every earlier test or helper that moves a Ticket into Resolved (and then Closed) must first seed one `COMPLETED` Action on that Ticket. The stricter gate is kept; no earlier test is allowed to bypass it. The exact edits are listed in `tests.md` §4.2. | The handout's resolution rule (§4.5) is the point of Lab 4; weakening BR-17(b) to keep Lab 3 tests untouched would defeat it, and the edit is mechanical (one seeded row). |
| D-23 | Drill-down is done with query parameters on the existing lists (`scope`, `myActions`, `followUp`, extended `status`), not new screens. | Handout §6.2/§8.1: dashboards link to existing detailed lists; the lists gain filters, specified in `api-spec.md` §6. |
