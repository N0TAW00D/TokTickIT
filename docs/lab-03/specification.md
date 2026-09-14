# Lab 3 Sprint Engineering Specification — TokTickIT Users, Roles, IT Staff Ticketing and Admin

Sprint 3 of the TokTickIT IT-support ticketing system. This document is the frozen engineering
contract for the sprint: the AI coding agent may report completion only when §10 Definition of Done
holds in full.

Companion documents: [`api-spec.md`](./api-spec.md), [`ui-spec.md`](./ui-spec.md),
[`tests.md`](./tests.md).

---

## 1. Sprint Goal

Replace the temporary Development Requester selector with real authentication and server-enforced
role-based authorization, then deliver the first operational IT Staff workflow and a minimalist
Administrator user-management screen. At the end of the sprint a user signs in with an email address
and password, is forced to change an initial password before entering the application, and sees only
the navigation and actions their single role permits. Requesters keep every Lab 2 ticket function on
their authenticated identity and gain Public Comments; IT Staff gain a shared Ticket Queue and a
Ticket Detail screen with ownership, IT Priority, permitted status transitions, Public Comments and
Internal Notes; Administrators manage accounts.

## 2. Stakeholder Request Interpretation

The stakeholder is telling us three things.

**The fake login has to go.** The Lab 2 Development Requester dropdown was scaffolding. Identity now
comes from an authenticated session, and the client can no longer assert who it is. Every Lab 2
Requester feature must keep working, unchanged from the user's point of view, on that new identity.

**IT Staff need somewhere to work.** Until now the product only modelled submitting a ticket. IT
Staff need to find work in a shared queue, take ownership of it, triage it with a priority that is
theirs rather than the Requester's, talk to the Requester in public, keep private operational notes,
and move the ticket through a defined lifecycle. The Requester may say "this looks fixed to me", but
only IT Staff close the loop formally.

**Authorization is a backend property.** "Hiding a button is not authorization." Every protected
operation is enforced on the server against the authenticated user's role and, where relevant, their
ownership of the record. The UI hides what a role may not do because that is good feedback, not
because it is the control. Administrators and IT Staff stay conceptually separate: Administrators
manage accounts, IT Staff manage tickets.

## 3. Scope

### 3.1 Included

- Authentication: login, logout, current-user retrieval, mandatory first-login password change.
- Server-side role-based authorization for Requester, IT Staff and Administrator, plus ownership
  checks on Requester-scoped records.
- Migration of the Lab 2 `RequesterUser` records into a real `User` model without losing Ticket or
  Attachment data.
- Continued Requester ownership protection for every Lab 2 Ticket and Attachment function, on the
  authenticated identity.
- Requester Public Comments and a "Problem Appears Resolved" indication.
- IT Staff Ticket Queue with search, filters, sorting and pagination.
- IT Staff Ticket Detail: ownership claim/assign/reassign, IT Priority, permitted status
  transitions, Public Comments, Internal Notes, existing Attachments.
- Minimalist Administrator User Management: user list with search and optional role filter, create,
  edit basic account information, one-role assignment, activate/deactivate, set a new initial
  password.
- Zen Green UI extensions reusing the Lab 2 design language and components.

### 3.2 Explicitly Excluded

From handout §4.2 and §8.5, and not to be built in this sprint:

- email invitations, password-reset email, multi-factor authentication, social login, single sign-on;
- self-registration and Requester-created accounts;
- Actions Taken by IT Staff (deferred to Lab 4, together with the rule that blocks resolution while
  Actions Taken remain incomplete);
- formal SLA calculation, escalation rules, notification services;
- dashboards and KPI analytics beyond simple queue counts;
- multi-tenant organizations, departments, customer administration;
- production-grade deployment or cloud infrastructure changes;
- multiple roles assigned to one user;
- user deletion, bulk user operations, user import/export, account-history screens;
- department, organization, profile-photo and other extended user-profile management;
- email delivery of initial passwords or reset links;
- account unlocking, administrator approval workflows, advanced identity management;
- advanced user-list features: mandatory pagination, multi-column sorting, multiple simultaneous
  filters;
- editing or deleting Public Comments and Internal Notes (append-only this sprint).

## 4. Functional Requirements

### Authentication and session

| ID | Requirement |
|---|---|
| FR-01 | A user authenticates with an email address and a password. |
| FR-02 | A successful login establishes an authenticated session and returns the user's id, name, email, role and password-change state. |
| FR-03 | A failed login returns a single generic failure regardless of whether the email exists, the password is wrong, or the account is inactive. |
| FR-04 | An authenticated user can retrieve their own current identity and role. |
| FR-05 | A user can log out; the session is invalidated server-side and cannot be reused. |
| FR-06 | A user whose account is flagged as requiring a password change can call only the current-user, change-password and logout endpoints until a valid new password is saved. |
| FR-07 | Saving a valid new password clears the password-change flag and admits the user to the application. |
| FR-36 | A voluntary password change must supply the current password and is refused if it is wrong. A forced first-login change does not require it. |
| FR-08 | Sessions expire; an expired session is treated as unauthenticated. |

### Authorization

| ID | Requirement |
|---|---|
| FR-09 | Every protected endpoint rejects an unauthenticated caller before any other processing. |
| FR-10 | Every protected endpoint rejects an authenticated caller whose role is not permitted by the authorization matrix in §4.1. |
| FR-11 | Requester-scoped endpoints additionally reject a caller who is not the owner of the record. |
| FR-12 | The client's navigation shows only the destinations permitted to the authenticated role. |
| FR-13 | A response must not reveal whether a record the caller may not access exists. |

### Requester

| ID | Requirement |
|---|---|
| FR-14 | The authenticated user identity determines Requester ownership; a `requesterId` supplied by the client is ignored. |
| FR-15 | Every Lab 2 Requester function — create Ticket, My Tickets list with search/filter/sort/pagination, Ticket Detail, attachment upload/download/soft-removal — continues to work on the authenticated identity. |
| FR-16 | A Requester can post a Public Comment on a Ticket they own. |
| FR-17 | A Requester can indicate that the reported problem appears resolved on a Ticket they own. |
| FR-18 | A Requester cannot set a Ticket to Resolved or Closed. |

