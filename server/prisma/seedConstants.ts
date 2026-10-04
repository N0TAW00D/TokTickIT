// Split out of seed.ts so it can be imported for its value alone (by
// server/tests/lab-03/migration.test.ts, MIG-06) without triggering
// seed.ts's own module-level `main()` side effect, which connects to
// `process.env.DATABASE_URL` and writes to it as soon as the module loads.

// All seeded accounts share this one password and are flagged
// `mustChangePassword: false` (docs/lab-03/specification.md §7.5, D-13) so
// the seed is directly usable for manual testing. This is a fake,
// LOCAL-DEVELOPMENT-ONLY password — it grants access to no non-local
// system, is not a real secret, and is documented here and in README.md
// (AC-58). The Lab 3 migration also hashes this same constant to backfill
// every migrated Lab 2 Requester's passwordHash (see prisma/migrations/
// 20260914120000_evolve_user_model_roles_sessions/migration.sql), so a
// migrated Lab 2 account and a freshly-seeded Lab 3 account can both log
// in with it.
export const LOCAL_DEV_PASSWORD = 'DevPassword123!';
