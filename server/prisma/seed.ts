import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";
import { LOCAL_DEV_PASSWORD } from "./seedConstants.js";
import { findPristineSeedTickets, seedLab4 } from "./seedLab4.js";

// Reference and fixture data per docs/lab-03/specification.md §7.5 (Lab 2's
// Categories/Related Systems/Requesters reference-data style is unchanged
// from docs/lab-02/specification.md §7.6; Users/Tickets/Comments/Notes are
// the Lab 3 additions). Every row is upserted on its natural unique key
// (email for Users, ticketNumber for Tickets) so re-running this script is
// safe and always converges to the same state (no duplicate rows) — see
// server/tests/lab-03/migration.test.ts MIG-05.
//
// LOCAL_DEV_PASSWORD lives in ./seedConstants.ts, not here, so it can be
// imported for its value alone without triggering this file's own
// module-level `main()` side effect below.
export { LOCAL_DEV_PASSWORD };

const SEED_CATEGORIES = [
  "Account and Access",
  "Hardware",
  "Software",
  "Network",
];

const SEED_RELATED_SYSTEMS = [
  "Email",
  "Campus Wi-Fi",
  "VPN",
  "LEB2 App",
  "Grade Submission App",
  "Printer",
  "Corporate Laptop",
];

const SEED_ACTIVE_REQUESTERS = [
  { name: "Jennifer Anderson", email: "jennifer.anderson@example.edu" },
  { name: "Michael Brown", email: "michael.brown@example.edu" },
  { name: "Sarah Johnson", email: "sarah.johnson@example.edu" },
  { name: "David Lee", email: "david.lee@example.edu" },
];

const SEED_INACTIVE_REQUESTERS = [
  { name: "Robert Wilson", email: "robert.wilson@example.edu" },
];

// 3 active + 1 inactive IT Staff (specification.md §7.5).
const SEED_ACTIVE_IT_STAFF = [
  { name: "Priya Natarajan", email: "priya.natarajan@example.edu" },
  { name: "Carlos Mendes", email: "carlos.mendes@example.edu" },
  { name: "Emma Fischer", email: "emma.fischer@example.edu" },
];

const SEED_INACTIVE_IT_STAFF = [
  { name: "Tom Bakker", email: "tom.bakker@example.edu" },
];

// 2 active Administrators — deliberately one more than handout §5.3's
// minimum, so AC-53 (self-deactivation) and AC-54 (last active
// Administrator) can each be exercised independently rather than firing on
// the same request (specification.md §7.5).
const SEED_ADMINISTRATORS = [
  { name: "Olivia Grant", email: "olivia.grant@example.edu" },
  { name: "Noah Kim", email: "noah.kim@example.edu" },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface SeedAccount {
  name: string;
  email: string;
}

// `email` is deliberately not `@unique` in schema.prisma (see the comment
// there and specification.md §7.4 item 6) — its uniqueness is a
// hand-written case-insensitive index instead, which Prisma's own
// `WhereUniqueInput` type has no representation for. `upsert`/`findUnique`
// therefore cannot use `email` as the lookup key here, so this finds-then-
// writes by hand, which is exactly what `upsert` does internally anyway.
async function upsertUser(
  { name, email }: SeedAccount,
  role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR",
  isActive: boolean,
  passwordHash: string
) {
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { name, role, isActive },
    });
  }
  return prisma.user.create({
    data: {
      name,
      email,
      role,
      isActive,
      passwordHash,
      // §7.5: seeded accounts are usable immediately for manual testing,
      // unlike a migrated or Administrator-created account.
      mustChangePassword: false,
    },
  });
}

async function upsertUsers(
  accounts: SeedAccount[],
  role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR",
  isActive: boolean,
  passwordHash: string
) {
  const results = [];
  for (const account of accounts) {
    results.push(await upsertUser(account, role, isActive, passwordHash));
  }
  return results;
}

interface SeedTicketSpec {
  ticketNumber: string;
  requesterEmail: string;
  ownerEmail: string | null;
  categoryName: string;
  relatedSystemName: string;
  summary: string;
  description: string;
  requestedPriority: "LOW" | "MEDIUM" | "HIGH";
  status:
    | "NEW"
    | "OPEN"
    | "IN_PROGRESS"
    | "WAITING_FOR_REQUESTER"
    | "RESOLVED"
    | "CLOSED"
    | "REOPENED"
    | "CANCELLED";
}

