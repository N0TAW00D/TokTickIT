import { resetLab3FixtureDatabase } from "./test-db-lab3-fixture.lib.js";

// CLI entry point for `npm run db:test:lab3-fixture` (docs/lab-04/tests.md
// §1.2): (re)creates the dedicated Lab 3-shaped fixture database used by
// server/tests/lab-04/migration.test.ts. The test file also calls
// resetLab3FixtureDatabase() itself, so `npm test` stays self-contained —
// this script exists for the documented manual/CI step.
resetLab3FixtureDatabase()
  .then((url) => {
    console.log(`Lab 3-shaped fixture database ready: ${url}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
