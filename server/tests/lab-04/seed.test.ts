import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import { hashActionCreateBody } from '../../src/services/actionRequestHash.js';
import { ACTIONS, originalCreateBody } from '../../prisma/seedLab4.js';
import { runPackageBin, serverRoot } from '../../scripts/test-db.lib.js';

// Seed coverage for Lab 4 (docs/lab-04/tests.md MIG-06..MIG-08;
// specification.md §7.5). Runs the real seed script against the shared test
// database as a child process.
//
// Why each test seeds for itself: tests/setup/reset-db.ts truncates Ticket
// (CASCADE to ActionTaken, TicketStatusChange, comments) before EVERY test,
// so Ticket-level seed data from global-setup never survives into a test
// body. Seeding inside each test makes the dataset deterministic regardless
// of test order. Users/reference data are never truncated and the seed is
// idempotent, so re-running it here is safe. afterAll truncates the Ticket
// tables again so this file leaves the DB as the other suites expect it.
//
// Expected metric values are computed with independent SQL here; no
// dashboard service code is imported (it does not exist yet).

const testServer = useTestServer(app);

function runSeed(): void {
  runPackageBin('tsx', [path.join(serverRoot, 'prisma/seed.ts')], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
}

// BR-22: 00:00 Asia/Bangkok on the day six days before today.
const WINDOW_START = `((date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') - interval '6 days') AT TIME ZONE 'Asia/Bangkok')`;
const OPEN = `('RESOLVED','CLOSED','CANCELLED')`;

async function one<T = number>(sql: string, ...params: unknown[]): Promise<T> {
  const rows = await prisma.$queryRawUnsafe<{ v: T }[]>(sql, ...params);
  return Number(rows[0]!.v) as T;
}

async function userId(email: string): Promise<number> {
  const u = await prisma.user.findFirstOrThrow({ where: { email } });
  return u.id;
}

async function countAllTables(): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    counts[tablename] = await one(`SELECT count(*)::int AS v FROM "${tablename}"`);
  }
  return counts;
}

beforeEach(() => {
  runSeed();
}, 120_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Attachment", "Ticket", "TicketCounter", "Session" RESTART IDENTITY CASCADE;'
  );
});

