-- Lab 4 recovery script (docs/lab-04/specification.md §7.4 step 4, path b).
--
-- Prisma has no down-migrations. This script reverses
-- 20261012120000_lab_04_actions_taken: it drops TicketStatusChange,
-- ActionTaken, the Ticket.version column and the ActionStatus enum, then
-- deletes the migration's _prisma_migrations row so `prisma migrate deploy`
-- can apply it again.
--
-- DESTRUCTIVE for Lab 4 data by design: every Action Taken, status-history
-- row and Ticket version is discarded. Lab 3 tables and rows are untouched.
-- Dropping the tables also drops their indexes, foreign keys and the
-- hand-written follow-up CHECK. Run it against the intended database only:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/prisma/recovery/lab-04-down.sql

BEGIN;

DROP TABLE IF EXISTS "TicketStatusChange";
DROP TABLE IF EXISTS "ActionTaken";

-- The two Lab 4 Ticket indexes are removed explicitly (the version column
-- itself has no index); the Lab 3 Ticket indexes are not touched.
DROP INDEX IF EXISTS "Ticket_status_updatedAt_idx";
DROP INDEX IF EXISTS "Ticket_ownerId_status_idx";
ALTER TABLE "Ticket" DROP COLUMN IF EXISTS "version";

DROP TYPE IF EXISTS "ActionStatus";

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" = '20261012120000_lab_04_actions_taken';

COMMIT;
