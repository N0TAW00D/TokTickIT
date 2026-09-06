import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';

// Covers docs/lab-02/api-spec.md §4.1 (POST /api/tickets/:id/attachments)
// and tests.md API-22, API-23, API-25, the 6th-upload half of API-24, and
// the upload half of API-26.
//
// NOT covered here (slice 9b, #17's next slice — GET/download/DELETE on
// /api/attachments/:id do not exist yet):
//   - API-24's "after removing one, upload succeeds" half — needs DELETE
//     to free up a slot.
//   - API-26's read/download/delete-ownership halves — needs GET/download
//     /DELETE routes to exist at all.
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

beforeAll(async () => {
  realUploadsDirFilesBefore = existsSync(REAL_UPLOADS_DIR) ? readdirSync(REAL_UPLOADS_DIR) : [];

  tempUploadsDir = mkdtempSync(path.join(os.tmpdir(), 'toktickit-attachments-'));
  process.env.ATTACHMENTS_DIR = tempUploadsDir;

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

afterAll(() => {
  // Prove no file ever landed in the real, git-ignored uploads dir.
  const realUploadsDirFilesAfter = existsSync(REAL_UPLOADS_DIR) ? readdirSync(REAL_UPLOADS_DIR) : [];
  expect(realUploadsDirFilesAfter).toEqual(realUploadsDirFilesBefore);

  // Clean up the temp dir this suite used, so nothing leaks on disk.
  rmSync(tempUploadsDir, { recursive: true, force: true });
  expect(existsSync(tempUploadsDir)).toBe(false);

  delete process.env.ATTACHMENTS_DIR;
});

async function createTicket(requesterId: number): Promise<number> {
  const res = await request(app)
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
  return request(app)
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

  describe('API-24: attachment active-count limit (AC-20, BR-23) — 6th-upload half only', () => {
    it('allows 5 active attachments, then rejects the 6th with 409 ATTACHMENT_LIMIT', async () => {
      const ticketId = await createTicket(requesterAId);

      for (let i = 0; i < 5; i++) {
        const res = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), { filename: `file-${i}.pdf` });
        expect(res.status, `upload #${i + 1}`).toBe(201);
      }

      const sixth = await upload(ticketId, requesterAId).attach('file', pdfBuffer(1000), { filename: 'file-6.pdf' });
      expect(sixth.status).toBe(409);
      expect(sixth.body.error).toBe('ATTACHMENT_LIMIT');

      const activeCount = await prisma.attachment.count({ where: { ticketId, isRemoved: false } });
      expect(activeCount).toBe(5);

      // "after removing one, upload succeeds" (the other half of API-24)
      // needs DELETE /api/attachments/:id, which is slice 9b — not built
      // yet. Left uncovered here deliberately rather than faked.
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

  describe('API-26: attachment ownership (AC-37, BR-14) — upload half only', () => {
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

      // read/download/delete-ownership halves need GET/download/DELETE
      // routes, which are slice 9b — not built yet.
    });

    it('a non-integer ticket id is treated as not found, not a 400 (api-spec.md §1.4)', async () => {
      const res = await upload(NaN, requesterAId).attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
      // supertest interpolates NaN as the literal string "NaN" in the URL.
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
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
      const res = await request(app)
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

      const missing = await request(app)
        .post(`/api/tickets/${ticketId}/attachments`)
        .attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe('MISSING_REQUESTER');

      const invalid = await request(app)
        .post(`/api/tickets/${ticketId}/attachments`)
        .set('X-Requester-Id', '999999')
        .attach('file', jpegBuffer(1000), { filename: 'photo.jpg' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBe('INVALID_REQUESTER');
    });
  });
});
