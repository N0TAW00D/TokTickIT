-- Lab 3: evolve the Lab 2 `RequesterUser` design into `User` with roles,
-- add `Session`, extend `Ticket` with ownership/IT Priority/status, and add
-- `PublicComment`/`InternalNote` (docs/lab-03/specification.md §7).
--
-- This file is HAND-EDITED from what `prisma migrate dev` generates for the
-- same schema change (see §7.4). The generator has no model-rename
-- detection: left alone it emits `DROP TABLE "RequesterUser"` followed by
-- `CREATE TABLE "User" (...)`, which would destroy every existing Ticket's
-- and Attachment's owning row. Every deviation from the generated diff
-- below exists to prevent that, or to satisfy a NOT NULL column being added
-- to an already-populated table. Verified against a database holding real
-- Lab 2 data before merge, and asserted by
-- server/tests/lab-03/migration.test.ts (MIG-01..MIG-06).

-- ============================================================
-- New enum types
-- ============================================================

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR');

-- AlterEnum: TicketStatus gains the seven new statuses in the §5.1
-- transition matrix. Every existing Lab 2 ticket stays 'NEW', which
-- remains valid in the new matrix (§7.4 item 7).
ALTER TYPE "TicketStatus" ADD VALUE 'OPEN';
ALTER TYPE "TicketStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_FOR_REQUESTER';
ALTER TYPE "TicketStatus" ADD VALUE 'RESOLVED';
ALTER TYPE "TicketStatus" ADD VALUE 'CLOSED';
ALTER TYPE "TicketStatus" ADD VALUE 'REOPENED';
ALTER TYPE "TicketStatus" ADD VALUE 'CANCELLED';

-- pgcrypto supplies crypt()/gen_salt('bf', ...), a real bcrypt
-- implementation, used below to backfill `User.passwordHash` without ever
-- writing a plaintext password or a hardcoded hash literal into this file
-- (BR-06, AC-58). Its bcrypt output is byte-for-byte compatible with the
-- Node `bcrypt` package used at runtime (both are the standard OpenBSD
-- blowfish-crypt bcrypt).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- RequesterUser -> User: RENAME, not drop+recreate (§7.4 item 1)
-- ============================================================

-- A rename preserves every row, its id, and every existing foreign key
-- from Ticket.requesterId and Attachment.removedById — nothing here can
-- orphan a Lab 2 Ticket or Attachment.
ALTER TABLE "RequesterUser" RENAME TO "User";
ALTER TABLE "User" RENAME CONSTRAINT "RequesterUser_pkey" TO "User_pkey";

-- No action is needed on "Ticket_requesterId_fkey" or
-- "Attachment_removedById_fkey": Postgres tracks a foreign key's target by
-- the referenced table's OID, not its name, so both constraints keep
-- pointing at the exact same physical table — now called "User" — through
-- this rename automatically. Dropping and recreating them, the way a naive
-- generated diff does, is exactly the unnecessary step this hand-edit
-- removes.

-- role: added with default 'REQUESTER', so every migrated Lab 2 row
-- classifies correctly (§7.4 item 3).
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'REQUESTER';

-- mustChangePassword: defaults true, so every migrated Requester must
-- choose a new password at first login (§7.4 item 4, handout §5.2).
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;

-- passwordHash: added in three steps, because `ADD COLUMN ... NOT NULL`
-- without a default fails outright on an already-populated table (§7.4
-- item 4). Every migrated row is backfilled with the bcrypt hash (cost 12)
-- of the documented local-development initial password — the same
-- constant `prisma/seed.ts` hashes for freshly-seeded accounts (see
-- LOCAL_DEV_PASSWORD there and README.md) — so a migrated Lab 2 Requester
-- can actually log in and be forced through the change-password flow,
-- rather than being left with an unusable random hash.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

UPDATE "User"
SET "passwordHash" = crypt('DevPassword123!', gen_salt('bf', 12))
WHERE "passwordHash" IS NULL;

ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

-- email: lower-cased for BR-09 (§7.4 item 6). Detect case-insensitive
-- duplicates first and fail loudly if any exist. Lab 2's constraint was
-- already an exact-match unique index, so this should never fire in
-- practice — but a migration that silently merged two distinct accounts
-- onto one email row would be far worse than one that refuses to run.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT lower("email") AS lowered
    FROM "User"
    GROUP BY lower("email")
    HAVING count(*) > 1
  ) AS case_insensitive_duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % case-insensitive duplicate email address(es) exist in "User". BR-09 requires case-insensitive uniqueness; resolve the duplicates manually, then re-run this migration.',
      duplicate_count;
  END IF;
END $$;

UPDATE "User" SET "email" = lower("email");

-- Lab 2's email uniqueness was a plain, case-*sensitive* unique
-- constraint — wrong per BR-09. Drop it and replace it with a
-- case-insensitive unique index on lower(email). This index has no
-- declarative Prisma schema representation (schema.prisma can only
-- express `email String @unique`, which would be case-sensitive), so it
-- lives only here — see the comment on `User.email` in schema.prisma, and
-- server/tests/lab-03/migration.test.ts MIG-04, which proves the database
-- itself rejects a case-variant duplicate insert.
-- Prisma's field-level `@unique` generates a plain `CREATE UNIQUE INDEX`,
-- not a table constraint (compare `migrations/20260806101642_init_category
-- /migration.sql`), so this is a DROP INDEX, not DROP CONSTRAINT.
DROP INDEX "RequesterUser_email_key";
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));

-- CreateIndex: Administrator role filter and the last-active-Administrator
-- check (BR-32).
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- ============================================================
-- Session (new)
-- ============================================================

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex: bulk invalidation on logout-all and deactivation (BR-12).
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Ticket: ownership, IT Priority, resolution indication
-- ============================================================

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "requesterResolvedAt" TIMESTAMP(3);

-- itPriority: added in three steps, for the same reason as passwordHash
-- above (§7.4 item 5), so no ticket is ever left with a null IT Priority
-- (BR-22).
ALTER TABLE "Ticket" ADD COLUMN "itPriority" "Priority";

UPDATE "Ticket" SET "itPriority" = "requestedPriority" WHERE "itPriority" IS NULL;

ALTER TABLE "Ticket" ALTER COLUMN "itPriority" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: default queue ordering, IT Priority desc then created date
-- asc (§8.2, D-10).
CREATE INDEX "Ticket_itPriority_createdAt_idx" ON "Ticket"("itPriority", "createdAt");

-- CreateIndex: queue filter by status.
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex: queue filter by owner, including "unassigned".
CREATE INDEX "Ticket_ownerId_idx" ON "Ticket"("ownerId");

-- ============================================================
-- PublicComment, InternalNote (new)
-- ============================================================

-- CreateTable
CREATE TABLE "PublicComment" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: thread retrieval in order.
CREATE INDEX "PublicComment_ticketId_createdAt_idx" ON "PublicComment"("ticketId", "createdAt");
CREATE INDEX "InternalNote_ticketId_createdAt_idx" ON "InternalNote"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