// Tickets spread across Requesters, all eight §5.1 statuses, all three
// Priority values, and both assigned and unassigned ownership
// (specification.md §7.5). Status is written directly — the seed is
// exempt from the §5.1 transition matrix, which isn't enforced logic yet
// (that lands in #69/#71/#72) — but every IN_PROGRESS and
// WAITING_FOR_REQUESTER row below carries an owner, in the spirit of BR-24.
// itPriority mirrors requestedPriority (BR-22): nothing has changed it yet.
//
// Lab 4 (§7.5) widens this to two or more Tickets per status and reassigns
// three Lab 3 rows so the named zero-metric users hold: Emma Fischer owns no
// Ticket (900006 now belongs to Carlos Mendes) and David Lee's only Tickets
// are the two resolved 10+ days ago (900004 and 900008 moved to Michael Brown
// and Sarah Johnson). Timestamps, Actions and history for these rows live in
// ./seedLab4.ts.
const SEED_TICKETS: SeedTicketSpec[] = [
  {
    ticketNumber: "TKT-2026-900001",
    requesterEmail: "jennifer.anderson@example.edu",
    ownerEmail: null,
    categoryName: "Account and Access",
    relatedSystemName: "Email",
    summary: "Cannot reset email password",
    description: "The self-service password reset link never arrives in my inbox.",
    requestedPriority: "LOW",
    status: "NEW",
  },
  {
    ticketNumber: "TKT-2026-900002",
    requesterEmail: "michael.brown@example.edu",
    ownerEmail: null,
    categoryName: "Network",
    relatedSystemName: "Campus Wi-Fi",
    summary: "Wi-Fi drops every few minutes in the library",
    description: "Connection to the campus network disconnects repeatedly near the library entrance.",
    requestedPriority: "MEDIUM",
    status: "OPEN",
  },
  {
    ticketNumber: "TKT-2026-900003",
    requesterEmail: "sarah.johnson@example.edu",
    ownerEmail: "priya.natarajan@example.edu",
    categoryName: "Software",
    relatedSystemName: "Grade Submission App",
    summary: "Grade submission form times out on save",
    description: "Saving a grade sheet with more than 40 rows times out before it finishes.",
    requestedPriority: "HIGH",
    status: "IN_PROGRESS",
  },
  {
    ticketNumber: "TKT-2026-900004",
    requesterEmail: "michael.brown@example.edu",
    ownerEmail: "carlos.mendes@example.edu",
    categoryName: "Network",
    relatedSystemName: "VPN",
    summary: "VPN client will not connect off campus",
    description: "The VPN client reports a handshake failure whenever I connect from home.",
    requestedPriority: "LOW",
    status: "WAITING_FOR_REQUESTER",
  },
  {
    ticketNumber: "TKT-2026-900005",
    requesterEmail: "jennifer.anderson@example.edu",
    ownerEmail: "priya.natarajan@example.edu",
    categoryName: "Hardware",
    relatedSystemName: "Corporate Laptop",
    summary: "Laptop battery drains fully within an hour",
    description: "Replaced the charger already; the battery still drains from full within about an hour.",
    requestedPriority: "MEDIUM",
    status: "RESOLVED",
  },
  {
    ticketNumber: "TKT-2026-900006",
    requesterEmail: "michael.brown@example.edu",
    ownerEmail: "carlos.mendes@example.edu",
    categoryName: "Hardware",
    relatedSystemName: "Printer",
    summary: "Departmental printer jams on double-sided prints",
    description: "Every double-sided print job jams on the second page; single-sided works fine.",
    requestedPriority: "HIGH",
    status: "CLOSED",
  },
  {
    ticketNumber: "TKT-2026-900007",
    requesterEmail: "sarah.johnson@example.edu",
    ownerEmail: "carlos.mendes@example.edu",
    categoryName: "Account and Access",
    relatedSystemName: "LEB2 App",
    summary: "Locked out of LEB2 App after password change",
    description: "Updated my password campus-wide and the LEB2 App still rejects the new one.",
    requestedPriority: "LOW",
    status: "REOPENED",
  },
  {
    ticketNumber: "TKT-2026-900008",
    requesterEmail: "sarah.johnson@example.edu",
    ownerEmail: null,
    categoryName: "Software",
    relatedSystemName: "Email",
    summary: "Request to install an email client plugin",
    description: "Would like the calendar-sync plugin installed; withdrawing the request for now.",
    requestedPriority: "MEDIUM",
    status: "CANCELLED",
  },
  {
    ticketNumber: "TKT-2026-900009",
    requesterEmail: "michael.brown@example.edu",
    ownerEmail: null,
    categoryName: "Hardware",
    relatedSystemName: "Printer",
    summary: "Printer shows offline for the whole department",
    description: "The shared printer appears offline on every machine since this morning.",
    requestedPriority: "MEDIUM",
    status: "NEW",
  },
  {
    ticketNumber: "TKT-2026-900010",
    requesterEmail: "sarah.johnson@example.edu",
    ownerEmail: null,
    categoryName: "Network",
    relatedSystemName: "VPN",
    summary: "VPN disconnects during long video calls",
    description: "The VPN tunnel drops after roughly 30 minutes of an active call.",
    requestedPriority: "HIGH",
    status: "OPEN",
  },
  {
    ticketNumber: "TKT-2026-900011",
    requesterEmail: "jennifer.anderson@example.edu",
    ownerEmail: "priya.natarajan@example.edu",
    categoryName: "Software",
    relatedSystemName: "Email",
    summary: "Shared mailbox is missing from my Outlook profile",
    description: "I was granted access to the shared mailbox but it never shows up.",
    requestedPriority: "MEDIUM",
    status: "OPEN",
  },
  {
    ticketNumber: "TKT-2026-900012",
    requesterEmail: "michael.brown@example.edu",
    ownerEmail: "carlos.mendes@example.edu",
    categoryName: "Software",
    relatedSystemName: "Grade Submission App",
    summary: "Exported grade report has the wrong column order",
    description: "The CSV export swaps the student id and name columns.",
    requestedPriority: "MEDIUM",
    status: "IN_PROGRESS",
  },
  {
    ticketNumber: "TKT-2026-900013",
    requesterEmail: "jennifer.anderson@example.edu",
    ownerEmail: "priya.natarajan@example.edu",
    categoryName: "Account and Access",
    relatedSystemName: "LEB2 App",
    summary: "Two-factor prompt never reaches my phone",
    description: "The LEB2 App asks for a second factor but no code or push arrives.",
    requestedPriority: "MEDIUM",
    status: "WAITING_FOR_REQUESTER",
  },
  {
    ticketNumber: "TKT-2026-900015",
    requesterEmail: "david.lee@example.edu",
    ownerEmail: "carlos.mendes@example.edu",
    categoryName: "Hardware",
    relatedSystemName: "Corporate Laptop",
    summary: "Docking station does not detect the second monitor",
    description: "The second monitor stays blank when the laptop is docked.",
    requestedPriority: "LOW",
    status: "RESOLVED",
  },
  {
    ticketNumber: "TKT-2026-900016",
    requesterEmail: "david.lee@example.edu",
    ownerEmail: "priya.natarajan@example.edu",
    categoryName: "Network",
    relatedSystemName: "Campus Wi-Fi",
    summary: "Cannot join the staff Wi-Fi network from the annex",
    description: "Authentication fails every time in the annex building.",
    requestedPriority: "MEDIUM",
    status: "CLOSED",
  },
  {
    ticketNumber: "TKT-2026-900017",
    requesterEmail: "sarah.johnson@example.edu",
    ownerEmail: "carlos.mendes@example.edu",
    categoryName: "Software",
    relatedSystemName: "Email",
    summary: "Old mailbox quota warning after archive",
    description: "Archived the old mail but the quota warning still appears.",
    requestedPriority: "MEDIUM",
    status: "CLOSED",
  },
  {
    ticketNumber: "TKT-2026-900018",
    requesterEmail: "michael.brown@example.edu",
    ownerEmail: null,
    categoryName: "Network",
    relatedSystemName: "Campus Wi-Fi",
    summary: "Guest Wi-Fi portal page loads blank",
    description: "The captive portal page is blank in the lab on the second floor.",
    requestedPriority: "LOW",
    status: "OPEN",
  },
  {
    ticketNumber: "TKT-2026-900019",
    requesterEmail: "jennifer.anderson@example.edu",
    ownerEmail: "priya.natarajan@example.edu",
    categoryName: "Software",
    relatedSystemName: "Grade Submission App",
    summary: "Grades vanished after the save confirmation",
    description: "The confirmation appeared, but the grade sheet is empty on reopening.",
    requestedPriority: "HIGH",
    status: "REOPENED",
  },
  {
    ticketNumber: "TKT-2026-900020",
    requesterEmail: "jennifer.anderson@example.edu",
    ownerEmail: null,
    categoryName: "Hardware",
    relatedSystemName: "Corporate Laptop",
    summary: "Request for a replacement laptop bag",
    description: "Withdrawing this request; the bag turned up in the office.",
    requestedPriority: "LOW",
    status: "CANCELLED",
  },
];

