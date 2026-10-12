-- Lab 4: Actions Taken, Ticket status history and Ticket optimistic
-- concurrency (docs/lab-04/specification.md §7.1-§7.4).
--
-- ADDITIVE ONLY: creates the ActionStatus enum, the ActionTaken and
-- TicketStatusChange tables and their indexes, and adds one defaulted column
-- to Ticket. No existing column, table or row is altered, renamed or
-- dropped, so every Lab 3 row keeps its id. Existing Tickets become
-- version = 1 with zero Actions and an empty status history (D-10).
--
-- Generated with `prisma migrate diff` from the Lab 3 schema to the Lab 4
-- schema, then hand-checked; the CHECK constraint at the end is hand-written
-- because Prisma cannot express it (§7.4 item 2). Asserted by
-- server/tests/lab-04/migration.test.ts (MIG-01..MIG-05, MIG-09).
-- Recovery: server/prisma/recovery/lab-04-down.sql (see README.md).

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ActionTaken" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "actionAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "result" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'PLANNED',
    "performedById" INTEGER NOT NULL,
    "assigneeId" INTEGER,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNote" TEXT,
    "attachmentNotes" TEXT,
    "lastUpdatedById" INTEGER NOT NULL,
    "clientRequestId" TEXT,
    "clientRequestHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionTaken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatusChange" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "fromStatus" "TicketStatus" NOT NULL,
    "toStatus" "TicketStatus" NOT NULL,
    "changedById" INTEGER NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionTaken_ticketId_actionAt_id_idx" ON "ActionTaken"("ticketId", "actionAt", "id");

-- CreateIndex
CREATE INDEX "ActionTaken_ticketId_status_idx" ON "ActionTaken"("ticketId", "status");

-- CreateIndex
CREATE INDEX "ActionTaken_assigneeId_status_idx" ON "ActionTaken"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ActionTaken_performedById_status_idx" ON "ActionTaken"("performedById", "status");

-- CreateIndex
CREATE INDEX "ActionTaken_ticketId_followUpRequired_idx" ON "ActionTaken"("ticketId", "followUpRequired");

-- CreateIndex
CREATE UNIQUE INDEX "ActionTaken_ticketId_clientRequestId_key" ON "ActionTaken"("ticketId", "clientRequestId");

-- CreateIndex
CREATE INDEX "TicketStatusChange_ticketId_changedAt_id_idx" ON "TicketStatusChange"("ticketId", "changedAt", "id");

-- CreateIndex
CREATE INDEX "TicketStatusChange_toStatus_changedAt_idx" ON "TicketStatusChange"("toStatus", "changedAt");

-- CreateIndex
CREATE INDEX "Ticket_status_updatedAt_idx" ON "Ticket"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Ticket_ownerId_status_idx" ON "Ticket"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_lastUpdatedById_fkey" FOREIGN KEY ("lastUpdatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusChange" ADD CONSTRAINT "TicketStatusChange_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusChange" ADD CONSTRAINT "TicketStatusChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Hand-written CHECK (D-20, BR-06): a follow-up note exists exactly when a
-- follow-up is required. Invisible to `prisma migrate` diffing, like Lab 3's
-- lower(email) unique index.
-- ============================================================

-- AddCheckConstraint
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_followUp_consistent_check"
    CHECK (("followUpRequired" AND "followUpNote" IS NOT NULL) OR (NOT "followUpRequired" AND "followUpNote" IS NULL));
