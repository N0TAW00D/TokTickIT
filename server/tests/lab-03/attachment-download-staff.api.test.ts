import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';

// GET /api/attachments/:id/download — docs/lab-03/api-spec.md §5/§9 (FR-27,
// AC-43): this fixes the PR #81 review finding that the route's role guard
// was left at REQUESTER-only, so IT Staff and Administrator — who the
// Staff Ticket Detail screen (ui-spec.md §10) shows Download/Preview
// buttons to — got 403 on every attempt. `getDownloadableAttachment`
// (src/services/attachmentAccess.ts) now resolves any existing attachment
// for an IT_STAFF/ADMINISTRATOR caller with no ownership check, while a
// REQUESTER caller keeps the exact Lab 2 ownership-checked behavior.
//
// This file covers only the staff-facing widening plus a couple of
// regression checks (Requester ownership, the removed-attachment 410, and
// unauthenticated 401) that prove the shared route wasn't otherwise
// disturbed. Everything else about this route — Content-Disposition
// hardening, file-missing-on-disk 500, byte-for-byte round-tripping — stays
// covered, unchanged, by tests/lab-02/attachments.api.test.ts, which this
// file does not modify.
//
// Fixtures reuse the seeded Requester/IT Staff/Administrator accounts
// (server/prisma/seed.ts, LOCAL_DEV_PASSWORD), same convention as
// ticket-detail-staff.api.test.ts — reset-db.ts truncates Ticket/
// Attachment/TicketCounter/Session (never User) before every test, and
// vitest.config.ts's `fileParallelism: false` runs every test file
// serially, so reusing the seeded Users across tests/files is safe.
//
// Like tests/lab-02/attachments.api.test.ts, this suite points
// ATTACHMENTS_DIR at a throwaway temp directory so a real upload/download
// round trip never touches the real, git-ignored server/uploads/.

const testServer = useTestServer(app);

let tempUploadsDir: string;

let categoryId: number;
let relatedSystemId: number;
let requesterAEmail: string;
let requesterBEmail: string;
let staffAEmail: string;
let adminEmail: string;

beforeAll(async () => {
  tempUploadsDir = mkdtempSync(path.join(os.tmpdir(), 'toktickit-staff-download-'));
  process.env.ATTACHMENTS_DIR = tempUploadsDir;

  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requesters = await prisma.user.findMany({
    where: { isActive: true, role: 'REQUESTER' },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const staffA = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'IT_STAFF' } });
  const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });

  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
  requesterAEmail = requesters[0]!.email;
  requesterBEmail = requesters[1]!.email;
  staffAEmail = staffA.email;
  adminEmail = admin.email;
});

afterAll(() => {
  rmSync(tempUploadsDir, { recursive: true, force: true });
  expect(existsSync(tempUploadsDir)).toBe(false);
  delete process.env.ATTACHMENTS_DIR;
});

function extractSessionCookiePair(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!raw) {
    throw new Error('Response carried no toktickit.sid cookie');
  }
  return raw.split(';')[0];
}

async function loginAndGetCookie(email: string, password: string = LOCAL_DEV_PASSWORD): Promise<string> {
  const res = await request(testServer.server)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
  expect(res.status, 'test fixture login must succeed').toBe(200);
  return extractSessionCookiePair(res);
}

// reset-db.ts truncates Session before every test, so fresh cookies must be
// obtained per test, not once in beforeAll.
let requesterACookie: string;
let requesterBCookie: string;
let staffACookie: string;
let adminCookie: string;

beforeEach(async () => {
  requesterACookie = await loginAndGetCookie(requesterAEmail);
  requesterBCookie = await loginAndGetCookie(requesterBEmail);
  staffACookie = await loginAndGetCookie(staffAEmail);
  adminCookie = await loginAndGetCookie(adminEmail);
});

function pdfBuffer(size: number): Buffer {
  const header = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary');
  if (size <= header.length) {
    return header.subarray(0, size);
  }
  return Buffer.concat([header, Buffer.alloc(size - header.length, 0x41)]);
}

