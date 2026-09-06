// Attachment type guard + safe filename helpers (specification.md BR-21,
// BR-29, BR-30; api-spec.md §4.1; tests.md UNIT-06).
//
// Split out from the upload route/service so the pure logic — no DB, no
// filesystem, no Express — is unit-testable on its own (UNIT-06), and so
// slice 9b (GET/download/DELETE on attachments) can reuse the same
// extension<->mime tables without re-deriving them.

export interface FieldError {
  field: string;
  message: string;
}

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: FieldError };

/** The only four types this API ever accepts (BR-21). */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * Lowercase file extension (no dot) -> the one mime type that extension is
 * allowed to declare. Both `jpg` and `jpeg` map to `image/jpeg` since
 * clients commonly use either; the canonical on-disk extension is always
 * derived back from the mime type (see `extensionForMimeType`), so the
 * stored file always ends up `.jpg`, never `.jpeg`.
 */
const EXTENSION_TO_MIME_TYPE: Record<string, AllowedMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** Canonical on-disk extension for each allowed mime type (BR-29's `<ext>`). */
const MIME_TYPE_TO_EXTENSION: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Lowercased substring after the last `.`, or `''` if there isn't one. */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * The type guard at the heart of BR-21: "checked by both file extension and
 * detected content type; a mismatch or disallowed type -> 415".
 *
 * Deliberately takes the *detected* mime type as a parameter rather than
 * reaching into a buffer itself — callers pass the client-declared type for
 * a pure extension/mimetype-pairing check (as UNIT-06 does, and as this
 * function is exercised standalone below), and the upload route instead
 * passes the result of `sniffMimeType` on the actual bytes. Because the
 * route feeds this function the *sniffed* type rather than trusting
 * whatever `Content-Type` the client's multipart part declared, a single
 * comparison here does double duty as both the extension check and the
 * extension-vs-content-sniff cross-check: a `.pdf` file that sniffs as PNG
 * fails here exactly the same way a `.exe` file does — neither extension
 * agrees with the (effective) mime type.
 */
export function validateAttachmentType(
  originalFilename: string,
  mimeType: string
): FieldResult<{ mimeType: AllowedMimeType; extension: string }> {
  const extension = getExtension(originalFilename);
  const expectedMimeType = EXTENSION_TO_MIME_TYPE[extension];

  if (!expectedMimeType || expectedMimeType !== mimeType) {
    return {
      ok: false,
      error: {
        field: 'file',
        message: 'File type must be JPEG, PNG, WEBP, or PDF, and its extension must match its content.',
      },
    };
  }

  return {
    ok: true,
    value: { mimeType: expectedMimeType, extension: MIME_TYPE_TO_EXTENSION[expectedMimeType] },
  };
}

/**
 * Magic-byte content sniff for the four allowed types (BR-21). No new
 * runtime dependency: the signatures are short, fixed, and well documented,
 * so a manual byte comparison is simpler and more auditable than pulling in
 * a file-type detection library for four formats.
 *
 * - JPEG: `FF D8 FF` (SOI marker + start of the next marker).
 * - PNG:  `89 50 4E 47 0D 0A 1A 0A` (the 8-byte PNG signature).
 * - WEBP: `RIFF????WEBP` — bytes 0-3 are `RIFF`, bytes 8-11 are `WEBP`; the
 *   4 bytes in between are a container-level size field, not part of the
 *   signature.
 * - PDF: `%PDF-` (the header every conforming PDF must start with).
 *
 * Returns `null` for anything that doesn't match one of the four (BR-21's
 * "disallowed type").
 */
export function sniffMimeType(buffer: Buffer): AllowedMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }

  return null;
}

const ORIGINAL_FILENAME_MAX_LENGTH = 255;

/**
 * `originalFilename` is metadata only — it is never used to derive the
 * on-disk path (the stored name is always a server-generated
 * `<uuidv4>.<ext>`, built separately) — but it is still attacker-controlled
 * input that gets displayed back to the user and stored in the DB, so BR-29
 * requires path components stripped and the result truncated to 255 chars.
 *
 * Strips both `/` and `\` (Windows-style) separators, so `../../etc/passwd`
 * and `..\\..\\etc\\passwd` both collapse to their final segment (`passwd`),
 * with no leading `..` or path separator surviving.
 */
