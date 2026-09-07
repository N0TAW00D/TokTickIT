import { resetTestDatabase } from "./test-db.lib.js";

// CLI entry point for `npm run db:test:reset` (docs/lab-02/tests.md §5):
// creates the dedicated test database if needed, applies all migrations,
// and seeds it with the Lab 2 reference/fixture data.
resetTestDatabase()
  .then((url) => {
    console.log(`Test database ready: ${url}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