### IT Staff

| ID | Requirement |
|---|---|
| FR-19 | IT Staff can retrieve a shared Ticket Queue spanning all Requesters, with search, filters, sorting and pagination. |
| FR-20 | IT Staff can open any Ticket in Ticket Detail. |
| FR-21 | IT Staff can claim an unassigned Ticket, assign one, or reassign one to another permitted user. |
| FR-22 | IT Staff and Administrators can set IT Priority independently of Requested Priority. |
| FR-23 | IT Staff can move a Ticket through any transition permitted by §5.1. |
| FR-24 | IT Staff can post Public Comments on any Ticket. |
| FR-25 | IT Staff can create Internal Notes on any Ticket. |
| FR-26 | IT Staff can read Internal Notes; Requesters cannot. |
| FR-27 | Existing Attachments remain viewable and downloadable from IT Staff Ticket Detail. |

### Administrator

| ID | Requirement |
|---|---|
| FR-28 | An Administrator can list users, search them by name or email, and optionally filter by role. |
| FR-29 | An Administrator can create a user with a name, email address, one permitted role, an activation state and an initial password. |
| FR-30 | An Administrator can update a user's name, email address, role and activation state. |
| FR-31 | An Administrator can set a new initial password on any account, which that user must change at next login. |
| FR-32 | The system rejects a duplicate email address and an invalid role value. |
| FR-33 | An Administrator cannot deactivate their own account. |
| FR-34 | The system refuses any change that would leave no active Administrator. |
| FR-35 | Non-Administrator callers are refused on every Administrator endpoint. |

### 4.1 Authorization matrix

`—` = refused. "Own" = only records the authenticated user owns as Requester. Administrators do not
perform IT Staff ticket operations: the two responsibilities stay separate (handout §4.3).

| Operation | Requester | IT Staff | Administrator |
|---|---|---|---|
| Log in / log out / read own identity | ✓ | ✓ | ✓ |
| Change own password | ✓ | ✓ | ✓ |
| Create Ticket | ✓ | — | — |
| List / view Tickets | Own | All | All (read) |
| Upload / download / remove Attachment | Own | All (read) | All (read) |
| Post Public Comment | Own | All | — |
| Read Public Comments | Own | All | All |
| Indicate "Problem Appears Resolved" | Own | — | — |
| IT Staff Ticket Queue | — | ✓ | — |
| Claim / assign / reassign owner | — | ✓ | — |
| Be assigned as Ticket Owner | — | ✓ | ✓ |
| Set IT Priority | — | ✓ | ✓ |
| Change Ticket status | — | ✓ | — |
| Create Internal Note | — | ✓ | — |
| Read Internal Note | — | ✓ | ✓ |
| List / create / edit users, set initial password | — | — | ✓ |

Every Administrator entry above is required by the handout rather than chosen. BR-04 makes both
Public Comments and Internal Notes visible to Administrators, so they can read ticket threads — and
therefore the Tickets and Attachments that carry them. Handout §4.5 makes a Ticket Owner "an active
IT Staff **or Administrator** user" and lets IT Priority "be changed only by IT Staff **or
Administrator**". Everything else operational — the queue, claiming and reassigning, status
transitions, writing notes, creating tickets — stays with IT Staff, which is the separation handout
§4.3 asks for ("does not automatically need to *perform* IT Staff Ticket operations"). An
Administrator can be handed a ticket and triage its priority, but cannot work the queue or move a
ticket through its lifecycle.

These Administrator ticket permissions are **API-level only**. Lab 3 builds no Administrator ticket
screen — §6 gives the role one screen, User Management — so AC-68 is exercised by direct API call.
Nobody should build or expect an Administrator ticket UI in this sprint.

## 5. Business Rules

### Authentication and passwords

| ID | Rule |
|---|---|
| BR-01 | Only an active user with valid credentials may authenticate. |
| BR-02 | A user marked as requiring a password change cannot enter the normal application until a new valid password is saved. |
| BR-06 | Passwords are stored only as a bcrypt hash (cost 12). No endpoint, log or error message ever returns a password or a hash, and the request bodies of credential-bearing endpoints are never logged, in whole or in part. |
| BR-07 | A new password must be 8–128 characters and must differ from the password it replaces. |
| BR-42 | On the voluntary path the request must carry the current password, verified against the stored hash before any change; a wrong value is refused with `403` and the password is unchanged. On the forced first-login path the field is neither required nor accepted, since the user authenticated moments earlier. |
| BR-08 | Login failure is reported identically for an unknown email, a wrong password and an inactive account, so that account existence is not disclosed. |
| BR-09 | Email addresses are unique across all users, compared case-insensitively and stored lower-cased. |
| BR-10 | Logout invalidates the session server-side; a logged-out session token is thereafter unauthenticated. |
| BR-11 | A session expires 8 hours after it is created; an expired session is unauthenticated. |
| BR-12 | Deactivating a user invalidates that user's existing sessions. |

### Identity and ownership

| ID | Rule |
|---|---|
| BR-03 | The authenticated user identity, not a `requesterId` supplied by the client, determines ownership of Requester operations. |
| BR-13 | A Requester may read and modify only Tickets and Attachments they own. A Ticket owned by another Requester is reported exactly as a Ticket that does not exist. |
| BR-14 | Ticket `requesterId` is set at creation from the authenticated user and never changes. |

### Comments and notes

| ID | Rule |
|---|---|
| BR-04 | Public Comments are visible to the Requester who owns the Ticket, IT Staff and Administrator. Internal Notes are visible only to IT Staff and Administrator. |
| BR-15 | Public Comments and Internal Notes are append-only: no edit, no delete. |
| BR-16 | Each entry records its author and creation time from the backend; a client-supplied author or timestamp is ignored. |
| BR-17 | Comment and note content is 1–2000 characters after trimming; empty or whitespace-only content is rejected. |
| BR-18 | Content is stored as plain text and rendered as text, never as HTML. |

