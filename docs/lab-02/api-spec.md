# Lab 2 API Contract — TokTickIT Requester Ticketing MVP

> Status: **Draft for review**. Companion to [`specification.md`](./specification.md). Every endpoint,
> status code, and error body here is traceable to a BR/FR/AC in that document and to a planned test
> in [`tests.md`](./tests.md).

---

## 1. Conventions

### 1.1 Base URL and format

- Base path: `/api`. All request and response bodies are `application/json; charset=utf-8` unless
  stated otherwise (attachment upload is `multipart/form-data`; attachment download is the file's
  own content type).
- Server: `http://localhost:3000` in development. The client reads it from
  `VITE_API_BASE_URL` (default `http://localhost:3000`).
- Timestamps in responses are ISO-8601 UTC strings (e.g. `2026-09-01T08:14:00.000Z`). The client
  formats them for display in Asia/Bangkok.

### 1.2 Requester context header

Every **Requester-scoped** endpoint (marked 🔒 below) requires:

```
X-Requester-Id: <positive integer>
```

Resolution rules (BR-13, A-10):

| Condition | Response |
|---|---|
| Header missing, empty, non-numeric, or ≤ 0 | `400` `MISSING_REQUESTER` |
| Header references a Requester that does not exist | `400` `INVALID_REQUESTER` |
| Header references a Requester with `isActive = false` | `400` `INVALID_REQUESTER` |
| Header references an active Requester | request proceeds; that Requester is "the caller" |

Reference-data endpoints (`/categories`, `/related-systems`, `/requesters`) are **not** scoped and
ignore the header.

### 1.3 Standard error body

All error responses (`4xx`, `5xx`) share this shape (example shown for a validation failure):

```json
{
  "error": "VALIDATION_FAILED",
  "message": "One or more fields are invalid.",
  "fields": [
    { "field": "summary", "message": "Summary must be at least 5 characters." }
  ]
}
```

- `error` — a **stable machine code**, always exactly one of the values in the §5 catalogue
  (`MISSING_REQUESTER`, `NOT_FOUND`, `VALIDATION_FAILED`, …). Never free text, never absent. The
  client branches on this.
- `message` — safe, generic human text. Never contains a stack trace, SQL, file path, or raw
  exception text (BR-41).
- `fields` — present **only** for `VALIDATION_FAILED` and `INVALID_QUERY`; one entry per rejected
  field. On every other error the key is **omitted entirely** (not `null`, not `[]`), so a test may
  assert `!('fields' in body)`.

### 1.4 Ownership and existence (BR-14, BR-42)

For 🔒 endpoints that address a specific ticket or attachment, a resource that does not exist and a
resource owned by a different Requester produce the **byte-identical** `404 NOT_FOUND` response. The
API never reveals that a resource exists to someone who does not own it.

A **non-integer path parameter** (`GET /api/tickets/abc`, `GET /api/attachments/xyz`, etc.) is
treated as a resource that does not exist → `404 NOT_FOUND`, identical to the above (no `400` — the
route matched, the resource did not).

### 1.4a Request body content type

`POST /api/tickets` and `DELETE /api/attachments/:id` require `Content-Type: application/json`. A
missing/other content type, or a body that is not a JSON object, → `400 MALFORMED_BODY`.
`POST /api/tickets/:id/attachments` requires `multipart/form-data` → otherwise `400 NO_FILE`.

### 1.5 Status codes used

| Code | Meaning in this API |
|---|---|
| `200 OK` | Successful retrieval, download, or soft-removal. |
| `201 Created` | Ticket or attachment created. |
| `400 Bad Request` | Missing/invalid Requester header, malformed query params, validation failure, malformed body. |
| `404 Not Found` | Route resource unknown **or** not owned by the caller; unknown/inactive category or related system on create. |
| `409 Conflict` | 6th active attachment; soft-removing an already-removed attachment. |
| `410 Gone` | Download of a soft-removed attachment. |
| `413 Payload Too Large` | Attachment file exceeds 5 MB. |
| `415 Unsupported Media Type` | Attachment type not in {JPEG, PNG, WEBP, PDF}. |
| `500 Internal Server Error` | Unexpected failure; generic body only. |

