#!/usr/bin/env node
/**
 * Vercel post-install: builds native addons that --ignore-scripts skipped.
 * In production we use @prisma/adapter-pg (no native build needed).
 * In development we use better-sqlite3 which needs node-gyp.
 * This script is a no-op in production — Prisma uses the pg adapter there.
 */
if (process.env.NODE_ENV !== "production") {
  const { execSync } = await import("child_process");
  try {
    execSync("cd node_modules/better-sqlite3 && npx node-gyp rebuild --release", {
      stdio: "inherit",
    });
  } catch {
    // Non-fatal in production CI
  }
}
