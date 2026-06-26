import { neonConfig } from '@neondatabase/serverless';

// The e2e tests run against a local Postgres + Neon HTTP proxy (docker). The
// neon-http driver defaults to https://<host>/sql (:443); point it at the proxy
// on :4444 instead when the connection targets it. Real Neon hosts never match
// `localtest.me` and NEON_LOCAL is unset in production, so this is a no-op there.
//
// Shared by the app client (db/index.ts) and the migrate/test paths, which each
// construct their own neon-http client.
export function configureNeonForLocalProxy(connectionString: string): void {
  if (connectionString.includes('localtest.me') || process.env.NEON_LOCAL) {
    neonConfig.fetchEndpoint = (host) => `http://${host}:4444/sql`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.poolQueryViaFetch = true;
  }
}