`422` is intentionally not used — validation failures are `400`.

---

## 2. Reference data endpoints (not scoped)

### 2.1 `GET /api/categories`

Active ticket categories, for the Create Ticket classification control.

- **Auth:** none.
- **Query params:** none.
- **200 response:** array ordered by `id` ascending (keeps the Lab 1 contract stable).

```json
[
  { "id": 1, "name": "Account and Access" },
  { "id": 2, "name": "Hardware" },
  { "id": 3, "name": "Software" },
  { "id": 4, "name": "Network" }
]
```

- Only rows with `isActive = true` are returned (BR-35). An empty result is a valid `200 []`.
- **Errors:** `500` only.
- **Traceability:** FR-07, FR-36, BR-35; AC-10.

### 2.2 `GET /api/related-systems`

Active related systems.

- **Auth:** none. **Query params:** none.
- **200 response:** array of `{ id, name }` ordered by `name` ascending.

```json
[
  { "id": 2, "name": "Campus Wi-Fi" },
  { "id": 7, "name": "Corporate Laptop" },
  { "id": 1, "name": "Email" }
]
```

- Only `isActive = true` (BR-35). An empty result is a valid `200 []`.
- **Errors:** `500`.
- **Traceability:** FR-07, FR-36, BR-35; AC-10.

### 2.3 `GET /api/requesters`

Active Development Requesters, for the selection screen ("fake login").

- **Auth:** none. **Query params:** none.
- **200 response:** array of `{ id, name, email }` ordered by `name` ascending.

```json
[
  { "id": 4, "name": "David Lee", "email": "david.lee@example.edu" },
  { "id": 1, "name": "Jennifer Anderson", "email": "jennifer.anderson@example.edu" },
  { "id": 2, "name": "Michael Brown", "email": "michael.brown@example.edu" },
  { "id": 3, "name": "Sarah Johnson", "email": "sarah.johnson@example.edu" }
]
```

- Only `isActive = true`; the inactive seed Requester is never returned (BR-08).
- An empty array is a valid response and drives the selection screen's empty state (AC-06).
- **Errors:** `500`.
- **Traceability:** FR-01, FR-06, BR-08, BR-35; AC-05, AC-06, AC-42.

---

## 3. Ticket endpoints

### 3.1 `POST /api/tickets` 🔒

Create one validated ticket for the calling Requester.

- **Headers:** `X-Requester-Id` (required), `Content-Type: application/json`.
- **Request body:**

```json
{
  "categoryId": 2,
  "relatedSystemId": 7,
  "requestedPriority": "MEDIUM",
  "summary": "Laptop battery drains quickly",
  "description": "My laptop battery is draining much faster than usual even when the system is idle."
}
```

| Field | Type | Rules |
|---|---|---|
| `categoryId` | integer | Required. Must be an active `Category` id → else `404 NOT_FOUND`. |
| `relatedSystemId` | integer | Required. Must be an active `RelatedSystem` id → else `404 NOT_FOUND`. |
| `requestedPriority` | string enum | Required. One of `LOW`, `MEDIUM`, `HIGH`. |
| `summary` | string | Required. Trimmed length **5–140**. |
| `description` | string | Required. Trimmed length **20–5000**. |

- The owner is taken from `X-Requester-Id`, **not** the body. A `requesterId` in the body is ignored
  (A-01).
- `summary` and `description` are trimmed before validation and before persistence; internal
  whitespace preserved.

- **201 response:** the full ticket.

