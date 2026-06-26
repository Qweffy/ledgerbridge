import type { QboConfig } from "../config";
import type { Database } from "../../db/types";
import { refreshTokens } from "./intuit";
import { getTokenRow, saveTokens } from "./store";

// Refresh the access token this many ms before it actually expires, so a request
// never races the expiry.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface TokenManagerDeps {
  fetchImpl?: typeof fetch;
  now?: Date;
}

export class NoTokensError extends Error {}

// Return a valid access token for a realm, refreshing (and persisting) it first
// if it's within the skew window of expiring.
//
// Note: a production multi-worker deployment should guard the refresh with a
// Postgres advisory lock so two workers don't refresh concurrently. The neon-http
// driver can't hold a session lock across statements, so that lands with the
// transactional pool a long-running worker uses; for the single dev process this is fine.
export async function getValidAccessToken(
  db: Database,
  cfg: QboConfig,
  realmId: string,
  deps: TokenManagerDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();

  const row = await getTokenRow(db, realmId);
  if (!row) throw new NoTokensError(`no QBO tokens for realm ${realmId}`);

  if (row.expiresAt.getTime() - now.getTime() > REFRESH_SKEW_MS) {
    return row.accessToken;
  }

  const refreshed = await refreshTokens(cfg, row.refreshToken, fetchImpl);
  await saveTokens(db, realmId, refreshed, now);
  return refreshed.accessToken;
}
