import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response } from 'express';
import { prisma } from '../../src/lib/prisma.js';
import { requesterContext } from '../../src/middleware/requesterContext.js';

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
