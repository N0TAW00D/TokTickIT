import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';

// Covers docs/lab-02/api-spec.md §4.1-4.4 (attachment upload, metadata,
// download, and soft removal) and tests.md API-22..API-31.
//
// This suite points ATTACHMENTS_DIR at a throwaway temp directory (rather
// than the real, git-ignored server/uploads/) so test runs never write to
// the real uploads directory and never leak files after the run — verified
// explicitly in the afterAll below.

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '../..');
const REAL_UPLOADS_DIR = path.join(serverRoot, 'uploads');

let tempUploadsDir: string;
let realUploadsDirFilesBefore: string[];

let requesterAId: number;
let requesterBId: number;
let activeCategoryId: number;
let activeRelatedSystemId: number;

// supertest spins up a brand-new ephemeral `app.listen(0)` server for every
// single `request(app)` call unless it's handed an already-listening
// server (lib/test.js: `serverAddress` only calls `.listen(0)` when
// `app.address()` is still null). This file makes dozens of requests per
// run, some in `Promise.all` batches of 3 — that many listen/close cycles
// in quick succession let the OS hand out the same ephemeral port to a new
// server before Node has fully torn down the previous one's sockets, so a
// pooled keep-alive connection from an old, already-closed server can get
// reused against the new one. That produces exactly the two failure modes
// observed here: a connection torn down mid-request ("socket hang up"), or
// a stale response race that a new connection reads out of order
// ("Parse Error: Expected HTTP/, RTSP/ or ICE/"). Binding one real server
// once for the whole file and reusing it for every request (`request(server)`
// below, never `request(app)`) removes the churn entirely.
let server: Server;

beforeAll(async () => {
  realUploadsDirFilesBefore = existsSync(REAL_UPLOADS_DIR) ? readdirSync(REAL_UPLOADS_DIR) : [];

  tempUploadsDir = mkdtempSync(path.join(os.tmpdir(), 'toktickit-attachments-'));
  process.env.ATTACHMENTS_DIR = tempUploadsDir;

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requesters = await prisma.requesterUser.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });

  if (requesters.length < 2) {
    throw new Error('Need at least 2 active seeded Requesters for attachment ownership tests');
  }

  activeCategoryId = category.id;
  activeRelatedSystemId = relatedSystem.id;
  requesterAId = requesters[0]!.id;
  requesterBId = requesters[1]!.id;
});

afterEach(() => {
  // tests.md §1.3: "Uploaded files during tests go to a temp directory
  // cleared in `afterEach`." Clear the directory's *contents* here — the
  // directory itself stays put (and gets removed once, in the afterAll
  // below) so every test in this file can keep pointing ATTACHMENTS_DIR at
  // the same path. This runs between tests, so a test that uploads a file
  // and then reads it back from `tempUploadsDir` within its own body is
  // unaffected.
  for (const entry of readdirSync(tempUploadsDir)) {
    rmSync(path.join(tempUploadsDir, entry), { recursive: true, force: true });
  }
});

afterAll(async () => {
  // Prove no file ever landed in the real, git-ignored uploads dir.
  const realUploadsDirFilesAfter = existsSync(REAL_UPLOADS_DIR) ? readdirSync(REAL_UPLOADS_DIR) : [];
  expect(realUploadsDirFilesAfter).toEqual(realUploadsDirFilesBefore);

  // Clean up the temp dir this suite used, so nothing leaks on disk.
  rmSync(tempUploadsDir, { recursive: true, force: true });
  expect(existsSync(tempUploadsDir)).toBe(false);

  delete process.env.ATTACHMENTS_DIR;

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function createTicket(requesterId: number): Promise<number> {
  const res = await request(server)
    .post('/api/tickets')
    .set('X-Requester-Id', String(requesterId))
    .send({
      categoryId: activeCategoryId,
      relatedSystemId: activeRelatedSystemId,
      requestedPriority: 'MEDIUM',
      summary: 'A ticket used to exercise attachment uploads',
      description: 'Description text long enough to satisfy the 20-character minimum for this field.',
    });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

function jpegBuffer(size: number): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  return padded(header, size);
}

function pngBuffer(size: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return padded(header, size);
}

function webpBuffer(size: number): Buffer {
  const header = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
  ]);
  return padded(header, size);
}

