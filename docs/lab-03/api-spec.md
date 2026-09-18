# Lab 3 API Contract — Authentication, Authorization, IT Staff and Admin

Implements the endpoint surface frozen in [`specification.md`](./specification.md) §8.1 and the
decisions in §8.2. Lab 2's contract ([`../lab-02/api-spec.md`](../lab-02/api-spec.md)) remains in
force for the Requester ticket and attachment endpoints except where §9 of this document states a
change.

---

## 1. Conventions

### 1.1 Base URL and format

Same as Lab 2: all routes under `/api`, JSON request and response bodies, UTF-8. Timestamps are ISO
8601 UTC strings.

### 1.2 Authentication (replaces Lab 2 §1.2 `X-Requester-Id`)

Authentication is a **server-side session**, not a token the client can read.

| Property | Value |
|---|---|
| Cookie name | `toktickit.sid` |
| Cookie value | 256 bits of CSPRNG randomness, base64url-encoded. Nothing else — no user id, no signature. |
| Attributes | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when served over HTTPS, `Max-Age` 28800 (8 h) |
| Server storage | `Session.tokenHash` = SHA-256 of the cookie value. The raw value is never stored (BR-06). |
| Expiry | Absolute, 8 h from creation (BR-11, FR-08). No sliding renewal; an expired session is `401 UNAUTHENTICATED`, identical to no session at all (AC-11). |

Resolution on every request: hash the cookie value → look up `Session` → reject if absent or
`expiresAt` has passed → load the `User` row fresh and read `role`, `isActive` and
`mustChangePassword` from it, never from the session (BR-39). An inactive user's session rows are
already deleted (BR-12), so this is belt-and-braces.

**The `X-Requester-Id` header is gone.** It is not read, not honoured, and not an error — a request
carrying it is treated exactly as one that does not (BR-03). `GET /api/requesters` is deleted.

### 1.3 Standard error body

Identical shape to Lab 2 §1.3:

```json
{
  "error": "VALIDATION_FAILED",
  "message": "One or more fields are invalid.",
  "fields": [
    { "field": "email", "message": "Enter a valid email address." }
  ]
}
```

- `error` — stable machine code from the §8 catalogue. Never free text, never absent.
- `message` — safe generic human text; never a stack trace, SQL, file path or raw exception (BR-36).
- `fields` — present **only** for `VALIDATION_FAILED` and `INVALID_QUERY`; omitted entirely
  otherwise, so a test may assert `!('fields' in body)`.

### 1.4 Authorization, existence and the 403/404 rule

Applies `specification.md` §8.2 verbatim. Three cases, checked in this order:

| Case | Code |
|---|---|
| No session, or an expired/unknown one, on a protected route | `401 UNAUTHENTICATED` |
| Role-gated **collection** the caller's role may never reach | `403 FORBIDDEN`, before any lookup |
| Record-addressed, caller has **no read path** to that record | `404 NOT_FOUND` |
| Record-addressed, caller **can read** it but may not perform this write | `403 FORBIDDEN` |

So: a Requester calling `GET /api/staff/tickets` gets `403`; a Requester calling
`GET /api/tickets/:id` for someone else's ticket, or `GET /api/tickets/:id/notes` at all, gets a
**byte-identical** `404` to a ticket that does not exist; an Administrator — who may read any ticket
— calling `PATCH /api/tickets/:id/status` gets `403`.

A non-integer path parameter is a `404`, as in Lab 2 §1.4.

### 1.5 Password-change gate

While the authenticated user has `mustChangePassword = true`, every route except
`GET /api/auth/me`, `POST /api/auth/change-password` and `POST /api/auth/logout` returns
`403 PASSWORD_CHANGE_REQUIRED` regardless of role (FR-06, AC-70). The gate is checked after
authentication and before authorization.

### 1.6 Request body content type

Every state-changing endpoint requires `Content-Type: application/json` and returns
`415 UNSUPPORTED_MEDIA_TYPE` otherwise (BR-40). This is the mechanism D-04's CSRF decision rests on,
so it is enforced centrally, not per route. Attachment upload keeps Lab 2's `multipart/form-data`
requirement.

### 1.7 Status codes used

