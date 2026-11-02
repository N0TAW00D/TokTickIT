import { prisma } from '../lib/prisma.ts';
import type { Priority, Role, TicketStatus } from '../generated/prisma/client.ts';
import { BANGKOK_TIME_ZONE, windowStart } from './dashboardWindow.ts';
import {
  followUpTicketWhere, myActionsTicketWhere, myOpenActionWhere, openTicketWhere, recentTicketWhere,
  urgentTicketWhere,
} from './ticketFilters.ts';

// GET /api/dashboard/staff (api-spec.md §5; BR-25..BR-29, BR-32). Aggregates
// only: counts and groupBys in SQL, lists capped at 5 rows.

const LIST_CAP = 5;
const NEWEST_FIRST = [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];
const STATUSES: TicketStatus[] = [
  'NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED',
];
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH'];
const ROLES: Role[] = ['REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'];

const STAFF_ITEM_SELECT = {
  id: true,
  ticketNumber: true,
  summary: true,
  status: true,
  itPriority: true,
  owner: { select: { id: true, name: true } },
  updatedAt: true,
} as const;

export async function buildStaffDashboard(caller: { id: number; role: Role }, now: Date) {
  const me = caller.id;
  const recentWhere = recentTicketWhere(now);
  const urgentWhere = urgentTicketWhere();
  const myActionWhere = myOpenActionWhere(me);

  const [
    unassigned, ownedByMe, followUpsRequired, statusGroups, priorityGroups,
    myActionCount, myActionTickets, myActionItems,
    urgentTotal, urgentItems, recentTotal, recentItems, userGroups,
  ] = await Promise.all([
    prisma.ticket.count({ where: { ...openTicketWhere(), ownerId: null } }),
    prisma.ticket.count({ where: { ...openTicketWhere(), ownerId: me } }),
    prisma.ticket.count({ where: followUpTicketWhere() }),
    prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['itPriority'], where: openTicketWhere(), _count: { _all: true } }),
    prisma.actionTaken.count({ where: myActionWhere }),
    prisma.ticket.count({ where: myActionsTicketWhere(me) }),
    prisma.actionTaken.findMany({
      where: myActionWhere,
      orderBy: [{ actionAt: 'asc' }, { id: 'asc' }],
      take: LIST_CAP,
      select: {
        id: true, ticketId: true, description: true, status: true, actionAt: true, followUpRequired: true,
        ticket: { select: { ticketNumber: true } },
      },
    }),
    prisma.ticket.count({ where: urgentWhere }),
    prisma.ticket.findMany({ where: urgentWhere, orderBy: NEWEST_FIRST, take: LIST_CAP, select: STAFF_ITEM_SELECT }),
    prisma.ticket.count({ where: recentWhere }),
    prisma.ticket.findMany({ where: recentWhere, orderBy: NEWEST_FIRST, take: LIST_CAP, select: STAFF_ITEM_SELECT }),
    caller.role === 'ADMINISTRATOR'
      ? prisma.user.groupBy({ by: ['role', 'isActive'], _count: { _all: true } })
      : Promise.resolve(null),
  ]);

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
  for (const g of statusGroups) byStatus[g.status] = g._count._all;
  const byItPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  for (const g of priorityGroups) byItPriority[g.itPriority] = g._count._all;

  return {
    generatedAt: now.toISOString(),
    timeZone: BANGKOK_TIME_ZONE,
    windowStart: windowStart(now).toISOString(),
    metrics: { unassigned, ownedByMe, urgent: urgentTotal, followUpsRequired },
    byStatus,
    byItPriority,
    myOpenActions: {
      actions: myActionCount,
      tickets: myActionTickets,
      items: myActionItems.map(({ ticket, ...action }) => ({ ...action, ticketNumber: ticket.ticketNumber })),
    },
    urgentTickets: { total: urgentTotal, items: urgentItems },
    recentlyUpdated: { total: recentTotal, items: recentItems },
    // BR-32: the key exists for an Administrator only.
    ...(userGroups !== null
      ? {
          userCounts: ROLES.map((role) => ({
            role,
            active: userGroups.find((g) => g.role === role && g.isActive)?._count._all ?? 0,
            inactive: userGroups.find((g) => g.role === role && !g.isActive)?._count._all ?? 0,
          })),
        }
      : {}),
  };
}
