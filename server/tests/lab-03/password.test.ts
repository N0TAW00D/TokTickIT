import { describe, expect, it } from 'vitest';
import { BCRYPT_COST, hashPassword, verifyPassword } from '../../src/lib/password.js';

// UNIT-01 (docs/lab-03/tests.md §2.1, BR-06): bcrypt hash + verify
// round-trips, the cost factor is 12, and the hash is never the plaintext.
//
// This is the only Lab 3 unit test this issue (#67) implements. UNIT-02,
// UNIT-03, UNIT-10 and UNIT-11 (password policy, same-as-current check,
// email normalisation, comment/note body validation) belong to the
// validation module #68 (authentication foundation) introduces — this
// issue adds no such module, only the bcrypt hashing helper the migration
// and seed also depend on.
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