| Code | Meaning in this API |
|---|---|
| `200` | Successful retrieval or update. |
| `201` | User, comment or note created. |
| `204` | Logout, password change, resolution indication, initial-password set — no body. |
| `400` | Validation failure, malformed query, malformed body. |
| `401` | No session, expired session, or invalid credentials at login. |
| `403` | Authenticated but forbidden; wrong current password; password-change gate. |
| `404` | Unknown record, or a record the caller has no read path to. |
| `409` | Duplicate email, forbidden status transition, last-active-Administrator, self-deactivation. |
| `413` / `415` / `410` | Lab 2 attachment codes, unchanged (FR-15), plus `415` for wrong content type. |
| `429` | Login rate limit (BR-38). |
| `500` | Unexpected failure; generic `INTERNAL` body only. |

`422` is intentionally not used, matching Lab 2.

---

## 2. Authentication endpoints

### 2.1 `POST /api/auth/login`

- **Auth:** none.
- **Body:** `{ "email": string, "password": string }`

**200:**

```json
{
  "id": 7,
  "name": "Suda Chaiyaporn",
  "email": "suda.c@toktickit.local",
  "role": "IT_STAFF",
  "mustChangePassword": false
}
```

Sets `toktickit.sid`. A new session row is always created; an existing one is never reused (BR-41).

- **401 `INVALID_CREDENTIALS`** — wrong password, unknown email, **or** an inactive account. All
  three return the byte-identical body `{"error":"INVALID_CREDENTIALS","message":"We couldn't sign
  you in. Check your email and password and try again."}` (BR-08, AC-05). No timing branch that
  would distinguish them: an unknown email still runs a bcrypt comparison against a dummy hash.
- **429 `RATE_LIMITED`** — 10 failures for one email, or from one source IP, within 15 minutes.
  Body is the **same** as `INVALID_CREDENTIALS` apart from the code, and the window self-clears; no
  account is locked (BR-38, AC-62).
- **400 `VALIDATION_FAILED`** — missing or malformed email, missing password.
- **415**, **500**.
- **Traceability:** FR-01, FR-02, FR-03; BR-01, BR-06, BR-08, BR-38, BR-41; AC-01, AC-05, AC-13,
  AC-61, AC-62.

### 2.2 `POST /api/auth/logout`

- **Auth:** any authenticated user (allowed through the §1.5 gate).
- **Body:** none.
- **204:** the session row is **deleted** — not merely expired — and the cookie is cleared with
  `Max-Age=0`. A subsequent request with the same cookie is `401` (BR-10, AC-10).
- **401** if there was no valid session to begin with.
- **Traceability:** FR-05; BR-10; AC-10.

### 2.3 `GET /api/auth/me`

- **Auth:** any authenticated user (allowed through the §1.5 gate).
- **200:** the same body shape as login, re-read from the `User` row on every call, so an
  Administrator's role change takes effect on the caller's next request without re-login (BR-39).
  Never contains `passwordHash`.
- **401** with no session.
- **Traceability:** FR-04; BR-39; AC-59, AC-60, AC-13.

### 2.4 `POST /api/auth/change-password`

- **Auth:** any authenticated user (allowed through the §1.5 gate).
- **Body — forced path** (`mustChangePassword` is true):
  `{ "newPassword": string, "confirmPassword": string }`
- **Body — voluntary path** (`mustChangePassword` is false):
  `{ "currentPassword": string, "newPassword": string, "confirmPassword": string }`

The two paths are distinguished by the user's current flag, not by a body field. Sending
`currentPassword` on the forced path is a `400` — it is neither required nor accepted there (BR-42).

- **204:** the hash is replaced, `mustChangePassword` is cleared, and **every other session** for
  that user is deleted; the calling session survives (BR-41, AC-64).
- **403 `WRONG_PASSWORD`** — voluntary path, `currentPassword` does not match. The stored password is
  unchanged (BR-42, AC-69).
- **400 `VALIDATION_FAILED`** — new password outside 8–128 characters, `confirmPassword` mismatch,
  or new password identical to the current one (BR-07, AC-07, AC-08).
