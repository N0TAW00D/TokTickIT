// Field validators for Ticket creation (specification.md §4-fields, A-03).
//
// These validate and normalize the user-editable Ticket fields that are
// server-authoritative regardless of client-side validation (§4-fields,
// "Validation layering"). The shape returned is deliberately close to
// api-spec.md §1.3's `VALIDATION_FAILED` body — `{ field, message }` per
// rejected field — so slice 8c (POST /api/tickets) can build that response
// directly, without re-deriving field names or messages.
//
// Scope note: only Summary, Description and Requested Priority are covered
// here (UNIT-04). List query-param parsing (UNIT-05) belongs to #18 and the
// attachment type/filename guard (UNIT-06) belongs to #17.

export interface FieldError {
  field: string;
  message: string;
}

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: FieldError };

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Priority = (typeof PRIORITIES)[number];

const SUMMARY_MIN = 5;
const SUMMARY_MAX = 140;
const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 5000;

/**
 * Ticket Summary: trimmed, then 5–140 characters (§4-fields). Trimming
 * happens before both the length check and persistence; empty or
 * whitespace-only input is rejected because it trims to a string shorter
 * than the minimum. Internal whitespace is preserved — only leading and
 * trailing whitespace is stripped.
 */
export function validateSummary(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, error: { field: 'summary', message: 'Summary is required.' } };
  }

  const trimmed = raw.trim();
  if (trimmed.length < SUMMARY_MIN || trimmed.length > SUMMARY_MAX) {
    return {
      ok: false,
      error: {
        field: 'summary',
        message: `Summary must be between ${SUMMARY_MIN} and ${SUMMARY_MAX} characters.`,
      },
    };
  }

  return { ok: true, value: trimmed };
}

/**
 * Description: trimmed, then 20–5000 characters (§4-fields). Same trim
 * semantics as Summary.
 */
export function validateDescription(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, error: { field: 'description', message: 'Description is required.' } };
  }

  const trimmed = raw.trim();
  if (trimmed.length < DESCRIPTION_MIN || trimmed.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      error: {
        field: 'description',
        message: `Description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`,
      },
    };
  }

  return { ok: true, value: trimmed };
}

/** Requested Priority: exactly one of LOW, MEDIUM, HIGH (BR-05, §4-fields). */
export function validateRequestedPriority(raw: unknown): FieldResult<Priority> {
  if (typeof raw !== 'string' || !PRIORITIES.includes(raw as Priority)) {
    return {
      ok: false,
      error: {
        field: 'requestedPriority',
        message: 'Requested Priority must be one of LOW, MEDIUM, HIGH.',
      },
    };
  }

  return { ok: true, value: raw as Priority };
}

export interface TicketFieldsInput {
  summary?: unknown;
  description?: unknown;
  requestedPriority?: unknown;
}

export interface TicketFieldsValue {
  summary: string;
  description: string;
  requestedPriority: Priority;
}

export type TicketFieldsResult =
  | { ok: true; value: TicketFieldsValue }
  | { ok: false; errors: FieldError[] };

/**
 * Validates every §4-fields field this slice covers and collects every
 * failing field's error (rather than stopping at the first), matching
 * BR-25's `fields[]` — one entry per rejected field, so e.g. a request with
 * both a too-short Summary and a missing Priority reports both at once.
 */
export function validateTicketFields(input: TicketFieldsInput): TicketFieldsResult {
  const summaryResult = validateSummary(input.summary);
  const descriptionResult = validateDescription(input.description);
  const priorityResult = validateRequestedPriority(input.requestedPriority);

  const errors: FieldError[] = [];
  if (!summaryResult.ok) errors.push(summaryResult.error);
  if (!descriptionResult.ok) errors.push(descriptionResult.error);
  if (!priorityResult.ok) errors.push(priorityResult.error);

  if (!summaryResult.ok || !descriptionResult.ok || !priorityResult.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      summary: summaryResult.value,
      description: descriptionResult.value,
      requestedPriority: priorityResult.value,
    },
  };
}
