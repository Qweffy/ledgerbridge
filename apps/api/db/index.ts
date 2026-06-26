import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { fullSchema } from './types';
import { configureNeonForLocalProxy } from './neon-local';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.',
  );
}

// Tests run against a local Postgres + neon-http proxy (docker); a no-op in
// production since real Neon hosts don't match.
configureNeonForLocalProxy(connectionString);

export const db = drizzle(neon(connectionString), { schema: fullSchema });
export { fullSchema as schema };