- **401**, **415**, **500**.
- **Traceability:** FR-06, FR-07, FR-36; BR-02, BR-07, BR-41, BR-42; AC-02, AC-07, AC-08, AC-09,
  AC-64, AC-69, AC-70.

---

## 3. Requester ticket endpoints

Lab 2 §3 and §4 remain in force with one change: the owning Requester is the authenticated user, not
`X-Requester-Id` (BR-03). That covers `POST /api/tickets`, `GET /api/tickets`,
`GET /api/tickets/:id`, `GET /api/tickets/:id/attachments`, `POST /api/tickets/:id/attachments`,
`GET /api/attachments/:id`, `GET /api/attachments/:id/download` and `DELETE /api/attachments/:id`. `POST /api/tickets` ignores any `requesterId` in the body (AC-03). Every
Lab 2 validation rule, error code and status code is unchanged (FR-15, AC-19), and the attachment
codes `410`, `413`, `415` keep their Lab 2 meanings.

Added by Lab 3:

### 3.1 `GET /api/tickets/:id/comments`

- **Auth:** the owning Requester, any IT Staff, any Administrator (BR-04).
- **200:** array ordered by `createdAt` ascending.

```json
[
  {
    "id": 12,
    "body": "I restarted the laptop and it still fails at the login screen.",
    "createdAt": "2026-09-12T08:41:03.000Z",
    "author": { "id": 3, "name": "Anan Wattana", "role": "REQUESTER" }
  }
]
```

- **404** for a ticket the caller has no read path to (§1.4). **401**, **403** (password gate),
  **500**.
- **Traceability:** FR-16; BR-04; AC-21.

### 3.2 `POST /api/tickets/:id/comments`

- **Auth:** the owning Requester, or any IT Staff. Administrators may read comments but not post
  them (`specification.md` §4.1) → `403 FORBIDDEN`.
- **Body:** `{ "body": string }`
- **201:** the created comment, same shape as §3.1. `author` and `createdAt` come from the server;
  any client-supplied value is ignored (BR-16).
- **400 `VALIDATION_FAILED`** — body empty or whitespace-only after trimming, or longer than 2000
  characters (BR-17, AC-22, AC-23).
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-16, FR-24; BR-04, BR-15, BR-16, BR-17, BR-18; AC-21, AC-22, AC-23, AC-65.

### 3.3 `POST /api/tickets/:id/requester-resolved`

- **Auth:** the owning Requester only. IT Staff and Administrators → `403`.
- **Body:** none.
- **204:** `requesterResolvedAt` is set to now. **The status does not change** (BR-26, AC-24).
  Repeating the call is idempotent — it refreshes the timestamp and still returns `204`.
- **409 `INVALID_STATE`** — the ticket is already Resolved, Closed or Cancelled; there is nothing to
  report.
- **404**, **401**, **403**, **500**.
- **Traceability:** FR-17, FR-18; BR-05, BR-26; AC-24, AC-25.

---

## 4. IT Staff queue

### 4.1 `GET /api/staff/tickets`

The shared queue across all Requesters.

- **Auth:** IT Staff only. Requester and Administrator → `403 FORBIDDEN` before any lookup (§1.4).

**Query parameters**

| Param | Values | Default |
|---|---|---|
| `search` | free text, matched case-insensitively against **ticket number** and **summary** | none |
| `status` | one of the eight status values | all |
| `itPriority` | `LOW` \| `MEDIUM` \| `HIGH` | all |
| `categoryId` | integer | all |
| `owner` | `unassigned` \| `me` \| a user id | all |
| `sort` | `createdAt` \| `updatedAt` \| `itPriority` \| `ticketNumber` | `itPriority` |
| `direction` | `asc` \| `desc` | `desc` for `itPriority`, else `asc` |
| `page` | integer ≥ 1 | 1 |
| `pageSize` | integer 1–100 | 20 |

Default ordering is **IT Priority descending, then created date ascending** — oldest most-urgent
first (D-10). `itPriority` sorts by severity (`HIGH` > `MEDIUM` > `LOW`), not alphabetically.

**200:**

