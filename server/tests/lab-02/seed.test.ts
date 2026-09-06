import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { serverRoot } from "../../scripts/test-db.lib.js";

// Covers the Issue #14 acceptance criteria that are specific to the schema
// and seed data (docs/lab-02/specification.md §7.1, §7.6):
//   - `npm run db:seed` is idempotent (running it twice yields identical
//     row counts).
//   - The inactive Requester (Robert Wilson) exists and is the only
//     inactive one.
//   - The 4 categories and >= 6 related systems exist.
//   - Schema-level uniqueness constraints hold: Ticket.ticketNumber and
//     RequesterUser.email.
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
    const activeRequesters = await prisma.requesterUser.findMany({
      where: { isActive: true },
    });

    expect(activeRequesters.length).toBeGreaterThanOrEqual(4);
  });

  it("seeds exactly one inactive Requester: Robert Wilson", async () => {
    const inactiveRequesters = await prisma.requesterUser.findMany({
      where: { isActive: false },
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
      requesters: await prisma.requesterUser.count(),
      activeRequesters: await prisma.requesterUser.count({
        where: { isActive: true },
      }),
      inactiveRequesters: await prisma.requesterUser.count({
        where: { isActive: false },
      }),
    });

    const runSeed = () =>
      execFileSync("npx", ["tsx", path.join(serverRoot, "prisma/seed.ts")], {
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
  it("rejects a duplicate RequesterUser.email", async () => {
    const existing = await prisma.requesterUser.findFirstOrThrow();

    await expect(
      prisma.requesterUser.create({
        data: { name: "Duplicate Person", email: existing.email },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a duplicate Ticket.ticketNumber", async () => {
    const requester = await prisma.requesterUser.findFirstOrThrow({
      where: { isActive: true },
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
    };

    await prisma.ticket.create({ data: ticketData });

    await expect(prisma.ticket.create({ data: ticketData })).rejects.toMatchObject({
      code: "P2002",
    });
  });
});