async function seedTicketOwnedByRequesterA(): Promise<number> {
  const res = await request(testServer.server)
    .post('/api/tickets')
    .set('Cookie', requesterACookie)
    .send({
      categoryId,
      relatedSystemId,
      requestedPriority: 'MEDIUM',
      summary: 'A ticket used to exercise the staff attachment download fix',
      description: 'Description text long enough to satisfy the 20-character minimum for this field.',
    });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** Uploads a PDF to `ticketId` as Requester A and returns its attachment id and bytes. */
async function uploadAttachment(ticketId: number): Promise<{ attachmentId: number; bytes: Buffer }> {
  const bytes = pdfBuffer(2048);
  const res = await request(testServer.server)
    .post(`/api/tickets/${ticketId}/attachments`)
    .set('Cookie', requesterACookie)
    .attach('file', bytes, { filename: 'diagnostic-log.pdf' });
  expect(res.status).toBe(201);
  return { attachmentId: res.body.id as number, bytes };
}

function download(attachmentId: number, cookie?: string) {
  const req = request(testServer.server).get(`/api/attachments/${attachmentId}/download`);
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

describe('GET /api/attachments/:id/download — IT Staff/Administrator access (api-spec.md §5, §9)', () => {
  it('IT Staff can download an attachment on a ticket it does not own — 200, correct bytes and headers', async () => {
    const ticketId = await seedTicketOwnedByRequesterA();
    const { attachmentId, bytes } = await uploadAttachment(ticketId);

    const res = await download(attachmentId, staffACookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      "attachment; filename=\"diagnostic-log.pdf\"; filename*=UTF-8''diagnostic-log.pdf"
    );
    expect(res.headers['content-length']).toBe(String(bytes.length));
    const downloaded = res.body as Buffer;
    expect(Buffer.isBuffer(downloaded)).toBe(true);
    expect(downloaded.equals(bytes)).toBe(true);
  });

  it('Administrator can likewise download any attachment — 200', async () => {
    const ticketId = await seedTicketOwnedByRequesterA();
    const { attachmentId, bytes } = await uploadAttachment(ticketId);

    const res = await download(attachmentId, adminCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect((res.body as Buffer).equals(bytes)).toBe(true);
  });

  it("a Requester still gets 404 downloading another Requester's attachment (ownership regression check)", async () => {
    const ticketId = await seedTicketOwnedByRequesterA();
    const { attachmentId } = await uploadAttachment(ticketId);

    const res = await download(attachmentId, requesterBCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('IT Staff downloading a soft-removed attachment still gets 410, regardless of role (BR-33)', async () => {
    const ticketId = await seedTicketOwnedByRequesterA();
    const { attachmentId } = await uploadAttachment(ticketId);

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { isRemoved: true, removedAt: new Date(), removedReason: 'Wrong file uploaded' },
    });

    const res = await download(attachmentId, staffACookie);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('ATTACHMENT_REMOVED');
  });

  it('Administrator downloading a soft-removed attachment still gets 410, regardless of role (BR-33)', async () => {
    const ticketId = await seedTicketOwnedByRequesterA();
    const { attachmentId } = await uploadAttachment(ticketId);

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { isRemoved: true, removedAt: new Date(), removedReason: 'Wrong file uploaded' },
    });

    const res = await download(attachmentId, adminCookie);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('ATTACHMENT_REMOVED');
  });

  it('an unauthenticated caller still gets 401, unaffected by the widened role guard', async () => {
    const ticketId = await seedTicketOwnedByRequesterA();
    const { attachmentId } = await uploadAttachment(ticketId);

    const missing = await download(attachmentId);
    expect(missing.status).toBe(401);
    expect(missing.body.error).toBe('UNAUTHENTICATED');

    const invalid = await download(attachmentId, `${SESSION_COOKIE_NAME}=does-not-exist`);
    expect(invalid.status).toBe(401);
    expect(invalid.body.error).toBe('UNAUTHENTICATED');
  });

  // AC-43: attachment continuity for IT Staff also covers the *list*, not
  // only the download — GET /api/tickets/:id's `attachments` array must
  // carry the real, uploaded attachment's content, not merely exist as a
  // key. `TICKET_DETAIL_ATTACHMENT_SELECT` (src/routes/tickets.ts) is the
  // exact field list a staff caller gets back.
  it("IT Staff's GET /api/tickets/:id attachments array carries the real, uploaded attachment's id/originalFilename/fileSize", async () => {
    const ticketId = await seedTicketOwnedByRequesterA();
    const { attachmentId, bytes } = await uploadAttachment(ticketId);

    const res = await request(testServer.server).get(`/api/tickets/${ticketId}`).set('Cookie', staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0]).toMatchObject({
      id: attachmentId,
      originalFilename: 'diagnostic-log.pdf',
      mimeType: 'application/pdf',
      fileSize: bytes.length,
      isRemoved: false,
      removedAt: null,
      removedReason: null,
    });
  });
});
