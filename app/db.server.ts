import { PrismaClient } from "@prisma/client";

// ── Driver adapter ────────────────────────────────────────────────────────────
// DEV  (NODE_ENV !== "production"):  better-sqlite3 — zero setup, file-based.
// PROD (NODE_ENV === "production"):  @prisma/adapter-pg — set DATABASE_URL.
//
// To switch to Postgres for production:
//   1. In prisma/schema.prisma change datasource.provider to "postgresql"
//   2. Set DATABASE_URL=postgresql://... in your host environment variables
//   3. Run: npx prisma migrate deploy
//   No other code changes needed — the adapter swap below handles the rest.
// ─────────────────────────────────────────────────────────────────────────────

async function createClient(): Promise<PrismaClient> {
  if (process.env.NODE_ENV === "production") {
    // Production: PostgreSQL via driver adapter.
    // Install before deploy: npm install @prisma/adapter-pg pg
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require("@prisma/adapter-pg");
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  } else {
    // Development: SQLite via better-sqlite3
    const { PrismaBetterSQLite3 } = await import("@prisma/adapter-better-sqlite3");
    const adapter = new PrismaBetterSQLite3({
      url: process.env.DATABASE_URL ?? "file:./prisma/dev.sqlite",
    });
    return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  // Production: fresh client per process (no global singleton needed)
  prisma = await createClient();
} else {
  // Development: reuse across HMR reloads
  if (!global.prismaGlobal) {
    global.prismaGlobal = await createClient();
  }
  prisma = global.prismaGlobal;
}

export default prisma;
