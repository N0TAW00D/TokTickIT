import bcrypt from 'bcrypt';

// bcrypt cost factor (BR-06, D-01) — a single constant to raise later.
export const BCRYPT_COST = 12;

/** Hashes a plaintext password with bcrypt at BCRYPT_COST. Never returns
 * or logs the plaintext (BR-06). */
export function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, BCRYPT_COST);
}

/** True if `plainTextPassword` is the password `hash` was produced from. */
export function verifyPassword(plainTextPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, hash);
}
