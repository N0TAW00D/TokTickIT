import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Reference and fixture data per docs/lab-02/specification.md §7.6.
// Every row is upserted on its natural unique key so re-running this script
// is safe and always converges to the same state (no duplicate rows).

const SEED_CATEGORIES = [
  "Account and Access",
  "Hardware",
  "Software",
  "Network",
];

const SEED_RELATED_SYSTEMS = [
  "Email",
  "Campus Wi-Fi",
  "VPN",
  "LEB2 App",
  "Grade Submission App",
  "Printer",
  "Corporate Laptop",
];

const SEED_ACTIVE_REQUESTERS = [
  { name: "Jennifer Anderson", email: "jennifer.anderson@example.edu" },
  { name: "Michael Brown", email: "michael.brown@example.edu" },
  { name: "Sarah Johnson", email: "sarah.johnson@example.edu" },
  { name: "David Lee", email: "david.lee@example.edu" },
];

const SEED_INACTIVE_REQUESTERS = [
  { name: "Robert Wilson", email: "robert.wilson@example.edu" },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const categories = await prisma.$transaction(
    SEED_CATEGORIES.map((name) =>
      prisma.category.upsert({
        where: { name },
        update: { isActive: true },
        create: { name, isActive: true },
      })
    )
  );

  const relatedSystems = await prisma.$transaction(
    SEED_RELATED_SYSTEMS.map((name) =>
      prisma.relatedSystem.upsert({
        where: { name },
        update: { isActive: true },
        create: { name, isActive: true },
      })
    )
  );

  const activeRequesters = await prisma.$transaction(
    SEED_ACTIVE_REQUESTERS.map(({ name, email }) =>
      prisma.requesterUser.upsert({
        where: { email },
        update: { name, isActive: true },
        create: { name, email, isActive: true },
      })
    )
  );

  const inactiveRequesters = await prisma.$transaction(
    SEED_INACTIVE_REQUESTERS.map(({ name, email }) =>
      prisma.requesterUser.upsert({
        where: { email },
        update: { name, isActive: false },
        create: { name, email, isActive: false },
      })
    )
  );

  // TicketCounter is intentionally NOT seeded here: rows are created lazily
  // on the first ticket allocated for a given year (see specification.md §7.3).

  console.log({
    categories: categories.length,
    relatedSystems: relatedSystems.length,
    activeRequesters: activeRequesters.length,
    inactiveRequesters: inactiveRequesters.length,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
