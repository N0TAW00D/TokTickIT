import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { runPackageBin, serverRoot } from "../../scripts/test-db.lib.js";

// Covers the Issue #14 acceptance criteria that are specific to the schema
// and seed data (docs/lab-02/specification.md §7.1, §7.6):
//   - `npm run db:seed` is idempotent (running it twice yields identical
//     row counts).
//   - The inactive Requester (Robert Wilson) exists and is the only
//     inactive one.
//   - The 4 categories and >= 6 related systems exist.
//   - Schema-level uniqueness constraints hold: Ticket.ticketNumber and
//     User.email (renamed from RequesterUser in Lab 3, specification.md
//     §7.4 item 1).
//
// This file runs against the dedicated test database only (never the dev
// database) — see tests/setup/global-setup.ts and tests/setup/load-test-env.ts.

describe("seed data (specification.md §7.6)", () => {
  it("seeds exactly the 4 required categories, all active", async () => {
    const categories = await prisma.category.findMany({
      orderBy: { id: "asc" },
    });

    expect(categories.map((c) => c.name)).toEqual([
      "Account and Access",
      "Hardware",
      "Software",
      "Network",
    ]);
    expect(categories.every((c) => c.isActive)).toBe(true);
  });

  it("seeds at least 6 active related systems", async () => {
    const relatedSystems = await prisma.relatedSystem.findMany();

    expect(relatedSystems.length).toBeGreaterThanOrEqual(6);
    expect(relatedSystems.every((r) => r.isActive)).toBe(true);
  });

  it("seeds at least 4 active Development Requesters", async () => {
    // Lab 3 renames RequesterUser to User and adds other roles to the same
    // table (specification.md §7.4 item 1, §7.5); the role filter keeps
    // this counting Requesters specifically.
    const activeRequesters = await prisma.user.findMany({
      where: { isActive: true, role: "REQUESTER" },
    });

    expect(activeRequesters.length).toBeGreaterThanOrEqual(4);
  });

  it("seeds exactly one inactive Requester: Robert Wilson", async () => {
    const inactiveRequesters = await prisma.user.findMany({
      where: { isActive: false, role: "REQUESTER" },
    });

    expect(inactiveRequesters).toHaveLength(1);
    expect(inactiveRequesters[0]).toMatchObject({
      name: "Robert Wilson",
      email: "robert.wilson@example.edu",
      isActive: false,
    });
  });

  it("running the seed script twice yields identical row counts", async () => {
    const countAll = async () => ({
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      requesters: await prisma.user.count({ where: { role: "REQUESTER" } }),
      activeRequesters: await prisma.user.count({
        where: { isActive: true, role: "REQUESTER" },
      }),
      inactiveRequesters: await prisma.user.count({
        where: { isActive: false, role: "REQUESTER" },
      }),
    });

    const runSeed = () =>
      runPackageBin("tsx", [path.join(serverRoot, "prisma/seed.ts")], {
        cwd: serverRoot,
        env: process.env,
        stdio: "pipe",
      });

    const before = await countAll();
    runSeed();
    const afterFirstRerun = await countAll();
    runSeed();
    const afterSecondRerun = await countAll();

    expect(afterFirstRerun).toEqual(before);
    expect(afterSecondRerun).toEqual(before);
  });
});

describe("schema constraints (specification.md §7.5)", () => {
  it("rejects a duplicate User.email", async () => {
    // Renamed from RequesterUser (specification.md §7.4 item 1). email is
    // no longer a plain @unique column (a case-insensitive unique index on
    // lower(email) replaces it, §7.4 item 6, asserted by
    // server/tests/lab-03/migration.test.ts MIG-04) — an exact-same-case
    // duplicate still violates it, so this still exercises a real DB-level
    // rejection. passwordHash is a required column with no default, so a
    // throwaway value is supplied purely to isolate the email assertion.
    const existing = await prisma.user.findFirstOrThrow();

    await expect(
      prisma.user.create({
        data: { name: "Duplicate Person", email: existing.email, passwordHash: "not-a-real-hash" },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a duplicate Ticket.ticketNumber", async () => {
    const requester = await prisma.user.findFirstOrThrow({
      where: { isActive: true, role: "REQUESTER" },
    });
    const category = await prisma.category.findFirstOrThrow();
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow();

    const ticketData = {
      ticketNumber: "TKT-2026-999999",
      requesterId: requester.id,
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: "Duplicate ticket number test",
      description: "Used only to exercise the unique constraint on ticketNumber.",
      requestedPriority: "MEDIUM" as const,
      // itPriority is a required column with no default (specification.md
      // §7.1); mirrors requestedPriority per BR-22, which is what
      // createTicket.ts does on the real creation path.
      itPriority: "MEDIUM" as const,
    };

    await prisma.ticket.create({ data: ticketData });

    await expect(prisma.ticket.create({ data: ticketData })).rejects.toMatchObject({
      code: "P2002",
    });
  });
});
