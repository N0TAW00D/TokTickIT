import { describe, expect, it } from 'vitest';
import { BCRYPT_COST, hashPassword, verifyPassword } from '../../src/lib/password.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isSameAsCurrentPassword,
  validatePasswordLength,
} from '../../src/validation/passwordPolicy.js';

// UNIT-01 (docs/lab-03/tests.md §2.1, BR-06): bcrypt hash + verify
// round-trips, the cost factor is 12, and the hash is never the plaintext.
//
// UNIT-02/UNIT-03 (below) are #68's — password policy (length 8-128) and
// the same-as-current check, both from validation/passwordPolicy.ts.
// UNIT-10 and UNIT-11 (email normalisation, comment/note body validation)
// remain out of scope for this file: UNIT-10 is #67's email lower-casing;
// UNIT-11 lives in tests/lab-03/comment-validation.test.ts (#70) instead.
describe('password hashing (BR-06, UNIT-01)', () => {
  const PLAINTEXT = 'CorrectHorseBatteryStaple1';

  it('round-trips: a hash verifies against the plaintext it was hashed from', async () => {
    const hash = await hashPassword(PLAINTEXT);
    await expect(verifyPassword(PLAINTEXT, hash)).resolves.toBe(true);
  });

  it('rejects the wrong plaintext', async () => {
    const hash = await hashPassword(PLAINTEXT);
    await expect(verifyPassword('SomethingElseEntirely1', hash)).resolves.toBe(false);
  });

  it('never returns the plaintext itself as the hash', async () => {
    const hash = await hashPassword(PLAINTEXT);
    expect(hash).not.toBe(PLAINTEXT);
  });

  it('hashes at bcrypt cost factor 12', async () => {
    const hash = await hashPassword(PLAINTEXT);
    // bcrypt hash format: $<algorithm>$<cost>$<22-char-salt><31-char-hash>
    const [, , costField] = hash.split('$');
    expect(Number(costField)).toBe(12);
    expect(BCRYPT_COST).toBe(12);
  });

  it('salts each hash independently, so hashing the same password twice differs', async () => {
    const [a, b] = await Promise.all([hashPassword(PLAINTEXT), hashPassword(PLAINTEXT)]);
    expect(a).not.toBe(b);
    await expect(verifyPassword(PLAINTEXT, a)).resolves.toBe(true);
    await expect(verifyPassword(PLAINTEXT, b)).resolves.toBe(true);
  });
});

// UNIT-02 (docs/lab-03/tests.md §2.1, BR-07): new-password length policy —
// 7 and 129 characters rejected, 8 and 128 (the boundary values themselves)
// accepted.
describe('password length policy (BR-07, UNIT-02)', () => {
  it('rejects a password one character shorter than the minimum', () => {
    const result = validatePasswordLength('a'.repeat(PASSWORD_MIN_LENGTH - 1), 'newPassword');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('newPassword');
    }
  });

  it('rejects a password one character longer than the maximum', () => {
    const result = validatePasswordLength('a'.repeat(PASSWORD_MAX_LENGTH + 1), 'newPassword');
    expect(result.ok).toBe(false);
  });

  it('accepts a password at exactly the minimum length', () => {
    const result = validatePasswordLength('a'.repeat(PASSWORD_MIN_LENGTH), 'newPassword');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(PASSWORD_MIN_LENGTH);
    }
  });

  it('accepts a password at exactly the maximum length', () => {
    const result = validatePasswordLength('a'.repeat(PASSWORD_MAX_LENGTH), 'newPassword');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(PASSWORD_MAX_LENGTH);
    }
  });

  it('rejects a missing/non-string value with a field error, not a throw', () => {
    const result = validatePasswordLength(undefined, 'newPassword');
    expect(result.ok).toBe(false);
  });

  it('uses the caller-supplied field name in the error, e.g. for initialPassword', () => {
    const result = validatePasswordLength('short', 'initialPassword');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('initialPassword');
    }
  });

  it('does not trim: a password padded with spaces past the boundary is judged on its literal length', () => {
    // 8 significant chars + 2 leading spaces = 10 literal chars, still
    // within policy either way, but this pins the "no trimming" behavior
    // documented on validatePasswordLength.
    const padded = `  ${'a'.repeat(PASSWORD_MIN_LENGTH)}`;
    const result = validatePasswordLength(padded, 'newPassword');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(padded);
    }
  });
});

// UNIT-03 (docs/lab-03/tests.md §2.1, BR-07): a new password identical to
// the current one is rejected.
describe('same-as-current password check (BR-07, UNIT-03)', () => {
  const CURRENT_PLAINTEXT = 'CurrentPasswordValue1';

  it('reports true when the candidate password is the one the hash was produced from', async () => {
    const hash = await hashPassword(CURRENT_PLAINTEXT);
    await expect(isSameAsCurrentPassword(CURRENT_PLAINTEXT, hash)).resolves.toBe(true);
  });

  it('reports false for a genuinely different candidate password', async () => {
    const hash = await hashPassword(CURRENT_PLAINTEXT);
    await expect(isSameAsCurrentPassword('SomethingCompletelyDifferent1', hash)).resolves.toBe(false);
  });
});