function pdfBuffer(size: number): Buffer {
  const header = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary');
  return padded(header, size);
}

function padded(header: Buffer, size: number): Buffer {
  if (size <= header.length) {
    return header.subarray(0, size);
  }
  return Buffer.concat([header, Buffer.alloc(size - header.length, 0x41)]);
}

function upload(ticketId: number, requesterId: number) {
  return request(server)
    .post(`/api/tickets/${ticketId}/attachments`)
    .set('X-Requester-Id', String(requesterId));
}

describe('POST /api/tickets/:id/attachments', () => {
  describe('API-22: type rules (AC-18, BR-21)', () => {
    it('rejects a .exe file with 415 UNSUPPORTED_TYPE', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), {
        filename: 'malware.exe',
      });
      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_TYPE');
      expect('fields' in res.body).toBe(false);
    });

    it('rejects a .txt file with 415 UNSUPPORTED_TYPE', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', Buffer.from('plain text content', 'ascii'), {
        filename: 'notes.txt',
      });
      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_TYPE');
    });

    it('rejects a PNG renamed to .pdf (extension/content mismatch) with 415 UNSUPPORTED_TYPE', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', pngBuffer(1000), { filename: 'renamed.pdf' });
      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_TYPE');
    });

    it.each([
      ['image/jpeg', 'photo.jpg', () => jpegBuffer(1000)],
      ['image/png', 'icon.png', () => pngBuffer(1000)],
      ['image/webp', 'image.webp', () => webpBuffer(1000)],
      ['application/pdf', 'report.pdf', () => pdfBuffer(1000)],
    ] as const)('accepts a genuine %s file and returns 201', async (mimeType, filename, makeBuffer) => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', makeBuffer(), { filename });
      expect(res.status).toBe(201);
      expect(res.body.mimeType).toBe(mimeType);
    });
  });

  describe('API-23: attachment size (AC-19, BR-22)', () => {
    it('accepts a file of exactly 5 MB with 201', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', pdfBuffer(5 * 1024 * 1024), {
        filename: 'exactly-5mb.pdf',
      });
      expect(res.status).toBe(201);
      expect(res.body.fileSize).toBe(5 * 1024 * 1024);
    });

    it('rejects a file of 5 MB + 1 byte with 413 FILE_TOO_LARGE', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', pdfBuffer(5 * 1024 * 1024 + 1), {
        filename: 'over-5mb.pdf',
      });
      expect(res.status).toBe(413);
      expect(res.body.error).toBe('FILE_TOO_LARGE');
      expect('fields' in res.body).toBe(false);
    });
  });

  describe('API-24: attachment active-count limit (AC-20, BR-23)', () => {
    it('allows 5 active attachments, then rejects the 6th with 409 ATTACHMENT_LIMIT', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadedIds: number[] = [];

      for (let i = 0; i < 5; i++) {
        const res = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), { filename: `file-${i}.pdf` });
        expect(res.status, `upload #${i + 1}`).toBe(201);
        uploadedIds.push(res.body.id as number);
      }

      const sixth = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), { filename: 'file-6.pdf' });
      expect(sixth.status).toBe(409);
      expect(sixth.body.error).toBe('ATTACHMENT_LIMIT');

      const activeCount = await prisma.attachment.count({ where: { ticketId, isRemoved: false } });
      expect(activeCount).toBe(5);

      // "after removing one, upload succeeds" — the other half of API-24,
      // now that DELETE /api/attachments/:id (slice 9b) exists.
      const removeRes = await request(server)
        .delete(`/api/attachments/${uploadedIds[0]}`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'Freeing a slot to prove the limit re-opens' });
      expect(removeRes.status).toBe(200);

      const seventh = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), { filename: 'file-7.pdf' });
      expect(seventh.status).toBe(201);

      const activeCountAfter = await prisma.attachment.count({ where: { ticketId, isRemoved: false } });
      expect(activeCountAfter).toBe(5);
    });

    it('holds the limit under genuinely concurrent uploads: one below the limit, 3 requests race for the last slot, exactly 1 succeeds and the rest are 409 (never 500)', async () => {
      const ticketId = await createTicket(requesterAId);

      // Snapshot the uploads dir before this test writes anything, so the
      // orphan-file check below can identify exactly the files *this test*
      // wrote, independent of whatever earlier tests in this file may have
      // left behind on disk.
      const filesBeforeThisTest = new Set(readdirSync(tempUploadsDir));

      // Get to one below the limit sequentially — only the final slot is
      // contested.
      for (let i = 0; i < 4; i++) {
        const res = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), { filename: `seed-${i}.pdf` });
        expect(res.status, `seed upload #${i + 1}`).toBe(201);
      }

      // Fire genuinely concurrent requests (Promise.all of in-flight
      // requests, not sequential awaits) at the 5th and only remaining
      // slot. Without a row lock serializing the recount, more than one of
      // these can observe 4 active attachments and proceed, landing above
      // BR-23's limit of 5 — this is the regression this test exists to
      // catch.
      const raceSize = 3;
      const responses = await Promise.all(
        Array.from({ length: raceSize }, (_, i) =>
          upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), { filename: `race-${i}.pdf` })
        )
      );

      // Never a 500: every response is either the one winner (201) or a
      // clean rejection (409 ATTACHMENT_LIMIT).
      for (const res of responses) {
        expect([201, 409]).toContain(res.status);
        if (res.status === 409) {
          expect(res.body.error).toBe('ATTACHMENT_LIMIT');
        }
      }
      expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
      expect(responses.filter((res) => res.status === 409)).toHaveLength(raceSize - 1);

      // Never a 6th row: the ticket ends with exactly 5 active attachments,
      // not 6 or 7.
      const activeCount = await prisma.attachment.count({ where: { ticketId, isRemoved: false } });
      expect(activeCount).toBe(5);

      // No orphan files: every file the losing requests wrote before
      // hitting the locked recount must have been deleted on the
      // best-effort cleanup path. Compare only the files *this test*
      // created (filtering out `filesBeforeThisTest`) against this
      // ticket's rows, so the assertion doesn't depend on whether earlier
      // tests in this file left files of their own on disk.
      const newFilesOnDisk = readdirSync(tempUploadsDir).filter((entry) => !filesBeforeThisTest.has(entry));
      const rows = await prisma.attachment.findMany({ where: { ticketId } });
      expect(newFilesOnDisk.sort()).toEqual(rows.map((row) => row.storedFilename).sort());
    });
  });

  describe('API-25: attachment storage safety (BR-27, BR-29)', () => {
    it('stores the file as <uuid>.<ext> under the uploads dir, and never exposes storedFilename in the response', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });

      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('storedFilename');
      expect(Object.keys(res.body).sort()).toEqual(
        ['id', 'ticketId', 'originalFilename', 'mimeType', 'fileSize', 'isRemoved', 'removedAt', 'removedReason', 'createdAt'].sort()
      );

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.storedFilename).toMatch(/^[0-9a-f-]{36}\.jpg$/);

      const filesOnDisk = readdirSync(tempUploadsDir);
      expect(filesOnDisk).toContain(row.storedFilename);
    });

    it('strips path components from originalFilename and truncates to 255 chars (BR-29)', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId)
        .attach('file', jpegBuffer(1000), { filename: '../../etc/passwd.jpg' });

      expect(res.status).toBe(201);
      expect(res.body.originalFilename).toBe('passwd.jpg');
      expect(res.body.originalFilename.length).toBeLessThanOrEqual(255);
    });

    it("bumps the parent ticket's updatedAt on a successful upload (BR-07)", async () => {
      const ticketId = await createTicket(requesterAId);
      const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

      await new Promise((resolve) => setTimeout(resolve, 10)); // ensure a distinguishable timestamp

      const res = await upload(ticketId, requesterAId).attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
      expect(res.status).toBe(201);

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    });

    it('BR-27 ordering: writes the file before the row, and on a post-write metadata failure deletes the orphaned file and leaves no row', async () => {
      const ticketId = await createTicket(requesterAId);

      const filesBefore = readdirSync(tempUploadsDir);
      const attachmentCountBefore = await prisma.attachment.count({ where: { ticketId } });

      const spy = vi
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('simulated metadata-insert failure'));

      // Sanity-check the sabotage actually engaged before trusting the
      // assertions below: confirm the mock is installed and distinct from
      // the real implementation.
      expect(vi.isMockFunction(prisma.$transaction)).toBe(true);

      try {
        const res = await upload(ticketId, requesterAId).attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('INTERNAL');
      } finally {
        spy.mockRestore();
      }

      const attachmentCountAfter = await prisma.attachment.count({ where: { ticketId } });
      expect(attachmentCountAfter).toBe(attachmentCountBefore);

      const filesAfter = readdirSync(tempUploadsDir);
      expect(filesAfter.sort()).toEqual(filesBefore.sort());
    });
  });

  describe('API-26: attachment ownership (AC-37, BR-14)', () => {
    it("B uploading to A's ticket returns 404, byte-identical to uploading to an unknown ticket id", async () => {
      const ticketId = await createTicket(requesterAId);

      const notOwnedRes = await upload(ticketId, requesterBId).attach('file', jpegBuffer(1000), {
        filename: 'photo.jpg',
      });
      const unknownRes = await upload(999_999, requesterAId).attach('file', jpegBuffer(1000), {
        filename: 'photo.jpg',
      });

      expect(notOwnedRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(notOwnedRes.body).toEqual(unknownRes.body);
      expect(notOwnedRes.body.error).toBe('NOT_FOUND');

      const created = await prisma.attachment.count({ where: { ticketId } });
      expect(created).toBe(0);
    });

    it('a non-integer ticket id is treated as not found, not a 400 (api-spec.md §1.4)', async () => {
      const res = await upload(NaN, requesterAId).attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
      // supertest interpolates NaN as the literal string "NaN" in the URL.
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it("B reading A's attachment returns 404, byte-identical to reading an unknown attachment id", async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', jpegBuffer(1000), {
        filename: 'photo.jpg',
      });
      const attachmentId = uploadRes.body.id as number;

      const notOwnedRes = await request(server)
        .get(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterBId));
      const unknownRes = await request(server)
        .get('/api/attachments/999999')
        .set('X-Requester-Id', String(requesterAId));

      expect(notOwnedRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(notOwnedRes.body).toEqual(unknownRes.body);
      expect(notOwnedRes.body.error).toBe('NOT_FOUND');
    });

    it("B downloading A's attachment returns 404, byte-identical to downloading an unknown attachment id", async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', jpegBuffer(1000), {
        filename: 'photo.jpg',
      });
      const attachmentId = uploadRes.body.id as number;

      const notOwnedRes = await request(server)
        .get(`/api/attachments/${attachmentId}/download`)
        .set('X-Requester-Id', String(requesterBId));
      const unknownRes = await request(server)
        .get('/api/attachments/999999/download')
        .set('X-Requester-Id', String(requesterAId));

      expect(notOwnedRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(notOwnedRes.body).toEqual(unknownRes.body);
      expect(notOwnedRes.body.error).toBe('NOT_FOUND');
    });

    it("B deleting A's attachment returns 404, byte-identical to deleting an unknown attachment id, and A's attachment stays active", async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', jpegBuffer(1000), {
        filename: 'photo.jpg',
      });
      const attachmentId = uploadRes.body.id as number;

      const notOwnedRes = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterBId))
        .set('Content-Type', 'application/json')
        .send({ reason: "B trying to remove A's attachment" });
      const unknownRes = await request(server)
        .delete('/api/attachments/999999')
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'Removing an attachment that does not exist' });

      expect(notOwnedRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(notOwnedRes.body).toEqual(unknownRes.body);
      expect(notOwnedRes.body.error).toBe('NOT_FOUND');

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row.isRemoved).toBe(false);
    });
  });

  // api-spec.md §1.4a: "POST /api/tickets/:id/attachments requires
  // multipart/form-data -> otherwise 400 NO_FILE." No tests.md API-xx row
  // covers this directly (API-22..26 assume a multipart request), so this
  // closes that gap the same way create-ticket.api.test.ts does for
  // MALFORMED_BODY.
  describe('missing/wrong content type and missing file part (§1.4a) — no tests.md API-xx row', () => {
    it('a JSON body (not multipart/form-data) returns 400 NO_FILE', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/attachments`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ file: 'not-a-file' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NO_FILE');

      const count = await prisma.attachment.count({ where: { ticketId } });
      expect(count).toBe(0);
    });

    it('a multipart request with no "file" part returns 400 NO_FILE', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).field('note', 'no file attached here');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NO_FILE');
    });

    it('an empty file part returns 400 NO_FILE', async () => {
      const ticketId = await createTicket(requesterAId);
      const res = await upload(ticketId, requesterAId).attach('file', Buffer.alloc(0), { filename: 'empty.pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NO_FILE');
    });

    it('missing/invalid X-Requester-Id header behaves like every other 🔒 endpoint', async () => {
      const ticketId = await createTicket(requesterAId);

      const missing = await request(server)
        .post(`/api/tickets/${ticketId}/attachments`)
        .attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe('MISSING_REQUESTER');

      const invalid = await request(server)
        .post(`/api/tickets/${ticketId}/attachments`)
        .set('X-Requester-Id', '999999')
        .attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBe('INVALID_REQUESTER');
    });
  });
});

describe('GET /api/attachments/:id', () => {
  // No dedicated tests.md API-xx row for the happy path (only ownership,
  // API-26, and the ticket-detail listing, API-21, are tracked) — this
  // closes that gap the same way the §1.4a block above does for NO_FILE.
  describe('metadata shape (api-spec.md §4.2) — no tests.md API-xx row', () => {
    it('returns the same 9-key shape as the upload 201 body, including ticketId', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const res = await request(server)
        .get(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterAId));

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ['id', 'ticketId', 'originalFilename', 'mimeType', 'fileSize', 'isRemoved', 'removedAt', 'removedReason', 'createdAt'].sort()
      );
      expect(res.body).toMatchObject({
        id: attachmentId,
        ticketId,
        originalFilename: 'report.pdf',
        mimeType: 'application/pdf',
        fileSize: 1000,
        isRemoved: false,
        removedAt: null,
        removedReason: null,
      });
    });

    it('returns a removed attachment too, with its removal metadata populated (BR-33)', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      // Soft-removed directly (DELETE /api/attachments/:id is a later
      // slice) — this test is about §4.2's read shape for a removed row,
      // not about how the row came to be removed.
      await prisma.attachment.update({
        where: { id: attachmentId },
        data: { isRemoved: true, removedAt: new Date(), removedReason: 'Uploaded the wrong file by mistake' },
      });

      const res = await request(server)
        .get(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterAId));

      expect(res.status).toBe(200);
      expect(res.body.isRemoved).toBe(true);
      expect(res.body.removedAt).not.toBeNull();
      expect(res.body.removedReason).toBe('Uploaded the wrong file by mistake');
    });

    it('a non-integer attachment id is treated as not found, not a 400 (api-spec.md §1.4)', async () => {
      const res = await request(server).get('/api/attachments/abc').set('X-Requester-Id', String(requesterAId));
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('missing/invalid X-Requester-Id header behaves like every other 🔒 endpoint', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const missing = await request(server).get(`/api/attachments/${attachmentId}`);
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe('MISSING_REQUESTER');

      const invalid = await request(server)
        .get(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', '999999');
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBe('INVALID_REQUESTER');
    });
  });
});

describe('GET /api/attachments/:id/download', () => {
  describe('API-27: download of an active attachment (AC-33, FR-20)', () => {
    it('returns 200 with the correct headers and bytes identical to the uploaded file', async () => {
      const ticketId = await createTicket(requesterAId);
      const originalBytes = pdfBuffer(12_345);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', originalBytes, {
        filename: 'battery-report.pdf',
      });
      expect(uploadRes.status).toBe(201);
      const attachmentId = uploadRes.body.id as number;

      const res = await request(server)
        .get(`/api/attachments/${attachmentId}/download`)
        .set('X-Requester-Id', String(requesterAId))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      // §4.3 documents `Content-Disposition: attachment; filename="<originalFilename>"`
      // literally; for an ordinary name that quoted-string is byte-for-byte
      // unchanged by the RFC 5987 hardening below — this asserts the exact
      // full header (including the `filename*` fallback every response now
      // carries) so a regression in either half would fail this test.
      expect(res.headers['content-disposition']).toBe(
        "attachment; filename=\"battery-report.pdf\"; filename*=UTF-8''battery-report.pdf"
      );
      expect(res.headers['content-length']).toBe(String(originalBytes.length));

      // The load-bearing assertion: the downloaded bytes match what was
      // uploaded, byte for byte — not merely that the status is 200.
      const downloadedBytes = res.body as Buffer;
      expect(Buffer.isBuffer(downloadedBytes)).toBe(true);
      expect(downloadedBytes.length).toBe(originalBytes.length);
      expect(downloadedBytes.equals(originalBytes)).toBe(true);
    });
  });

  describe('Content-Disposition safety for hostile originalFilename values (api-spec.md §4.3) — no tests.md API-xx row', () => {
    /**
     * Uploads a file with the given client-supplied filename and downloads
     * it back, returning both responses plus the exact bytes sent — every
     * test below checks that the round trip never 500s and never corrupts
     * the payload, in addition to whatever it asserts about the header.
     */
    async function uploadAndDownload(filename: string) {
      const ticketId = await createTicket(requesterAId);
      const originalBytes = pdfBuffer(64);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', originalBytes, { filename });
      expect(uploadRes.status).toBe(201);
      const attachmentId = uploadRes.body.id as number;

      const downloadRes = await request(server)
        .get(`/api/attachments/${attachmentId}/download`)
        .set('X-Requester-Id', String(requesterAId))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      return { uploadRes, downloadRes, originalBytes };
    }

    it('a filename with an embedded double quote downloads 200 with a well-formed header, never mangled', async () => {
      const { downloadRes, originalBytes } = await uploadAndDownload('we"ird.pdf');

      expect(downloadRes.status).toBe(200);
      const cd = downloadRes.headers['content-disposition'] as string | undefined;
      expect(cd).toBeDefined();
      // Exactly the two quotes delimiting filename="..." may appear — an
      // embedded '"' surviving unescaped would add a third/fourth and mangle
      // the quoted-string, which is the bug this test guards against.
      expect((cd!.match(/"/g) ?? []).length).toBe(2);
      expect(cd).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
      expect((downloadRes.body as Buffer).equals(originalBytes)).toBe(true);
    });

    it('a filename with an embedded CR/LF downloads 200 (never 500) and injects no extra header', async () => {
      const { downloadRes, originalBytes } = await uploadAndDownload('a\r\nX-Injected: yes.pdf');

      // This is the availability half of the bug report: raw CR/LF reaching
      // res.setHeader used to make Node throw and the download 500 outright.
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['x-injected']).toBeUndefined();
      const cd = downloadRes.headers['content-disposition'] as string | undefined;
      expect(cd).toBeDefined();
      expect(cd).not.toMatch(/[\r\n]/);
      expect(cd).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
      expect((downloadRes.body as Buffer).equals(originalBytes)).toBe(true);
    });

    it('a filename with an embedded semicolon downloads 200 with the semicolon preserved inside the quoted value', async () => {
      const { downloadRes, originalBytes } = await uploadAndDownload('sem;i.pdf');

      expect(downloadRes.status).toBe(200);
      // A semicolon inside a quoted-string is not a parameter separator —
      // valid HTTP parsers treat quoted-string content as opaque — so this
      // name needs no special handling and passes through unchanged.
      expect(downloadRes.headers['content-disposition']).toContain('filename="sem;i.pdf"');
      expect((downloadRes.body as Buffer).equals(originalBytes)).toBe(true);
    });

    it('a non-ASCII filename downloads 200 with an ASCII fallback and the exact stored name carried in filename*', async () => {
      const { uploadRes, downloadRes, originalBytes } = await uploadAndDownload('résumé.pdf');

      // Ground truth is whatever the server actually persisted as
      // originalFilename, not the literal JS string this test sent as the
      // multipart filename: multer/busboy's own multipart-header decoding
      // (a separate, pre-existing layer this PR does not touch) is not
      // guaranteed to preserve non-ASCII bytes losslessly on the way in.
      // What this test verifies is that the *download* header safely and
      // losslessly encodes whatever originalFilename value ended up stored
      // — the concern §4.3 and this fix are actually about.
      const storedName = uploadRes.body.originalFilename as string;
      expect(storedName.length).toBeGreaterThan(0);

      expect(downloadRes.status).toBe(200);
      const cd = downloadRes.headers['content-disposition'] as string | undefined;
      expect(cd).toBeDefined();
      // filename="..." has no defined charset for non-ASCII (RFC 6266), so
      // only the ASCII-safe fallback needs to appear there; the exact
      // stored name must still be recoverable, losslessly, from filename*.
      expect(cd).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
      expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent(storedName)}`);
      expect((downloadRes.body as Buffer).equals(originalBytes)).toBe(true);
    });
  });

  describe('API-28: download of a removed attachment (AC-34, BR-33)', () => {
    it('returns 410 ATTACHMENT_REMOVED after the attachment is soft-removed', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const beforeRemoval = await request(server)
        .get(`/api/attachments/${attachmentId}/download`)
        .set('X-Requester-Id', String(requesterAId));
      expect(beforeRemoval.status).toBe(200);

      // Soft-removed directly (DELETE /api/attachments/:id is a later
      // slice) — this test is about the download route's gate on
      // `isRemoved`, not about how the row came to be removed. API-29
      // covers DELETE's own correctness end-to-end once it exists.
      await prisma.attachment.update({
        where: { id: attachmentId },
        data: { isRemoved: true, removedAt: new Date(), removedReason: 'Wrong file uploaded' },
      });

      const afterRemoval = await request(server)
        .get(`/api/attachments/${attachmentId}/download`)
        .set('X-Requester-Id', String(requesterAId));

      expect(afterRemoval.status).toBe(410);
      expect(afterRemoval.body.error).toBe('ATTACHMENT_REMOVED');
      expect('fields' in afterRemoval.body).toBe(false);
    });
  });

  describe('file missing on disk (api-spec.md §4.3) — no tests.md API-xx row', () => {
    it('returns 500 INTERNAL, not 404, when the metadata row exists but the file does not', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      const filePath = path.join(tempUploadsDir, row.storedFilename);
      expect(existsSync(filePath)).toBe(true);
      rmSync(filePath);
      expect(existsSync(filePath)).toBe(false);

      const res = await request(server)
        .get(`/api/attachments/${attachmentId}/download`)
        .set('X-Requester-Id', String(requesterAId));

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('INTERNAL');
    });
  });
});

