import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Loaded first (see setupFiles order in vitest.config.ts), before anything
// imports `src/lib/prisma.ts`. Forces DATABASE_URL to the dedicated test
// database for every test worker, regardless of whether it inherited the
// value the globalSetup process computed. `override: true` is required
// here because `src/lib/prisma.ts` also runs `dotenv/config` (loading
// `.env`), and plain dotenv never overwrites a variable that is already set
// — so this must win the race by running first.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "../..");

dotenv.config({ path: path.join(serverRoot, ".env.test"), override: true });

if (!process.env.DATABASE_URL?.toLowerCase().includes("test")) {
  throw new Error(
    "DATABASE_URL does not look like a test database after loading " +
      "server/.env.test. Refusing to run tests to avoid touching the dev " +
      "database."
  );
}
