import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LAB4_MIGRATION_SUFFIX,
  recreateDatabase,
  resetLab3FixtureDatabase,
} from '../../scripts/test-db-lab3-fixture.lib.js';
import { parseDatabaseIdentity, runPackageBin, serverRoot } from '../../scripts/test-db.lib.js';

// Migration coverage for Lab 4 (docs/lab-04/tests.md MIG-01..MIG-05, MIG-09;
// specification.md §7.4). Runs the real Lab 4 migration against a database
// holding only Lab 3-shaped data (never the shared `toktickit_test`, which
// global-setup already migrated). If the fixture cannot be provisioned,
// beforeAll throws and every test fails loudly — never a skip.

const LAB3_TABLES = [
  'User',
  'Ticket',
  'Attachment',
  'PublicComment',
  'InternalNote',
  'Category',
  'RelatedSystem',
] as const;

const migrationsDir = path.join(serverRoot, 'prisma/migrations');
const downScript = path.join(serverRoot, 'prisma/recovery/lab-04-down.sql');

function lab4MigrationName(): string {
  const found = fs.readdirSync(migrationsDir).filter((n) => n.endsWith(LAB4_MIGRATION_SUFFIX));
  expect(found, 'exactly one Lab 4 migration folder').toHaveLength(1);
  return found[0]!;
}

let fixtureUrl: string;

