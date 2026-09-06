import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';

// See tests/setup/http-server.ts for why requests go through one shared,
// already-listening server rather than `request(app)`.
const testServer = useTestServer(app);

// Covers docs/lab-02/api-spec.md §2.1 (BR-35; AC-10, test API-01):
// only active Categories, shaped {id,name}, ordered by id ascending — the
// Lab 1 contract stays stable. The seed (server/prisma/seed.ts) only ever
// creates active Categories, so to prove the isActive filter is real (not
// just "everything happens to be active"), this suite creates one inactive
// Category itself and deletes it in afterEach. Category is shared reference
// data other suites read (tests.md §1.3 — reset-db leaves it intact), so we
// clean up rather than touching the seed.
describe('GET /api/categories', () => {
  afterEach(async () => {
    await prisma.category.deleteMany({ where: { name: 'Discontinued Category' } });
  });

  it('API-01: returns only active Categories, ordered by id, and keeps the Lab 1 four', async () => {
    const inactive = await prisma.category.create({
      data: { name: 'Discontinued Category', isActive: false },
    });

    const res = await request(testServer.server).get('/api/categories');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, name: 'Account and Access' },
      { id: 2, name: 'Hardware' },
      { id: 3, name: 'Software' },
      { id: 4, name: 'Network' },
    ]);

    const ids = (res.body as Array<{ id: number }>).map((c) => c.id);
    expect(ids).not.toContain(inactive.id);

    const orderedIds = (res.body as Array<{ id: number }>).map((c) => c.id);
    expect(orderedIds).toEqual([...orderedIds].sort((a, b) => a - b));
  });
});

// Covers docs/lab-02/api-spec.md §2.2 (BR-35; AC-10, test API-02):
// only active RelatedSystems, shaped {id,name}, ordered by name ascending,
// at least 6 rows (the seed has 7). Same reasoning as the categories suite
// above: the seed never creates an inactive RelatedSystem, so this suite
// creates one itself to prove the isActive filter is real, then deletes it.
describe('GET /api/related-systems', () => {
  afterEach(async () => {
    await prisma.relatedSystem.deleteMany({ where: { name: 'Decommissioned System' } });
  });

  it('API-02: returns only active RelatedSystems, ordered by name, with at least 6 rows', async () => {
    const inactive = await prisma.relatedSystem.create({
      data: { name: 'Decommissioned System', isActive: false },
    });

    const res = await request(testServer.server).get('/api/related-systems');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(6);

    for (const system of res.body as Array<{ id: number; name: string }>) {
      expect(Object.keys(system).sort()).toEqual(['id', 'name']);
    }

    const ids = (res.body as Array<{ id: number }>).map((s) => s.id);
    expect(ids).not.toContain(inactive.id);

    const names = (res.body as Array<{ name: string }>).map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

// Covers docs/lab-02/api-spec.md §1.3 / §5 (BR-41): the standard error body
// on the 500 path — stable `error` code, safe generic `message` that never
// leaks the underlying exception, and `fields` omitted entirely (not just
// falsy) since neither route ever returns VALIDATION_FAILED/INVALID_QUERY.
// c0283c7 fixed /api/categories's 500 body to this shape and
// /api/related-systems was written with the same shape from the start, but
// neither had a test forcing the failure path — these two do.
describe('GET /api/categories and /api/related-systems — 500 path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('categories: returns the standard INTERNAL error body without leaking the thrown error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.category, 'findMany').mockRejectedValue(new Error('boom'));

    const res = await request(testServer.server).get('/api/categories');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body.message).not.toContain('boom');
    expect('fields' in res.body).toBe(false);
  });

  it('related-systems: returns the standard INTERNAL error body without leaking the thrown error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.relatedSystem, 'findMany').mockRejectedValue(new Error('boom'));

    const res = await request(testServer.server).get('/api/related-systems');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body.message).not.toContain('boom');
    expect('fields' in res.body).toBe(false);
  });
});