```json
{
  "id": 1,
  "ticketNumber": "TKT-2026-000001",
  "requester": { "id": 1, "name": "Jennifer Anderson", "email": "jennifer.anderson@example.edu" },
  "category": { "id": 2, "name": "Hardware" },
  "relatedSystem": { "id": 7, "name": "Corporate Laptop" },
  "requestedPriority": "MEDIUM",
  "status": "NEW",
  "summary": "Laptop battery drains quickly",
  "description": "My laptop battery is draining much faster than usual even when the system is idle.",
  "createdAt": "2026-09-01T08:14:00.000Z",
  "updatedAt": "2026-09-01T08:14:00.000Z",
  "attachments": []
}
```

- `ticketNumber` is server-generated `TKT-<YYYY>-<NNNNNN>` where `YYYY` is the creation year in
  Asia/Bangkok and `NNNNNN` is the zero-padded per-year sequence (BR-01, BR-28). It is unique.
- `status` is always `NEW` (BR-02).

- **Error responses:**

| Status | `error` | When |
|---|---|---|
| `400` | `MISSING_REQUESTER` / `INVALID_REQUESTER` | Header rules (§1.2). |
| `400` | `VALIDATION_FAILED` | Any field rule broken. `fields[]` lists each. Nothing persisted (BR-25, BR-26). |
| `400` | `MALFORMED_BODY` | Body is not valid JSON / not an object. |
| `404` | `NOT_FOUND` | `categoryId` or `relatedSystemId` is unknown or inactive (BR-36, AC-43). |
| `500` | `INTERNAL` | Unexpected error, or Ticket Number allocation still colliding after 3 retries. |

- **Concurrency:** the per-year `TicketCounter` row is incremented atomically inside the same
  transaction that inserts the ticket; on a unique-violation for `ticketNumber` the whole
  transaction is retried up to 3 times before returning `500` (BR-28).

- **Traceability:** FR-08..FR-13, BR-01, BR-02, BR-04, BR-05, BR-12, BR-24, BR-25, BR-28, BR-36;
  AC-01, AC-11, AC-12, AC-13, AC-14, AC-16, AC-43.

---

### 3.2 `GET /api/tickets` 🔒

The calling Requester's tickets — always server-side scoped to that Requester (BR-15), paginated,
searchable, filterable, sortable.

- **Headers:** `X-Requester-Id` (required).
- **Query parameters:**

| Param | Type | Default | Rules |
|---|---|---|---|
| `search` | string | — | Case-insensitive substring match on `ticketNumber` **OR** `summary`. Blank / whitespace-only ⇒ ignored (BR-16). |
| `categoryId` | integer | — | Must be a known active category id ⇒ else `400`. |
| `priority` | enum | — | `LOW` \| `MEDIUM` \| `HIGH` ⇒ else `400`. |
| `status` | enum | — | `NEW` (only valid value in Lab 2) ⇒ else `400`. |
| `sort` | enum | `createdAt` | `createdAt` \| `updatedAt` \| `ticketNumber` ⇒ else `400` (BR-18). |
| `order` | enum | `desc` | `asc` \| `desc` ⇒ else `400`. |
| `page` | integer | `1` | Integer ≥ 1 ⇒ else `400` (BR-19). |
| `pageSize` | integer | `10` | One of `10`, `20`, `50` ⇒ else `400` (BR-19). |

- Multiple filters combine with **AND** (BR-17).
- Secondary sort is always `id desc` for a stable order (BR-18).
- `page` beyond the last page ⇒ `200` with `items: []` and correct `meta` (BR-19, AC-27) — **not**
  an error.

- **200 response:**

```json
{
  "items": [
    {
      "id": 12,
      "ticketNumber": "TKT-2026-000012",
      "summary": "Cannot connect to VPN",
      "category": { "id": 4, "name": "Network" },
      "relatedSystem": { "id": 3, "name": "VPN" },
      "requestedPriority": "HIGH",
      "status": "NEW",
      "createdAt": "2026-09-01T02:08:00.000Z",
      "updatedAt": "2026-09-01T02:08:00.000Z",
      "activeAttachmentCount": 1
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 10,
    "totalItems": 12,
    "totalPages": 2,
    "sort": "createdAt",
    "order": "desc"
  }
}
```

