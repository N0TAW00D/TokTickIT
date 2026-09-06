// Attachment file storage (specification.md BR-27, BR-29, BR-30; api-spec.md
// §4.1). Owns exactly the filesystem half of an upload: choosing the
// uploads directory, generating the server-side stored name, writing the
// bytes durably, and best-effort cleanup of an orphaned file. The route
// (src/routes/tickets.ts) and its supporting service decide *when* to call
// these — this module has no opinion on ownership, limits, or the DB row.

import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Directory attachment files are written under (BR-30: "server/uploads/
 * (git-ignored, not statically served)"). Configurable via `ATTACHMENTS_DIR`
 * so tests can point this at a throwaway temp directory instead of the real
 * one — see tests/lab-02/attachments.api.test.ts, which sets this env var
 * before importing the app and asserts the real server/uploads/ never
 * receives a file during the run.
 *
 * Read lazily on every call (not cached at module load) so a test can set
 * `process.env.ATTACHMENTS_DIR` ahead of each request rather than needing
 * to control module initialization order.
 *
 * The default is resolved relative to this file's own location rather than
 * `process.cwd()`, so `server/uploads/` lands in the same place regardless
 * of the directory `npm test` / `npm run dev` happen to be launched from.
 */
export function getUploadsDir(): string {
  const configured = process.env.ATTACHMENTS_DIR;
  if (configured && configured.trim() !== '') {
    return path.resolve(configured);
  }
  return path.resolve(import.meta.dirname, '../../uploads');
}

export interface StoredAttachmentFile {
  storedFilename: string;
  absolutePath: string;
}

/**
 * Writes `buffer` to a new server-generated `<uuidv4>.<extension>` file
 * under the uploads dir and resolves once the write is durable.
 *
 * BR-27 ("the DB row is written only after the file is durably stored")
 * is enforced by call order, not by anything in this function: callers
 * must `await` this before creating the Attachment row, and must not
 * create that row at all if this rejects — a disk-write failure here
 * propagates as-is and leaves no DB row (there is nothing to clean up:
 * `writeFile` either produces the complete file or none of it reached
 * disk under this name).
 *
 * The stored name is generated here, from `randomUUID()` and the
 * already-validated `extension` — never from client input — so there is no
 * path-traversal surface on the write path (contrast `originalFilename`,
 * which is client-controlled metadata only, handled by
 * `safeOriginalFilename` in `validation/attachmentFile.ts`).
 */
export async function storeAttachmentFile(buffer: Buffer, extension: string): Promise<StoredAttachmentFile> {
  const dir = getUploadsDir();
  await mkdir(dir, { recursive: true });

  const storedFilename = `${randomUUID()}.${extension}`;
  const absolutePath = path.join(dir, storedFilename);

  await writeFile(absolutePath, buffer);

  return { storedFilename, absolutePath };
}

/**
 * Deletes a previously-stored attachment file, swallowing any error.
 *
 * Used only when the file was already durably written but the metadata
 * insert that should follow it fails (api-spec.md §4.1's 500 row: "the
 * just-written file is deleted on a best-effort basis before responding").
 * At that point the file is orphaned either way — no row will ever
 * reference it — so a further failure to delete it (permissions, already
 * gone, etc.) is logged and swallowed rather than thrown: surfacing it
 * would replace the original 500 cause with an unrelated cleanup error, and
 * "a file that still leaks is unreferenced and unreachable" is an accepted
 * outcome per that same spec line, not a correctness failure.
 */
export async function deleteAttachmentFileBestEffort(storedFilename: string): Promise<void> {
  const absolutePath = path.join(getUploadsDir(), storedFilename);
  try {
    await unlink(absolutePath);
  } catch (error) {
    console.error(`Best-effort cleanup failed to delete orphaned attachment file "${storedFilename}":`, error);
  }
}