### Ticket ownership, priority and status

| ID | Rule |
|---|---|
| BR-05 | A Requester may indicate that the problem appears resolved, but cannot formally set the Ticket to Resolved or Closed. |
| BR-19 | A Ticket has zero or one primary Ticket Owner, who must be an active IT Staff or Administrator user. |
| BR-20 | Assigning an inactive user, a Requester, or a non-existent user as Ticket Owner is rejected. |
| BR-21 | Requested Priority is set by the Requester at creation and is never changed by IT Staff. |
| BR-22 | IT Priority is initialised to a copy of Requested Priority and may afterwards be changed only by IT Staff or Administrator (handout §4.5). |
| BR-23 | A Ticket status change is permitted only if the transition appears in the matrix in §5.1 and the caller holds a permitted role. |
| BR-24 | A Ticket must have a Ticket Owner before it may enter In Progress. |
| BR-25 | Resolved and Closed may be set only by IT Staff. Cancelled may be set only by IT Staff. |
| BR-26 | "Problem Appears Resolved" records the Requester's indication and the time it was given; it does not change Ticket status. |

### 5.1 Status transition matrix

Statuses: New, Open, In Progress, Waiting for Requester, Resolved, Closed, Reopened, Cancelled.
Every transition below is IT Staff only. A Requester changes no status (BR-05).

| From | Permitted next | Notes |
|---|---|---|
| New | Open, In Progress, Cancelled | |
| Open | In Progress, Waiting for Requester, Resolved, Cancelled | |
| In Progress | Waiting for Requester, Resolved, Cancelled | |
| Waiting for Requester | In Progress, Resolved, Cancelled | |
| Resolved | Closed, Reopened | Closing requires confirmation in the UI. |
| Closed | Reopened | Reopening requires confirmation in the UI. |
| Reopened | In Progress, Waiting for Requester, Resolved, Cancelled | |
| Cancelled | — | Terminal; cancelling requires confirmation in the UI. |

BR-24 applies to *every* row that arrives at In Progress, not only the row from New: a Ticket
without a Ticket Owner cannot enter In Progress from any state.

A transition not listed is rejected as a conflict, including a no-op transition to the current
status.

### Administrator

| ID | Rule |
|---|---|
| BR-27 | An Administrator creates a user with exactly one permitted role. A user never holds more than one role. |
| BR-28 | An Administrator may update a user's name, email address, role and activation state, and nothing else. |
| BR-29 | A duplicate email address is rejected on both create and update. |
| BR-30 | A new initial password set by an Administrator flags the account as requiring a change at next login. |
| BR-31 | An Administrator cannot deactivate their own account. Changing one's own role is not separately forbidden — handout §4.4 states the Administrator rules are "limited to" its seven items — but is still caught by BR-32 whenever it would leave no active Administrator. |
| BR-32 | No change may leave the system with zero active Administrators. |
| BR-33 | Users are deactivated, never deleted. |

### Validation, failure and regression

| ID | Rule |
|---|---|
| BR-34 | Invalid request bodies are rejected with field-level messages and no partial write. |
| BR-35 | Invalid queue query parameters are rejected as invalid input rather than silently ignored or returned as a server error. |
| BR-36 | An unexpected server error returns a safe generic message and never leaks a stack trace, SQL, or file path. |
| BR-38 | Repeated failed logins are rate-limited per email address and per source IP (10 failures in 15 minutes, then refusal for 15 minutes), and a rate-limited attempt returns the same generic body as BR-08. No account is ever locked, because handout §4.2 excludes account unlocking — the limit is time-based and self-clearing. |
| BR-39 | The current-user endpoint returns id, name, email, role and password-change state, resolved from the `User` row on every request rather than cached in the session, so that a **role change** by an Administrator takes effect on the caller's next request. **Deactivation** (BR-12) and an Administrator-issued **new initial password** (BR-41) do not surface this way — they destroy the user's sessions, so the caller's next request is unauthenticated. It never returns a hash. |
| BR-40 | Every state-changing endpoint rejects a request whose `Content-Type` is not `application/json` with `415`. This is the mechanism D-04's CSRF decision rests on. |
| BR-41 | A new session is always created at login and an existing one is never reused. A successful password change, and an Administrator setting a new initial password, delete every other session belonging to that user. |
| BR-37 | Lab 2 business rules are referenced as `L2-BR-nn` to avoid collision with this document's numbering. `L2-BR-08`, `L2-BR-09`, `L2-BR-10`, `L2-BR-11`, `L2-BR-13` and `L2-BR-38` govern the Development Requester selector, its stored client selection and the `X-Requester-Id` header, and are **repealed** by §7.4 item 8. Every other Lab 2 business rule remains in force, re-expressed against the authenticated identity. |

## 6. UI Specification Summary

Full detail, tokens, per-screen layout and the visual checklist live in [`ui-spec.md`](./ui-spec.md).
Lab 3 reuses the Zen Green design language, tokens, components, validation placement, responsive
rules and accessibility expectations established in Lab 2; new screens must read as part of the same
application.

| Screen | Modes | Notes |
|---|---|---|
| Login | view, submitting | Email + password, field validation, busy state, one generic failure message. |
| Change Password | view, submitting | Forced when the password-change flag is set, with no navigation away until saved; also reachable voluntarily from the shell menu, where the current password is required (D-12). |
| App shell | — | Authenticated user's name and role replace the Development Requester display; Logout and Change Password actions; role-specific navigation. |
| My Tickets / Create Ticket / Requester Ticket Detail | as Lab 2 | Unchanged except identity source; Ticket Detail gains Public Comments and "Problem Appears Resolved". |
| IT Staff Ticket Queue | view | Search, filters, sort, pagination; table on desktop, card list below 768 px. |
| IT Staff Ticket Detail | view, editing, submitting | Ownership, IT Priority and status controls; Public Comments and Internal Notes visually distinct; Attachments read-only. |
| Administrator User Management | list, create, edit | List with search and optional role filter; create and edit forms; set-new-initial-password action. |

