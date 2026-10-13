import type { PrismaClient } from "../src/generated/prisma/client.js";
import { hashActionCreateBody } from "../src/services/actionRequestHash.js";

// Lab 4 seed extension (docs/lab-04/specification.md §7.5, D-10, D-11).
//
// Called from seed.ts after the Tickets and Users exist. Everything here is
// find-or-create on a natural key so the script is safe to re-run:
//   - Actions Taken: (ticketId, clientRequestId) with the fixed UUIDs below
//   - status history: only ever written for a Ticket whose history is empty
//     or already equal to the seeded chain (see "pristine" below), so the
//     n-th row of that verified chain is updated in place instead of adding one.
//
// Pristine rule (protects application activity on re-seed): a seeded Ticket
// is pristine when it does not exist yet, or when its status and owner equal
// the seeded values, version = 1, its history rows equal the seeded chain
// exactly by content in order (from, to, changedBy) or are still empty, and
// its Actions are only the seeded ones with version = 1, and it has no
// Attachment and no Public Comment or Internal Note beyond the seeded ones
// (compared by author and body). Only pristine
// Tickets get created or re-anchored, together with their history, Actions
// and timestamps. Any other Ticket and everything attached to it is left
// completely untouched. History is matched by content, never by id position.
// Every timestamp is expressed as an offset in hours before "now" and is
// re-written on each run, so the Asia/Bangkok 7-day window metrics (BR-22)
// stay reproducible whenever the seed is run. Offsets inside the window are
// at most 120 h and outside it at least 216 h, so they hold at any time of
// day (the window is 6 days plus the part of today already elapsed).
//
// Prisma's `@updatedAt` overwrites `updatedAt` on every Prisma write, so
// Ticket/Action createdAt/updatedAt are set afterwards with raw SQL.
//
// Status is written directly (the seed is exempt from the §5.1 matrix).
// Emma Fischer deliberately appears nowhere: no Ticket, no Action, no
// history row (zero metrics). David Lee's Tickets are resolved 10+ days ago.

type Status =
  | "NEW" | "OPEN" | "IN_PROGRESS" | "WAITING_FOR_REQUESTER"
  | "RESOLVED" | "CLOSED" | "REOPENED" | "CANCELLED";
type ActionStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

const PRIYA = "priya.natarajan@example.edu";
const CARLOS = "carlos.mendes@example.edu";
const OLIVIA = "olivia.grant@example.edu"; // Administrator

// All seeded Tickets were created this many hours ago, so every Action's
// actionAt (BR-04: not before createdAt) is valid.
const CREATED_HOURS_AGO = 24 * 20;

// ticketNumber -> hours ago of Ticket.updatedAt. This is an upper bound on
// the age: seedLab4 makes it at least as recent as the Ticket's latest
// history row and latest Action createdAt/updatedAt (BR-15).
const TICKET_UPDATED_HOURS_AGO: Record<string, number> = {
  "TKT-2026-900001": 30,
  "TKT-2026-900002": 72,
  "TKT-2026-900003": 6,
  "TKT-2026-900004": 48,
  "TKT-2026-900005": 48,
  "TKT-2026-900006": 216,
  "TKT-2026-900007": 24,
  "TKT-2026-900008": 216,
  "TKT-2026-900009": 120,
  "TKT-2026-900010": 48,
  "TKT-2026-900011": 4,
  "TKT-2026-900012": 20,
  "TKT-2026-900013": 8,
  "TKT-2026-900015": 290, // David Lee: resolved 12 days ago
  "TKT-2026-900016": 252, // David Lee: closed 10.5 days ago
  "TKT-2026-900017": 24, // legacy, no history, inside the window
  "TKT-2026-900018": 72, // legacy, no history
  "TKT-2026-900019": 3,
  "TKT-2026-900020": 96,
};

interface HistoryStep {
  to: Status;
  hoursAgo: number;
  by: string;
}

