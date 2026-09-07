import type { Server } from 'node:http';
import type { Express } from 'express';
import { afterAll, beforeAll } from 'vitest';

// Why every *.api.test.ts file binds one real server instead of calling
// `request(app)` per assertion:
//
// supertest's `serverAddress()` (node_modules/supertest/lib/test.js) calls
// `app.listen(0)` on every single `request(app)` invocation unless it's
// handed an object that is already listening. A file that fires many
// requests in quick succession — especially concurrently, e.g. a
// `Promise.all` of parallel creates — performs that many listen/close
// cycles back-to-back. The OS can then hand the same ephemeral port to a
// new server while a keep-alive socket from the previous, already-closed
// listener is still pooled, which surfaces as intermittent
// connection-layer failures on an otherwise-correct test:
//   Error: socket hang up
//   Error: Parse Error: Expected HTTP/, RTSP/ or ICE/
// Measured on create-ticket.api.test.ts (its API-09 fires 15 parallel
// requests): ~1 failure in 15-20 runs with `request(app)` everywhere, 0/30
// after switching every call site in the file to a single shared,
// already-listening server; the flake reproduces again if reverted.
//
// Fix: bind one real `http.Server` via `app.listen(0)` in `beforeAll`, pass
// it to `request()` for every call in the file, and close it in `afterAll`.
// Never leave a `request(app)` behind. Use `useTestServer` below to do this
// with one line instead of repeating the beforeAll/afterAll pair.
export function useTestServer(app: Express): { server: Server } {
  const handle = { server: undefined as unknown as Server };

  beforeAll(async () => {
    handle.server = await new Promise<Server>((resolve) => {
      const server: Server = app.listen(0, () => resolve(server));
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      handle.server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  return handle;
}