interface SeedCommentSpec {
  ticketNumber: string;
  authorEmail: string;
  body: string;
}

// Example Public Comments and Internal Notes, containing no sensitive
// information (specification.md §7.5).
const SEED_PUBLIC_COMMENTS: SeedCommentSpec[] = [
  {
    ticketNumber: "TKT-2026-900003",
    authorEmail: "priya.natarajan@example.edu",
    body: "Thanks for the report — I can reproduce the timeout and I'm looking into it now.",
  },
  {
    ticketNumber: "TKT-2026-900003",
    authorEmail: "sarah.johnson@example.edu",
    body: "Appreciate the update — let me know if you need a sample grade sheet to test with.",
  },
  {
    ticketNumber: "TKT-2026-900005",
    authorEmail: "jennifer.anderson@example.edu",
    body: "The replacement battery is holding a full charge through the day now, thank you!",
  },
];

const SEED_INTERNAL_NOTES: SeedCommentSpec[] = [
  {
    ticketNumber: "TKT-2026-900003",
    authorEmail: "priya.natarajan@example.edu",
    body: "Save timeout looks like the batch validation query scanning the whole table; checking the query plan next.",
  },
  {
    ticketNumber: "TKT-2026-900004",
    authorEmail: "carlos.mendes@example.edu",
    body: "Asked the requester to confirm which VPN client version they're on before escalating further.",
  },
];

