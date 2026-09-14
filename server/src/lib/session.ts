import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

// Session token generation, hashing and cookie handling (api-spec.md §1.2,
// specification.md §7.1, §8.2). The raw token lives only in the cookie and
// is never persisted — `Session.tokenHash` stores its SHA-256 hash, so a
// database leak yields no usable session.

export const SESSION_COOKIE_NAME = 'toktickit.sid';

/** Absolute session lifetime from creation, 8 hours (BR-11, D-03). */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** 256 bits of CSPRNG randomness, base64url-encoded (api-spec.md §1.2). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a raw session token — what `Session.tokenHash` stores. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// There is no reverse proxy in front of this app anywhere in this stack, so
// Express's 'trust proxy' setting is deliberately left at its default
// (unset) rather than trusting a client-suppliable X-Forwarded-Proto header
// from an untrusted hop. `req.secure` therefore reflects the actual TLS
// state of the connection Express itself terminated.
function isHttps(req: Request): boolean {
  return req.secure;
}

/** Sets `toktickit.sid` with the attributes api-spec.md §1.2 requires. */
export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isHttps(req),
    maxAge: SESSION_TTL_MS,
  });
}

/** Clears the cookie via `Max-Age=0` (api-spec.md §2.2). */
export function clearSessionCookie(req: Request, res: Response): void {
  res.cookie(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isHttps(req),
    maxAge: 0,
  });
}

/**
 * Reads the raw session token out of the `Cookie` request header.
 *
 * No cookie-parsing middleware (e.g. `cookie-parser`) is installed anywhere
 * in this app, and none of this app's other routes need one — so this
 * parses the header by hand rather than adding a new dependency for a
 * single, simply-shaped cookie value (an unpadded base64url token, which by
 * construction never contains `;`, `,`, or whitespace — the characters that
 * make hand-rolled cookie parsing generally unsafe for arbitrary values).
 */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