// Each chain starts from NEW (fromStatus of step 1) and ends at the Ticket's
// current status. NEW Tickets and the legacy Tickets (900017, 900018) have
// no entry on purpose (D-10).
const TICKET_HISTORY: Record<string, HistoryStep[]> = {
  "TKT-2026-900002": [{ to: "OPEN", hoursAgo: 72, by: PRIYA }],
  "TKT-2026-900010": [{ to: "OPEN", hoursAgo: 48, by: CARLOS }],
  "TKT-2026-900011": [{ to: "OPEN", hoursAgo: 100, by: PRIYA }],
  "TKT-2026-900003": [
    { to: "OPEN", hoursAgo: 80, by: PRIYA },
    { to: "IN_PROGRESS", hoursAgo: 70, by: PRIYA },
  ],
  "TKT-2026-900012": [
    { to: "OPEN", hoursAgo: 60, by: CARLOS },
    { to: "IN_PROGRESS", hoursAgo: 50, by: CARLOS },
  ],
  "TKT-2026-900004": [
    { to: "OPEN", hoursAgo: 100, by: CARLOS },
    { to: "IN_PROGRESS", hoursAgo: 90, by: CARLOS },
    { to: "WAITING_FOR_REQUESTER", hoursAgo: 48, by: CARLOS },
  ],
  "TKT-2026-900013": [
    { to: "OPEN", hoursAgo: 70, by: PRIYA },
    { to: "IN_PROGRESS", hoursAgo: 60, by: PRIYA },
    { to: "WAITING_FOR_REQUESTER", hoursAgo: 8, by: PRIYA },
  ],
  // Jennifer Anderson's recently resolved Ticket: RESOLVED row inside the window.
  "TKT-2026-900005": [
    { to: "OPEN", hoursAgo: 150, by: PRIYA },
    { to: "IN_PROGRESS", hoursAgo: 120, by: PRIYA },
    { to: "RESOLVED", hoursAgo: 48, by: PRIYA },
  ],
  // David Lee's Tickets: every row 10+ days old, outside the window.
  "TKT-2026-900015": [
    { to: "OPEN", hoursAgo: 400, by: CARLOS },
    { to: "IN_PROGRESS", hoursAgo: 380, by: CARLOS },
    { to: "RESOLVED", hoursAgo: 290, by: CARLOS },
  ],
  "TKT-2026-900016": [
    { to: "OPEN", hoursAgo: 420, by: PRIYA },
    { to: "IN_PROGRESS", hoursAgo: 400, by: PRIYA },
    { to: "RESOLVED", hoursAgo: 270, by: PRIYA },
    { to: "CLOSED", hoursAgo: 252, by: PRIYA },
  ],
  "TKT-2026-900006": [
    { to: "OPEN", hoursAgo: 300, by: CARLOS },
    { to: "IN_PROGRESS", hoursAgo: 280, by: CARLOS },
    { to: "RESOLVED", hoursAgo: 230, by: CARLOS },
    { to: "CLOSED", hoursAgo: 216, by: CARLOS },
  ],
  "TKT-2026-900007": [
    { to: "OPEN", hoursAgo: 200, by: CARLOS },
    { to: "IN_PROGRESS", hoursAgo: 190, by: CARLOS },
    { to: "RESOLVED", hoursAgo: 100, by: CARLOS },
    { to: "REOPENED", hoursAgo: 24, by: CARLOS },
  ],
  "TKT-2026-900019": [
    { to: "OPEN", hoursAgo: 150, by: PRIYA },
    { to: "IN_PROGRESS", hoursAgo: 140, by: PRIYA },
    { to: "RESOLVED", hoursAgo: 100, by: PRIYA },
    { to: "REOPENED", hoursAgo: 3, by: PRIYA },
  ],
  "TKT-2026-900008": [
    { to: "OPEN", hoursAgo: 230, by: CARLOS },
    { to: "CANCELLED", hoursAgo: 216, by: CARLOS },
  ],
  // Only IT Staff change status (BR-16); the Administrator appears in Actions only.
  "TKT-2026-900020": [{ to: "CANCELLED", hoursAgo: 96, by: PRIYA }],
};