async function seedTickets(pristine: ReadonlySet<string>): Promise<Map<string, { id: number }>> {
  const categories = await prisma.category.findMany();
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
  const relatedSystems = await prisma.relatedSystem.findMany();
  const relatedSystemIdByName = new Map(relatedSystems.map((r) => [r.name, r.id]));
  const users = await prisma.user.findMany();
  const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));

  const ticketsByNumber = new Map<string, { id: number }>();

  for (const spec of SEED_TICKETS) {
    const requesterId = userIdByEmail.get(spec.requesterEmail);
    const categoryId = categoryIdByName.get(spec.categoryName);
    const relatedSystemId = relatedSystemIdByName.get(spec.relatedSystemName);
    const ownerId = spec.ownerEmail ? userIdByEmail.get(spec.ownerEmail) : null;

    if (!requesterId || !categoryId || !relatedSystemId || (spec.ownerEmail && !ownerId)) {
      throw new Error(`Seed ticket ${spec.ticketNumber} references an unknown fixture row.`);
    }

    // Pristine rule (see seedLab4.ts): an existing Ticket with application
    // activity (status/owner changed, version bumped, extra history or
    // Actions) is left completely untouched, not even a no-op update, which
    // would bump @updatedAt.
    if (!pristine.has(spec.ticketNumber)) {
      const existing = await prisma.ticket.findUniqueOrThrow({ where: { ticketNumber: spec.ticketNumber } });
      ticketsByNumber.set(spec.ticketNumber, { id: existing.id });
      continue;
    }

    const ticket = await prisma.ticket.upsert({
      where: { ticketNumber: spec.ticketNumber },
      update: {
        requesterId,
        categoryId,
        relatedSystemId,
        ownerId: ownerId ?? null,
        summary: spec.summary,
        description: spec.description,
        requestedPriority: spec.requestedPriority,
        // itPriority is left untouched on an update: an IT Staff/Admin
        // change to it (BR-22) must survive re-running the seed.
        status: spec.status,
      },
      create: {
        ticketNumber: spec.ticketNumber,
        requesterId,
        categoryId,
        relatedSystemId,
        ownerId: ownerId ?? null,
        summary: spec.summary,
        description: spec.description,
        requestedPriority: spec.requestedPriority,
        itPriority: spec.requestedPriority,
        status: spec.status,
      },
    });

    ticketsByNumber.set(spec.ticketNumber, { id: ticket.id });
  }

  return ticketsByNumber;
}

