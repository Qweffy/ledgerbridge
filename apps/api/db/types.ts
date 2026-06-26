import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as core from "./schema";
import * as internal from "./internal";

// The full Drizzle schema (sync core + simulated internal system) and the db type
// every service is written against. Tests inject a PGlite-backed db of the same
// shape, so service code never imports a concrete driver.
export const fullSchema = { ...core, ...internal };
export type FullSchema = typeof core & typeof internal;
export type Database = NeonHttpDatabase<FullSchema>;