Cross-cutting UI rules:

- Badges are consistent and distinct for Ticket status, Requested Priority, IT Priority and role.
- Editable fields are visually distinct from read-only fields on every screen.
- Every screen provides loading, saving, success, validation, empty, no-results, forbidden,
  not-found, conflict and safe failure feedback where meaningful (handout §8.6). The conflict state
  is what a rejected status transition (§5.1) surfaces.
- Internal Notes are visually distinct from Public Comments — different surface, an explicit
  "private" marker, and a distinct composer — so a private note cannot be posted publicly by
  mistake.
- All screens are usable at desktop (≥ 992 px), tablet (768–991 px) and mobile (< 768 px).

## 7. Data Changes

### 7.1 Models

**`User`** — evolved from Lab 2's `RequesterUser` by renaming the table, so existing rows, ids and
foreign keys survive untouched.

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK autoincrement | Unchanged from `RequesterUser`. |
| `name` | `String` | |
| `email` | `String` unique | Stored lower-cased (BR-09). |
| `passwordHash` | `String` | bcrypt, cost 12 (BR-06). |
| `role` | `Role` enum | `REQUESTER` \| `IT_STAFF` \| `ADMINISTRATOR`. One only (BR-27). |
| `isActive` | `Boolean` default `true` | Unchanged. |
| `mustChangePassword` | `Boolean` default `true` | Cleared on a successful change (FR-07). |
| `createdAt` / `updatedAt` | `DateTime` | Unchanged. |

**`Session`** — new.

| Field | Type | Notes |
|---|---|---|
| `tokenHash` | `String` PK | SHA-256 of the session token. The cookie carries the raw 256-bit token, base64url-encoded, and nothing else; the raw value is never stored, so a database leak yields no usable session. |
| `userId` | `Int` FK → `User` | `onDelete: Cascade`. |
| `expiresAt` | `DateTime` | Creation + 8 h (BR-11). |
| `createdAt` | `DateTime` | |

Expired rows are deleted opportunistically whenever a session is resolved for the owning user, so
the table does not grow without bound.

**`Ticket`** — extended.

| Field | Type | Notes |
|---|---|---|
| `ownerId` | `Int?` FK → `User` | Primary Ticket Owner; null = unassigned (BR-19). |
| `itPriority` | `Priority` | Backfilled from `requestedPriority` (BR-22). |
| `requesterResolvedAt` | `DateTime?` | Set by "Problem Appears Resolved" (BR-26). |
| `status` | `TicketStatus` | Enum extended to the eight statuses in §5.1. |

**`PublicComment`** and **`InternalNote`** — new, identical shape.

| Field | Type | Notes |
|---|---|---|
| `id` | `Int` PK autoincrement | |
| `ticketId` | `Int` FK → `Ticket` | `onDelete: Cascade`. |
| `authorId` | `Int` FK → `User` | `onDelete: Restrict` (BR-16). |
| `body` | `String` | 1–2000 characters after trimming (BR-17). |
| `createdAt` | `DateTime` default `now()` | |

### 7.2 Relationships

- one `User` (Requester) → many `Ticket` as `requester`; one `User` (IT Staff) → many `Ticket` as
  `owner`; both relations point at the same table and are named to disambiguate.
- one `Ticket` → many `PublicComment`, many `InternalNote`, many `Attachment`.
- one `User` → many `PublicComment`, many `InternalNote` as author.
- Categories, Related Systems, Tickets and Attachments keep their Lab 2 relationships.

### 7.3 Indexes

| Index | Why |
|---|---|
| `User(email)` unique | Login lookup and BR-09. |
| `User(role, isActive)` | Administrator role filter and the last-active-Administrator check (BR-32). |
| `Session(tokenHash)` PK | Session resolution on every authenticated request. |
| `Session(userId)` | Bulk invalidation on logout-all and deactivation (BR-12). |
| `Ticket(itPriority, createdAt)` | The default queue ordering in §8 (IT Priority desc, created date asc). |
| `Ticket(status)` | Queue filter by status. |
| `Ticket(ownerId)` | Queue filter by owner and "unassigned". |
| existing `Ticket(requesterId, …)` | Retained for My Tickets. |
| `PublicComment(ticketId, createdAt)`, `InternalNote(ticketId, createdAt)` | Thread retrieval in order. |

### 7.4 Migration decisions

1. `RequesterUser` is **renamed** to `User`, not copied. A rename preserves every row, every id and
   every existing foreign key from `Ticket.requesterId` and `Attachment.removedById`, so no Lab 2
   ticket or attachment can be orphaned. **Prisma will not generate this on its own** — it has no
   model-rename detection and emits `DROP TABLE "RequesterUser"` + `CREATE TABLE "User"`, destroying
   the rows this decision exists to protect. The generated SQL is replaced by hand with
   `ALTER TABLE "RequesterUser" RENAME TO "User";`, and the migration is verified against a database
   holding Lab 2 rows before it is merged.
2. Adding `Ticket.owner → User` creates a second relation between `Ticket` and `User`, which Prisma
   rejects while both are unnamed. The existing relation gains `@relation("TicketRequester")` and the
   new one takes `@relation("TicketOwner")`.
3. `role` is added with default `REQUESTER`, correctly classifying every migrated Lab 2 record.
4. `passwordHash` is added in three steps, because `ADD COLUMN … NOT NULL` without a default fails on
   a populated table: add nullable → `UPDATE` every row with the hash of a documented
   local-development initial password → `SET NOT NULL`. `mustChangePassword` defaults to `true`, so
   every migrated Requester must choose a new password at first login (handout §5.2).
5. `Ticket.itPriority` is added by the same three steps — add nullable →
   `UPDATE … SET "itPriority" = "requestedPriority"` → `SET NOT NULL` — so no ticket has a null IT
   Priority (BR-22).
