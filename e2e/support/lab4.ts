import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import dotenv from "dotenv";
import { Client } from "pg";
import { expect, type Page, type TestInfo } from "@playwright/test";
import type { AxeResults, Result as AxeRuleResult } from "axe-core";
import { createRequesterOwnedFixtureTicket } from "./staffFixtures.js";
import type { FixtureUser } from "./auth.js";

// Shared helpers for the Lab 4 responsive / accessibility / regression specs
// (docs/lab-04/tests.md R-01..R-05, A11Y-01..A11Y-06, E2E-16..E2E-18). Same
// conventions as e2e/lab-03: real client, real server, the dedicated
// `toktickit_e2e` database, fixture rows inserted with direct `pg`.

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, "..");

/** docs/lab-04/tests.md §1.3 viewport matrix, plus the 320 px overflow width. */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
  narrow: { width: 320, height: 640 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export const IT_STAFF_EMAIL = "priya.natarajan@example.edu";
export const ADMIN_EMAIL = "olivia.grant@example.edu";
export const REQUESTER_EMAIL = "jennifer.anderson@example.edu";
export const ZERO_STAFF_EMAIL = "emma.fischer@example.edu";
export const ZERO_REQUESTER_EMAIL = "david.lee@example.edu";

function databaseUrl(): string {
  const result = dotenv.config({ path: path.join(e2eRoot, ".env.e2e") });
  const url = result.parsed?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || !url.endsWith("/toktickit_e2e")) {
    throw new Error(`DATABASE_URL must point at "toktickit_e2e" (got "${url}").`);
  }
  return url;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Id of a seeded Ticket, read-only. */
export async function ticketIdByNumber(ticketNumber: string): Promise<number> {
  return withClient(async (client) => {
    const r = await client.query<{ id: number }>(
      'SELECT id FROM "Ticket" WHERE "ticketNumber" = $1',
      [ticketNumber],
    );
    if (r.rowCount === 0) throw new Error(`Ticket ${ticketNumber} not found; reset the e2e database.`);
    return r.rows[0].id;
  });
}

/** Email of the Requester who owns a seeded Ticket, read-only. */
export async function requesterEmailOf(ticketNumber: string): Promise<string> {
  return withClient(async (client) => {
    const r = await client.query<{ email: string }>(
      `SELECT u.email FROM "Ticket" t JOIN "User" u ON u.id = t."requesterId" WHERE t."ticketNumber" = $1`,
      [ticketNumber],
    );
    if (r.rowCount === 0) throw new Error(`Ticket ${ticketNumber} not found.`);
    return r.rows[0].email;
  });
}

export interface FixtureActionSpec {
  description: string;
  result?: string | null;
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  /** Hours before now (negative = future, PLANNED only). */
  hoursAgo?: number;
  followUpNote?: string | null;
  attachmentNotes?: string | null;
  assigneeEmail?: string | null;
}

export interface Lab4FixtureTicket {
  id: number;
  ticketNumber: string;
  requester: FixtureUser;
  actionIds: number[];
}

export interface Lab4FixtureOptions {
  summary?: string;
  /** Free-text description of the Ticket (default: the generic fixture text). */
  description?: string;
  /** Display name of the fixture Requester, for screenshots that must not read "E2E ... Fixture". */
  requesterName?: string;
  status?: string;
  ownerEmail?: string | null;
  actions?: FixtureActionSpec[];
  /** Status-history rows (from, to, hours ago), changed by Priya Natarajan. */
  history?: { from: string; to: string; hoursAgo: number }[];
}

/**
 * A fresh Requester-owned Ticket (own number band, own Requester) with the
 * given status, owner, Actions and status history. Created before the Ticket
 * exists in any other spec's view, so tests that mutate it never touch seeded
 * rows. Replaces any earlier copy (cascade deletes its Actions/history).
 */
export async function createLab4FixtureTicket(
  discriminator: string,
  ticketNumber: string,
  options: Lab4FixtureOptions = {},
): Promise<Lab4FixtureTicket> {
  const base = await createRequesterOwnedFixtureTicket(discriminator, ticketNumber);
  return withClient(async (client) => {
    const staff = await client.query<{ id: number }>(
      'SELECT id FROM "User" WHERE lower(email) = lower($1)',
      [IT_STAFF_EMAIL],
    );
    const staffId = staff.rows[0].id;
    const emailToId = async (email: string | null | undefined) => {
      if (!email) return null;
      const r = await client.query<{ id: number }>(
        'SELECT id FROM "User" WHERE lower(email) = lower($1)',
        [email],
      );
      return r.rows[0].id;
    };

    await client.query(
      `UPDATE "Ticket" SET summary = COALESCE($2, summary), status = $3::"TicketStatus",
         "ownerId" = $4, "createdAt" = NOW() - INTERVAL '10 days', "updatedAt" = NOW()
       WHERE id = $1`,
      [
        base.id,
        options.summary ?? null,
        options.status ?? "IN_PROGRESS",
        await emailToId(options.ownerEmail === undefined ? IT_STAFF_EMAIL : options.ownerEmail),
      ],
    );

    if (options.description) {
      await client.query('UPDATE "Ticket" SET description = $2 WHERE id = $1', [base.id, options.description]);
    }
    if (options.requesterName) {
      await client.query('UPDATE "User" SET name = $2 WHERE id = $1', [base.requester.id, options.requesterName]);
    }

    const actionIds: number[] = [];
    for (const [index, a] of (options.actions ?? []).entries()) {
      const assignee = await emailToId(a.assigneeEmail);
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO "ActionTaken"
           ("ticketId", "actionAt", description, result, status, "performedById", "assigneeId",
            "followUpRequired", "followUpNote", "attachmentNotes", "lastUpdatedById", "updatedAt")
         VALUES ($1, NOW() - ($2::float * INTERVAL '1 hour'), $3, $4, $5::"ActionStatus", $6, $7,
                 $8, $9, $10, $6, NOW())
         RETURNING id`,
        [
          base.id,
          a.hoursAgo ?? 30 - index,
          a.description,
          a.result ?? null,
          a.status ?? "COMPLETED",
          staffId,
          assignee,
          a.followUpNote != null,
          a.followUpNote ?? null,
          a.attachmentNotes ?? null,
        ],
      );
      actionIds.push(inserted.rows[0].id);
    }

    for (const h of options.history ?? []) {
      await client.query(
        `INSERT INTO "TicketStatusChange" ("ticketId", "fromStatus", "toStatus", "changedById", "changedAt")
         VALUES ($1, $2::"TicketStatus", $3::"TicketStatus", $4, NOW() - ($5::float * INTERVAL '1 hour'))`,
        [base.id, h.from, h.to, staffId, h.hoursAgo],
      );
    }

    return { id: base.id, ticketNumber, requester: base.requester, actionIds };
  });
}

/**
 * Removes everything the Lab 4 hardening specs created, so the seeded dashboards (Owned by Me,
 * My Open Actions, Unassigned...) are back to their seeded numbers for any spec that runs after
 * them: fixture Tickets in the TKT-2026-997xxx band (Actions and history cascade), the fixture
 * Requesters made for them, Tickets/users created through the UI by the regression spec.
 */
export async function cleanupLab4Fixtures(): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `DELETE FROM "Ticket" WHERE "ticketNumber" ~ '^TKT-2026-997[0-9]{3}$'
         OR "requesterId" IN (SELECT id FROM "User" WHERE email LIKE 'e2e-plain-login-l4-%@toktickit.local' OR email LIKE 'l4-regression-%@example.test')`,
    );
    await client.query(
      `DELETE FROM "User" WHERE email LIKE 'e2e-plain-login-l4-%@toktickit.local' OR email LIKE 'l4-regression-%@example.test' OR email LIKE 'l4-flow-%@example.test'`,
    );
  });
}

/** Simulates a second editor: bumps an Action's version so the next save is stale. */
export async function bumpActionVersion(actionId: number): Promise<void> {
  await withClient((client) =>
    client.query(
      `UPDATE "ActionTaken" SET version = version + 1, description = description || ' (edited elsewhere)',
         "updatedAt" = NOW() WHERE id = $1`,
      [actionId],
    ),
  );
}

/** A long unbroken token: the worst case for an unclamped cell or card. */
export const LONG_UNBROKEN = "Unbreakable".repeat(14);

/**
 * Asserts the document has no horizontal page scroll
 * (`scrollWidth <= clientWidth`, tests.md R-01..R-04).
 */
export async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${context}: horizontal overflow (scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
  expect(
    metrics.bodyScrollWidth,
    `${context}: body overflows (scrollWidth ${metrics.bodyScrollWidth} > clientWidth ${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
}

/**
 * Asserts no element listed by `selector` pokes outside the viewport
 * horizontally (catches clipped content inside an `overflow: hidden` ancestor
 * that the document-level check cannot see).
 */
export async function expectNothingOutsideViewport(
  page: Page,
  selector: string,
  context: string,
): Promise<void> {
  const offenders = await page.evaluate((sel) => {
    const width = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll<HTMLElement>(sel))
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.right > width + 1 || rect.left < -1))
      .map(({ el, rect }) => `${el.tagName.toLowerCase()}.${el.className} [${Math.round(rect.left)}..${Math.round(rect.right)}]`);
  }, selector);
  expect(offenders, `${context}: elements outside the viewport`).toEqual([]);
}

/** Collects `console.error` calls, page errors and failed same-app requests. */
export function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return { errors };
}

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/** axe scan failing on any serious/critical violation, with an actionable message (mirrors e2e/lab-03/accessibility.spec.ts). */
export async function assertNoSeriousViolations(page: Page, testInfo: TestInfo): Promise<void> {
  const results: AxeResults = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach("axe-results", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const failing = results.violations.filter(
    (v: AxeRuleResult) => v.impact != null && FAILING_IMPACTS.has(v.impact),
  );
  if (failing.length === 0) return;
  const detail = failing
    .map((v: AxeRuleResult) => {
      const targets = v.nodes
        .map((n) => `    - ${n.target.map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" ")}`)
        .join("\n");
      return `  [${v.impact}] ${v.id}: ${v.help}\n  ${v.helpUrl}\n  targets:\n${targets}`;
    })
    .join("\n\n");
  expect(failing.length, `axe-core found ${failing.length} serious/critical violation(s):\n\n${detail}`).toBe(0);
}

/** Independent read-only SQL for expected values; never the service code under test. */
export async function dbRows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return withClient(async (client) => (await client.query<T>(sql, params)).rows);
}

/** One number from independent SQL. */
export async function dbCount(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await dbRows<{ n: string | number }>(sql, params);
  return Number(rows[0].n);
}

/**
 * An active IT Staff user (password = the seeded one, copied from Priya) whose email
 * matches the cleanup pattern, so it never outlives the spec.
 */
export async function createFlowStaffUser(localPart: string, name: string): Promise<FixtureUser> {
  return withClient(async (client) => {
    const email = `l4-flow-${localPart}@example.test`;
    await client.query('DELETE FROM "User" WHERE email = $1', [email]);
    const hash = await client.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "User" WHERE lower(email) = lower($1)',
      [IT_STAFF_EMAIL],
    );
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO "User" (name, email, "passwordHash", role, "isActive", "mustChangePassword", "updatedAt")
       VALUES ($1, $2, $3, 'IT_STAFF'::"Role", true, false, NOW()) RETURNING id`,
      [name, email, hash.rows[0].passwordHash],
    );
    return { id: inserted.rows[0].id, email, name };
  });
}

/** Flips a user's active flag directly (a deactivation that happens while someone else has a form open). */
export async function setUserActive(userId: number, isActive: boolean): Promise<void> {
  await withClient((client) => client.query('UPDATE "User" SET "isActive" = $2, "updatedAt" = NOW() WHERE id = $1', [userId, isActive]));
}

/** Current Actions of a Ticket as stored (count, for exactly-once assertions). */
export async function countActionsOf(ticketId: number): Promise<number> {
  return dbCount('SELECT count(*) AS n FROM "ActionTaken" WHERE "ticketId" = $1', [ticketId]);
}
