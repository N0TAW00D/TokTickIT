// Soft-removal reason validator (specification.md BR-31, A-09;
// api-spec.md §4.4). Split out the same way validation/ticketFields.ts and
// validation/attachmentFile.ts are — pure, DB/Express-free, and reusable if
// a future slice ever needs the same rule.

import type { FieldResult } from './ticketFields.ts';

const REASON_MIN = 3;
const REASON_MAX = 200;

/**
 * `reason`: required, trimmed length 3-200 (BR-31, A-09). Missing, wrong
 * type, or out of range after trimming -> a `FieldError` the route turns
 * into `400 VALIDATION_FAILED` (api-spec.md §4.4). Whitespace-only input is
 * rejected the same way validateSummary/validateDescription reject it: it
 * trims to a string shorter than the minimum.
 */
export function validateRemovalReason(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, error: { field: 'reason', message: 'reason is required.' } };
  }

  const trimmed = raw.trim();
  if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
    return {
      ok: false,
      error: {
        field: 'reason',
        message: `reason must be between ${REASON_MIN} and ${REASON_MAX} characters after trimming.`,
      },
    };
  }

  return { ok: true, value: trimmed };
}
