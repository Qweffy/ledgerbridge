// Apply checked-in migrations to the configured database using the neon-http
// driver (same path the app uses), which works against Neon serverless without
// a separate pg connection. Run with: npm run db:migrate -w @ledgerbridge/api
import { config } from "dotenv";

config({ path: ".env.local" });

const { migrate } = await import("drizzle-orm/neon-http/migrator");
const { db } = await import("./index");

await migrate(db, { migrationsFolder: "./db/migrations" });
console.info("migrations applied");
