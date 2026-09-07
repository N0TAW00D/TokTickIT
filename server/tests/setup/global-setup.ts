import { resetTestDatabase } from "../../scripts/test-db.lib.js";

// Vitest `globalSetup`: runs once, before any test file, in the main
// process. It guarantees the dedicated test database (server/.env.test)
// exists, is fully migrated, and is seeded — so `npm test` is self-contained
// and never depends on a developer having run `db:test:reset` first.
//
// It never touches the dev database: resetTestDatabase() refuses to run
// unless .env.test resolves to a different, "test"-named database than
// server/.env (see scripts/test-db.lib.ts).
export default async function globalSetup() {
  await resetTestDatabase();
}