- `activeAttachmentCount` counts non-removed attachments only.

- **Error responses:**

| Status | `error` | When |
|---|---|---|
| `400` | `MISSING_REQUESTER` / `INVALID_REQUESTER` | Header rules. |
| `400` | `INVALID_QUERY` | Any query param fails its rule. `fields[]` names the offending param(s). Params are **not** silently coerced (BR-19, FR-29, AC-28). |
| `500` | `INTERNAL` | Unexpected error. |

- **Traceability:** FR-24..FR-31, BR-15..BR-20; AC-03, AC-09, AC-22..AC-31.

---

### 3.3 `GET /api/tickets/:id` 🔒

One ticket owned by the calling Requester, with its attachments.

- **Headers:** `X-Requester-Id` (required).
- **Path param:** `id` — integer ticket id.
- **200 response:** same shape as the `POST /api/tickets` `201` body, plus a populated
  `attachments` array:

```json
{
  "id": 1,
  "ticketNumber": "TKT-2026-000001",
  "requester": { "id": 1, "name": "Jennifer Anderson", "email": "jennifer.anderson@example.edu" },
  "category": { "id": 2, "name": "Hardware" },
  "relatedSystem": { "id": 7, "name": "Corporate Laptop" },
  "requestedPriority": "MEDIUM",
  "status": "NEW",
  "summary": "Laptop battery drains quickly",
  "description": "My laptop battery is draining much faster than usual even when the system is idle.",
  "createdAt": "2026-09-01T08:14:00.000Z",
  "updatedAt": "2026-09-01T09:02:00.000Z",
  "attachments": [
    {
      "id": 5,
      "originalFilename": "battery-report.pdf",
      "mimeType": "application/pdf",
      "fileSize": 249184,
      "isRemoved": false,
      "removedAt": null,
      "removedReason": null,
      "createdAt": "2026-09-01T08:15:10.000Z"
    },
    {
      "id": 6,
      "originalFilename": "screenshot.png",
      "mimeType": "image/png",
      "fileSize": 812345,
      "isRemoved": true,
      "removedAt": "2026-09-01T09:02:00.000Z",
      "removedReason": "Uploaded the wrong screenshot",
      "createdAt": "2026-09-01T08:16:40.000Z"
    }
  ]
}
```

- Both active and soft-removed attachments are listed. Removed ones carry `removedAt` /
  `removedReason` and no download path (BR-33).

- **Error responses:**

| Status | `error` | When |
|---|---|---|
| `400` | `MISSING_REQUESTER` / `INVALID_REQUESTER` | Header rules. |
| `404` | `NOT_FOUND` | `id` unknown **or** ticket owned by another Requester (identical response — BR-14). |
| `500` | `INTERNAL` | Unexpected error. |

- **Traceability:** FR-32..FR-34, BR-38, BR-39, BR-42; AC-32, AC-37, AC-38.

---

## 4. Attachment endpoints

All 🔒. Ownership is checked through the attachment's parent ticket: an attachment whose ticket is
not owned by the caller is treated as non-existent (`404`, BR-14).

### 4.1 `POST /api/tickets/:id/attachments` 🔒

Upload one file to an owned ticket.

- **Headers:** `X-Requester-Id` (required), `Content-Type: multipart/form-data`.
- **Path param:** `id` — ticket id.
- **Body:** one form part named `file`.
- **Constraints:**

