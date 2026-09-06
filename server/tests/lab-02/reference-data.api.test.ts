import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';

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

    const res = await request(app).get('/api/categories');

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