describe('Lab 4 seed', () => {
  it('MIG-06: running the seed twice leaves identical row counts for every table, including Actions and history', async () => {
    const afterFirst = await countAllTables();
    // Guard against a vacuous pass: the tables under test must be populated.
    expect(afterFirst.ActionTaken).toBeGreaterThan(0);
    expect(afterFirst.TicketStatusChange).toBeGreaterThan(0);

    runSeed();
    const afterSecond = await countAllTables();
    expect(afterSecond).toEqual(afterFirst);

    // Actions are keyed on (ticketId, clientRequestId): no key may repeat.
    const dupes = await one(`
      SELECT count(*)::int AS v FROM (
        SELECT "ticketId", "clientRequestId" FROM "ActionTaken"
        GROUP BY 1, 2 HAVING count(*) > 1) d`);
    expect(dupes).toBe(0);
  }, 120_000);

  it('MIG-07: seeded data covers statuses, priorities, Action counts, performers, follow-ups and resolution-gate row of §7.5', async () => {
    // Eight statuses, at least two Tickets each.
    const byStatus = await prisma.$queryRaw<{ status: string; n: number }[]>`
      SELECT status::text AS status, count(*)::int AS n FROM "Ticket" GROUP BY status`;
    const statusCount = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
    for (const s of [
      'NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER',
      'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED',
    ]) {
      expect(statusCount[s] ?? 0, `Tickets in ${s}`).toBeGreaterThanOrEqual(2);
    }

    // All three IT Priorities among Open Tickets; several unassigned Open Tickets.
    for (const p of ['LOW', 'MEDIUM', 'HIGH']) {
      expect(
        await one(`SELECT count(*)::int AS v FROM "Ticket" WHERE status NOT IN ${OPEN} AND "itPriority" = '${p}'`),
        `Open Tickets with IT Priority ${p}`
      ).toBeGreaterThan(0);
    }
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" WHERE status NOT IN ${OPEN} AND "ownerId" IS NULL`)
    ).toBeGreaterThanOrEqual(3);
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" WHERE status NOT IN ${OPEN} AND "ownerId" IS NOT NULL`)
    ).toBeGreaterThan(0);

    // Lab 3 invariant kept: In Progress rows carry an owner.
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" WHERE status = 'IN_PROGRESS' AND "ownerId" IS NULL`)
    ).toBe(0);

    // Tickets with 0, 1 and 4+ Actions.
    const perTicket = await prisma.$queryRaw<{ n: number }[]>`
      SELECT (SELECT count(*) FROM "ActionTaken" a WHERE a."ticketId" = t.id)::int AS n FROM "Ticket" t`;
    expect(perTicket.some((r) => r.n === 0)).toBe(true);
    expect(perTicket.some((r) => r.n === 1)).toBe(true);
    expect(perTicket.some((r) => r.n >= 4)).toBe(true);

    // One Ticket with Actions by three different performers, one an Administrator.
    const multi = await prisma.$queryRaw<{ id: number }[]>`
      SELECT a."ticketId" AS id FROM "ActionTaken" a
      GROUP BY a."ticketId" HAVING count(DISTINCT a."performedById") >= 3`;
    expect(multi.length).toBeGreaterThanOrEqual(1);
    const multiRoles = await prisma.$queryRaw<{ role: string }[]>`
      SELECT DISTINCT u.role::text AS role FROM "ActionTaken" a
      JOIN "User" u ON u.id = a."performedById" WHERE a."ticketId" = ${multi[0]!.id}`;
    expect(multiRoles.map((r) => r.role)).toContain('ADMINISTRATOR');

    // All four Action statuses.
    const statuses = await prisma.$queryRaw<{ s: string }[]>`SELECT DISTINCT status::text AS s FROM "ActionTaken"`;
    expect(statuses.map((r) => r.s).sort()).toEqual(['CANCELLED', 'COMPLETED', 'IN_PROGRESS', 'PLANNED']);

    // Exactly two follow-ups, each with a note; every COMPLETED Action has a result.
    expect(await one(`SELECT count(*)::int AS v FROM "ActionTaken" WHERE "followUpRequired"`)).toBe(2);
    expect(
      await one(`SELECT count(*)::int AS v FROM "ActionTaken" WHERE "followUpRequired" AND coalesce(btrim("followUpNote"), '') = ''`)
    ).toBe(0);
    expect(
      await one(`SELECT count(*)::int AS v FROM "ActionTaken" WHERE status = 'COMPLETED' AND coalesce(btrim(result), '') = ''`)
    ).toBe(0);

    // Resolution gate (BR-17): owner + >=1 COMPLETED + no PLANNED/IN_PROGRESS.
    const gateOk = `
      t."ownerId" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "ActionTaken" a WHERE a."ticketId" = t.id AND a.status = 'COMPLETED')
      AND NOT EXISTS (SELECT 1 FROM "ActionTaken" a WHERE a."ticketId" = t.id AND a.status IN ('PLANNED','IN_PROGRESS'))`;
    // Every seeded RESOLVED Ticket that has Actions satisfies the gate...
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" t WHERE t.status = 'RESOLVED'
        AND EXISTS (SELECT 1 FROM "ActionTaken" a WHERE a."ticketId" = t.id) AND NOT (${gateOk})`)
    ).toBe(0);
    // ...and at least one does (the gate-passing Resolved Ticket)...
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" t WHERE t.status = 'RESOLVED' AND ${gateOk}`)
    ).toBeGreaterThanOrEqual(1);
    // ...while the blocked candidate is a not-yet-Resolved Ticket with an owner, a
    // COMPLETED Action and a PLANNED Action.
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" t
        WHERE t.status NOT IN ('RESOLVED','CLOSED','CANCELLED') AND t."ownerId" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "ActionTaken" a WHERE a."ticketId" = t.id AND a.status = 'COMPLETED')
        AND EXISTS (SELECT 1 FROM "ActionTaken" a WHERE a."ticketId" = t.id AND a.status = 'PLANNED')`)
    ).toBeGreaterThanOrEqual(1);

    // Status history: consistent with each Ticket's status, except NEW and
    // deliberate legacy Tickets (>=1 RESOLVED/CLOSED legacy Ticket updated in the window).
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" t WHERE t.status <> 'NEW'
        AND (SELECT h."toStatus" FROM "TicketStatusChange" h WHERE h."ticketId" = t.id
             ORDER BY h."changedAt" DESC, h.id DESC LIMIT 1) IS DISTINCT FROM t.status
        AND EXISTS (SELECT 1 FROM "TicketStatusChange" h WHERE h."ticketId" = t.id)`),
      'latest history row must equal the Ticket status when history exists'
    ).toBe(0);
    const legacy = await one(`SELECT count(*)::int AS v FROM "Ticket" t WHERE t.status <> 'NEW'
      AND NOT EXISTS (SELECT 1 FROM "TicketStatusChange" h WHERE h."ticketId" = t.id)`);
    expect(legacy).toBeGreaterThanOrEqual(2);
    expect(legacy).toBeLessThanOrEqual(4);
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" t WHERE t.status IN ('RESOLVED','CLOSED')
        AND t."updatedAt" >= ${WINDOW_START}
        AND NOT EXISTS (SELECT 1 FROM "TicketStatusChange" h WHERE h."ticketId" = t.id)`)
    ).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('MIG-08: named users have the documented zero and non-zero dashboard metrics', async () => {
    const recentlyResolved = (requesterId: number) =>
      one(
        `SELECT count(*)::int AS v FROM "Ticket" t
         WHERE t."requesterId" = $1 AND t.status IN ('RESOLVED','CLOSED')
         AND (SELECT h."changedAt" FROM "TicketStatusChange" h
              WHERE h."ticketId" = t.id AND h."toStatus" IN ('RESOLVED','CLOSED')
              ORDER BY h."changedAt" DESC, h.id DESC LIMIT 1) >= ${WINDOW_START}`,
        requesterId
      );
    const requesterOpen = (id: number) =>
      one(`SELECT count(*)::int AS v FROM "Ticket" WHERE "requesterId" = $1 AND status NOT IN ${OPEN}`, id);
    const requesterWaiting = (id: number) =>
      one(`SELECT count(*)::int AS v FROM "Ticket" WHERE "requesterId" = $1 AND status = 'WAITING_FOR_REQUESTER'`, id);
    const requesterUpdated = (id: number) =>
      one(`SELECT count(*)::int AS v FROM "Ticket" WHERE "requesterId" = $1 AND "updatedAt" >= ${WINDOW_START}`, id);

    const staffOwned = (id: number) =>
      one(`SELECT count(*)::int AS v FROM "Ticket" WHERE "ownerId" = $1 AND status NOT IN ${OPEN}`, id);
    const staffOpenActions = (id: number) =>
      one(
        `SELECT count(*)::int AS v FROM "ActionTaken" a JOIN "Ticket" t ON t.id = a."ticketId"
         WHERE a.status IN ('PLANNED','IN_PROGRESS') AND t.status NOT IN ${OPEN}
         AND (a."assigneeId" = $1 OR (a."assigneeId" IS NULL AND a."performedById" = $1))`,
        id
      );
    // BR-26 / BR-27 / BR-22 are global definitions; the owner-scoped variants
    // are checked as well so Priya is non-zero under either reading.
    const followUps = (ownerId?: number) =>
      one(
        `SELECT count(DISTINCT t.id)::int AS v FROM "Ticket" t JOIN "ActionTaken" a ON a."ticketId" = t.id
         WHERE t.status NOT IN ${OPEN} AND a."followUpRequired" AND a.status <> 'CANCELLED'
         ${ownerId ? 'AND t."ownerId" = ' + ownerId : ''}`
      );
    const urgent = (ownerId?: number) =>
      one(
        `SELECT count(*)::int AS v FROM "Ticket" t WHERE t.status NOT IN ${OPEN} AND t."itPriority" = 'HIGH'
         ${ownerId ? 'AND t."ownerId" = ' + ownerId : ''}`
      );
    const staffUpdated = (ownerId?: number) =>
      one(
        `SELECT count(*)::int AS v FROM "Ticket" t WHERE t."updatedAt" >= ${WINDOW_START}
         ${ownerId ? 'AND t."ownerId" = ' + ownerId : ''}`
      );

    // Priya Natarajan (IT Staff): every metric > 0.
    const priya = await userId('priya.natarajan@example.edu');
    expect(await staffOwned(priya), 'Priya Owned by Me').toBeGreaterThan(0);
    expect(await staffOpenActions(priya), 'Priya My Open Actions').toBeGreaterThan(0);
    expect(await followUps(), 'Follow-ups (global)').toBeGreaterThan(0);
    expect(await followUps(priya), 'Follow-ups (Priya-owned)').toBeGreaterThan(0);
    expect(await urgent(), 'Urgent (global)').toBeGreaterThan(0);
    expect(await urgent(priya), 'Urgent (Priya-owned)').toBeGreaterThan(0);
    expect(await staffUpdated(), 'Recently Updated (global)').toBeGreaterThan(0);
    expect(await staffUpdated(priya), 'Recently Updated (Priya-owned)').toBeGreaterThan(0);

    // Jennifer Anderson (Requester): every metric > 0.
    const jennifer = await userId('jennifer.anderson@example.edu');
    expect(await requesterOpen(jennifer), 'Jennifer Open').toBeGreaterThan(0);
    expect(await requesterWaiting(jennifer), 'Jennifer Waiting for Me').toBeGreaterThan(0);
    expect(await requesterUpdated(jennifer), 'Jennifer Recently Updated').toBeGreaterThan(0);
    expect(await recentlyResolved(jennifer), 'Jennifer Recently Resolved').toBeGreaterThan(0);

    // Emma Fischer (IT Staff): owns no Ticket, has no open Action (any role in it).
    const emma = await userId('emma.fischer@example.edu');
    expect(await staffOwned(emma), 'Emma Owned by Me').toBe(0);
    expect(await staffOpenActions(emma), 'Emma My Open Actions').toBe(0);
    expect(await one(`SELECT count(*)::int AS v FROM "Ticket" WHERE "ownerId" = $1`, emma)).toBe(0);
    expect(
      await one(
        `SELECT count(*)::int AS v FROM "ActionTaken" WHERE status IN ('PLANNED','IN_PROGRESS')
         AND ("assigneeId" = $1 OR "performedById" = $1)`,
        emma
      )
    ).toBe(0);

    // David Lee (Requester): has Tickets, all resolved 10+ days ago.
    const david = await userId('david.lee@example.edu');
    expect(await one(`SELECT count(*)::int AS v FROM "Ticket" WHERE "requesterId" = $1`, david)).toBeGreaterThan(0);
    expect(await requesterOpen(david), 'David Open').toBe(0);
    expect(await requesterWaiting(david), 'David Waiting for Me').toBe(0);
    expect(await requesterUpdated(david), 'David Recently Updated').toBe(0);
    expect(await recentlyResolved(david), 'David Recently Resolved').toBe(0);
    expect(
      await one(
        `SELECT count(*)::int AS v FROM "Ticket" t WHERE t."requesterId" = $1 AND (
           t.status NOT IN ('RESOLVED','CLOSED')
           OR NOT EXISTS (SELECT 1 FROM "TicketStatusChange" h WHERE h."ticketId" = t.id AND h."toStatus" IN ('RESOLVED','CLOSED')
                          AND h."changedAt" < now() - interval '10 days'))`,
        david
      ),
      "David's Tickets were resolved 10+ days ago"
    ).toBe(0);
  }, 120_000);

  it('BR-15: every Ticket updatedAt is at or after its latest Action createdAt/updatedAt and latest history changedAt', async () => {
    const bad = await prisma.$queryRaw<{ ticketNumber: string }[]>`
      SELECT t."ticketNumber" FROM "Ticket" t
      WHERE t."updatedAt" < COALESCE((SELECT max(GREATEST(a."createdAt", a."updatedAt")) FROM "ActionTaken" a WHERE a."ticketId" = t.id), '-infinity')
         OR t."updatedAt" < COALESCE((SELECT max(h."changedAt") FROM "TicketStatusChange" h WHERE h."ticketId" = t.id), '-infinity')
      ORDER BY 1`;
    expect(bad.map((r) => r.ticketNumber)).toEqual([]);
    expect(
      await one(`SELECT count(*)::int AS v FROM "Ticket" t WHERE EXISTS (SELECT 1 FROM "ActionTaken" a WHERE a."ticketId" = t.id)`)
    ).toBeGreaterThan(0);
  }, 120_000);

  it('BR-16: every status-history changedBy is IT Staff', async () => {
    const bad = await prisma.$queryRaw<{ ticketNumber: string; role: string }[]>`
      SELECT t."ticketNumber", u.role::text AS role FROM "TicketStatusChange" h
      JOIN "User" u ON u.id = h."changedById" JOIN "Ticket" t ON t.id = h."ticketId"
      WHERE u.role <> 'IT_STAFF' ORDER BY 1`;
    expect(bad).toEqual([]);
    expect(await one(`SELECT count(*)::int AS v FROM "TicketStatusChange"`)).toBeGreaterThan(0);
  }, 120_000);

  it('MIG-06b: reseeding preserves application activity on a seeded Ticket and still re-anchors pristine ones', async () => {
    const t = async (n: string) => prisma.ticket.findUniqueOrThrow({ where: { ticketNumber: n } });
    const snapshot = async (n: string) => {
      const ticket = await t(n);
      return {
        status: ticket.status,
        ownerId: ticket.ownerId,
        version: ticket.version,
        updatedAt: ticket.updatedAt.toISOString(),
        history: (await prisma.ticketStatusChange.findMany({ where: { ticketId: ticket.id }, orderBy: { id: 'asc' } }))
          .map((h) => ({ ...h, changedAt: h.changedAt.toISOString() })),
        actions: (await prisma.actionTaken.findMany({ where: { ticketId: ticket.id }, orderBy: { id: 'asc' } }))
          .map((a) => ({ ...a, actionAt: a.actionAt.toISOString(), createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
      };
    };

    // (a) through the existing HTTP route as IT Staff (Lab 3 contract).
    const login = await request(testServer.server)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'priya.natarajan@example.edu', password: LOCAL_DEV_PASSWORD });
    expect(login.status, 'login').toBe(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))!.split(';')[0]!;
    const viaHttp = await t('TKT-2026-900013'); // WAITING_FOR_REQUESTER, owned
    const patch = await request(testServer.server)
      .patch(`/api/tickets/${viaHttp.id}/status`)
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie)
      .send({ status: 'IN_PROGRESS' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    // (b) direct SQL mimicking the Lab 4 contract: status + version + history row.
    const viaSql = await t('TKT-2026-900012'); // IN_PROGRESS
    const carlos = await userId('carlos.mendes@example.edu');
    await prisma.$executeRaw`UPDATE "Ticket" SET status = 'WAITING_FOR_REQUESTER', version = version + 1 WHERE id = ${viaSql.id}`;
    await prisma.$executeRaw`
      INSERT INTO "TicketStatusChange" ("ticketId", "fromStatus", "toStatus", "changedById", "changedAt")
      VALUES (${viaSql.id}, 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', ${carlos}, now())`;

    // A pristine Ticket made stale: reseeding must re-anchor it.
    const pristine = await t('TKT-2026-900003');
    await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = '2000-01-01' WHERE id = ${pristine.id}`;

    const beforeHttp = await snapshot('TKT-2026-900013');
    const beforeSql = await snapshot('TKT-2026-900012');
    expect(beforeHttp.status).toBe('IN_PROGRESS');
    expect(beforeSql.status).toBe('WAITING_FOR_REQUESTER');

    runSeed();

    expect(await snapshot('TKT-2026-900013')).toEqual(beforeHttp);
    expect(await snapshot('TKT-2026-900012')).toEqual(beforeSql);
    const after = await t('TKT-2026-900003');
    expect(after.updatedAt.getTime()).toBeGreaterThan(Date.now() - 7 * 24 * 3_600_000);
  }, 180_000);

  it('every keyed seeded Action hashes a valid original create payload, not its current row (api-spec §2.3)', async () => {
    const rows = await prisma.actionTaken.findMany({ where: { clientRequestId: { not: null } } });
    expect(rows.length).toBe(ACTIONS.length);
    for (const spec of ACTIONS) {
      const row = rows.find((r) => r.clientRequestId === spec.clientRequestId)!;
      expect(row, spec.clientRequestId).toBeDefined();
      const body = originalCreateBody(spec, row.actionAt, row.assigneeId);

      // api-spec §2.3 / BR-04..06,09 asserted directly.
      expect(['PLANNED', 'IN_PROGRESS', 'COMPLETED'], `${spec.clientRequestId} initial status`).toContain(body.status);
      const result = typeof body.result === 'string' ? body.result.trim() : '';
      if (body.status === 'COMPLETED') expect(result.length, 'COMPLETED needs a result').toBeGreaterThan(0);
      if (body.followUpRequired) {
        expect(String(body.followUpNote ?? '').trim().length).toBeGreaterThan(0);
      } else {
        expect(body.followUpNote ?? null).toBeNull();
      }
      if (body.status !== 'PLANNED') expect(row.actionAt.getTime(), 'future only when PLANNED').toBeLessThanOrEqual(Date.now());

      expect(row.clientRequestHash, spec.clientRequestId).toBe(hashActionCreateBody(body));
    }
    // The cancelled Action must not hash a CANCELLED create body.
    const cancelled = rows.find((r) => r.status === 'CANCELLED')!;
    expect(cancelled.clientRequestHash).not.toBe(
      hashActionCreateBody({
        description: cancelled.description, result: cancelled.result, actionAt: cancelled.actionAt.toISOString(),
        status: 'CANCELLED', assigneeId: cancelled.assigneeId, followUpRequired: cancelled.followUpRequired,
        followUpNote: cancelled.followUpNote, attachmentNotes: cancelled.attachmentNotes,
      })
    );
  }, 120_000);

  // Each kind of application activity is exercised alone (fresh seed from
  // beforeEach), so each pristine-rule guard is proven on its own.
  it.each(['attachment', 'public comment', 'internal note'] as const)(
    'MIG-06c: reseeding keeps a %s added through the API on a seeded Ticket (updatedAt and content unchanged)',
    async (kind) => {
      const uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'toktickit-seed-uploads-'));
      const previousDir = process.env.ATTACHMENTS_DIR;
      process.env.ATTACHMENTS_DIR = uploadsDir;
      try {
        const login = async (email: string) => {
          const r = await request(testServer.server)
            .post('/api/auth/login').set('Content-Type', 'application/json')
            .send({ email, password: LOCAL_DEV_PASSWORD });
          expect(r.status, `login ${email}`).toBe(200);
          return (r.headers['set-cookie'] as unknown as string[])
            .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))!.split(';')[0]!;
        };
        // TKT-2026-900015 belongs to David Lee; its seeded updatedAt is ~290 h old.
        const ticket = await prisma.ticket.findUniqueOrThrow({
          where: { ticketNumber: 'TKT-2026-900015' }, include: { requester: true },
        });
        if (kind === 'attachment') {
          const cookie = await login(ticket.requester.email);
          const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary'), Buffer.alloc(500, 0x41)]);
          const up = await request(testServer.server)
            .post(`/api/tickets/${ticket.id}/attachments`).set('Cookie', cookie)
            .attach('file', pdf, { filename: 'note.pdf' });
          expect(up.status, JSON.stringify(up.body)).toBe(201);
        } else if (kind === 'public comment') {
          const cookie = await login(ticket.requester.email);
          const r = await request(testServer.server)
            .post(`/api/tickets/${ticket.id}/comments`).set('Cookie', cookie)
            .set('Content-Type', 'application/json').send({ body: 'Thanks, the monitor works.' });
          expect(r.status, JSON.stringify(r.body)).toBe(201);
        } else {
          const cookie = await login('priya.natarajan@example.edu');
          const r = await request(testServer.server)
            .post(`/api/tickets/${ticket.id}/notes`).set('Cookie', cookie)
            .set('Content-Type', 'application/json').send({ body: 'Follow up next term.' });
          expect(r.status, JSON.stringify(r.body)).toBe(201);
        }

        const snap = async () => {
          const tk = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
          return {
            updatedAt: tk.updatedAt.toISOString(),
            attachments: await prisma.attachment.findMany({ where: { ticketId: ticket.id }, orderBy: { id: 'asc' } }),
            comments: await prisma.publicComment.findMany({ where: { ticketId: ticket.id }, orderBy: { id: 'asc' } }),
            notes: await prisma.internalNote.findMany({ where: { ticketId: ticket.id }, orderBy: { id: 'asc' } }),
          };
        };
        const before = await snap();
        const added = kind === 'attachment' ? before.attachments : kind === 'public comment' ? before.comments : before.notes;
        expect(added).toHaveLength(1);

        runSeed();
        expect(await snap()).toEqual(before);
      } finally {
        if (previousDir === undefined) delete process.env.ATTACHMENTS_DIR;
        else process.env.ATTACHMENTS_DIR = previousDir;
        rmSync(uploadsDir, { recursive: true, force: true });
      }
    },
    180_000
  );

  it('MIG-06d: a DB seeded by the earlier revision (Administrator history, no hashes) is repaired; genuine history is kept', async () => {
    // State written by `git show ef80e88:server/prisma/seedLab4.ts`: history of
    // 900008 and 900020 authored by an Administrator, Actions without a hash.
    const olivia = await userId('olivia.grant@example.edu');
    const ticketId = async (n: string) => (await prisma.ticket.findUniqueOrThrow({ where: { ticketNumber: n } })).id;
    for (const n of ['TKT-2026-900008', 'TKT-2026-900020']) {
      await prisma.$executeRaw`UPDATE "TicketStatusChange" SET "changedById" = ${olivia} WHERE "ticketId" = ${await ticketId(n)}`;
    }
    await prisma.$executeRaw`UPDATE "ActionTaken" SET "clientRequestHash" = NULL`;

    // Genuine user history on another seeded Ticket (has seeded history already).
    const priya = await userId('priya.natarajan@example.edu');
    const genuineTicket = await ticketId('TKT-2026-900002');
    await prisma.$executeRaw`
      INSERT INTO "TicketStatusChange" ("ticketId", "fromStatus", "toStatus", "changedById", "changedAt")
      VALUES (${genuineTicket}, 'OPEN', 'IN_PROGRESS', ${priya}, now())`;
    const genuineBefore = await prisma.ticketStatusChange.findMany({ where: { ticketId: genuineTicket }, orderBy: { id: 'asc' } });
    expect(genuineBefore).toHaveLength(2);

    runSeed();

    const admins = await one(`
      SELECT count(*)::int AS v FROM "TicketStatusChange" h JOIN "User" u ON u.id = h."changedById"
      WHERE u.role = 'ADMINISTRATOR'`);
    expect(admins, 'Administrator-authored history rows').toBe(0);
    expect(await one(`SELECT count(*)::int AS v FROM "ActionTaken" WHERE "clientRequestHash" IS NULL`)).toBe(0);
    const genuineAfter = await prisma.ticketStatusChange.findMany({ where: { ticketId: genuineTicket }, orderBy: { id: 'asc' } });
    expect(genuineAfter).toEqual(genuineBefore);
  }, 180_000);
});