| Rule | Limit | Violation |
|---|---|---|
| Type | `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, checked by **both** extension and content sniff | `415 UNSUPPORTED_TYPE` |
| Size | ≤ 5 MB (`5 * 1024 * 1024` bytes) | `413 FILE_TOO_LARGE` |
| Active count | ≤ 5 non-removed attachments per ticket after this upload | `409 ATTACHMENT_LIMIT` |
| File part | exactly one part named `file`, non-empty | `400 NO_FILE` |

- The stored file name is server-generated `<uuidv4>.<ext>` under `server/uploads/` (git-ignored,
  never statically served). `originalFilename` is the client name with any path components stripped,
  truncated to 255 chars (BR-29, BR-30).
- The DB row is written **only after** the file is durably stored; a disk-write failure writes no
  row and returns `500` (BR-27).
- On success the parent ticket's `updatedAt` is bumped (BR-07).

- **201 response:**

```json
{
  "id": 7,
  "ticketId": 1,
  "originalFilename": "battery-report.pdf",
  "mimeType": "application/pdf",
  "fileSize": 249184,
  "isRemoved": false,
  "removedAt": null,
  "removedReason": null,
  "createdAt": "2026-09-01T08:15:10.000Z"
}
```

- **Error responses:**

| Status | `error` | When |
|---|---|---|
| `400` | `MISSING_REQUESTER` / `INVALID_REQUESTER` | Header rules. |
| `400` | `NO_FILE` | No `file` part, or empty file. |
| `404` | `NOT_FOUND` | Ticket unknown or not owned. |
| `409` | `ATTACHMENT_LIMIT` | Ticket already has 5 active attachments (BR-23, AC-20). |
| `413` | `FILE_TOO_LARGE` | > 5 MB (BR-22, AC-19). |
| `415` | `UNSUPPORTED_TYPE` | Type not allowed / extension–content mismatch (BR-21, AC-18). |
| `500` | `INTERNAL` | Disk write or unexpected failure; no row written. |

- **Traceability:** FR-15..FR-19, BR-21..BR-23, BR-27, BR-29, BR-30; AC-18..AC-21.

### 4.2 `GET /api/attachments/:id` 🔒

Metadata for one attachment on an owned ticket.

- **Headers:** `X-Requester-Id` (required). **Path param:** `id` — attachment id.
- **200 response:** same object shape as the `POST` `201` body above (including `ticketId`).
- **Errors:**

| Status | `error` | When |
|---|---|---|
| `400` | `MISSING_REQUESTER` / `INVALID_REQUESTER` | Header rules. |
| `404` | `NOT_FOUND` | Attachment unknown, or its ticket is not owned. |
| `500` | `INTERNAL` | Unexpected error. |

- **Traceability:** FR-18, BR-14; AC-36.

### 4.3 `GET /api/attachments/:id/download` 🔒

Download the bytes of an **active** attachment on an owned ticket.

- **Headers:** `X-Requester-Id` (required). **Path param:** `id`.
- **200 response:** the raw file with headers:
  - `Content-Type: <stored mimeType>`
  - `Content-Disposition: attachment; filename="<originalFilename>"`
  - `Content-Length: <fileSize>`
- **Errors:**

| Status | `error` | When |
|---|---|---|
| `400` | `MISSING_REQUESTER` / `INVALID_REQUESTER` | Header rules. |
| `404` | `NOT_FOUND` | Attachment unknown, or its ticket is not owned. |
| `410` | `ATTACHMENT_REMOVED` | The attachment is soft-removed (BR-33, AC-34). |
| `500` | `INTERNAL` | File missing on disk / unexpected error — deliberately `500` (server fault), not `404`, since the metadata row proves the resource exists and is owned. |

- **Traceability:** FR-20, FR-22, BR-30, BR-33; AC-33, AC-34, AC-37.

### 4.4 `DELETE /api/attachments/:id` 🔒

Soft-remove one attachment on an owned ticket. The row and file are retained; only access is revoked
(BR-31, A-08).

- **Headers:** `X-Requester-Id` (required), `Content-Type: application/json`.
- **Path param:** `id`.
- **Request body:**

```json
{ "reason": "Uploaded the wrong screenshot" }
```

| Field | Type | Rules |
|---|---|---|
| `reason` | string | Required. Trimmed length **3–200** (BR-31, A-09). |

- Sets `isRemoved = true`, `removedAt = now()`, `removedReason`, `removedById = caller`. Bumps the
  ticket's `updatedAt`.
- **200 response:** the updated attachment metadata (`isRemoved: true`, `removedAt`, `removedReason`
  populated).
- **Errors:**

| Status | `error` | When |
|---|---|---|
| `400` | `MISSING_REQUESTER` / `INVALID_REQUESTER` | Header rules. |
| `400` | `VALIDATION_FAILED` | `reason` missing or outside 3–200 after trim. `fields: [{ "field": "reason", ... }]`. Attachment stays active (AC-35). |
| `404` | `NOT_FOUND` | Attachment unknown, or its ticket is not owned (BR-32). |
| `409` | `ALREADY_REMOVED` | The attachment is already soft-removed (BR-32). |
| `500` | `INTERNAL` | Unexpected error. |

- **Traceability:** FR-21..FR-23, BR-31, BR-32; AC-34, AC-35, AC-36.

---

## 5. Error code catalogue

| `error` | HTTP | Meaning |
|---|---|---|
| `MISSING_REQUESTER` | 400 | `X-Requester-Id` absent or not a positive integer. |
| `INVALID_REQUESTER` | 400 | `X-Requester-Id` does not match an active Requester. |
| `MALFORMED_BODY` | 400 | Request body is not valid JSON / not an object. |
| `VALIDATION_FAILED` | 400 | One or more field rules failed; see `fields[]`. |
| `INVALID_QUERY` | 400 | One or more list query params failed their rule; see `fields[]`. |
| `NO_FILE` | 400 | Attachment upload had no usable `file` part. |
| `NOT_FOUND` | 404 | Route resource unknown or not owned by the caller; unknown/inactive category or related system on create. |
| `ATTACHMENT_LIMIT` | 409 | Upload would exceed 5 active attachments. |
| `ALREADY_REMOVED` | 409 | Soft-removing an attachment that is already removed. |
| `ATTACHMENT_REMOVED` | 410 | Download requested for a soft-removed attachment. |
| `FILE_TOO_LARGE` | 413 | Attachment exceeds 5 MB. |
| `UNSUPPORTED_TYPE` | 415 | Attachment type not allowed. |
| `INTERNAL` | 500 | Unexpected server error; generic body, details logged server-side only. |

---

## 6. Endpoint → requirement matrix

| Endpoint | FR | Key BR | AC |
|---|---|---|---|
| `GET /api/categories` | FR-07, FR-36 | BR-35 | AC-10 |
| `GET /api/related-systems` | FR-07, FR-36 | BR-35 | AC-10 |
| `GET /api/requesters` | FR-01, FR-06 | BR-08, BR-35 | AC-05, AC-06, AC-42 |
| `POST /api/tickets` | FR-08–FR-13 | BR-01, BR-02, BR-12, BR-25, BR-28, BR-36 | AC-01, AC-11–AC-14, AC-16, AC-43 |
| `GET /api/tickets` | FR-24–FR-31 | BR-15–BR-20 | AC-03, AC-09, AC-22–AC-31 |
| `GET /api/tickets/:id` | FR-32–FR-34 | BR-38, BR-42 | AC-32, AC-37, AC-38 |
| `POST /api/tickets/:id/attachments` | FR-15–FR-19 | BR-21–BR-23, BR-27, BR-29 | AC-18–AC-21 |
| `GET /api/attachments/:id` | FR-18 | BR-14 | AC-36 |
| `GET /api/attachments/:id/download` | FR-20, FR-22 | BR-30, BR-33 | AC-33, AC-34, AC-37 |
| `DELETE /api/attachments/:id` | FR-21–FR-23 | BR-31, BR-32 | AC-34, AC-35 |

---

## 7. Lab 3 transition note

`X-Requester-Id` is a stand-in for the future `Authorization` credential (BR-40). In Lab 3 the
Requester-context middleware is replaced by authentication middleware that derives the principal from
a verified token; every 🔒 endpoint keeps its path and response shapes, and ownership checks move
from "header id == resource.requesterId" to "authenticated user id == resource.requesterId". No
endpoint in this document is expected to change shape when that happens.