function deploy(url: string): void {
  runPackageBin('prisma', ['migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

type Rows = Record<string, unknown>[];

/** Every row of every Lab 3 table, ordered by id, optionally minus columns. */
async function snapshotLab3Rows(url: string, omit: string[] = []): Promise<Record<string, Rows>> {
  return withClient(url, async (c) => {
    const out: Record<string, Rows> = {};
    for (const table of LAB3_TABLES) {
      const res = await c.query(`SELECT * FROM "${table}" ORDER BY id`);
      out[table] = res.rows.map((row) => {
        const copy = { ...row };
        for (const col of omit) delete copy[col];
        return copy;
      });
    }
    return out;
  });
}

/** Structural fingerprint: columns, indexes, constraints, enums, tables. */
async function snapshotSchema(url: string): Promise<unknown> {
  return withClient(url, async (c) => {
    const cols = await c.query(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns WHERE table_schema = 'public'
         ORDER BY table_name, column_name`
    );
    const idx = await c.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`
    );
    const cons = await c.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE connamespace = 'public'::regnamespace ORDER BY conname`
    );
    const enums = await c.query(
      `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
         ORDER BY t.typname, e.enumsortorder`
    );
    const mig = await c.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
    return { cols: cols.rows, idx: idx.rows, cons: cons.rows, enums: enums.rows, mig: mig.rows };
  });
}

async function tableExists(url: string, table: string): Promise<boolean> {
  return withClient(url, async (c) => {
    const res = await c.query(`SELECT to_regclass($1) AS t`, [`public."${table}"`]);
    return res.rows[0].t !== null;
  });
}

async function ticketHasVersionColumn(url: string): Promise<boolean> {
  return withClient(url, async (c) => {
    const res = await c.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Ticket' AND column_name='version'`
    );
    return res.rowCount === 1;
  });
}

async function enumExists(url: string, name: string): Promise<boolean> {
  return withClient(url, async (c) => {
    const res = await c.query(`SELECT 1 FROM pg_type WHERE typname = $1`, [name]);
    return res.rowCount === 1;
  });
}

let pre: Record<string, Rows>;
let preSchema: unknown;

describe('Lab 3 -> Lab 4 migration (specification.md §7.4)', () => {
  beforeAll(async () => {
    fixtureUrl = await resetLab3FixtureDatabase();
    pre = await snapshotLab3Rows(fixtureUrl);
    preSchema = await snapshotSchema(fixtureUrl);

    expect(pre.Ticket!.length, 'fixture needs Tickets').toBeGreaterThan(0);
    expect(
      pre.Ticket!.some((t) => t.status === 'RESOLVED'),
      'fixture needs a RESOLVED Ticket'
    ).toBe(true);
    for (const table of LAB3_TABLES) {
      expect(pre[table]!.length, `fixture needs ${table} rows`).toBeGreaterThan(0);
    }
    expect(await ticketHasVersionColumn(fixtureUrl)).toBe(false);
    expect(await tableExists(fixtureUrl, 'ActionTaken')).toBe(false);

    deploy(fixtureUrl); // the real thing under test
    const applied = await withClient(fixtureUrl, (c) =>
      c.query('SELECT 1 FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL', [
        lab4MigrationName(),
      ])
    );
    expect(applied.rowCount, 'Lab 4 migration recorded as applied').toBe(1);
  }, 120_000);

  it('MIG-01 row counts and ids of every Lab 3 table are identical after migrating', async () => {
    const post = await snapshotLab3Rows(fixtureUrl, ['version']);
    for (const table of LAB3_TABLES) {
      expect(post[table]!.length, `${table} row count`).toBe(pre[table]!.length);
      expect(post[table]!.map((r) => r.id), `${table} ids`).toEqual(pre[table]!.map((r) => r.id));
    }
    // Stronger than ids: no Lab 3 column value changed either.
    expect(post).toEqual(pre);
  });

  it('MIG-02 every existing Ticket has version 1, zero Actions and zero history; a legacy RESOLVED Ticket can still be closed or reopened', async () => {
    await withClient(fixtureUrl, async (c) => {
      const tickets = await c.query('SELECT id, version FROM "Ticket" ORDER BY id');
      expect(tickets.rowCount).toBe(pre.Ticket!.length);
      expect(tickets.rows.every((t) => t.version === 1)).toBe(true);
      expect((await c.query('SELECT count(*)::int AS n FROM "ActionTaken"')).rows[0].n).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM "TicketStatusChange"')).rows[0].n).toBe(0);

      const resolved = await c.query(`SELECT id FROM "Ticket" WHERE status = 'RESOLVED' ORDER BY id`);
      expect(resolved.rowCount).toBeGreaterThan(0);
      const id = resolved.rows[0].id;

      // Data level only: the workflow API is a later Issue. Both directions
      // must be accepted by the migrated database; undone afterwards.
      const closed = await c.query(`UPDATE "Ticket" SET status = 'CLOSED' WHERE id = $1`, [id]);
      expect(closed.rowCount).toBe(1);
      const reopened = await c.query(`UPDATE "Ticket" SET status = 'REOPENED' WHERE id = $1`, [id]);
      expect(reopened.rowCount).toBe(1);
      await c.query(`UPDATE "Ticket" SET status = 'RESOLVED' WHERE id = $1`, [id]);
    });
  });

  it('MIG-03 follow-up CHECK rejects invalid pairs; unique (ticketId, clientRequestId) and the Lab 3 lower(email) index exist', async () => {
    await withClient(fixtureUrl, async (c) => {
      const t = (await c.query('SELECT id FROM "Ticket" ORDER BY id LIMIT 1')).rows[0].id as number;
      const u = (await c.query('SELECT id FROM "User" ORDER BY id LIMIT 1')).rows[0].id as number;

      const insert = (follow: boolean, note: string | null, requestId: string | null) =>
        c.query(
          `INSERT INTO "ActionTaken"
             ("ticketId","actionAt","description","performedById","lastUpdatedById",
              "followUpRequired","followUpNote","clientRequestId","updatedAt")
           VALUES ($1, now(), 'desc', $2, $2, $3, $4, $5, now())`,
          [t, u, follow, note, requestId]
        );

      // Invalid pairs: required without note, not required with a note.
      await expect(insert(true, null, null)).rejects.toMatchObject({ code: '23514' });
      await expect(insert(false, 'stray note', null)).rejects.toMatchObject({ code: '23514' });
      // Valid pairs.
      await insert(true, 'call back', null);
      await insert(false, null, null);

      // Unique (ticketId, clientRequestId): duplicate key rejected, NULLs distinct.
      const key = '11111111-1111-4111-8111-111111111111';
      await insert(false, null, key);
      await expect(insert(false, null, key)).rejects.toMatchObject({ code: '23505' });
      await insert(false, null, null);
      await insert(false, null, null);

      await c.query('DELETE FROM "ActionTaken"');
    });

    await withClient(fixtureUrl, async (c) => {
      const defs = (await c.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='public'`)).rows.map(
        (r) => r.indexdef as string
      );
      const has = (re: RegExp) => defs.some((d) => re.test(d));
      expect(has(/UNIQUE INDEX .* ON public\."ActionTaken" .*\("ticketId", "clientRequestId"\)/)).toBe(true);
      expect(has(/UNIQUE INDEX .* ON public\."User" .*\(lower\(\(?"?email"?(::text)?\)?(::text)?\)\)/)).toBe(true);

      // The other §7.3 indexes.
      expect(has(/ON public\."ActionTaken" .*\("ticketId", "actionAt", id\)/)).toBe(true);
      expect(has(/ON public\."ActionTaken" .*\("ticketId", status\)/)).toBe(true);
      expect(has(/ON public\."ActionTaken" .*\("assigneeId", status\)/)).toBe(true);
      expect(has(/ON public\."ActionTaken" .*\("performedById", status\)/)).toBe(true);
      expect(has(/ON public\."ActionTaken" .*\("ticketId", "followUpRequired"\)/)).toBe(true);
      expect(has(/ON public\."TicketStatusChange" .*\("ticketId", "changedAt", id\)/)).toBe(true);
      expect(has(/ON public\."TicketStatusChange" .*\("toStatus", "changedAt"\)/)).toBe(true);
      expect(has(/ON public\."Ticket" .*\(status, "updatedAt"\)/)).toBe(true);
      expect(has(/ON public\."Ticket" .*\("ownerId", status\)/)).toBe(true);
      // Retained.
      expect(has(/ON public\."Ticket" .*\("itPriority", "createdAt"\)/)).toBe(true);
      expect(has(/ON public\."Ticket" .*\("requesterId", "createdAt"\)/)).toBe(true);
    });
  });

  it('MIG-05 applying migrations a second time is a no-op and raises no error', async () => {
    const schemaBefore = await snapshotSchema(fixtureUrl);
    const rowsBefore = await snapshotLab3Rows(fixtureUrl);
    expect(() => deploy(fixtureUrl)).not.toThrow();
    expect(await snapshotSchema(fixtureUrl)).toEqual(schemaBefore);
    expect(await snapshotLab3Rows(fixtureUrl)).toEqual(rowsBefore);
  }, 60_000);

  it('MIG-04 lab-04-down.sql returns the schema to the Lab 3 shape with all Lab 3 data intact', async () => {
    const url = await resetLab3FixtureDatabase();
    const lab3Rows = await snapshotLab3Rows(url);
    const lab3Schema = await snapshotSchema(url);
    deploy(url);

    // Write Lab 4 rows so the script has something to discard.
    await withClient(url, async (c) => {
      const t = (await c.query('SELECT id FROM "Ticket" ORDER BY id LIMIT 1')).rows[0].id as number;
      const u = (await c.query('SELECT id FROM "User" ORDER BY id LIMIT 1')).rows[0].id as number;
      await c.query(
        `INSERT INTO "ActionTaken" ("ticketId","actionAt","description","performedById","lastUpdatedById","updatedAt")
         VALUES ($1, now(), 'x', $2, $2, now())`,
        [t, u]
      );
      await c.query(
        `INSERT INTO "TicketStatusChange" ("ticketId","fromStatus","toStatus","changedById") VALUES ($1,'NEW','OPEN',$2)`,
        [t, u]
      );
      await c.query(`UPDATE "Ticket" SET version = 5 WHERE id = $1`, [t]);
    });
    expect(await tableExists(url, 'ActionTaken')).toBe(true);

    const sql = fs.readFileSync(downScript, 'utf-8');
    await withClient(url, async (c) => {
      await c.query(sql);
    });

    expect(await tableExists(url, 'ActionTaken')).toBe(false);
    expect(await tableExists(url, 'TicketStatusChange')).toBe(false);
    expect(await ticketHasVersionColumn(url)).toBe(false);
    expect(await enumExists(url, 'ActionStatus')).toBe(false);
    expect(await snapshotSchema(url)).toEqual(lab3Schema);
    expect(await snapshotLab3Rows(url)).toEqual(lab3Rows);

    // The migration is no longer recorded, so it can be applied again.
    const recorded = await withClient(url, (c) =>
      c.query('SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1', [lab4MigrationName()])
    );
    expect(recorded.rowCount).toBe(0);
    deploy(url);
    expect(await ticketHasVersionColumn(url)).toBe(true);
  }, 180_000);

  it('MIG-09 restoring a pg_dump taken before the migration removes every Lab 4 object and keeps Lab 3 data', async () => {
    const url = await resetLab3FixtureDatabase();
    const dbName = parseDatabaseIdentity(url).database;
    const lab3Rows = await snapshotLab3Rows(url);

    const dump = pgDump(url, dbName);

    deploy(url);
    await withClient(url, async (c) => {
      const t = (await c.query('SELECT id FROM "Ticket" ORDER BY id LIMIT 1')).rows[0].id as number;
      const u = (await c.query('SELECT id FROM "User" ORDER BY id LIMIT 1')).rows[0].id as number;
      await c.query(
        `INSERT INTO "ActionTaken" ("ticketId","actionAt","description","performedById","lastUpdatedById","updatedAt")
         VALUES ($1, now(), 'x', $2, $2, now())`,
        [t, u]
      );
      await c.query(`UPDATE "Ticket" SET version = 3`);
    });

    // Restore into a freshly recreated database (test-named, guarded).
    await recreateDatabase(url);
    pgRestore(url, dbName, dump);

    for (const table of LAB3_TABLES) {
      const rows = await withClient(url, (c) => c.query(`SELECT * FROM "${table}" ORDER BY id`));
      expect(rows.rows.length, `${table} row count`).toBe(lab3Rows[table]!.length);
      expect(rows.rows.map((r) => r.id), `${table} ids`).toEqual(lab3Rows[table]!.map((r) => r.id));
    }
    expect(await tableExists(url, 'ActionTaken')).toBe(false);
    expect(await tableExists(url, 'TicketStatusChange')).toBe(false);
    expect(await ticketHasVersionColumn(url)).toBe(false);
    expect(await enumExists(url, 'ActionStatus')).toBe(false);
  }, 180_000);
});

// --- pg_dump / pg_restore: host binaries when present, else the Docker
// container the project's database runs in (`local-postgres`). ---

function hostHas(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function pgConnArgs(url: string): { user: string; password: string; host: string; port: string } {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port || '5432',
  };
}

function pgDump(url: string, dbName: string): Buffer {
  const c = pgConnArgs(url);
  if (hostHas('pg_dump')) {
    return execFileSync(
      'pg_dump',
      ['-Fc', '-h', c.host, '-p', c.port, '-U', c.user, '-d', dbName],
      { env: { ...process.env, PGPASSWORD: c.password }, maxBuffer: 256 * 1024 * 1024 }
    );
  }
  return execFileSync('docker', ['exec', 'local-postgres', 'pg_dump', '-Fc', '-U', c.user, '-d', dbName], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

function pgRestore(url: string, dbName: string, dump: Buffer): void {
  const c = pgConnArgs(url);
  if (hostHas('pg_restore')) {
    execFileSync('pg_restore', ['--no-owner', '-h', c.host, '-p', c.port, '-U', c.user, '-d', dbName], {
      env: { ...process.env, PGPASSWORD: c.password },
      input: dump,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return;
  }
  execFileSync(
    'docker',
    ['exec', '-i', 'local-postgres', 'pg_restore', '--no-owner', '-U', c.user, '-d', dbName],
    { input: dump, stdio: ['pipe', 'pipe', 'pipe'] }
  );
}