/**
 * PublicComment/InternalNote have no natural unique key beyond their id
 * (append-only, BR-15, so there is no "update" case to upsert into) — a
 * matching (ticketId, authorId, body) row is treated as "already seeded"
 * and left alone, which is what makes re-running this script idempotent
 * for these two tables too.
 */
interface ThreadRowArgs {
  ticketId: number;
  authorId: number;
  body: string;
}

async function seedComments(
  finder: (args: { where: ThreadRowArgs }) => Promise<unknown>,
  creator: (args: { data: ThreadRowArgs }) => Promise<unknown>,
  specs: SeedCommentSpec[],
  ticketsByNumber: Map<string, { id: number }>,
  userIdByEmail: Map<string, number>
) {
  for (const spec of specs) {
    const ticket = ticketsByNumber.get(spec.ticketNumber);
    const authorId = userIdByEmail.get(spec.authorEmail);
    if (!ticket || !authorId) {
      throw new Error(`Seed comment/note on ${spec.ticketNumber} references an unknown fixture row.`);
    }

    const row: ThreadRowArgs = { ticketId: ticket.id, authorId, body: spec.body };
    const existing = await finder({ where: row });
    if (!existing) {
      await creator({ data: row });
    }
  }
}

async function main() {
  const categories = await prisma.$transaction(
    SEED_CATEGORIES.map((name) =>
      prisma.category.upsert({
        where: { name },
        update: { isActive: true },
        create: { name, isActive: true },
      })
    )
  );

  const relatedSystems = await prisma.$transaction(
    SEED_RELATED_SYSTEMS.map((name) =>
      prisma.relatedSystem.upsert({
        where: { name },
        update: { isActive: true },
        create: { name, isActive: true },
      })
    )
  );

  // One shared bcrypt hash for every seeded account (§7.5, D-13) — hashed
  // once, since bcrypt is deliberately slow and every account uses the
  // same LOCAL_DEV_PASSWORD.
  const passwordHash = await hashPassword(LOCAL_DEV_PASSWORD);

  const activeRequesters = await upsertUsers(SEED_ACTIVE_REQUESTERS, "REQUESTER", true, passwordHash);
  const inactiveRequesters = await upsertUsers(SEED_INACTIVE_REQUESTERS, "REQUESTER", false, passwordHash);
  const activeItStaff = await upsertUsers(SEED_ACTIVE_IT_STAFF, "IT_STAFF", true, passwordHash);
  const inactiveItStaff = await upsertUsers(SEED_INACTIVE_IT_STAFF, "IT_STAFF", false, passwordHash);
  const administrators = await upsertUsers(SEED_ADMINISTRATORS, "ADMINISTRATOR", true, passwordHash);

  // TicketCounter is intentionally NOT seeded here: rows are created lazily
  // on the first ticket allocated for a given year (see
  // docs/lab-02/specification.md §7.3). The tickets below bypass that
  // allocator entirely (fixed "900xxx" ticketNumbers, well outside the
  // sequential band real ticket creation uses), so they never collide with
  // it either.
  const pristine = await findPristineSeedTickets(prisma, SEED_TICKETS);
  for (const spec of SEED_TICKETS) {
    if (!pristine.has(spec.ticketNumber)) {
      console.log(`Skipping ${spec.ticketNumber}: it has application activity since it was seeded.`);
    }
  }
  const ticketsByNumber = await seedTickets(pristine);

  const users = await prisma.user.findMany();
  const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));

  await seedComments(
    (args) => prisma.publicComment.findFirst(args),
    (args) => prisma.publicComment.create(args),
    SEED_PUBLIC_COMMENTS,
    ticketsByNumber,
    userIdByEmail
  );
  await seedComments(
    (args) => prisma.internalNote.findFirst(args),
    (args) => prisma.internalNote.create(args),
    SEED_INTERNAL_NOTES,
    ticketsByNumber,
    userIdByEmail
  );

  // Lab 4 (docs/lab-04/specification.md §7.5): Actions Taken, status history
  // and timestamps re-anchored to now. Runs last, after Tickets and Users exist.
  const lab4 = await seedLab4(prisma, pristine);

  console.log({
    ...lab4,
    categories: categories.length,
    relatedSystems: relatedSystems.length,
    activeRequesters: activeRequesters.length,
    inactiveRequesters: inactiveRequesters.length,
    activeItStaff: activeItStaff.length,
    inactiveItStaff: inactiveItStaff.length,
    administrators: administrators.length,
    tickets: ticketsByNumber.size,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
