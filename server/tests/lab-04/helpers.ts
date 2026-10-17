import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Server } from 'node:http';
import { expect } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import type { Role, TicketStatus } from '../../src/generated/prisma/client.js';

// Shared fixtures for the Lab 4 API suites. Rows are created directly with
// Prisma; the per-test TRUNCATE of "Ticket" (tests/setup/reset-db.ts) cascades
// to ActionTaken, and Users are deleted by the owning suite's afterEach.

export const PASSWORD = 'CorrectHorseBattery1';

export async function createUser(
  role: Role,
  options: { isActive?: boolean; name?: string } = {},
): Promise<{ id: number; name: string; email: string; role: Role }> {
  const passwordHash = await hashPassword(PASSWORD);
  const email = `lab4-${role.toLowerCase()}-${randomUUID()}@example.edu`;
  const user = await prisma.user.create({
    data: {
      name: options.name ?? `Lab4 ${role} ${email.slice(5, 11)}`,
      email,
      role,
      isActive: options.isActive ?? true,
      mustChangePassword: false,
      passwordHash,
    },
  });
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function loginCookie(server: Server, email: string): Promise<string> {
  const res = await request(server)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password: PASSWORD });
  expect(res.status, 'fixture login must succeed').toBe(200);
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const raw = setCookie.find((c) => c.startsWith('toktickit.sid='));
  if (!raw) throw new Error('no session cookie');
  return raw.split(';')[0];
}

export async function createTicket(
  requesterId: number,
  overrides: { status?: TicketStatus; createdAt?: Date; ownerId?: number | null } = {},
) {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-L4-${randomUUID().slice(0, 12)}`,
      requesterId,
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: 'A ticket used to exercise Actions Taken',
      description: 'Description text long enough to satisfy the 20-character minimum for this field.',
      requestedPriority: 'MEDIUM',
      itPriority: 'MEDIUM',
      status: overrides.status ?? 'IN_PROGRESS',
      ownerId: overrides.ownerId ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
}

export async function createActionRow(
  ticketId: number,
  performedById: number,
  overrides: {
    description?: string;
    status?: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    result?: string | null;
    actionAt?: Date;
    assigneeId?: number | null;
    followUpRequired?: boolean;
    followUpNote?: string | null;
    attachmentNotes?: string | null;
  } = {},
) {
  const status = overrides.status ?? 'PLANNED';
  return prisma.actionTaken.create({
    data: {
      ticketId,
      performedById,
      lastUpdatedById: performedById,
      description: overrides.description ?? 'Seeded action',
      status,
      result: overrides.result !== undefined ? overrides.result : status === 'COMPLETED' ? 'Done' : null,
      actionAt: overrides.actionAt ?? new Date(),
      assigneeId: overrides.assigneeId ?? null,
      followUpRequired: overrides.followUpRequired ?? false,
      followUpNote: overrides.followUpNote ?? null,
      attachmentNotes: overrides.attachmentNotes ?? null,
    },
  });
}

export async function deleteUsers(ids: number[]): Promise<void> {
  if (ids.length > 0) {
    await prisma.actionTaken.deleteMany({
      where: { OR: [{ performedById: { in: ids } }, { lastUpdatedById: { in: ids } }, { assigneeId: { in: ids } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}
