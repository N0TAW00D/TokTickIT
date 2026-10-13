import { prisma } from '../lib/prisma.ts';
import { BANGKOK_TIME_ZONE, windowStart } from './dashboardWindow.ts';
import { openTicketWhere, recentTicketWhere, recentlyResolvedTicketWhere } from './ticketFilters.ts';

// GET /api/dashboard/requester (api-spec.md §4; BR-20..BR-24). Every query is
// scoped to `requesterId = me` first; nothing here accepts a user id from the
// request. Counts are SQL aggregates and each list is `take: 5`.

const LIST_CAP = 5;
const NEWEST_FIRST = [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];
const ITEM_SELECT = { id: true, ticketNumber: true, summary: true, status: true, updatedAt: true } as const;

export async function buildRequesterDashboard(requesterId: number, now: Date) {
  const mine = { requesterId };
  const recentWhere = { ...mine, ...recentTicketWhere(now) };
  const resolvedWhere = { ...mine, ...recentlyResolvedTicketWhere(now) };
  const windowStartAt = windowStart(now);

  const [openTickets, waitingForMe, recentTotal, recentItems, resolvedTotal, resolvedItems] = await Promise.all([
    prisma.ticket.count({ where: { ...mine, ...openTicketWhere() } }),
    prisma.ticket.count({ where: { ...mine, status: 'WAITING_FOR_REQUESTER' } }),
    prisma.ticket.count({ where: recentWhere }),
    prisma.ticket.findMany({ where: recentWhere, orderBy: NEWEST_FIRST, take: LIST_CAP, select: ITEM_SELECT }),
    prisma.ticket.count({ where: resolvedWhere }),
    prisma.ticket.findMany({
      where: resolvedWhere,
      orderBy: NEWEST_FIRST,
      take: LIST_CAP,
      select: {
        ...ITEM_SELECT,
        // Latest status change into Resolved/Closed inside the window = resolvedAt (BR-23).
        statusChanges: {
          where: { toStatus: { in: ['RESOLVED', 'CLOSED'] }, changedAt: { gte: windowStartAt } },
          orderBy: { changedAt: 'desc' },
          take: 1,
          select: { changedAt: true },
        },
      },
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    timeZone: BANGKOK_TIME_ZONE,
    windowStart: windowStartAt.toISOString(),
    metrics: { openTickets, waitingForMe },
    recentlyUpdated: { total: recentTotal, items: recentItems },
    recentlyResolved: {
      total: resolvedTotal,
      items: resolvedItems.map(({ statusChanges, ...ticket }) => ({
        ...ticket,
        resolvedAt: statusChanges[0]!.changedAt,
      })),
    },
  };
}
