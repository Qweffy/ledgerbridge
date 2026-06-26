import { eq } from "drizzle-orm";
import { oauthTokens } from "../../db/schema";
import type { Database } from "../../db/types";
import type { OAuthTokens } from "./intuit";

export type OAuthTokenRow = typeof oauthTokens.$inferSelect;

// Upsert tokens for a realm (one connected QBO company = one row).
export async function saveTokens(
  db: Database,
  realmId: string,
  tokens: OAuthTokens,
  now: Date = new Date(),
): Promise<void> {
  const expiresAt = new Date(now.getTime() + tokens.expiresIn * 1000);
  const refreshExpiresAt = new Date(now.getTime() + tokens.refreshTokenExpiresIn * 1000);
  const set = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    refreshExpiresAt,
    updatedAt: now,
  };
  await db
    .insert(oauthTokens)
    .values({ realmId, ...set })
    .onConflictDoUpdate({ target: oauthTokens.realmId, set });
}

export async function getTokenRow(
  db: Database,
  realmId: string,
): Promise<OAuthTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.realmId, realmId))
    .limit(1);
  return row;
}
