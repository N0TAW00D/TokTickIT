import { expect, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { prisma } from '../../src/lib/prisma.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';

// Shared helpers for the Lab 4 dashboard / drill-down suites. Nothing in here
// imports dashboard service code: expected values are recomputed with
// independent SQL (docs/lab-04/tests.md §1.3).

/** Frozen "now": Monday 2026-10-12 12:00 Bangkok. Window start is 2026-10-05T17:00:00Z. */
export const NOW = new Date('2026-10-12T05:00:00.000Z');
export const WINDOW_START = new Date('2026-10-05T17:00:00.000Z');

export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
}

export function unfreezeClock(): void {
  vi.useRealTimers();
}

export type Status =
  | 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING_FOR_REQUESTER'
  | 'RESOLVED' | 'CLOSED' | 'REOPENED' | 'CANCELLED';
export type Prio = 'LOW' | 'MEDIUM' | 'HIGH';
export type ActionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export const ALL_STATUSES: Status[] = [
  'NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED',
];

export function hoursBefore(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 3_600_000);
}

export async function userByName(name: string) {
  return prisma.user.findFirstOrThrow({ where: { name } });
}

export async function loginAs(server: Server, email: string): Promise<string> {
  const res = await request(server)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password: LOCAL_DEV_PASSWORD });
  expect(res.status, 'fixture login must succeed').toBe(200);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!raw) throw new Error('no session cookie');
  return raw.split(';')[0]!;
}

let ticketSeq = 0;

export interface TicketSpec {
  requesterId: number;
  status?: Status;
  itPriority?: Prio;
  ownerId?: number | null;
  updatedAt?: Date;
  summary?: string;
}

export async function makeTicket(spec: TicketSpec) {
  ticketSeq += 1;
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const updatedAt = spec.updatedAt ?? NOW;
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-9${String(ticketSeq).padStart(5, '0')}`,
      requesterId: spec.requesterId,
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: spec.summary ?? `Fixture ticket ${ticketSeq}`,
      description: 'Fixture description',
      requestedPriority: 'MEDIUM',
      itPriority: spec.itPriority ?? 'MEDIUM',
      status: spec.status ?? 'OPEN',
      ownerId: spec.ownerId ?? null,
      createdAt: hoursBefore(updatedAt, 24 * 30),
      updatedAt,
    },
  });
}

export async function addHistory(ticketId: number, toStatus: Status, changedById: number, changedAt: Date) {
  return prisma.ticketStatusChange.create({
    data: { ticketId, fromStatus: 'IN_PROGRESS', toStatus, changedById, changedAt },
  });
}

export interface ActionSpec {
  ticketId: number;
  performedById: number;
  assigneeId?: number | null;
  status?: ActionStatus;
  followUpRequired?: boolean;
  actionAt?: Date;
  description?: string;
}

export async function addAction(spec: ActionSpec) {
  return prisma.actionTaken.create({
    data: {
      ticketId: spec.ticketId,
      actionAt: spec.actionAt ?? NOW,
      description: spec.description ?? 'Fixture action',
      status: spec.status ?? 'PLANNED',
      result: spec.status === 'COMPLETED' ? 'Done' : null,
      performedById: spec.performedById,
      assigneeId: spec.assigneeId ?? null,
      lastUpdatedById: spec.performedById,
      followUpRequired: spec.followUpRequired ?? false,
      followUpNote: spec.followUpRequired ? 'Check later' : null,
    },
  });
}

/** Independent SQL for the Bangkok window start, from a frozen instant (BR-22). */
export const WINDOW_START_SQL = `((date_trunc('day', $1::timestamptz AT TIME ZONE 'Asia/Bangkok') - interval '6 days') AT TIME ZONE 'Asia/Bangkok')`;
export const NOT_OPEN = `('RESOLVED','CLOSED','CANCELLED')`;

export async function sqlCount(sql: string, ...params: unknown[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ v: bigint | number }[]>(sql, ...params);
  return Number(rows[0]!.v);
}

/** Timestamps are stored as `timestamp` (UTC); compare them as UTC instants explicitly. */
export const UPDATED_RECENTLY = `("updatedAt" AT TIME ZONE 'UTC') >= ${WINDOW_START_SQL}`;

export async function sqlRecentlyResolvedIds(requesterId: number, now: Date): Promise<number[]> {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT t.id FROM "Ticket" t
      WHERE t."requesterId" = $2 AND t.status IN ('RESOLVED','CLOSED')
        AND (SELECT max(h."changedAt") FROM "TicketStatusChange" h
              WHERE h."ticketId" = t.id AND h."toStatus" IN ('RESOLVED','CLOSED')) AT TIME ZONE 'UTC' >= ${WINDOW_START_SQL}
      ORDER BY t.id`,
    now.toISOString(),
    requesterId
  );
  return rows.map((r) => r.id);
}

export function get(server: Server, path: string, cookie?: string) {
  const req = request(server).get(path);
  return cookie ? req.set('Cookie', cookie) : req;
}
