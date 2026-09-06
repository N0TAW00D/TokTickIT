import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import type { Priority } from '../../src/validation/ticketFields.js';

// Covers docs/lab-02/api-spec.md §3.2 (GET /api/tickets) and tests.md
// API-10..API-18. reset-db.ts (tests/setup/reset-db.ts) truncates
// Ticket/Attachment/TicketCounter before every test in this file, so each
// test starts from an empty Ticket table.
//
// Fixtures are seeded directly via `prisma.ticket.create`/`$executeRaw`
// (bypassing POST /api/tickets) rather than through real HTTP requests, so
// tests can pin exact ticketNumbers and createdAt instants — including two
// rows sharing the *identical* createdAt, which a real request-per-ticket
// flow can't reliably produce but BR-18's secondary `id desc` sort needs to
// be tested against.

let categoryAId: number;
let categoryBId: number;
let relatedSystemId: number;
let requesterAId: number;
let requesterBId: number;
let inactiveRequesterId: number;

let ticketSeq = 0;

beforeAll(async () => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requesters = await prisma.requesterUser.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const inactiveRequester = await prisma.requesterUser.findFirstOrThrow({ where: { isActive: false } });

  categoryAId = categories[0]!.id;
  categoryBId = categories[1]!.id;
  relatedSystemId = relatedSystem.id;
  requesterAId = requesters[0]!.id;
  requesterBId = requesters[1]!.id;
  inactiveRequesterId = inactiveRequester.id;
});

interface SeedTicketOverrides {
  requesterId?: number;
  categoryId?: number;
  relatedSystemId?: number;
  ticketNumber?: string;
  summary?: string;
  description?: string;
  requestedPriority?: Priority;
  status?: 'NEW';
  createdAt?: Date;
  updatedAt?: Date;
}

async function seedTicket(overrides: SeedTicketOverrides = {}) {
  ticketSeq += 1;
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: overrides.ticketNumber ?? `TKT-2026-${String(ticketSeq).padStart(6, '0')}`,
      requesterId: overrides.requesterId ?? requesterAId,
      categoryId: overrides.categoryId ?? categoryAId,
      relatedSystemId: overrides.relatedSystemId ?? relatedSystemId,
      summary: overrides.summary ?? `Seed ticket ${ticketSeq}`,
      description: overrides.description ?? 'x'.repeat(25),
      requestedPriority: overrides.requestedPriority ?? 'MEDIUM',
      status: overrides.status ?? 'NEW',
    },
  });

  // createdAt/updatedAt are plain columns (no forced-immutable behavior in
  // this schema beyond @updatedAt's auto-touch on write), but going through
  // `create`'s own defaulting can't produce two rows with an identical
  // instant reliably, and raw SQL is the simplest way to pin both fields to
  // an exact, arbitrary value for the sort tests below.
  if (overrides.createdAt || overrides.updatedAt) {
    const createdAt = overrides.createdAt ?? ticket.createdAt;
    const updatedAt = overrides.updatedAt ?? createdAt;
    await prisma.$executeRaw`UPDATE "Ticket" SET "createdAt" = ${createdAt}, "updatedAt" = ${updatedAt} WHERE id = ${ticket.id}`;
    return prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  }

  return ticket;
}

async function seedAttachment(ticketId: number, overrides: { isRemoved?: boolean } = {}) {
  const isRemoved = overrides.isRemoved ?? false;
  return prisma.attachment.create({
    data: {
      ticketId,
      originalFilename: 'file.pdf',
      storedFilename: `${randomUUID()}.pdf`,
      mimeType: 'application/pdf',
      fileSize: 1024,
      isRemoved,
      removedAt: isRemoved ? new Date() : null,
      removedReason: isRemoved ? 'test removal' : null,
    },
  });
}

function listTickets(requesterId: number, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  return request(app)
    .get(`/api/tickets${qs ? `?${qs}` : ''}`)
    .set('X-Requester-Id', String(requesterId));
}

type ListItem = { id: number; ticketNumber: string; activeAttachmentCount: number };

function idsOf(items: unknown): number[] {
  return (items as ListItem[]).map((item) => item.id);
}

