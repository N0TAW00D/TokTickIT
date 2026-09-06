import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Pin the test process's time zone to UTC. BR-01 requires Ticket
    // Number years to be computed in Asia/Bangkok regardless of host time
    // zone (see src/services/ticketNumber.ts), and the tests assert that
    // with instants that straddle a year boundary in UTC+7 but not in UTC.
    // Every developer machine and CI runner we know of is *already*
    // Asia/Bangkok, so an unpinned run can't tell correct
    // `Intl.DateTimeFormat`-based code apart from a naive, wrong
    // `Date.prototype.getFullYear()` implementation — both pass locally.
    // Pinning to a zone that genuinely differs from Bangkok makes those
    // assertions meaningful everywhere, not just accidentally on CI.
    env: {
      TZ: 'UTC',
    },
    // Runs once before any test file: ensures the dedicated test database
    // (server/.env.test) exists, is migrated, and is seeded. Never touches
    // the dev database (see scripts/test-db.lib.ts for the safety checks).
    globalSetup: ['./tests/setup/global-setup.ts'],
    // Runs before every test file: pins DATABASE_URL to the test database
    // for this worker, then truncates Ticket/Attachment/TicketCounter
    // before each test for isolation (docs/lab-02/tests.md §1.3).
    setupFiles: ['./tests/setup/load-test-env.ts', './tests/setup/reset-db.ts'],
    // Every test file shares the one `toktickit_test` database, and
    // reset-db.ts truncates Ticket/Attachment/TicketCounter before each
    // test. Running files in parallel therefore lets one worker wipe rows
    // another worker is mid-way through asserting on. Serialising test
    // files keeps that truncation a real isolation boundary instead of a
    // race — required before #16-#19 add four more ticket-writing suites.
    fileParallelism: false,
  },
});