6. Existing emails are lower-cased for BR-09. The Lab 2 `email` unique constraint is
   case-*sensitive*, so the migration first detects case-insensitive duplicates and fails loudly if
   any exist, then runs `UPDATE "User" SET email = lower(email)`, then replaces the constraint with a
   unique index on `lower(email)`, so BR-09 is enforced by the database and not by application code
   alone. **This index has no declarative Prisma representation** — `schema.prisma` can only express
   `email String @unique` — so it lives in hand-written migration SQL and is invisible to
   `prisma migrate`'s diffing. It is therefore recorded here, asserted by a migration test, and must
   be re-checked whenever the `User` model changes, or a later generated migration will silently
   restore a case-sensitive constraint and reopen the duplicate-email hole.
7. `TicketStatus` gains the seven new values; every existing Lab 2 ticket stays `NEW`, which remains
   valid in the new matrix.
8. The Development Requester selector, its `GET /api/requesters` endpoint, the `X-Requester-Id`
   middleware and the client's stored selection are deleted in the same sprint (#70). This repeals
   Lab 2 `L2-BR-08`, `L2-BR-09`, `L2-BR-10`, `L2-BR-11`, `L2-BR-13` and `L2-BR-38` (BR-37).

### 7.5 Seed data (idempotent, `upsert` by email — safe to re-run)

- 4 active Requesters and 1 inactive Requester;
- 3 active IT Staff and 1 inactive IT Staff;
- 2 active Administrators — one more than handout §5.3's minimum, so that AC-53 (self-deactivation)
  and AC-54 (last active Administrator) can be exercised independently rather than firing on the
  same request;
- Tickets spread across Requesters, all eight statuses, all three priorities, and both assigned and
  unassigned ownership. The seed writes status directly and is exempt from the transition matrix in
  §5.1; seeded In Progress and Waiting for Requester rows carry a Ticket Owner so they satisfy
  BR-24;
- example Public Comments and Internal Notes containing no sensitive information.

All seeded accounts share a single documented local-development password and are flagged
`mustChangePassword: false` so the seed is usable for manual testing. These credentials are for
local development only and are documented in `README.md`. No real personal password or secret is
committed.

## 8. API Contract

Full request and response shapes, validation detail and error bodies are specified in
[`api-spec.md`](./api-spec.md). This section freezes the surface and the decisions that document
implements.

### 8.1 Endpoint summary

| Method & path | Purpose | Role | Statuses |
|---|---|---|---|
| `POST /api/auth/login` | Authenticate, issue session | public | 200, 400, 401, 415, 429 |
| `POST /api/auth/logout` | Invalidate session | any authenticated | 204, 401 |
| `GET /api/auth/me` | Current identity, role, password-change state | any authenticated | 200, 401 |
| `POST /api/auth/change-password` | Save a new password, clear the flag | any authenticated | 204, 400, 401, 403, 415 |
| `POST /api/tickets` | Create Ticket | Requester | 201, 400, 401, 403, 415 |
| `GET /api/tickets` | My Tickets (owned) | Requester | 200, 400, 401, 403 |
| `GET /api/tickets/:id` | Ticket Detail | Requester (own), IT Staff, Admin | 200, 401, 403, 404 |
| `GET /api/tickets/:id/attachments` … | Lab 2 attachment lifecycle | as Lab 2, on authenticated identity | as Lab 2, plus 401/403 |
| `GET /api/tickets/:id/comments` | Read Public Comments | Requester (own), IT Staff, Admin | 200, 401, 403, 404 |
| `POST /api/tickets/:id/comments` | Post Public Comment | Requester (own), IT Staff | 201, 400, 401, 403, 404, 415 |
| `POST /api/tickets/:id/requester-resolved` | Indicate problem appears resolved | Requester (own) | 204, 401, 403, 404, 415 |
| `GET /api/staff/tickets` | IT Staff Ticket Queue | IT Staff | 200, 400, 401, 403 |
| `PATCH /api/tickets/:id/owner` | Claim, assign, reassign | IT Staff | 200, 400, 401, 403, 404, 415 |
| `PATCH /api/tickets/:id/it-priority` | Set IT Priority | IT Staff, Admin | 200, 400, 401, 403, 404, 415 |
| `PATCH /api/tickets/:id/status` | Permitted status transition | IT Staff | 200, 400, 401, 403, 404, 409, 415 |
| `GET /api/tickets/:id/notes` | Read Internal Notes | IT Staff, Admin | 200, 401, 403, 404 |
| `POST /api/tickets/:id/notes` | Create Internal Note | IT Staff | 201, 400, 401, 403, 404, 415 |
| `GET /api/users` | User list, search, optional role filter | Admin | 200, 400, 401, 403 |
| `POST /api/users` | Create user with one role | Admin | 201, 400, 401, 403, 409, 415 |
| `PATCH /api/users/:id` | Update name, email, role, activation | Admin | 200, 400, 401, 403, 404, 409, 415 |
| `POST /api/users/:id/initial-password` | Set a new initial password | Admin | 204, 400, 401, 403, 404, 415 |

The Lab 2 attachment codes `410` (already removed), `413` (too large) and `415` (unsupported type)
remain in force unchanged on the attachment endpoints (FR-15).

### 8.2 Decisions

**Authentication mechanism.** An opaque random session token is issued at login and delivered in an
`httpOnly`, `SameSite=Lax`, `Path=/` cookie, `Secure` when served over HTTPS. The server stores only
a SHA-256 hash of the token in `Session`. A JWT was rejected because the handout requires logout
invalidation, and a stateless token cannot be revoked without adding a denylist — which is a session
table with extra steps. Session rows give real invalidation for logout (BR-10) and deactivation
(BR-12) at the cost of one indexed lookup per request.

**Password hashing.** bcrypt at cost 12, via the `bcrypt` package. Chosen over Argon2id for its
first-class support in the course's Node stack and its absence of native-build friction; cost 12 is
the current practical default and is a single constant to raise later.

**CSRF.** `SameSite=Lax` blocks the cross-site form posts that matter here, and every state-changing
call is a same-origin `fetch` sending JSON, which a cross-site form cannot forge. No separate CSRF
token is introduced; the decision and its limits are recorded in `api-spec.md`.

