// New-password policy for POST /api/auth/change-password (api-spec.md §2.4,
// BR-07): 8–128 characters, and different from the password it replaces.
// Split out the same way validation/ticketFields.ts and
// validation/attachmentRemoval.ts are — reusable and, for the length check,
// DB/Express-free. `../lib/password.ts` (#67) stays scoped to hashing;
// policy validation lives here, alongside it, as directed by #68's brief.
//
// UNIT-02/UNIT-03 (docs/lab-03/tests.md §2.1) test this module from
// server/tests/lab-03/password.test.ts, the same file #67's UNIT-01
// (bcrypt hash/verify) lives in.

import type { FieldResult } from './ticketFields.ts';
import { verifyPassword } from '../lib/password.ts';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * New-password length check (BR-07): 8–128 characters. Deliberately NOT
 * trimmed before counting, unlike Summary/Description
 * (validation/ticketFields.ts) — a password's leading/trailing characters
 * are part of the secret the user chose, not incidental whitespace, so they
 * are counted and preserved exactly as typed.
 *
 * `field` lets the one caller (routes/auth.ts) reuse this for both
 * `newPassword` (change-password) and, later, `initialPassword`
 * (issue #71's Administrator endpoints) without the error always reading
 * "newPassword" regardless of which field was actually invalid.
 */
export function validatePasswordLength(raw: unknown, field: string): FieldResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, error: { field, message: `${field} is required.` } };
  }

  if (raw.length < PASSWORD_MIN_LENGTH || raw.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        field,
        message: `${field} must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
      },
    };
  }

  return { ok: true, value: raw };
}

/**
 * True if `newPlaintext` is the same password `currentHash` was hashed
 * from — BR-07's "must differ from the password it replaces". This is
 * exactly a `verifyPassword` call; the wrapper exists so call sites read as
 * the business rule they implement, not as a re-verification of the
 * password that was just checked for an unrelated reason.
 */
export function isSameAsCurrentPassword(newPlaintext: string, currentHash: string): Promise<boolean> {
  return verifyPassword(newPlaintext, currentHash);
}
