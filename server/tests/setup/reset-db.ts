import "./load-test-env.js";
import { afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/prisma.js";

// Per-test isolation (docs/lab-02/tests.md §1.3): truncate the tables that
// individual tests write to before every test, restarting identity
// sequences so ids are predictable. Reference/requester rows (Category,
// RelatedSystem, RequesterUser) are seeded once by globalSetup and left
// intact — tests must not depend on mutating them.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Attachment", "Ticket", "TicketCounter" RESTART IDENTITY CASCADE;'
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