```json
{
  "items": [
    {
      "id": 41,
      "ticketNumber": "TKT-2026-000041",
      "summary": "VPN drops every few minutes",
      "category": { "id": 4, "name": "Network" },
      "requestedPriority": "MEDIUM",
      "itPriority": "HIGH",
      "status": "IN_PROGRESS",
      "owner": { "id": 7, "name": "Suda Chaiyaporn" },
      "requesterResolvedAt": null,
      "createdAt": "2026-09-10T02:14:55.000Z",
      "updatedAt": "2026-09-12T06:03:11.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "totalItems": 137,
  "totalPages": 7
}
```

`owner` is `null` when unassigned — the client renders the "Unassigned" token from `ui-spec.md` §3.4.

- **400 `INVALID_QUERY`** with a `fields` array — unknown `sort` field, `direction` not
  `asc`/`desc`, `pageSize` outside 1–100, `page` below 1, non-integer `categoryId`, `status` or
  `itPriority` not in the enum, `owner` neither `unassigned`/`me` nor an integer (BR-35, AC-31).
  Never silently ignored, never a `500`.
- **200 with `items: []`** for a filter that matches nothing — a no-results state, not an error.
- **401**, **403**, **500**.
- **Traceability:** FR-19; BR-35; AC-26…AC-31, AC-33.

### 4.2 `GET /api/staff/assignable-users`

