import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { fullSchema, type Database } from "../../db/types";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations", import.meta.url));

export interface TestDb {
  db: Database;
  // The raw PGlite client — exposed so notification/trigger tests can LISTEN.
  client: PGlite;
  close: () => Promise<void>;
}

// An in-process Postgres (PGlite/WASM) with the real migrations applied, so
// service code runs against the production schema without docker or Neon.
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.exec(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));
  }
  const db = drizzle(client, { schema: fullSchema }) as unknown as Database;
  return { db, client, close: () => client.close() };
}
