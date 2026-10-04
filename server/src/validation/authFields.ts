// Login field validators (api-spec.md §2.1, BR-01). Split out the same way
// validation/ticketFields.ts and validation/attachmentRemoval.ts are — pure,
// DB/Express-free, and reusable.
//
// Scope note: this covers only the shape of a login request's `email` and
// `password`. Password *policy* (length, same-as-current) is a change-
// password concern and lives in validation/passwordPolicy.ts instead — a
// login password is checked for presence only, never length, because an
// existing account's password may predate BR-07's 8-128 rule (e.g. a
// migrated Lab 2 seed whose backfilled password happens to be shorter or
// longer than today's policy).

import type { FieldResult } from './ticketFields.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Login email: required, a string, non-empty and shaped like an email
 * address after trimming. The returned value is lower-cased (BR-09) so the
 * caller can use it directly as the lookup key without re-deriving
 * normalization rules.
 */
export function validateLoginEmail(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, error: { field: 'email', message: 'Email is required.' } };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0 || !EMAIL_PATTERN.test(trimmed)) {
    return { ok: false, error: { field: 'email', message: 'Enter a valid email address.' } };
  }

  return { ok: true, value: trimmed.toLowerCase() };
}

/** Login password: required, a non-empty string. No length policy — see file header. */
export function validateLoginPassword(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: { field: 'password', message: 'Password is required.' } };
  }

  return { ok: true, value: raw };
}