**Safe errors.** Every protected endpoint distinguishes `401` unauthenticated, `403` authenticated
but forbidden, `400` invalid input, `404` missing, `409` conflict, `415` wrong content type, `429`
rate-limited and `500` unexpected.

*Precedence between `403` and `404`.* Three cases, in this order:

1. **Role-gated collection** the caller's role may never reach → `403` before any lookup. No record
   is addressed, so nothing can leak. Example: a Requester calling `GET /api/staff/tickets`.
2. **Record-addressed, and the caller has no read path to that record** → `404`, never `403`, so
   existence is not disclosed (BR-13, FR-13). Examples: a Requester calling `GET /api/tickets/:id`
   for another Requester's Ticket, or `GET /api/tickets/:id/notes` (AC-04) — both indistinguishable
   from a Ticket that does not exist.
3. **Record-addressed, the caller *can* already read that record, but lacks this particular write
   permission** → `403`. Existence is already known to this caller through a permitted read path, so
   `403` discloses nothing new and is the honest code. Example: an Administrator, who may read any
   Ticket (§4.1), calling `PATCH /api/tickets/:id/status` (AC-68).

This is why §8.1 lists both `403` and `404` on record-addressed routes: which one applies depends on
whether the caller has a read path to the record. A `403` therefore never carries record-level
information the caller did not already hold.

**Queue query behaviour.** Searchable: ticket number and summary. Filterable: status, IT Priority,
category, owner (including an explicit "unassigned"). Sortable: created date, last updated, IT
Priority, ticket number. Default ordering: IT Priority descending, then created date ascending, so
the oldest most-urgent work surfaces first. Page size 20, maximum 100; the response carries page,
pageSize, totalItems and totalPages. An unknown sort field, an out-of-range page size or a
malformed filter is a `400` (BR-35).

## 9. Acceptance Criteria

Every criterion is observable and maps to at least one planned test in [`tests.md`](./tests.md).

### Authentication

| ID | Criterion |
|---|---|
| AC-01 | Given an active user with valid credentials, when the user logs in, then the backend establishes authenticated access and returns the permitted user identity and role. |
| AC-02 | Given a user who must change the initial password, when login succeeds, then normal application screens remain unavailable until a valid new password is saved. |
| AC-70 | Given a session whose password-change flag is set, when any endpoint other than current-user, change-password or logout is called directly, then it is refused regardless of role (FR-06). |
| AC-05 | Given a wrong password, an unknown email, and an inactive account, when each is submitted, then all three produce the same status code and the same message body. |
| AC-06 | Given a login request in flight, when the user waits, then the submit control is disabled and a busy indication is shown. |
| AC-07 | Given a new password shorter than 8 or longer than 128 characters, when it is submitted, then it is rejected with a field-level message and the flag stays set. |
| AC-08 | Given a new password identical to the current one, when it is submitted, then it is rejected. |
| AC-09 | Given a successful password change, when it completes, then the flag is cleared and the application opens. |
| AC-10 | Given an authenticated session, when the user logs out and then calls a protected endpoint with the same token, then the call is unauthenticated. |
| AC-11 | Given a session older than 8 hours, when it is used, then it is unauthenticated. |
| AC-12 | Given an active session, when an Administrator deactivates that user, then the user's next request is unauthenticated. |
| AC-13 | Given any successful authentication response, when it is inspected, then it contains no password and no hash. |
| AC-59 | Given an authenticated session, when the current-user endpoint is called, then it returns id, name, email, role and password-change state; with no session it returns 401. |
| AC-60 | Given a user whose **role** an Administrator has just changed, when that user's next request is served, then the new role is in effect without re-login (BR-39). Deactivation and an Administrator-set initial password instead end in 401 on the next request, per AC-12 and AC-64. |
| AC-61 | Given a login response, when it is inspected, then it carries the password-change state that AC-02 depends on. |
| AC-62 | Given 10 failed logins for one email within 15 minutes, when an 11th is attempted, then it is refused with the same generic body as AC-05, and the account is not locked once the window passes. The same holds for the per-source-IP limit, exercised with failures spread across different email addresses from one source. |
| AC-63 | Given a state-changing request whose Content-Type is not `application/json`, when it is sent, then it is rejected with 415 (BR-40). |
| AC-64 | Given a user with two active sessions, when the password is changed on one, then the other session is unauthenticated (BR-41). |
| AC-69 | Given a voluntary password change with a wrong current password, when it is submitted, then it is refused with 403 and the password is unchanged; given the forced first-login path, when no current password is sent, then the change succeeds (BR-42). |

### Authorization

| ID | Criterion |
|---|---|
| AC-14 | Given no session, when any protected endpoint is called, then it returns 401 without performing the operation. |
| AC-15 | Given an authenticated caller whose role is not permitted, when a protected endpoint is called, then it returns 403 without performing the operation. |
| AC-03 | Given an authenticated Requester, when the client supplies another requesterId, then the backend still applies the authenticated identity and does not return another Requester's data. |
| AC-16 | Given a Requester, when they request another Requester's Ticket and a Ticket that does not exist, then both responses are identical. |
| AC-17 | Given each of the three roles, when the shell renders, then navigation contains only that role's permitted destinations. |
| AC-18 | Given a Requester who navigates directly to an IT Staff or Administrator route, when the route loads, then a forbidden state is shown and, asserted by request interception, no request to a protected endpoint is issued. |

### Requester regression, Public Comments, resolution indication

