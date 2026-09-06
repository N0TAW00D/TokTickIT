import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response } from 'express';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { requesterContext } from '../../src/middleware/requesterContext.js';

// Covers docs/lab-02/api-spec.md §2.3 (BR-08, BR-35; AC-05, AC-06, AC-42):
// only active Development Requesters, shaped {id,name,email}, ordered by
// name. The seed fixture (server/prisma/seed.ts) is the exact set from the
// api-spec §2.3 example, so the expected array below is asserted verbatim
// rather than re-derived — this also proves no extra field (isActive,
// createdAt, updatedAt) leaks through, since toEqual rejects unexpected keys.
describe('GET /api/requesters', () => {
  it('returns only active Requesters, ordered by name, shaped as {id,name,email}', async () => {
    const res = await request(app).get('/api/requesters');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 4, name: 'David Lee', email: 'david.lee@example.edu' },
      { id: 1, name: 'Jennifer Anderson', email: 'jennifer.anderson@example.edu' },
      { id: 2, name: 'Michael Brown', email: 'michael.brown@example.edu' },
      { id: 3, name: 'Sarah Johnson', email: 'sarah.johnson@example.edu' },
    ]);
  });

  it('never returns the inactive seed Requester (Robert Wilson)', async () => {
    const res = await request(app).get('/api/requesters');

    const names = (res.body as Array<{ name: string }>).map((r) => r.name);
    expect(names).not.toContain('Robert Wilson');

    const inactive = await prisma.requesterUser.findFirstOrThrow({
      where: { isActive: false },
    });
    const ids = (res.body as Array<{ id: number }>).map((r) => r.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('ignores the X-Requester-Id header — this endpoint is not Requester-scoped', async () => {
    const withoutHeader = await request(app).get('/api/requesters');
    const withBogusHeader = await request(app)
      .get('/api/requesters')
      .set('X-Requester-Id', '999999');
    const withInactiveHeader = await request(app)
      .get('/api/requesters')
      .set('X-Requester-Id', '0');

    expect(withBogusHeader.status).toBe(200);
    expect(withInactiveHeader.status).toBe(200);
    expect(withBogusHeader.body).toEqual(withoutHeader.body);
    expect(withInactiveHeader.body).toEqual(withoutHeader.body);
  });
});

// Covers docs/lab-02/tests.md API-04: GET /api/requesters failure/empty
// shape — DB error -> 500 {error:"INTERNAL"} generic; empty table -> 200 [].
// RequesterUser is shared seed reference data that reset-db.ts deliberately
// never truncates and the suite above depends on, so the empty-table case
// is proven by stubbing prisma.requesterUser.findMany to resolve [] rather
// than by deleting the seeded rows.
describe('API-04: GET /api/requesters failure/empty shape', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DB error: returns the standard INTERNAL error body without leaking the thrown error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.requesterUser, 'findMany').mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/requesters');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body.message).not.toContain('boom');
    expect('fields' in res.body).toBe(false);
  });

  it('empty table: returns 200 []', async () => {
    vi.spyOn(prisma.requesterUser, 'findMany').mockResolvedValue([]);

    const res = await request(app).get('/api/requesters');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// Covers docs/lab-02/api-spec.md §1.2 (BR-13, A-10): the X-Requester-Id
// requester-context middleware. There is no 🔒 endpoint to mount it on yet
// (that lands with #16/#18/#19), so it is proven here on a test-only route
// that echoes back whatever `req.requester` the middleware attaches.
describe('requesterContext middleware', () => {
  function buildTestApp(): Express {
    const testApp = express();
    testApp.get('/__test/protected', requesterContext, (req: Request, res: Response) => {
      res.status(200).json({ requester: req.requester });
    });
    return testApp;
  }

  it('rejects a missing header with 400 MISSING_REQUESTER', async () => {
    const res = await request(buildTestApp()).get('/__test/protected');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_REQUESTER');
    expect(typeof res.body.message).toBe('string');
    expect('fields' in res.body).toBe(false);
  });

  it('rejects an empty header with 400 MISSING_REQUESTER', async () => {
    const res = await request(buildTestApp())
      .get('/__test/protected')
      .set('X-Requester-Id', '');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_REQUESTER');
  });

  it('rejects a non-numeric header with 400 MISSING_REQUESTER', async () => {
    const res = await request(buildTestApp())
      .get('/__test/protected')
      .set('X-Requester-Id', 'abc');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_REQUESTER');
  });

  it('rejects a zero or negative header with 400 MISSING_REQUESTER', async () => {
    const zero = await request(buildTestApp())
      .get('/__test/protected')
      .set('X-Requester-Id', '0');
    const negative = await request(buildTestApp())
      .get('/__test/protected')
      .set('X-Requester-Id', '-1');

    expect(zero.status).toBe(400);
    expect(zero.body.error).toBe('MISSING_REQUESTER');
    expect(negative.status).toBe(400);
    expect(negative.body.error).toBe('MISSING_REQUESTER');
  });

  it('rejects a header for a Requester that does not exist with 400 INVALID_REQUESTER', async () => {
    const res = await request(buildTestApp())
      .get('/__test/protected')
      .set('X-Requester-Id', '999999');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REQUESTER');
    expect('fields' in res.body).toBe(false);
  });

  it('rejects an id beyond Postgres int4 range with 400 INVALID_REQUESTER, not 500', async () => {
    // A positive integer larger than int4 is syntactically valid but cannot
    // reference any row, so api-spec.md §1.2 puts it in the existence branch.
    // Passing it to Prisma raises "out of range", which would leak as a 500
    // for what is really bad client input (BR-41 / §1.3).
    for (const id of ['2147483648', '3000000000', '99999999999999999999']) {
      const res = await request(buildTestApp())
        .get('/__test/protected')
        .set('X-Requester-Id', id);

      expect(res.status, `id ${id} should not 500`).toBe(400);
      expect(res.body.error).toBe('INVALID_REQUESTER');
      expect('fields' in res.body).toBe(false);
    }
  });

  it('rejects a header for an inactive Requester with 400 INVALID_REQUESTER', async () => {
    const inactive = await prisma.requesterUser.findFirstOrThrow({
      where: { isActive: false },
    });

    const res = await request(buildTestApp())
      .get('/__test/protected')
      .set('X-Requester-Id', String(inactive.id));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REQUESTER');
  });

  it('lets an active Requester through and exposes it to the downstream handler', async () => {
    const active = await prisma.requesterUser.findFirstOrThrow({
      where: { isActive: true },
    });

    const res = await request(buildTestApp())
      .get('/__test/protected')
      .set('X-Requester-Id', String(active.id));

    expect(res.status).toBe(200);
    expect(res.body.requester).toEqual({
      id: active.id,
      name: active.name,
      email: active.email,
    });
  });
});
