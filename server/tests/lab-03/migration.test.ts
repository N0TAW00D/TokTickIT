import path from 'node:path';
import { Client, Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { resetLab2FixtureDatabase } from '../../scripts/test-db-lab2-fixture.lib.js';
import { runPackageBin, serverRoot } from '../../scripts/test-db.lib.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';

// Migration and regression coverage (docs/lab-03/tests.md §2.6, MIG-01
// ..MIG-06; specification.md §7.4). Runs the real Lab 3 migration against
// a database holding only Lab 2-era data (never the shared
// `toktickit_test` database, which tests/setup/global-setup.ts already
// migrates to the Lab 3 schema before any test file runs) and asserts the
// rename/backfills preserve every row.
//
// Per tests.md §1.4/§1.7: if the Lab 2-era fixture database cannot be
// provisioned, this must fail loudly (a real assertion failure), never
// look like a skip or a pass. resetLab2FixtureDatabase() throwing inside
// beforeAll achieves exactly that — Vitest reports every test in this file
// as failed, not skipped.
//
// MIG-07/MIG-08 (the Lab 2 regression suite re-pointed to the authenticated
// identity, and proof the Development Requester selector is gone) belong
// to `requester-regression.api.test.ts` under issue #70, not this file —
// this issue only evolves the schema/migration/seed.

let fixtureUrl: string;
let fixturePrisma: PrismaClient;

interface PreMigrationSnapshot {
  requesters: { id: number; name: string; email: string; isActive: boolean }[];
  tickets: { id: number; ticketNumber: string; requesterId: number }[];
  attachments: { id: number; ticketId: number; storedFilename: string; removedById: number | null }[];
}
let pre: PreMigrationSnapshot;

describe('Lab 2 -> Lab 3 migration (specification.md §7.4)', () => {
  beforeAll(async () => {
    fixtureUrl = await resetLab2FixtureDatabase();

    // Snapshot the Lab 2-era rows via raw SQL before migrating: the
    // Lab-3-shaped Prisma Client generated for this repo has no
    // `requesterUser` model to read the pre-migration table with.
    const raw = new Client({ connectionString: fixtureUrl });
    await raw.connect();
    try {
      const requesters = await raw.query<PreMigrationSnapshot['requesters'][number]>(
        'SELECT id, name, email, "isActive" FROM "RequesterUser" ORDER BY id'
      );
      const tickets = await raw.query<PreMigrationSnapshot['tickets'][number]>(
        'SELECT id, "ticketNumber", "requesterId" FROM "Ticket" ORDER BY id'
      );
      const attachments = await raw.query<PreMigrationSnapshot['attachments'][number]>(
        'SELECT id, "ticketId", "storedFilename", "removedById" FROM "Attachment" ORDER BY id'
      );
      pre = { requesters: requesters.rows, tickets: tickets.rows, attachments: attachments.rows };
    } finally {
      await raw.end();
    }

    expect(pre.requesters.length, 'Lab 2 fixture must seed at least one Requester').toBeGreaterThan(0);
    expect(pre.tickets.length, 'Lab 2 fixture must seed at least one Ticket').toBeGreaterThan(0);
    expect(pre.attachments.length, 'Lab 2 fixture must seed at least one Attachment').toBeGreaterThan(0);

    // Apply every migration (the two Lab 2-era ones are already recorded as
    // applied in the fixture DB's own _prisma_migrations table, so only
    // the Lab 3 migration is pending) — this is the real thing under test.
    runPackageBin('prisma', ['migrate', 'deploy'], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: fixtureUrl },
      stdio: 'pipe',
    });

    fixturePrisma = new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: fixtureUrl })),
    });
  });

  afterAll(async () => {
    await fixturePrisma?.$disconnect();
  });

  it('MIG-01: every Ticket and Attachment survives the rename with the same id and ownership', async () => {
    const tickets = await fixturePrisma.ticket.findMany({ orderBy: { id: 'asc' } });
    expect(tickets.map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, requesterId: t.requesterId }))).toEqual(
      pre.tickets
    );

    const attachments = await fixturePrisma.attachment.findMany({ orderBy: { id: 'asc' } });
    expect(
      attachments.map((a) => ({
        id: a.id,
        ticketId: a.ticketId,
        storedFilename: a.storedFilename,
        removedById: a.removedById,
      }))
    ).toEqual(pre.attachments);
  });

  it('MIG-02: every RequesterUser row becomes a REQUESTER User with the same id', async () => {
    const migratedIds = pre.requesters.map((r) => r.id);
    const users = await fixturePrisma.user.findMany({
      where: { id: { in: migratedIds } },
      orderBy: { id: 'asc' },
    });

    expect(users.map((u) => u.id)).toEqual(migratedIds);
    expect(users.every((u) => u.role === 'REQUESTER')).toBe(true);

    for (const before of pre.requesters) {
      const after = users.find((u) => u.id === before.id)!;
      expect(after.name).toBe(before.name);
      expect(after.isActive).toBe(before.isActive);
      // mustChangePassword defaults true, so a migrated Lab 2 Requester
      // must choose a new password at first login (§7.4 item 4).
      expect(after.mustChangePassword).toBe(true);
    }
  });

  it('MIG-03: no null passwordHash; every itPriority equals its requestedPriority', async () => {
    const users = await fixturePrisma.user.findMany();
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => typeof u.passwordHash === 'string' && u.passwordHash.length > 0)).toBe(true);

    const tickets = await fixturePrisma.ticket.findMany();
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.itPriority).toBe(t.requestedPriority);
    }
  });

  it('MIG-04: emails are lower-cased and the case-insensitive unique index rejects a case-variant duplicate', async () => {
    const users = await fixturePrisma.user.findMany();
    for (const u of users) {
      expect(u.email).toBe(u.email.toLowerCase());
    }

    const mixedCaseUser = users.find((u) => u.email === 'mixed.case@example.edu');
    expect(mixedCaseUser, 'the mixed-case fixture email must have been lower-cased').toBeDefined();

    // A real DB-level rejection, not application validation: attempt the
    // duplicate insert directly against the case-insensitive unique index.
    const raw = new Client({ connectionString: fixtureUrl });
    await raw.connect();
    try {
      await expect(
        raw.query(
          `INSERT INTO "User" (name, email, "passwordHash", role, "isActive", "mustChangePassword", "updatedAt")
           VALUES ('Case Variant', 'MIXED.CASE@EXAMPLE.EDU', 'x', 'REQUESTER', true, true, now())`
        )
      ).rejects.toMatchObject({ code: '23505' }); // Postgres unique_violation
    } finally {
      await raw.end();
    }
  });

  it('MIG-05: running the seed twice against the migrated database leaves identical row counts and no duplicate emails', async () => {
    const countAll = async () => ({
      users: await fixturePrisma.user.count(),
      categories: await fixturePrisma.category.count(),
      relatedSystems: await fixturePrisma.relatedSystem.count(),
      tickets: await fixturePrisma.ticket.count(),
      publicComments: await fixturePrisma.publicComment.count(),
      internalNotes: await fixturePrisma.internalNote.count(),
    });

    const runSeed = () =>
      runPackageBin('tsx', [path.join(serverRoot, 'prisma/seed.ts')], {
        cwd: serverRoot,
        env: { ...process.env, DATABASE_URL: fixtureUrl },
        stdio: 'pipe',
      });

    runSeed();
    const afterFirstRun = await countAll();
    runSeed();
    const afterSecondRun = await countAll();

    expect(afterSecondRun).toEqual(afterFirstRun);

    const emails = (await fixturePrisma.user.findMany({ select: { email: true } })).map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('MIG-06: no column in any table holds a seeded password in clear text', async () => {
    // The seed has already run (MIG-05, above), so the fixture database
    // now also carries LOCAL_DEV_PASSWORD-based accounts to check.
    const raw = new Client({ connectionString: fixtureUrl });
    await raw.connect();
    try {
      // Genuinely "no column in any table" — walk every character-typed
      // column in the public schema and check none of them stores the
      // plaintext local-dev password verbatim, rather than assuming it can
      // only ever land in User.passwordHash.
      const columns = await raw.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND data_type IN ('text', 'character varying', 'character')`
      );
      expect(columns.rows.length).toBeGreaterThan(0);

      for (const { table_name, column_name } of columns.rows) {
        const result = await raw.query(
          `SELECT count(*)::int AS count FROM "${table_name}" WHERE "${column_name}" = $1`,
          [LOCAL_DEV_PASSWORD]
        );
        expect(
          result.rows[0].count,
          `"${table_name}"."${column_name}" must never store the seeded password in clear text`
        ).toBe(0);
      }
    } finally {
      await raw.end();
    }

    const users = await fixturePrisma.user.findMany();
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.passwordHash).not.toBe(LOCAL_DEV_PASSWORD);
      // bcrypt hash prefix ($2a$/$2b$/$2y$) — proves it's a real hash, not
      // some other encoding of the plaintext.
      expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
      await expect(bcrypt.compare(LOCAL_DEV_PASSWORD, u.passwordHash)).resolves.toBe(true);
    }
  });
});
