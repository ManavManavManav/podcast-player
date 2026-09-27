// Brings the database (DATABASE_URL, or the local file) up to date. Reads
// .env.local and .env like the app; settings already in the environment win.
// Usage: npm run migrate. Safe to run repeatedly. The server also migrates on
// its own when it finds the schema behind; this is for doing it before a deploy.

import fs from "node:fs";
import { createClient } from "@libsql/client";
import { getAuthOptions } from "@/lib/server/auth";
import { databaseConfig } from "@/lib/server/db";
import { ensureAppSchema, ensureAuthSchema } from "@/lib/server/migrations";

for (const file of [".env.local", ".env"]) if (fs.existsSync(file)) process.loadEnvFile(file);

async function main() {
  const db = createClient(databaseConfig());
  const app = await ensureAppSchema(db);
  const auth = await ensureAuthSchema(db, getAuthOptions(db));
  const { rows } = await db.execute("SELECT part, version FROM schema_version ORDER BY part");
  const versions = rows.map((r) => `${r.part} ${r.version}`).join(", ");
  console.log(app || auth ? `Migrated (${versions}).` : `Already up to date (${versions}).`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
