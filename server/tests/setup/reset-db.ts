import "./load-test-env.js";
import { afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/prisma.js";

// Per-test isolation (docs/lab-02/tests.md §1.3): truncate the tables that
// individual tests write to before every test, restarting identity
// sequences so ids are predictable. Reference/requester rows (Category,
// RelatedSystem, User) are seeded once by globalSetup and left intact —
// tests must not depend on mutating them; auth.api.test.ts creates its own
// dedicated test-local Users for scenarios that need mutation (deactivation,
// role change, password change) rather than touching the seed.
//
// "Session" is added here for Lab 3 (docs/lab-03/tests.md, auth.api.test.ts):
// no other test file reads or depends on a Session row surviving across
// tests, so truncating it before every test keeps login/logout/expiry
// assertions isolated the same way Ticket/Attachment already are. It has an
// FK to User (`onDelete: Cascade`), so truncating it alone — never User —
// is safe and leaves every seeded User row untouched.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Attachment", "Ticket", "TicketCounter", "Session" RESTART IDENTITY CASCADE;'
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
