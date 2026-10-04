import { resetLab2FixtureDatabase } from "./test-db-lab2-fixture.lib.js";

// CLI entry point for `npm run db:test:lab2-fixture` (docs/lab-03/tests.md
// §1.4, §5): (re)creates the dedicated Lab 2-era fixture database used by
// server/tests/lab-03/migration.test.ts. migration.test.ts also calls
// resetLab2FixtureDatabase() itself in its own beforeAll, so `npm test` is
// self-contained the same way tests/setup/global-setup.ts already makes
// the main test database self-contained — this script exists for the
// documented manual/CI step alongside `db:test:reset`.
resetLab2FixtureDatabase()
  .then((url) => {
    console.log(`Lab 2-era fixture database ready: ${url}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