Added post-review (PR #80): the queue's Owner filter (`ui-spec.md` §9) and Ticket Detail's Ticket
Owner select (`ui-spec.md` §10) both need to offer real users as options, but the only existing
user-listing route (`GET /api/users`, §6.1) is Administrator-only — an IT Staff caller gets `403`
there. This route is the minimal, IT-Staff-callable alternative, scoped to exactly what a Ticket
Owner may legally be (BR-19: "an active IT Staff or Administrator user").

- **Auth:** IT Staff only. Requester and Administrator → `403` (§1.4) — Administrator has
  `GET /api/users` instead and does not need this route.
- **200:** array of active IT Staff and Administrator users, ordered by name ascending, minimal
  shape — no email, no `isActive`/`mustChangePassword` (those belong to §6.1's Administrator-only
  view; this route exposes only what an assignment picker needs):

```json
[
  { "id": 7, "name": "Suda Chaiyaporn", "role": "IT_STAFF" },
  { "id": 12, "name": "Kanya Boonmee", "role": "ADMINISTRATOR" }
]
```

- Inactive users and Requesters are never included — filtering happens server-side, not left to
  the client.
- The queue's Owner filter (`ui-spec.md` §9: "plus each active IT Staff") renders only the
  `IT_STAFF` entries from this list; Ticket Detail's Ticket Owner select (§10: "active IT Staff and
  Administrators") renders both roles, matching BR-19 exactly.
- **401**, **403**, **500**.
- **Traceability:** supports FR-19 (queue Owner filter) and BR-19/AC-35 (valid reassignment
  targets); no new FR/AC minted — this route is infrastructure for requirements already specified.

---

## 5. IT Staff ticket operations

`GET /api/tickets/:id` (Lab 2 §3.3) is reused for Ticket Detail. For IT Staff and Administrators it
returns any ticket and additionally carries `itPriority`, `owner` and `requesterResolvedAt`; for a
Requester it returns only their own and omits `itPriority` (FR-20, AC-67).

`GET /api/tickets/:id/attachments` (the `attachments` array on the ticket detail response) is reused
unchanged. `GET /api/attachments/:id/download` is **not** reused unchanged — its role guard is widened
(§9) to admit IT Staff and Administrator alongside Requester, with no ownership check for either
staff role, so Attachments created in Lab 2 stay downloadable from IT Staff Ticket Detail (FR-27,
AC-43). IT Staff and Administrator have read access only — upload and soft-removal remain
Requester-owned operations (`specification.md` §4.1); `GET /api/attachments/:id` (metadata) and
`DELETE /api/attachments/:id` are unaffected by this change and stay Requester-only,
ownership-checked exactly as in Lab 2.

### 5.1 `PATCH /api/tickets/:id/owner`

Claim, assign and reassign are one operation.

- **Auth:** IT Staff only. Administrator → `403` (they may be an owner, but may not perform the
  assignment — `specification.md` §4.1, AC-68).
- **Body:** `{ "ownerId": number | null }` — `null` unassigns. Claiming is the client sending its own
  user id.
- **200:** the updated ticket.
- **409 `INVALID_OWNER`** — `ownerId` names an inactive user, a Requester, or a user that does not
  exist. All three return the same code; the message does not say which (BR-20, AC-36).
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-21; BR-19, BR-20; AC-34, AC-35, AC-36.

### 5.2 `PATCH /api/tickets/:id/it-priority`

- **Auth:** IT Staff **or Administrator** (handout §4.5, BR-22).
- **Body:** `{ "itPriority": "LOW" | "MEDIUM" | "HIGH" }`
- **200:** the updated ticket. `requestedPriority` is untouched — no endpoint in this API can change
  it after creation (BR-21, AC-37).
- **400 `VALIDATION_FAILED`** — value not in the enum.
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-22; BR-21, BR-22; AC-37, AC-68.

### 5.3 `PATCH /api/tickets/:id/status`

- **Auth:** IT Staff only. Administrator → `403` (AC-68).
- **Body:** `{ "status": <one of the eight> }`
- **200:** the updated ticket.
- **409 `INVALID_TRANSITION`** — the pair (current, requested) is absent from `specification.md`
  §5.1, **including** a no-op transition to the current status (BR-23, AC-39).
- **409 `OWNER_REQUIRED`** — target is `IN_PROGRESS` and the ticket has no owner, from any source
  state (BR-24, AC-40).
- **400 `VALIDATION_FAILED`** — status not in the enum.
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-23; BR-05, BR-23, BR-24, BR-25; AC-38, AC-39, AC-40.

### 5.4 `GET /api/tickets/:id/notes`

- **Auth:** IT Staff and Administrator (BR-04). **A Requester gets `404`, not `403`** — the §1.4
  rule, so neither the notes nor the ticket's existence is confirmed (AC-04).
- **200:** array ordered by `createdAt` ascending, same shape as comments.
- **401**, **403** (password gate), **500**.
- **Traceability:** FR-26; BR-04; AC-04, AC-66.

### 5.5 `POST /api/tickets/:id/notes`

- **Auth:** IT Staff only. Administrator may read notes but not write them → `403` (AC-68).
  Requester → `404`.
- **Body:** `{ "body": string }`
- **201:** the created note. Author and timestamp from the server (BR-16).
- **400 `VALIDATION_FAILED`** — empty, whitespace-only, or over 2000 characters (BR-17).
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-25; BR-04, BR-15, BR-16, BR-17, BR-18; AC-41, AC-04.

---

## 6. Administrator user endpoints

Every route in this section is Administrator-only. A Requester or IT Staff caller gets
`403 FORBIDDEN` before any lookup — these are role-gated collections, so `403` leaks nothing
(§1.4, AC-55).

### 6.1 `GET /api/users`

- **Query:** `search` (matched case-insensitively against **name or email**), `role` (one of the
  three). No pagination, no multi-column sort, no second simultaneous filter — all excluded by
  handout §8.5.
- **200:** array ordered by name ascending.

```json
[
  {
    "id": 3,
    "name": "Anan Wattana",
    "email": "anan.w@toktickit.local",
    "role": "REQUESTER",
    "isActive": true,
    "mustChangePassword": false
  }
]
```

Never contains `passwordHash` (BR-06, AC-13).

- **400 `INVALID_QUERY`** — `role` not one of the three enum values.
- **200 `[]`** when nothing matches — a no-results state, not an error.
- **401**, **403**, **500**.
- **Traceability:** FR-28, FR-35; AC-45, AC-46, AC-47, AC-55.

### 6.2 `POST /api/users`

- **Body:**

```json
{
  "name": "Pim Rattanakosin",
  "email": "pim.r@toktickit.local",
  "role": "IT_STAFF",
  "isActive": true,
  "initialPassword": "ChangeMe2026"
}
```

- **201:** the created user, same shape as §6.1, with `mustChangePassword: true` — always, and not
  settable by the client (BR-30, AC-48).
- **409 `EMAIL_IN_USE`** — the email is already held, compared **case-insensitively** (BR-09, BR-29,
  AC-49).
- **400 `VALIDATION_FAILED`** — missing name, malformed email, `role` not one of exactly the three
  permitted values (AC-50), `initialPassword` outside 8–128 characters.
- **401**, **403**, **415**, **500**.
- **Traceability:** FR-29, FR-32; BR-09, BR-27, BR-29, BR-30; AC-48, AC-49, AC-50.

### 6.3 `PATCH /api/users/:id`

- **Body:** any subset of `{ "name", "email", "role", "isActive" }`. No other field is accepted —
  a request carrying `passwordHash`, `mustChangePassword` or `id` is a `400` (BR-28).
- **200:** the updated user.
- **409 `EMAIL_IN_USE`** — duplicate on update too (BR-29).
- **409 `SELF_DEACTIVATION`** — the caller is `:id` and `isActive: false`. An Administrator may
  still edit their own name and email (BR-31, AC-53).
- **409 `LAST_ADMIN`** — the change would leave zero active Administrators, whether by deactivating
  the last one or by changing their role away from `ADMINISTRATOR` (BR-32, AC-54). Evaluated inside
  the same transaction as the write, so two concurrent demotions cannot both pass.
- **400 `VALIDATION_FAILED`** — malformed email, invalid role.
- **404** — no such user. **401**, **403**, **415**, **500**.
- **Traceability:** FR-30, FR-32, FR-33, FR-34; BR-28, BR-29, BR-31, BR-32, BR-33; AC-49, AC-51,
  AC-53, AC-54.

### 6.4 `POST /api/users/:id/initial-password`

- **Body:** `{ "initialPassword": string }`
- **204:** the hash is replaced, `mustChangePassword` is set to `true`, and **every** session
  belonging to that user is deleted, so an active session cannot outlive the reset (BR-30, BR-41).
  That user's next login lands on the forced Change Password screen (AC-52).
- **400 `VALIDATION_FAILED`** — password outside 8–128 characters.
- **404**, **401**, **403**, **415**, **500**.
- **Traceability:** FR-31; BR-30, BR-41; AC-52.

Deliberately absent, per handout §8.5: `DELETE /api/users/:id`, bulk operations, import/export,
role history, multi-role assignment, and any email-sending endpoint.

---

## 7. Endpoint → requirement matrix

| Endpoint | FR | Key BRs | ACs |
|---|---|---|---|
| `POST /api/auth/login` | 01, 02, 03 | 01, 08, 38, 41 | 01, 05, 13, 61, 62 |
| `POST /api/auth/logout` | 05 | 10 | 10 |
| `GET /api/auth/me` | 04 | 39 | 13, 59, 60 |
| `POST /api/auth/change-password` | 06, 07, 36 | 02, 07, 41, 42 | 02, 07, 08, 09, 64, 69, 70 |
| Lab 2 ticket + attachment routes | 14, 15 | 03, 13, 14, 37 | 03, 16, 19, 20, 43 |
| `GET /api/tickets/:id/comments` | 16 | 04 | 21 |
| `POST /api/tickets/:id/comments` | 16, 24 | 04, 15, 16, 17, 18 | 21, 22, 23, 65 |
| `POST /api/tickets/:id/requester-resolved` | 17, 18 | 05, 26 | 24, 25 |
| `GET /api/staff/tickets` | 19 | 35 | 26–31, 33 |
| `GET /api/staff/assignable-users` | 19 | 19 | 31, 35 |
| `GET /api/tickets/:id` (staff view) | 20 | 13 | 43, 44, 67 |
| `PATCH /api/tickets/:id/owner` | 21 | 19, 20 | 34, 35, 36 |
| `PATCH /api/tickets/:id/it-priority` | 22 | 21, 22 | 37, 68 |
| `PATCH /api/tickets/:id/status` | 23 | 05, 23, 24, 25 | 38, 39, 40 |
| `GET /api/tickets/:id/notes` | 26 | 04 | 04, 66 |
| `POST /api/tickets/:id/notes` | 25 | 04, 15–18 | 04, 41 |
| `GET /api/users` | 28, 35 | — | 45, 46, 47, 55 |
| `POST /api/users` | 29, 32 | 09, 27, 29, 30 | 48, 49, 50 |
| `PATCH /api/users/:id` | 30, 32, 33, 34 | 28, 29, 31, 32, 33 | 49, 51, 53, 54 |
| `POST /api/users/:id/initial-password` | 31 | 30, 41 | 52 |
| every protected route | 09, 10, 11, 12, 13 | 03, 13, 36, 40 | 14, 15, 16, 18, 57 |

---

## 8. Error code catalogue

| Code | Status | Raised by |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Login: wrong password, unknown email, or inactive account — indistinguishable. |
| `RATE_LIMITED` | 429 | Login rate limit (BR-38). |
| `UNAUTHENTICATED` | 401 | No session, expired session, unknown cookie. |
| `FORBIDDEN` | 403 | Role not permitted; or permitted to read but not to perform this write. |
| `PASSWORD_CHANGE_REQUIRED` | 403 | The §1.5 gate. |
| `WRONG_PASSWORD` | 403 | Voluntary change-password with a wrong `currentPassword`. |
| `VALIDATION_FAILED` | 400 | Field validation; carries `fields`. |
| `INVALID_QUERY` | 400 | Malformed query parameters; carries `fields`. |
| `MALFORMED_BODY` | 400 | Body is not a JSON object. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `Content-Type` is not `application/json` (BR-40). |
| `NOT_FOUND` | 404 | Unknown record, or a record the caller has no read path to. |
| `EMAIL_IN_USE` | 409 | Duplicate email on user create or update. |
| `INVALID_OWNER` | 409 | Owner is inactive, a Requester, or nonexistent. |
| `INVALID_TRANSITION` | 409 | Status pair absent from `specification.md` §5.1. |
| `OWNER_REQUIRED` | 409 | `IN_PROGRESS` requested with no owner. |
| `INVALID_STATE` | 409 | Resolution indication on an already-closed ticket. |
| `SELF_DEACTIVATION` | 409 | Administrator deactivating their own account. |
| `LAST_ADMIN` | 409 | Change would leave no active Administrator. |
| `INTERNAL` | 500 | Unexpected failure; generic message only (BR-36, AC-57). |

Lab 2 codes retained unchanged on the attachment routes: `ATTACHMENT_LIMIT`, `ALREADY_REMOVED`,
`ATTACHMENT_REMOVED`, `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`.

Removed from Lab 2: `MISSING_REQUESTER` and `INVALID_REQUESTER`, whose endpoint and header no longer
exist (§9).

---

## 9. Changes to the Lab 2 contract

| Lab 2 | Lab 3 |
|---|---|
| `X-Requester-Id` header on every scoped route | **Removed.** Identity is the session (§1.2). |
| `GET /api/requesters` | **Deleted.** `L2-BR-35` is *not* repealed — it also governs `GET /api/categories` and `GET /api/related-systems`, both of which are retained unchanged; only the requesters clause becomes moot with the endpoint's removal. |
| `400 MISSING_REQUESTER` / `INVALID_REQUESTER` | **Removed** — replaced by `401 UNAUTHENTICATED`. |
| Ticket routes open to any caller with a valid header | Require a session; ownership from the authenticated user (BR-03). |
| `GET /api/tickets/:id` returns Lab 2 fields | Adds `itPriority`, `owner`, `requesterResolvedAt` for IT Staff and Administrator; a Requester never sees `itPriority`. |
| No comment or note routes | §3.1, §3.2, §5.4, §5.5. |
| `GET /api/attachments/:id/download` — Requester only, ownership-checked | Role guard widened to Requester, IT Staff **and** Administrator (§5); IT Staff/Administrator resolve any existing attachment with no ownership check (a soft-removed one still `410`s, BR-33, regardless of role), a Requester keeps the exact Lab 2 behavior. `GET /api/attachments/:id` (metadata) and `DELETE /api/attachments/:id` are unchanged — still Requester-only, ownership-checked. |

Every other Lab 2 endpoint — including `GET /api/attachments/:id` and `DELETE /api/attachments/:id`
above — keeps its path, request shape, response shape, validation rules and
status codes unchanged (FR-15, AC-19).