export interface ActionSpec {
  /** Fixed idempotency key (BR-35); unique per Ticket. */
  clientRequestId: string;
  ticketNumber: string;
  performedBy: string;
  assignee: string | null;
  /** Current status of the seeded row. */
  status: ActionStatus;
  /**
   * Status of the ORIGINAL create request that clientRequestHash is computed
   * from (api-spec §2.3: PLANNED, IN_PROGRESS or COMPLETED, never CANCELLED).
   * Defaults to `status`; required when `status` is CANCELLED.
   */
  originalStatus?: Exclude<ActionStatus, "CANCELLED">;
  /** Hours before now; negative = in the future (PLANNED only, BR-04). */
  actionHoursAgo: number;
  description: string;
  result: string | null;
  followUpNote: string | null;
  attachmentNotes?: string;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Coverage (all inside the §7.5 table):
//  - 900003: 5 Actions, three performers incl. an Administrator, three
//    statuses, one follow-up (Priya's Urgent Ticket).
//  - 900012: the BLOCKED resolution candidate. It is left IN_PROGRESS rather
//    than RESOLVED on purpose: it has an owner and a COMPLETED Action but
//    also a PLANNED one, so BR-17 forbids moving it to RESOLVED. Seeding it
//    as RESOLVED would store a state the gate makes unreachable (an Action
//    logged after a Resolve is only legitimate follow-up work, BR-12).
//  - 900005: the gate-PASSING Resolved Ticket (owner, 2 COMPLETED, none open).
//  - 900013: second follow-up; 900011: PLANNED unassigned Action (BR-25
//    performer fallback); the rest give single-Action Tickets.
//  - Tickets without an entry here have 0 Actions.
export const ACTIONS: ActionSpec[] = [
  { clientRequestId: uuid(1), ticketNumber: "TKT-2026-900003", performedBy: PRIYA, assignee: null, status: "COMPLETED", actionHoursAgo: 30, description: "Reproduced the save timeout in the staging environment.", result: "Timeout reproduced with 40+ rows; batch validation query is the cause.", followUpNote: null },
  { clientRequestId: uuid(2), ticketNumber: "TKT-2026-900003", performedBy: CARLOS, assignee: null, status: "COMPLETED", actionHoursAgo: 26, description: "Reviewed the indexes on the grade table.", result: "Found a missing composite index on (course, student).", followUpNote: null },
  { clientRequestId: uuid(3), ticketNumber: "TKT-2026-900003", performedBy: OLIVIA, assignee: null, status: "COMPLETED", actionHoursAgo: 20, description: "Approved the production index change window.", result: "Change window approved for tonight.", followUpNote: null },
  { clientRequestId: uuid(4), ticketNumber: "TKT-2026-900003", performedBy: PRIYA, assignee: PRIYA, status: "IN_PROGRESS", actionHoursAgo: 5, description: "Applying the composite index to production.", result: null, followUpNote: "Confirm the timeout is gone after 24 hours of normal use." },
  { clientRequestId: uuid(5), ticketNumber: "TKT-2026-900003", performedBy: CARLOS, assignee: null, status: "CANCELLED", originalStatus: "IN_PROGRESS", actionHoursAgo: 10, description: "Scale up the database instance.", result: null, followUpNote: null },
  { clientRequestId: uuid(6), ticketNumber: "TKT-2026-900012", performedBy: CARLOS, assignee: null, status: "COMPLETED", actionHoursAgo: 18, description: "Compared the export template with the column spec.", result: "Template swaps the first two columns.", followUpNote: null },
  { clientRequestId: uuid(7), ticketNumber: "TKT-2026-900012", performedBy: CARLOS, assignee: PRIYA, status: "PLANNED", actionHoursAgo: -48, description: "Deploy the corrected export template.", result: null, followUpNote: null, attachmentNotes: "See the sample export attached to the Ticket." },
  { clientRequestId: uuid(8), ticketNumber: "TKT-2026-900013", performedBy: PRIYA, assignee: PRIYA, status: "IN_PROGRESS", actionHoursAgo: 6, description: "Re-enrolled the requester's phone for two-factor prompts.", result: null, followUpNote: "Check back with the requester once they test the new prompt." },
  { clientRequestId: uuid(9), ticketNumber: "TKT-2026-900005", performedBy: PRIYA, assignee: null, status: "COMPLETED", actionHoursAgo: 72, description: "Ran the battery diagnostic on the laptop.", result: "Battery health at 38 percent; replacement needed.", followUpNote: null },
  { clientRequestId: uuid(10), ticketNumber: "TKT-2026-900005", performedBy: PRIYA, assignee: null, status: "COMPLETED", actionHoursAgo: 60, description: "Swapped in a replacement battery.", result: "New battery holds charge through a full day.", followUpNote: null },
  { clientRequestId: uuid(11), ticketNumber: "TKT-2026-900015", performedBy: CARLOS, assignee: null, status: "COMPLETED", actionHoursAgo: 300, description: "Updated the docking station firmware.", result: "Second monitor detected after the update.", followUpNote: null },
  { clientRequestId: uuid(12), ticketNumber: "TKT-2026-900004", performedBy: CARLOS, assignee: null, status: "COMPLETED", actionHoursAgo: 60, description: "Checked the VPN gateway logs for the requester.", result: "Handshake fails on an outdated client version.", followUpNote: null },
  { clientRequestId: uuid(13), ticketNumber: "TKT-2026-900007", performedBy: CARLOS, assignee: null, status: "COMPLETED", actionHoursAgo: 110, description: "Reset the LEB2 App credential cache.", result: "Cache cleared; login worked until the next password change.", followUpNote: null },
  { clientRequestId: uuid(14), ticketNumber: "TKT-2026-900006", performedBy: CARLOS, assignee: null, status: "COMPLETED", actionHoursAgo: 240, description: "Replaced the duplex roller in the printer.", result: "Double-sided prints run without jams.", followUpNote: null },
  { clientRequestId: uuid(15), ticketNumber: "TKT-2026-900011", performedBy: PRIYA, assignee: null, status: "PLANNED", actionHoursAgo: -24, description: "Request mailbox permission refresh from the mail team.", result: null, followUpNote: null },
  { clientRequestId: uuid(16), ticketNumber: "TKT-2026-900016", performedBy: PRIYA, assignee: null, status: "COMPLETED", actionHoursAgo: 280, description: "Reissued the Wi-Fi certificate for the requester.", result: "Annex Wi-Fi authenticates with the new certificate.", followUpNote: null },
];

/**
 * The valid create body (api-spec §2.3) a client would have sent to create
 * this Action, which BR-35's clientRequestHash is computed from. It is
 * independent of the row's current status: a CANCELLED Action was created as
 * IN_PROGRESS (or PLANNED) and cancelled afterwards.
 */
export function originalCreateBody(a: ActionSpec, actionAt: Date, assigneeId: number | null): Record<string, unknown> {
  const status = a.originalStatus ?? a.status;
  if (status === "CANCELLED") {
    throw new Error(`Seeded Action ${a.clientRequestId} needs an originalStatus (CANCELLED is not a valid initial status).`);
  }
  return {
    description: a.description,
    result: a.result,
    actionAt: actionAt.toISOString(),
    status,
    assigneeId,
    followUpRequired: a.followUpNote !== null,
    followUpNote: a.followUpNote,
    attachmentNotes: a.attachmentNotes ?? null,
  };
}

export interface Lab4SeedSummary {
  lab4ActionsTaken: number;
  lab4StatusHistoryRows: number;
}

// Previous seed signature, recognised as seed-owned so a database seeded by
// the earlier revision (PR #103, commit ef80e88) upgrades cleanly. That
// revision wrote two chains authored by an Administrator (BR-16 says only IT
// Staff change status); its Actions equal the current ones apart from a null
// clientRequestHash, which the Action check below already tolerates. A chain
// matching either this or the current TICKET_HISTORY is pristine and is
// rewritten to the current one; anything else is genuine user history.
const LEGACY_HISTORY_103: Record<string, HistoryStep[]> = {
  "TKT-2026-900008": [
    { to: "OPEN", hoursAgo: 230, by: OLIVIA },
    { to: "CANCELLED", hoursAgo: 216, by: OLIVIA },
  ],
  "TKT-2026-900020": [{ to: "CANCELLED", hoursAgo: 96, by: OLIVIA }],
};

export interface SeedTicketState {
  ticketNumber: string;
  status: Status;
  ownerEmail: string | null;
}

/**
 * Returns the ticket numbers (from `specs`) that are pristine in the sense
 * described in the header; a Ticket that does not exist yet counts. Call it
 * BEFORE the Lab 3 Ticket upserts run.
 */
export interface SeededComment {
  ticketNumber: string;
  authorEmail: string;
  body: string;
}

export async function findPristineSeedTickets(
  prisma: PrismaClient,
  specs: readonly SeedTicketState[],
  seededComments: { publicComments: readonly SeededComment[]; internalNotes: readonly SeededComment[] }
): Promise<Set<string>> {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const idOf = (email: string) => users.find((u) => u.email === email)?.id;
  const pristine = new Set<string>();

  for (const spec of specs) {
    const t = await prisma.ticket.findUnique({ where: { ticketNumber: spec.ticketNumber } });
    if (!t) {
      pristine.add(spec.ticketNumber);
      continue;
    }
    const ownerId = spec.ownerEmail ? idOf(spec.ownerEmail) : null;
    if (t.status !== spec.status || t.ownerId !== (ownerId ?? null) || t.version !== 1) continue;
    // POST /requester-resolved sets this without touching status or version.
    if (t.requesterResolvedAt !== null) continue;

    const history = await prisma.ticketStatusChange.findMany({
      where: { ticketId: t.id },
      orderBy: { id: "asc" },
    });
    const chains = [TICKET_HISTORY[spec.ticketNumber] ?? [], LEGACY_HISTORY_103[spec.ticketNumber]];
    const matchesChain = (steps: HistoryStep[]) => {
      let from: Status = "NEW";
      return (
        history.length === steps.length &&
        steps.every((step, i) => {
          const h = history[i]!;
          const ok = h.fromStatus === from && h.toStatus === step.to && h.changedById === idOf(step.by);
          from = step.to;
          return ok;
        })
      );
    };
    const historyOk =
      history.length === 0 || chains.some((steps) => steps !== undefined && matchesChain(steps));
    if (!historyOk) continue;

    const seededKeys = new Set(
      ACTIONS.filter((a) => a.ticketNumber === spec.ticketNumber).map((a) => a.clientRequestId)
    );
    const actions = await prisma.actionTaken.findMany({ where: { ticketId: t.id } });
    if (actions.some((a) => a.version !== 1 || !a.clientRequestId || !seededKeys.has(a.clientRequestId))) continue;

    // Application activity the seed never creates: any Attachment (the seed
    // has none), and any Public Comment or Internal Note beyond the seeded
    // ones for this Ticket. Compared by (author, body) with multiplicity, so
    // an extra row identical to a seeded one still counts as activity.
    if ((await prisma.attachment.count({ where: { ticketId: t.id } })) > 0) continue;
    const hasExtra = (
      list: readonly SeededComment[],
      rows: readonly { authorId: number; body: string }[]
    ) => {
      const budget = new Map<string, number>();
      for (const c of list) {
        if (c.ticketNumber !== spec.ticketNumber) continue;
        const key = `${idOf(c.authorEmail)}\u0000${c.body}`;
        budget.set(key, (budget.get(key) ?? 0) + 1);
      }
      return rows.some((r) => {
        const key = `${r.authorId}\u0000${r.body}`;
        const left = budget.get(key) ?? 0;
        budget.set(key, left - 1);
        return left <= 0;
      });
    };
    const comments = await prisma.publicComment.findMany({ where: { ticketId: t.id } });
    if (hasExtra(seededComments.publicComments, comments)) continue;
    const notes = await prisma.internalNote.findMany({ where: { ticketId: t.id } });
    if (hasExtra(seededComments.internalNotes, notes)) continue;

    pristine.add(spec.ticketNumber);
  }
  return pristine;
}

export async function seedLab4(
  prisma: PrismaClient,
  pristine: ReadonlySet<string>
): Promise<Lab4SeedSummary> {
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 3_600_000);