| ID | Criterion |
|---|---|
| AC-19 | Given an authenticated Requester, when the Lab 2 regression suites are re-run against the authenticated identity, then every Lab 2 acceptance criterion still carried by BR-37 passes unchanged. Each Lab 2 journey — create Ticket, My Tickets search/filter/sort/pagination, Ticket Detail, attachment upload/download/soft-removal — is asserted by its own Lab 2 test, re-pointed rather than rewritten. |
| AC-20 | Given the client, when any screen is inspected, then no Development Requester selector, Change Requester action or stored requester selection exists. |
| AC-21 | Given a Requester on a Ticket they own, when they post a Public Comment, then it is stored with the backend's author and timestamp and appears in the thread. |
| AC-22 | Given comment content that is empty or whitespace-only, when it is submitted, then it is rejected. |
| AC-23 | Given comment content longer than 2000 characters, when it is submitted, then it is rejected. |
| AC-24 | Given a Requester on a Ticket they own, when they indicate the problem appears resolved, then the indication and its time are recorded and the Ticket status is unchanged. |
| AC-25 | Given a Requester, when they attempt to set a Ticket to Resolved or Closed by any endpoint, then it is refused. |

### IT Staff Ticket Queue

| ID | Criterion |
|---|---|
| AC-26 | Given IT Staff, when the queue is retrieved, then it spans all Requesters and is ordered by IT Priority descending then created date ascending by default. |
| AC-27 | Given a search term, when it matches a ticket number or a summary, then only matching Tickets are returned. |
| AC-28 | Given each supported filter (status, IT Priority, category, owner, unassigned), when applied, then only matching Tickets are returned. |
| AC-29 | Given each supported sort field and direction, when applied, then the ordering changes accordingly. |
| AC-30 | Given a paginated request, when it is returned, then the response carries page, pageSize, totalItems and totalPages, and the page holds at most pageSize rows. |
| AC-31 | Given an unknown sort field, a page size above 100, or a malformed filter value, when submitted, then the response is 400. |
| AC-32 | Given a queue with unassigned and assigned Tickets, when it renders, then an unassigned row carries the explicit "Unassigned" owner token defined in `ui-spec.md` and an assigned row carries the owner's name, so a component test can assert the difference without reading colour. |
| AC-33 | Given an empty queue and a search matching nothing, when each renders, then distinct empty and no-results states are shown. |

### IT Staff Ticket Detail

| ID | Criterion |
|---|---|
| AC-34 | Given an unassigned Ticket, when IT Staff claim it, then they become the Ticket Owner. |
| AC-35 | Given an assigned Ticket, when IT Staff reassign it to another active IT Staff user, then the owner changes. |
| AC-36 | Given an inactive user, a Requester, or a non-existent user, when assigned as Ticket Owner, then the operation is rejected. |
| AC-37 | Given a Ticket, when IT Staff change IT Priority, then IT Priority changes and Requested Priority does not. |
| AC-38 | Given every transition listed in §5.1 and a Ticket satisfying that row's stated precondition, when IT Staff perform it, then it succeeds. |
| AC-39 | Given a transition absent from §5.1, including a transition to the current status, when attempted, then it is rejected as a conflict. |
| AC-40 | Given a Ticket with no owner, when IT Staff attempt to set In Progress, then it is rejected. |
| AC-41 | Given IT Staff, when they create an Internal Note, then it is stored with the backend's author and timestamp. |
| AC-04 | Given a Requester account, when an Internal Note endpoint is requested, then the operation is rejected without exposing note content. |
| AC-65 | Given IT Staff, when they post a Public Comment on a Ticket they do not own, then it succeeds and is visible to the Requester (FR-24). |
| AC-66 | Given IT Staff, when they read the Internal Notes of any Ticket, then the notes are returned (FR-26). |
| AC-67 | Given IT Staff, when they open any Ticket in the queue regardless of Requester, then Ticket Detail loads (FR-20). |
| AC-68 | Given an Administrator, when they set IT Priority on a Ticket, then it succeeds; when they attempt a status transition, claim, or note creation, then each is refused (§4.1). |
| AC-42 | Given IT Staff Ticket Detail, when Public Comments and Internal Notes render, then the note thread carries the distinct surface class, the private badge and the separate composer defined in `ui-spec.md`, none of which appear on the comment thread. |
| AC-43 | Given a Lab 2 Ticket with Attachments, when IT Staff open it, then the Attachments are listed and downloadable. |
| AC-44 | Given a Requester who indicated the problem appears resolved, when IT Staff open the Ticket, then that indication is visible. |

### Administrator User Management

| ID | Criterion |
|---|---|
| AC-45 | Given an Administrator, when the user list is retrieved, then it shows Name, Email, Role, Status and an Edit action for each user. |
| AC-46 | Given a search term, when it matches a name or an email, then only matching users are returned. |
| AC-47 | Given a role filter, when applied, then only users holding that role are returned. |
| AC-48 | Given valid input, when an Administrator creates a user with one role and an initial password, then the account exists, is flagged to change its password, and can log in. |
| AC-49 | Given an email already in use, when a user is created or updated with it, then the operation is rejected with a clear message. |
| AC-50 | Given an invalid role value, when submitted, then the operation is rejected. |
| AC-51 | Given an existing user, when an Administrator updates name, email, role and activation state, then all four change. |
| AC-52 | Given a user, when an Administrator sets a new initial password, then that user's next login requires a password change before the application opens. |
| AC-53 | Given an Administrator, when they attempt to deactivate their own account, then it is rejected. |
| AC-54 | Given the last active Administrator, when any change would leave no active Administrator, then it is rejected. |
| AC-55 | Given a Requester and an IT Staff user, when each calls any Administrator endpoint, then both are refused. |

### Cross-cutting

| ID | Criterion |
|---|---|
| AC-56 | Given every major Lab 3 screen at desktop, tablet and mobile widths, when measured, then `document.documentElement.scrollWidth <= clientWidth` holds and the `ui-spec.md` visual checklist passes for clipping, overlap and focus. |
| AC-57 | Given an unexpected server error, when it is returned, then the body carries a generic message and no stack trace, SQL or file path. |
| AC-58 | Given the repository, when it is inspected, then no production secret, database credential or real personal password is committed. The sole credential present is the documented local-development seed password, which grants access to no non-local system. |

## 10. Definition of Done

### 10.1 Product completion — the coding agent may claim "done" only when all hold

- [ ] Every FR in §4 is implemented and every BR in §5 is enforced on the server.
- [ ] Every AC in §9 passes, each covered by at least one automated test in `tests.md`.
- [ ] The authorization matrix in §4.1 is enforced by the backend for every protected operation;
      no control is protected by UI visibility alone.