describe('GET /api/tickets', () => {
  it('API-10: ownership isolation — B tickets never appear for A, even with a matching search; totalItems reflects only A', async () => {
    const aMatch = await seedTicket({ requesterId: requesterAId, summary: 'Cannot connect to VPN' });
    const aOther = await seedTicket({ requesterId: requesterAId, summary: 'Printer jam' });
    const bMatch = await seedTicket({ requesterId: requesterBId, summary: 'Cannot connect to VPN either' });

    // Sanity check on the fixture itself: an unscoped query for "VPN" would
    // match both A's and B's ticket, so isolation below is doing real work,
    // not just an accident of what got seeded.
    const unscopedMatchCount = await prisma.ticket.count({
      where: { summary: { contains: 'VPN', mode: 'insensitive' } },
    });
    expect(unscopedMatchCount).toBe(2);

    const searchRes = await listTickets(requesterAId, { search: 'VPN' });
    expect(searchRes.status).toBe(200);
    expect(idsOf(searchRes.body.items)).toEqual([aMatch.id]);
    expect(idsOf(searchRes.body.items)).not.toContain(bMatch.id);
    expect(searchRes.body.meta.totalItems).toBe(1);

    const allRes = await listTickets(requesterAId);
    expect(idsOf(allRes.body.items).sort((x, y) => x - y)).toEqual([aOther.id, aMatch.id].sort((x, y) => x - y));
    expect(idsOf(allRes.body.items)).not.toContain(bMatch.id);
    expect(allRes.body.meta.totalItems).toBe(2);
  });

  it('API-11: default sort is createdAt desc, id desc; default pagination is page 1 / pageSize 10', async () => {
    const oldest = await seedTicket({ createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const middle = await seedTicket({ createdAt: new Date('2026-01-02T00:00:00.000Z') });
    // Two rows sharing the exact same createdAt instant, newer than both of
    // the above — proves BR-18's secondary `id desc` actually breaks the
    // tie instead of the order being incidental to insertion/physical order.
    const tieInstant = new Date('2026-01-03T00:00:00.000Z');
    const tieLower = await seedTicket({ createdAt: tieInstant });
    const tieHigher = await seedTicket({ createdAt: tieInstant });
    expect(tieHigher.id).toBeGreaterThan(tieLower.id);

    const res = await listTickets(requesterAId);

    expect(res.status).toBe(200);
    expect(idsOf(res.body.items)).toEqual([tieHigher.id, tieLower.id, middle.id, oldest.id]);
    expect(res.body.meta).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: 4,
      totalPages: 1,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  // BR-18's `{ id: 'desc' }` secondary sort has no dedicated tests.md
  // API-xx row (API-11 covers the default-sort tie-break, but with an
  // insert-only fixture whose physical/ctid row order happens to coincide
  // with id order — so it would still pass even if the secondary sort were
  // deleted from the route). These tests decouple physical row order from
  // id order to prove the tie-break is actually load-bearing.
  describe('BR-18: id desc tie-break is load-bearing, not incidental to physical row order', () => {
    it('breaks a tied createdAt by id desc even when the lower-id row is physically newer than the higher-id one', async () => {
      const oldest = await seedTicket({ createdAt: new Date('2026-05-01T00:00:00.000Z') });
      const middle = await seedTicket({ createdAt: new Date('2026-05-02T00:00:00.000Z') });
      const tieInstant = new Date('2026-05-03T00:00:00.000Z');
      const tieLower = await seedTicket({ createdAt: tieInstant });
      const tieHigher = await seedTicket({ createdAt: tieInstant });
      expect(tieHigher.id).toBeGreaterThan(tieLower.id);

      // Re-index the LOWER-id tied row *after* the higher-id row's tied
      // index entry already exists, by genuinely changing its createdAt
      // away and then back to the tied instant. A no-op UPDATE (writing the
      // same value it already has) doesn't do this — Postgres treats it as
      // HOT-eligible and reuses the existing index entry in place, leaving
      // this row's position among the tied duplicates unchanged. Actually
      // changing the value (even temporarily) forces a real, non-HOT
      // re-index, so tieLower's entry among the `createdAt` duplicates ends
      // up physically *after* tieHigher's — the opposite of what a straight
      // insert-only fixture (like API-11's) produces, where insertion order
      // and id order coincide. Confirmed via EXPLAIN ANALYZE against this
      // route's exact query shape: it plans an `Index Scan Backward` over
      // `Ticket_requesterId_createdAt_idx`, and without `{ id: 'desc' }`
      // this decoupling makes that backward scan yield tieLower before
      // tieHigher — the wrong order, which the assertion below catches.
      const detourInstant = new Date('2020-01-01T00:00:00.000Z');
      await prisma.$executeRaw`UPDATE "Ticket" SET "createdAt" = ${detourInstant} WHERE id = ${tieLower.id}`;
      await prisma.$executeRaw`UPDATE "Ticket" SET "createdAt" = ${tieInstant} WHERE id = ${tieLower.id}`;

      const res = await listTickets(requesterAId);

      expect(res.status).toBe(200);
      expect(idsOf(res.body.items)).toEqual([tieHigher.id, tieLower.id, middle.id, oldest.id]);
    });

    it('breaks a tied updatedAt by id desc under sort=updatedAt, with the same physical-order decoupling', async () => {
      const tieInstant = new Date('2026-06-01T00:00:00.000Z');
      const tieLower = await seedTicket({ updatedAt: tieInstant });
      const tieHigher = await seedTicket({ updatedAt: tieInstant });
      expect(tieHigher.id).toBeGreaterThan(tieLower.id);

      // Same change-away-then-back trick as above (a same-value UPDATE
      // would be HOT-eligible and not actually move tieLower's position
      // among the tied `updatedAt` duplicates), applied to updatedAt.
      const detourInstant = new Date('2020-01-01T00:00:00.000Z');
      await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = ${detourInstant} WHERE id = ${tieLower.id}`;
      await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = ${tieInstant} WHERE id = ${tieLower.id}`;

      const res = await listTickets(requesterAId, { sort: 'updatedAt', order: 'desc' });

      expect(res.status).toBe(200);
      expect(idsOf(res.body.items)).toEqual([tieHigher.id, tieLower.id]);
    });
  });

  it('API-12: search matches ticketNumber OR summary, case-insensitive; blank/whitespace search is ignored', async () => {
    const byNumber = await seedTicket({ ticketNumber: 'TKT-2026-000777', summary: 'Something unrelated' });
    const bySummary = await seedTicket({ ticketNumber: 'TKT-2026-000001', summary: 'Cannot connect to VPN' });
    const neither = await seedTicket({ ticketNumber: 'TKT-2026-000002', summary: 'Printer jam' });

    const byNumberRes = await listTickets(requesterAId, { search: '000777' });
    expect(idsOf(byNumberRes.body.items)).toEqual([byNumber.id]);

    // Lowercase against a summary containing "VPN" — proves case-insensitivity.
    const bySummaryRes = await listTickets(requesterAId, { search: 'vpn' });
    expect(idsOf(bySummaryRes.body.items)).toEqual([bySummary.id]);

    const blankRes = await listTickets(requesterAId, { search: '   ' });
    expect(blankRes.status).toBe(200);
    expect(idsOf(blankRes.body.items).sort((x, y) => x - y)).toEqual(
      [byNumber.id, bySummary.id, neither.id].sort((x, y) => x - y)
    );
    expect(blankRes.body.meta.totalItems).toBe(3);
  });

  it('API-13: categoryId, priority, and status filters combine with AND', async () => {
    const matchesAll = await seedTicket({ categoryId: categoryAId, requestedPriority: 'HIGH', status: 'NEW' });
    const wrongCategory = await seedTicket({ categoryId: categoryBId, requestedPriority: 'HIGH', status: 'NEW' });
    const wrongPriority = await seedTicket({ categoryId: categoryAId, requestedPriority: 'LOW', status: 'NEW' });

    const categoryOnly = await listTickets(requesterAId, { categoryId: String(categoryAId) });
    expect(idsOf(categoryOnly.body.items).sort((x, y) => x - y)).toEqual(
      [matchesAll.id, wrongPriority.id].sort((x, y) => x - y)
    );

    const categoryAndPriority = await listTickets(requesterAId, {
      categoryId: String(categoryAId),
      priority: 'HIGH',
    });
    expect(idsOf(categoryAndPriority.body.items)).toEqual([matchesAll.id]);

    const statusOnly = await listTickets(requesterAId, { status: 'NEW' });
    expect(idsOf(statusOnly.body.items).sort((x, y) => x - y)).toEqual(
      [matchesAll.id, wrongCategory.id, wrongPriority.id].sort((x, y) => x - y)
    );
  });

  it('API-14: sort=ticketNumber&order=asc orders correctly and stays stable across pages', async () => {
    // pageSize must be one of {10, 20, 50} (BR-19), so 12 rows over
    // pageSize=10 is the smallest fixture that actually exercises a second
    // page while sorting by ticketNumber.
    const numbers = Array.from({ length: 12 }, (_, i) => `TKT-2026-${String(12 - i).padStart(6, '0')}`);
    for (const ticketNumber of numbers) {
      await seedTicket({ ticketNumber });
    }

    const page1 = await listTickets(requesterAId, { sort: 'ticketNumber', order: 'asc', pageSize: '10', page: '1' });
    const page2 = await listTickets(requesterAId, { sort: 'ticketNumber', order: 'asc', pageSize: '10', page: '2' });

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const allNumbersAcrossPages = [...(page1.body.items as ListItem[]), ...(page2.body.items as ListItem[])].map(
      (item) => item.ticketNumber
    );

    expect(page1.body.items).toHaveLength(10);
    expect(page2.body.items).toHaveLength(2);
    // Ascending order overall, and — crucially — no ticket is skipped or
    // duplicated across the page boundary (the "stable across pages" part
    // of AC-25): the concatenation of both pages is exactly the sorted set.
    expect(allNumbersAcrossPages).toEqual([...numbers].sort());
    expect(new Set(allNumbersAcrossPages).size).toBe(numbers.length);
  });

  it('API-15: page 2 returns the next slice with correct meta', async () => {
    for (let i = 0; i < 15; i++) {
      await seedTicket({ createdAt: new Date(Date.UTC(2026, 0, i + 1)) });
    }

    const res = await listTickets(requesterAId, { page: '2', pageSize: '10' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.meta).toEqual({
      page: 2,
      pageSize: 10,
      totalItems: 15,
      totalPages: 2,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('API-16: a page past the last page returns 200 with items: [] and correct meta (not an error)', async () => {
    await seedTicket();
    await seedTicket();

    const res = await listTickets(requesterAId, { page: '99', pageSize: '10' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.meta).toEqual({
      page: 99,
      pageSize: 10,
      totalItems: 2,
      totalPages: 1,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('API-17: invalid query params return 400 INVALID_QUERY with fields[] naming the offender; nothing is silently coerced', async () => {
    const cases: Array<[label: string, query: Record<string, string>, expectedField: string]> = [
      ['pageSize=7 (not 10/20/50)', { pageSize: '7' }, 'pageSize'],
      ['page=0 (must be >= 1)', { page: '0' }, 'page'],
      ['page=-1 (must be >= 1)', { page: '-1' }, 'page'],
      ['sort=bogus (not a valid sort field)', { sort: 'bogus' }, 'sort'],
      ['priority=SUPER (not LOW/MEDIUM/HIGH)', { priority: 'SUPER' }, 'priority'],
      ['unknown categoryId', { categoryId: '999999' }, 'categoryId'],
    ];

    for (const [label, query, expectedField] of cases) {
      const res = await listTickets(requesterAId, query);
      expect(res.status, label).toBe(400);
      expect(res.body.error, label).toBe('INVALID_QUERY');
      expect(Array.isArray(res.body.fields), label).toBe(true);
      const fields = (res.body.fields as Array<{ field: string; message: string }>).map((f) => f.field);
      expect(fields, label).toContain(expectedField);
      for (const fieldError of res.body.fields as Array<Record<string, unknown>>) {
        expect(typeof fieldError.field, label).toBe('string');
        expect(typeof fieldError.message, label).toBe('string');
      }
    }

    // If page=0 (or pageSize=7) were silently defaulted instead of
    // rejected, no ticket would need to exist for the request to still
    // return 200 with an empty/normal list — nothing above would catch
    // that. This confirms page=0 is rejected even when a page 1 would
    // otherwise have real content to return.
    await seedTicket();
    const stillRejected = await listTickets(requesterAId, { page: '0' });
    expect(stillRejected.status).toBe(400);
    expect(stillRejected.body.error).toBe('INVALID_QUERY');
  });

  it('API-18: missing/unknown/inactive X-Requester-Id returns 400', async () => {
    const missing = await request(app).get('/api/tickets');
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('MISSING_REQUESTER');
    expect('fields' in missing.body).toBe(false);

    const unknown = await request(app).get('/api/tickets').set('X-Requester-Id', '999999');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('INVALID_REQUESTER');

    const inactive = await request(app).get('/api/tickets').set('X-Requester-Id', String(inactiveRequesterId));
    expect(inactive.status).toBe(400);
    expect(inactive.body.error).toBe('INVALID_REQUESTER');
  });

  // §3.2's list item shape includes activeAttachmentCount; no dedicated
  // tests.md API-xx row covers it directly (#17, not yet implemented, is
  // what will start populating real Attachment rows through the API), but
  // the count must already be correct today, so it's covered here.
  describe('activeAttachmentCount (§3.2) — no dedicated tests.md API-xx row', () => {
    it('counts only non-removed attachments; a ticket with none is 0', async () => {
      const withoutAttachments = await seedTicket();
      const withAttachments = await seedTicket();
      await seedAttachment(withAttachments.id, { isRemoved: false });
      await seedAttachment(withAttachments.id, { isRemoved: false });
      await seedAttachment(withAttachments.id, { isRemoved: true });

      const res = await listTickets(requesterAId);

      const countsById = new Map((res.body.items as ListItem[]).map((item) => [item.id, item.activeAttachmentCount]));
      expect(countsById.get(withoutAttachments.id)).toBe(0);
      expect(countsById.get(withAttachments.id)).toBe(2);
    });
  });
});
