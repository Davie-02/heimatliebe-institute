/**
 * npm run seed:demo  – loads example data (never on the live site).
 * The first system administrator is created automatically at start-up from ADMIN_EMAIL /
 * ADMIN_NAME / ADMIN_PASSWORD (see src/setup/setup.service.ts).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadDemoData } from "../src/setup/demo-data";

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to load demo data into production.");
  const prisma = new PrismaClient();
  try {
    if (process.argv.includes("--demo")) await loadDemoData(prisma);
    else console.log("Nothing to do. Use `npm run seed:demo` for example data.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