describe('DELETE /api/attachments/:id', () => {
  describe('API-29: soft removal happy path (AC-34, BR-31)', () => {
    it('sets isRemoved/removedAt/removedReason/removedById, drops from the active count, and bumps the ticket updatedAt', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'screenshot.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const ticketBefore = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      await new Promise((resolve) => setTimeout(resolve, 10)); // ensure a distinguishable timestamp

      const res = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'Uploaded the wrong screenshot' });

      expect(res.status).toBe(200);
      expect(res.body.isRemoved).toBe(true);
      expect(res.body.removedAt).not.toBeNull();
      expect(res.body.removedReason).toBe('Uploaded the wrong screenshot');

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row.isRemoved).toBe(true);
      expect(row.removedAt).not.toBeNull();
      expect(row.removedReason).toBe('Uploaded the wrong screenshot');
      expect(row.removedById).toBe(requesterAId);

      const activeCount = await prisma.attachment.count({ where: { ticketId, isRemoved: false } });
      expect(activeCount).toBe(0);

      const ticketAfter = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(ticketAfter.updatedAt.getTime()).toBeGreaterThan(ticketBefore.updatedAt.getTime());
    });
  });

  describe('API-30: removal reason validation (AC-35, BR-31, A-09)', () => {
    it.each([
      ['missing', undefined],
      ['2 characters (under the 3 minimum)', 'ab'],
      ['201 characters (over the 200 maximum)', 'a'.repeat(201)],
      ['whitespace-only', '   '],
    ] as const)('rejects a reason that is %s with 400 VALIDATION_FAILED, and the attachment stays active', async (_label, reason) => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const body = reason === undefined ? {} : { reason };
      const res = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
      expect(res.body.fields).toEqual([{ field: 'reason', message: expect.any(String) }]);

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row.isRemoved).toBe(false);
      expect(row.removedAt).toBeNull();
      expect(row.removedReason).toBeNull();
    });

    it('accepts a reason of exactly 3 characters and exactly 200 characters', async () => {
      const ticketId = await createTicket(requesterAId);

      const shortReasonUpload = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'a.pdf',
      });
      const shortRes = await request(server)
        .delete(`/api/attachments/${shortReasonUpload.body.id}`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'abc' });
      expect(shortRes.status).toBe(200);

      const longReasonUpload = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'b.pdf',
      });
      const longRes = await request(server)
        .delete(`/api/attachments/${longReasonUpload.body.id}`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'a'.repeat(200) });
      expect(longRes.status).toBe(200);
    });

    it('a non-JSON content type returns 400 MALFORMED_BODY and leaves the attachment active', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const res = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterAId))
        .send('reason=whatever');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MALFORMED_BODY');

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row.isRemoved).toBe(false);
    });
  });

  describe('API-31: removing an already-removed attachment (BR-32)', () => {
    it('the second removal returns 409 ALREADY_REMOVED', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const first = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'First removal' });
      expect(first.status).toBe(200);

      const second = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'Second removal attempt' });

      expect(second.status).toBe(409);
      expect(second.body.error).toBe('ALREADY_REMOVED');
      expect('fields' in second.body).toBe(false);

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row.removedReason).toBe('First removal');
    });

    it('holds BR-32 under genuinely concurrent DELETEs on one active attachment: exactly one 200, the rest 409 ALREADY_REMOVED (never 500), and the stored reason is the winner\'s, not overwritten by a loser', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'contested.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      // Fire genuinely concurrent requests (Promise.all of in-flight
      // requests, not sequential awaits) at the same active attachment.
      // Without an atomic conditional update, more than one of these could
      // observe `isRemoved === false` and both write, which would silently
      // overwrite the first remover's reason/removedById and never raise a
      // 409 — the regression this test exists to catch.
      const raceSize = 3;
      const reasons = Array.from({ length: raceSize }, (_, i) => `Concurrent removal attempt ${i}`);
      const responses = await Promise.all(
        reasons.map((reason) =>
          request(server)
            .delete(`/api/attachments/${attachmentId}`)
            .set('X-Requester-Id', String(requesterAId))
            .set('Content-Type', 'application/json')
            .send({ reason })
        )
      );

      // Never a 500: every response is either the one winner (200) or a
      // clean rejection (409 ALREADY_REMOVED).
      for (const res of responses) {
        expect([200, 409]).toContain(res.status);
        if (res.status === 409) {
          expect(res.body.error).toBe('ALREADY_REMOVED');
        }
      }
      const winners = responses.filter((res) => res.status === 200);
      const losers = responses.filter((res) => res.status === 409);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(raceSize - 1);

      // The persisted reason is exactly the winning request's reason — not
      // blank, not a mix, and not silently replaced by a losing request
      // that ran after the winning write (removedById is necessarily
      // requesterAId in every branch here since only the owner may call
      // this endpoint at all — BR-32 — so the reason is the fact this test
      // can actually distinguish winner from loser on).
      const winningReason = winners[0].body.removedReason as string;
      expect(reasons).toContain(winningReason);

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row.isRemoved).toBe(true);
      expect(row.removedReason).toBe(winningReason);
      expect(row.removedById).toBe(requesterAId);

      const activeCount = await prisma.attachment.count({ where: { id: attachmentId, isRemoved: false } });
      expect(activeCount).toBe(0);
    });
  });

  describe('a non-integer attachment id and missing/invalid header (api-spec.md §1.4, §1.2) — no tests.md API-xx row', () => {
    it('a non-integer attachment id is treated as not found, not a 400', async () => {
      const res = await request(server)
        .delete('/api/attachments/abc')
        .set('X-Requester-Id', String(requesterAId))
        .set('Content-Type', 'application/json')
        .send({ reason: 'Does not matter' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('missing/invalid X-Requester-Id header behaves like every other 🔒 endpoint', async () => {
      const ticketId = await createTicket(requesterAId);
      const uploadRes = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), {
        filename: 'report.pdf',
      });
      const attachmentId = uploadRes.body.id as number;

      const missing = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Does not matter' });
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe('MISSING_REQUESTER');

      const invalid = await request(server)
        .delete(`/api/attachments/${attachmentId}`)
        .set('X-Requester-Id', '999999')
        .set('Content-Type', 'application/json')
        .send({ reason: 'Does not matter' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBe('INVALID_REQUESTER');
    });
  });
});
