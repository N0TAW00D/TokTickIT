import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Runs once before any test file: ensures the dedicated test database
    // (server/.env.test) exists, is migrated, and is seeded. Never touches
    // the dev database (see scripts/test-db.lib.ts for the safety checks).
    globalSetup: ['./tests/setup/global-setup.ts'],
    // Runs before every test file: pins DATABASE_URL to the test database
    // for this worker, then truncates Ticket/Attachment/TicketCounter
    // before each test for isolation (docs/lab-02/tests.md §1.3).
    setupFiles: ['./tests/setup/load-test-env.ts', './tests/setup/reset-db.ts'],
  },
});
