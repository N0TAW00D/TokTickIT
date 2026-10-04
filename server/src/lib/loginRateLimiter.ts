// In-memory login rate limiter (BR-38, D-15, api-spec.md §2.1): 10 failed
// login attempts against a single key within a 15-minute sliding window,
// then that key is refused for the remainder of the window — self-clearing,
// never a permanent lock (handout §4.2 excludes account unlocking).
//
// Two independent dimensions — per-email and per-source-IP — are just two
// key namespaces into the same store; the caller prefixes keys with
// "email:"/"ip:" so the two can never collide with each other.
//
// In-memory and per-process: this resets on restart and does not coordinate
// across multiple server instances. That is an accepted limitation for this
// lab's single-instance deployment; a multi-instance deployment would need a
// shared store (e.g. Redis) instead.

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 10;

const attemptsByKey = new Map<string, number[]>();

function recentTimestamps(key: string, now: number): number[] {
  const timestamps = (attemptsByKey.get(key) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  attemptsByKey.set(key, timestamps);
  return timestamps;
}

/** True once `key` has accumulated `MAX_FAILED_ATTEMPTS` failures inside the current 15-minute window. */
export function isRateLimited(key: string): boolean {
  return recentTimestamps(key, Date.now()).length >= MAX_FAILED_ATTEMPTS;
}

/** Records one failed attempt against `key`, timestamped now. */
export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const timestamps = recentTimestamps(key, now);
  timestamps.push(now);
  attemptsByKey.set(key, timestamps);
}

/** Test-only: clears every tracked key so rate-limit state never bleeds across tests. */
export function __resetLoginRateLimiterForTests(): void {
  attemptsByKey.clear();
}