- [ ] The migration applies to a database holding Lab 2 data with every Ticket and Attachment
      intact and correctly owned; the seed is idempotent across repeated runs.
- [ ] No Development Requester selector, `GET /api/requesters` endpoint, `X-Requester-Id`
      middleware or stored client selection remains in the codebase.
- [ ] Passwords exist only as bcrypt hashes; no secret is committed.
- [ ] The full suite — unit, API/integration, UI component, UI style, responsive,
      security/authorization, migration/regression and E2E — passes, with no skipped, disabled or
      `.only` tests.
- [ ] Every major screen is verified at desktop, tablet and mobile, and the visual checklist in
      `ui-spec.md` is complete.
- [ ] Nothing from §3.2 has been built.

### 10.2 Course delivery

- [ ] `docs/lab-03/` holds `specification.md`, `ui-spec.md`, `api-spec.md`, `tests.md`,
      `reviewer.md` and `ai-use.md`.
- [ ] Test files exist at the handout §12 paths: `server/tests/lab-03/`, `client/tests/lab-03/`,
      `e2e/lab-03/`.
- [ ] Screenshots are committed under `artifacts/lab-03/screenshots/` in the four required
      subfolders, at all three widths.
- [ ] Every Lab 3 Issue is Done on the Kanban board, with feature branches merged into
      `lab3-staging` and then `main`.
- [ ] `reviewer.md` records reviewer identity, PR links, comments, responses and approvals.
- [ ] `ai-use.md` names the LLM and shows 6–10 key prompts with a reflection.
- [ ] Evidence is captured that this specification existed before the implementation PRs were
      completed (handout §14 Part 2).
- [ ] `README.md` and `.gitignore` are current.

## 11. Assumptions and Decisions

| ID | Decision | Justification |
|---|---|---|
| D-01 | bcrypt cost 12 for password hashing. | First-class support in the course's Node stack, no native-build friction, and a single constant to raise later. |
| D-02 | Server-side `Session` rows with an opaque token in an httpOnly cookie, not a JWT. | The handout requires logout invalidation; a stateless token cannot be revoked without a denylist, which is a session table with extra steps. |
| D-03 | Sessions expire 8 hours after creation, absolute rather than sliding. | Matches a working day; absolute expiry is simpler to reason about and to test than idle timeout. |
| D-04 | No dedicated CSRF token; `SameSite=Lax` plus same-origin JSON `fetch`, enforced by BR-40. | A cross-site form cannot send `Content-Type: application/json`, and Lax blocks the cross-site posts that matter. This only holds because BR-40 makes the server *reject* any other content type — without that enforcement the argument is void. Recorded with its limits so it can be revisited if a cross-origin client appears. |
| D-05 | Password policy: 8–128 characters, must differ from the previous one. | The handout requires "password rules" and justified limits without specifying them; length is the rule with real strength benefit, and composition rules mainly harm usability. |
| D-06 | `RequesterUser` is renamed to `User` rather than copied. | Preserves every row, id and foreign key, so no Lab 2 Ticket or Attachment can be orphaned. |
| D-07 | A Ticket must have an owner before entering In Progress (BR-24). | "In Progress" asserts somebody is working on it; unassigned work in progress is not meaningful. |
| D-08 | Cancelled is IT Staff only and terminal; Requesters cannot cancel. | The handout gives Requesters no status authority (BR-05) and lists no cancellation path back. |
| D-09 | The Administrator role is read-mostly on Tickets: read Tickets, Attachments, Public Comments and Internal Notes; set IT Priority; be assigned as Ticket Owner. No queue, no claiming, no status transitions, no writing notes or comments. | Every permission granted is one the handout states outright — BR-04 for both threads, §4.5 for Ticket Owner and IT Priority — and reading a thread requires reading the Ticket that carries it. Everything withheld is what §4.3 means by not *performing* IT Staff ticket operations. |
| D-10 | Default queue ordering is IT Priority descending, then created date ascending. | Surfaces the oldest most-urgent work first, which is what a queue is for. |
| D-11 | Comment and note bodies are 1–2000 characters, stored and rendered as plain text. | Long enough for a real operational note, short enough to bound storage and rendering; text-only rendering removes the injection surface (BR-18). |
| D-12 | §7's "permitted profile/password actions" is resolved as **in scope, minimally**: the shell exposes Change Password, which reuses the screen the mandatory first-login flow already requires. A voluntary change must supply the current password; the forced first-login change need not, since the user authenticated moments earlier. Profile editing stays Administrator-only. | Handout §7 asks the shell to "provide Logout and permitted profile/password actions", and the standing rule is not to deliver less than the sheet defines. The screen and endpoint exist regardless, so honouring the bullet costs one route and one menu entry — whereas dropping it would be the only place the contract delivers less than a handout bullet. Requiring the current password on the voluntary path stops a hijacked session becoming permanent account takeover; §8.5's exclusions (deletion, history, recovery workflows) are untouched. |
| D-15 | Failed logins are rate-limited on a self-clearing time window (BR-38), never locked. | Handout §4.4 requires a rule for login attempts while §4.2 excludes account unlocking; a lockout would need the unlock workflow the handout forbids. A time window satisfies both, and without it the spec would ship unlimited online guessing against an 8-character minimum. |
| D-13 | Seeded accounts share one documented local-development password with `mustChangePassword: false`. | Keeps the seed immediately usable for manual testing and demos; the credential is local-only and documented in `README.md`. |
| D-14 | Three-case precedence for `403` vs `404` (§8.2): role-gated collection → `403`; record the caller cannot read → `404`; record the caller can read but may not write → `403`. | Required by FR-13 and BR-13: a `403` on a record the caller may not see would confirm it exists. The two `403` cases are safe because neither discloses anything the caller did not already have — no record is addressed in the first, and the record is already readable in the second. A flat "always 404" rule would contradict §8.1's own status lists and make an Administrator's refused write indistinguishable from a missing ticket. |