  const users = await prisma.user.findMany();
  const userId = (email: string) => {
    const u = users.find((x) => x.email === email);
    if (!u) throw new Error(`Lab 4 seed references unknown user ${email}.`);
    return u.id;
  };
  const tickets = await prisma.ticket.findMany({ select: { id: true, ticketNumber: true } });
  const ticketId = (n: string) => {
    const t = tickets.find((x) => x.ticketNumber === n);
    if (!t) throw new Error(`Lab 4 seed references unknown ticket ${n}.`);
    return t.id;
  };

  // Status history, pristine Tickets only. Pristine means the existing rows
  // already equal the seeded chain (verified by content), so row i is step i.
  let historyRows = 0;
  for (const [ticketNumber, steps] of Object.entries(TICKET_HISTORY)) {
    if (!pristine.has(ticketNumber)) continue;
    const id = ticketId(ticketNumber);
    const existing = await prisma.ticketStatusChange.findMany({
      where: { ticketId: id },
      orderBy: { id: "asc" },
    });
    let from: Status = "NEW";
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const data = {
        ticketId: id,
        fromStatus: from,
        toStatus: step.to,
        changedById: userId(step.by),
        changedAt: ago(step.hoursAgo),
      };
      const row = existing[i];
      if (row) {
        await prisma.ticketStatusChange.update({ where: { id: row.id }, data });
      } else {
        await prisma.ticketStatusChange.create({ data });
      }
      from = step.to;
      historyRows++;
    }
  }

  // Actions Taken: (ticketId, clientRequestId), pristine Tickets only.
  let actionRows = 0;
  for (const a of ACTIONS) {
    if (!pristine.has(a.ticketNumber)) continue;
    const tId = ticketId(a.ticketNumber);
    const performedById = userId(a.performedBy);
    const assigneeId = a.assignee ? userId(a.assignee) : null;
    const when = ago(a.actionHoursAgo);
    const data = {
      ticketId: tId,
      actionAt: when,
      description: a.description,
      result: a.result,
      status: a.status,
      performedById,
      assigneeId,
      followUpRequired: a.followUpNote !== null,
      followUpNote: a.followUpNote,
      attachmentNotes: a.attachmentNotes ?? null,
      lastUpdatedById: performedById,
      clientRequestId: a.clientRequestId,
      // BR-35: hash of the original (valid) create body, not of the current row.
      clientRequestHash: hashActionCreateBody(originalCreateBody(a, when, assigneeId)),
    };
    const existing = await prisma.actionTaken.findUnique({
      where: { ticketId_clientRequestId: { ticketId: tId, clientRequestId: a.clientRequestId } },
    });
    const saved = existing
      ? await prisma.actionTaken.update({ where: { id: existing.id }, data })
      : await prisma.actionTaken.create({ data });
    // Logged when it happened, or an hour ago for a future-dated PLANNED Action.
    const loggedAt = ago(Math.max(a.actionHoursAgo, 1));
    await prisma.$executeRaw`
      UPDATE "ActionTaken" SET "createdAt" = ${loggedAt}, "updatedAt" = ${loggedAt}
      WHERE id = ${saved.id}`;
    actionRows++;
  }

  // Ticket timestamps last, so nothing above (or Lab 3's upserts) leaves a
  // stale @updatedAt behind. Done for every pristine seeded Ticket. updatedAt
  // is never older than the Ticket's latest history row or Action (BR-15).
  const createdAt = ago(CREATED_HOURS_AGO);
  for (const t of tickets) {
    const declared = TICKET_UPDATED_HOURS_AGO[t.ticketNumber];
    if (declared === undefined || !pristine.has(t.ticketNumber)) continue;
    const newest = Math.min(
      declared,
      ...(TICKET_HISTORY[t.ticketNumber] ?? []).map((h) => h.hoursAgo),
      ...ACTIONS.filter((a) => a.ticketNumber === t.ticketNumber).map((a) => Math.max(a.actionHoursAgo, 1))
    );
    await prisma.$executeRaw`
      UPDATE "Ticket" SET "createdAt" = ${createdAt}, "updatedAt" = ${ago(newest)}
      WHERE id = ${t.id}`;
  }

  return { lab4ActionsTaken: actionRows, lab4StatusHistoryRows: historyRows };
}
