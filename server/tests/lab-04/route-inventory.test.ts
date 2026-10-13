import { describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { actionsTakenRouter } from '../../src/routes/actionsTaken.js';
import { attachmentsRouter } from '../../src/routes/attachments.js';
import { authRouter } from '../../src/routes/auth.js';
import { categoriesRouter } from '../../src/routes/categories.js';
import { dashboardRouter } from '../../src/routes/dashboard.js';
import { relatedSystemsRouter } from '../../src/routes/relatedSystems.js';
import { staffRouter } from '../../src/routes/staff.js';
import { ticketsRouter } from '../../src/routes/tickets.js';
import { usersRouter } from '../../src/routes/users.js';

// API-30 / AC-47 (docs/lab-04/tests.md): enumerate the Express router and
// assert the route table is exactly the Lab 1-4 routes of api-spec.md - no
// DELETE for Actions Taken, no history write route, no Action file upload, no
// export route, nothing undeclared. Each route also carries its middleware
// chain: J = JSON content-type guard, A = session (authenticate), G =
// password-change gate, R = role gate. Which roles pass R is exercised over
// HTTP by authorization.api.test.ts.

interface LayerLike {
  name: string;
  handle: { stack?: LayerLike[] };
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> };
}

const FLAGS: Record<string, string> = {
  requireJsonContentType: 'J',
  authenticate: 'A',
  passwordChangeGate: 'G',
  requireRoleMiddleware: 'R',
};

// The mount prefix of a nested router is not recoverable from Express 5's
// layer, so each router is identified by object identity. A router mounted
// in app.ts that is not listed here fails the test as undeclared.
const MOUNTS = new Map<object, string>([
  [categoriesRouter, '/api/categories'],
  [relatedSystemsRouter, '/api/related-systems'],
  [actionsTakenRouter, '/api/tickets/:id/actions-taken'],
  [ticketsRouter, '/api/tickets'],
  [attachmentsRouter, '/api/attachments'],
  [authRouter, '/api/auth'],
  [staffRouter, '/api/staff'],
  [dashboardRouter, '/api/dashboard'],
  [usersRouter, '/api/users'],
]);

function enumerateRoutes(): string[] {
  const out: string[] = [];
  const walk = (stack: LayerLike[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const chain = layer.route.stack.map((s) => FLAGS[s.name] ?? '').join('');
        const path = (prefix + layer.route.path).replace(/\/$/, '') || '/';
        for (const method of Object.keys(layer.route.methods)) {
          out.push(`${method.toUpperCase()} ${path} [${chain || 'public'}]`);
        }
      } else if (layer.name === 'router') {
        const mount = MOUNTS.get(layer.handle);
        if (mount === undefined) {
          out.push(`UNDECLARED ROUTER MOUNT (${layer.name})`);
          continue;
        }
        walk(layer.handle.stack ?? [], mount);
      }
    }
  };
  const root = (app as unknown as { router: { stack: LayerLike[] } }).router;
  walk(root.stack, '');
  return out;
}

const EXPECTED = [
  // App
  'GET / [public]',
  'GET /api/health [public]',
  // Reference data (Lab 2)
  'GET /api/categories [public]',
  'GET /api/related-systems [public]',
  // Auth (Lab 3)
  'POST /api/auth/login [J]',
  'POST /api/auth/logout [JA]',
  'GET /api/auth/me [AG]',
  'POST /api/auth/change-password [JAG]',
  // Tickets (Lab 2-4)
  'POST /api/tickets [JAGR]',
  'GET /api/tickets [AGR]',
  'GET /api/tickets/:id [AGR]',
  'POST /api/tickets/:id/attachments [AGR]',
  'GET /api/tickets/:id/comments [AGR]',
  'POST /api/tickets/:id/comments [JAGR]',
  'PATCH /api/tickets/:id/owner [JAGR]',
  'PATCH /api/tickets/:id/it-priority [JAGR]',
  'PATCH /api/tickets/:id/status [JAGR]',
  'GET /api/tickets/:id/status-history [AGR]',
  'GET /api/tickets/:id/notes [AGR]',
  'POST /api/tickets/:id/notes [JAGR]',
  'POST /api/tickets/:id/requester-resolved [JAGR]',
  // Actions Taken (Lab 4)
  'GET /api/tickets/:id/actions-taken [AGR]',
  'POST /api/tickets/:id/actions-taken [JAGR]',
  'PATCH /api/tickets/:id/actions-taken/:actionId [JAGR]',
  // Attachments (Lab 2)
  'GET /api/attachments/:id [AGR]',
  'GET /api/attachments/:id/download [AGR]',
  'DELETE /api/attachments/:id [JAGR]',
  // Staff queue (Lab 3-4)
  'GET /api/staff/tickets [AGR]',
  'GET /api/staff/assignable-users [AGR]',
  // Dashboards (Lab 4)
  'GET /api/dashboard/requester [AGR]',
  'GET /api/dashboard/staff [AGR]',
  // User administration (Lab 3)
  'GET /api/users [AGR]',
  'POST /api/users [JAGR]',
  'PATCH /api/users/:id [JAGR]',
  'POST /api/users/:id/initial-password [JAGR]',
];

describe('API-30: route inventory (AC-47)', () => {
  it('the Express route table is exactly the routes api-spec.md declares, each with its middleware chain', () => {
    expect(enumerateRoutes().sort()).toEqual([...EXPECTED].sort());
  });

  it('no route exists for deleting an Action, writing history, uploading Action files or exporting', () => {
    const routes = enumerateRoutes();
    expect(routes.filter((r) => r.startsWith('DELETE'))).toEqual(['DELETE /api/attachments/:id [JAGR]']);
    expect(routes.filter((r) => /actions-taken/.test(r) && !/^(GET|POST|PATCH) /.test(r))).toEqual([]);
    expect(routes.filter((r) => /status-history/.test(r) && !r.startsWith('GET '))).toEqual([]);
    expect(routes.filter((r) => /actions-taken.*(attach|upload|file)/i.test(r))).toEqual([]);
    expect(routes.filter((r) => /export|csv|report/i.test(r))).toEqual([]);
  });
});
