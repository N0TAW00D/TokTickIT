// Public Comment (and, later, Internal Note — #72) body validator
// (specification.md BR-17; api-spec.md §3.2). Split out the same way
// validation/attachmentRemoval.ts is — pure, DB/Express-free, and shared
// by whichever route needs the "1-2000 trimmed characters" rule.

import type { FieldResult } from './ticketFields.ts';

const BODY_MIN = 1;
const BODY_MAX = 2000;

/**
 * `body`: required, trimmed length 1-2000 (BR-17). Missing, wrong type, or
 * out of range after trimming -> a `FieldError` the route turns into `400
 * VALIDATION_FAILED` (api-spec.md §3.2). Whitespace-only input is rejected
 * the same way validateRemovalReason rejects it: it trims to a string
 * shorter than the minimum, so empty-or-whitespace-only content (AC-22) and
 * over-length content (AC-23) share one check.
 */
export function validateCommentBody(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, error: { field: 'body', message: 'body is required.' } };
  }

  const trimmed = raw.trim();
  if (trimmed.length < BODY_MIN || trimmed.length > BODY_MAX) {
    return {
      ok: false,
      error: {
        field: 'body',
        message: `body must be between ${BODY_MIN} and ${BODY_MAX} characters after trimming.`,
      },
    };
  }

  return { ok: true, value: trimmed };
}
