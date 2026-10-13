import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { useTestServer } from '../setup/http-server.js';
import { freezeClock, unfreezeClock, userByName, loginAs, get } from './dashboardFixtures.js';

// Lab 4 authorization matrix (docs/lab-04/tests.md SEC-*). This file holds the
// dashboard and D-13 queue rows; Actions / workflow rows land with their issues.

const testServer = useTestServer(app);

let cookies: { requester: string; staff: string; admin: string };

beforeEach(async () => {
  freezeClock();
  cookies = {
    requester: await loginAs(testServer.server, (await userByName('Jennifer Anderson')).email),
    staff: await loginAs(testServer.server, (await userByName('Priya Natarajan')).email),
    admin: await loginAs(testServer.server, (await userByName('Olivia Grant')).email),
  };
});

afterEach(() => unfreezeClock());

describe('Lab 4 authorization: dashboards and the staff queue', () => {
  it('SEC-03: Requester gets 403 on the staff dashboard; IT Staff and Administrator get 403 on the requester dashboard; permitted pairs are 200', async () => {
    const s = testServer.server;
    for (const [path, cookie, status] of [
      ['/api/dashboard/staff', cookies.requester, 403],
      ['/api/dashboard/requester', cookies.staff, 403],
      ['/api/dashboard/requester', cookies.admin, 403],
      ['/api/dashboard/requester', cookies.requester, 200],
      ['/api/dashboard/staff', cookies.staff, 200],
      ['/api/dashboard/staff', cookies.admin, 200],
    ] as const) {
      const res = await get(s, path, cookie);
      expect(res.status, `${path} as ${cookie.slice(0, 12)}`).toBe(status);
      if (status === 403) {
        expect(res.body.error).toBe('FORBIDDEN');
        expect(res.body).not.toHaveProperty('metrics');
      }
    }
    // No session is 401 on both.
    expect((await get(s, '/api/dashboard/requester')).status).toBe(401);
    expect((await get(s, '/api/dashboard/staff')).status).toBe(401);
  });

  it('SEC-08: GET /api/staff/tickets and /api/staff/assignable-users are 403 for a Requester and 200 for an Administrator', async () => {
    const s = testServer.server;
    for (const path of ['/api/staff/tickets', '/api/staff/assignable-users']) {
      const requester = await get(s, path, cookies.requester);
      expect(requester.status, `${path} requester`).toBe(403);
      expect(requester.body.error).toBe('FORBIDDEN');
      expect((await get(s, path, cookies.admin)).status, `${path} admin`).toBe(200);
      expect((await get(s, path, cookies.staff)).status, `${path} staff`).toBe(200);
    }
  });
});