export function safeOriginalFilename(rawFilename: string): string {
  const segments = rawFilename.split(/[/\\]/);
  const basename = segments[segments.length - 1] ?? '';
  return basename.slice(0, ORIGINAL_FILENAME_MAX_LENGTH);
}

/**
 * Percent-encodes `value` per RFC 5987's `attr-char` (used by the `filename*`
 * parameter, RFC 6266 §5): everything `encodeURIComponent` already escapes,
 * plus `'`, `(`, `)`, and `*`, which `encodeURIComponent` leaves bare but
 * `attr-char` does not permit. This is the standard workaround for that gap
 * (documented on MDN's `encodeURIComponent` page) rather than a hand-rolled
 * character class.
 */
function encodeRfc5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * ASCII-safe stand-in for `originalFilename` inside a `Content-Disposition`
 * quoted-string (RFC 6266 `filename=`). `originalFilename` only ever passes
 * through `safeOriginalFilename` before reaching here — path separators are
 * gone, but quotes, backslashes, control characters (including CR/LF), and
 * arbitrary Unicode all survive — so this still has real sanitizing to do:
 *
 * - C0/C1 control characters (0x00-0x1F, 0x7F-0x9F), which includes CR and
 *   LF, are **stripped outright**, not substituted. They are not merely
 *   awkward, they are illegal in an HTTP header value at all — Node's
 *   `http` module throws `ERR_INVALID_CHAR` if one reaches `res.setHeader`,
 *   which is exactly how the reported bug turns a successful download into
 *   an uncaught `500`. A control character also carries no meaningful
 *   filename content worth preserving as a placeholder.
 * - `"` and `\` are legal header bytes but are the quoted-string's own
 *   escape mechanism: an unescaped `"` closes the string early (the
 *   reported mangled-filename bug) and `\` would need paired escaping to
 *   use safely. Both are **substituted** with `_` rather than
 *   backslash-escaped, trading a one-character cosmetic loss in the ASCII
 *   fallback for a fallback that stays trivially well-formed.
 * - Any remaining non-ASCII character is also **substituted** with `_`:
 *   RFC 6266 leaves `filename`'s charset undefined for non-ASCII text and
 *   directs implementers to `filename*` for that case instead — which is
 *   exactly what `contentDispositionFilename` below adds, carrying the
 *   exact original name losslessly for clients that support it.
 *
 * This never touches the *stored* `originalFilename` (DB row or disk) —
 * only the bytes written into this one response header — so BR-29/BR-30
 * are unaffected; an ordinary filename (the only kind BR-29 mentions) is
 * unchanged by this function, character for character.
 */
function asciiFallbackFilename(filename: string): string {
  let result = '';
  for (const char of filename) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      continue;
    }
    if (char === '"' || char === '\\' || codePoint > 0x7e) {
      result += '_';
      continue;
    }
    result += char;
  }
  // Every character stripped (e.g. a filename made entirely of control
  // characters) would otherwise leave `filename=""`, which is well-formed
  // but useless — fall back to a generic name instead.
  return result.length > 0 ? result : 'download';
}

/**
 * Builds the full `Content-Disposition: attachment; ...` header value for
 * an attachment download (api-spec.md §4.3). Lives next to the other
 * filename helpers, rather than inline in `routes/attachments.ts`, so
 * anything else that ever needs to serve `originalFilename` back to a
 * browser (Ticket Detail's own download links) reuses the same escaping
 * instead of re-deriving it.
 *
 * Emits both parameters per RFC 6266 §5 / RFC 5987:
 * - `filename="<asciiFallbackFilename>"` — for ordinary filenames (the only
 *   kind api-spec.md §4.3 documents) this is byte-for-byte
 *   `filename="<originalFilename>"`, exactly as before; only quotes,
 *   backslashes, control characters, and non-ASCII text change it.
 * - `filename*=UTF-8''<percent-encoded originalFilename>` — the exact
 *   original name, for the many clients (all evergreen browsers) that
 *   understand the newer parameter; a client that doesn't simply ignores
 *   it and uses `filename` instead.
 */
export function contentDispositionFilename(originalFilename: string): string {
  const fallback = asciiFallbackFilename(originalFilename);
  const extended = encodeRfc5987ValueChars(originalFilename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${extended}`;
}
