import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Lab 2 E2E + responsive harness (docs/lab-02/tests.md §1.1, §1.4, Issue
// #20). This is infrastructure only: the actual E2E-01..05 and R-01..06
// test rows are written by later slices (docs/lab-02/tests.md §2) once the
// PRs they depend on are merged — this config only has to prove the stack
// boots end to end, via e2e/lab-02/harness.smoke.spec.ts.

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = here;
const serverRoot = path.resolve(e2eRoot, "../server");
const clientRoot = path.resolve(e2eRoot, "../client");

dotenv.config({ path: path.join(e2eRoot, ".env.e2e") });

const DATABASE_URL = process.env.DATABASE_URL;
// The server's own address — it always listens on port 3000
// (server/src/index.ts hardcodes it) — kept separate from the URL handed to
// the client below. They're the same by default, but must not be the same
// *variable*: the server webServer's readiness check has to keep polling
// the server's real port even when VITE_API_BASE_URL is deliberately
// pointed elsewhere (e.g. a dead port, to prove the smoke spec is
// falsifiable). Collapsing them into one constant would make that kind of
// sabotage hang the whole run on the server's own startup wait instead of
// producing the client-side assertion failure it's meant to prove.
const SERVER_URL = "http://localhost:3000";
const CLIENT_API_BASE_URL = process.env.VITE_API_BASE_URL ?? SERVER_URL;
const CLIENT_URL = "http://localhost:5173";

if (!DATABASE_URL) {
  throw new Error(
    "e2e/.env.e2e is missing (or has no DATABASE_URL). Run:\n" +
      "  cp e2e/.env.e2e.example e2e/.env.e2e"
  );
}
if (!DATABASE_URL.endsWith("/toktickit_e2e")) {
  // Mirrors the check in scripts/reset-e2e-db.ts: this config is the other
  // place a wrong DATABASE_URL could point the suite at toktickit_test or
  // localdb, so it gets the same guard.
  throw new Error(
    `e2e/.env.e2e DATABASE_URL must point at "toktickit_e2e" (got ` +
      `"${DATABASE_URL}"). Refusing to run the E2E suite against a ` +
      "database that isn't the dedicated E2E database."
  );
}

export default defineConfig({
  testDir: path.join(e2eRoot, "lab-02"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: CLIENT_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Boots BOTH halves of the real stack against the dedicated E2E database.
  // `npm run test:e2e`'s `pretest:e2e` hook (see package.json) has already
  // created/pushed/seeded toktickit_e2e by the time this starts.
  webServer: [
    {
      // Server: `tsx src/index.ts` directly rather than `npm run dev`
      // (`tsx watch ...`) — file-watching restarts serve no purpose for a
      // one-shot test run and only add a way for the process to bounce
      // mid-suite.
      command: "npx tsx src/index.ts",
      cwd: serverRoot,
      url: `${SERVER_URL}/api/health`,
      env: { ...process.env, DATABASE_URL },
      reuseExistingServer: !process.env.CI,
      // A cold boot here is tsx transpiling + Prisma generating the client
      // adapter + opening the pg pool — comfortably more than Playwright's
      // 60s default on a first run.
      timeout: 120_000,
    },
    {
      // Client: plain `vite dev`, not `vite preview`.
      //
      // `vite preview` serves the production bundle, which is closer to
      // what real users get — but Playwright's `webServer` runs exactly
      // one command per entry, and `preview` requires a build to already
      // exist. That would mean either chaining "build && preview" here
      // (silently serving a stale bundle if a previous build succeeded but
      // this run's build fails partway, and adding a multi-second build to
      // every single test invocation) or trusting a separate, easy-to-forget
      // manual build step. `vite dev` needs neither: it's a single command,
      // starts in milliseconds, and this suite is testing application
      // *behavior* (does the real API + DB wiring work), not the
      // production bundling pipeline — bundle-specific concerns are out of
      // scope for Lab 2 (docs/lab-02/tests.md §7 lists no such check).
      command: "npx vite dev --port 5173 --strictPort",
      cwd: clientRoot,
      url: CLIENT_URL,
      env: { ...process.env, VITE_API_BASE_URL: CLIENT_API_BASE_URL },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
