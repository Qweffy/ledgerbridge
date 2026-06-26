import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { buildAuthorizeUrl, exchangeCode, refreshTokens } from "../../src/oauth/intuit";
import { getValidAccessToken } from "../../src/oauth/manager";
import { getTokenRow, saveTokens } from "../../src/oauth/store";
import { noopSink } from "../../src/internal/sink";
import { buildServer } from "../../src/server";
import type { QboConfig } from "../../src/config";

const cfg: QboConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "http://localhost:3001/oauth/callback",
  environment: "sandbox",
  scope: "com.intuit.quickbooks.accounting",
  minorVersion: "73",
  authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
  tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  apiBaseUrl: "https://sandbox-quickbooks.api.intuit.com",
};

function tokenFetch(resp: Record<string, unknown>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; auth: string; body: string }>;
} {
  const calls: Array<{ url: string; auth: string; body: string }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      auth: headers["authorization"] ?? "",
      body: String(init?.body),
    });
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const TOKEN_RESP = {
  access_token: "at",
  refresh_token: "rt",
  expires_in: 3600,
  x_refresh_token_expires_in: 8640000,
  token_type: "bearer",
};

describe("intuit oauth helpers", () => {
  it("builds the authorize url with scope, redirect and state", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "xyz"));
    expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3001/oauth/callback");
    expect(url.searchParams.get("state")).toBe("xyz");
  });

  it("exchanges a code with Basic auth and authorization_code grant", async () => {
    const { fetchImpl, calls } = tokenFetch(TOKEN_RESP);
    const tokens = await exchangeCode(cfg, "the-code", fetchImpl);
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
    expect(calls[0]?.url).toBe(cfg.tokenUrl);
    expect(calls[0]?.auth).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(calls[0]?.body).toContain("grant_type=authorization_code");
    expect(calls[0]?.body).toContain("code=the-code");
  });

  it("refreshes with the refresh_token grant", async () => {
    const { fetchImpl, calls } = tokenFetch({ ...TOKEN_RESP, access_token: "at2" });
    const tokens = await refreshTokens(cfg, "old-rt", fetchImpl);
    expect(tokens.accessToken).toBe("at2");
    expect(calls[0]?.body).toContain("grant_type=refresh_token");
    expect(calls[0]?.body).toContain("refresh_token=old-rt");
  });
});

describe("token manager", () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    await h.close();
  });

  it("returns the stored token when it isn't near expiry", async () => {
    const now = new Date("2026-06-26T12:00:00Z");
    await saveTokens(
      h.db,
      "realm1",
      { accessToken: "live", refreshToken: "rt", expiresIn: 3600, refreshTokenExpiresIn: 8640000 },
      now,
    );
    const { fetchImpl, calls } = tokenFetch(TOKEN_RESP);
    const token = await getValidAccessToken(h.db, cfg, "realm1", { fetchImpl, now });
    expect(token).toBe("live");
    expect(calls).toHaveLength(0);
  });

  it("refreshes and persists when within the 5-minute skew window", async () => {
    const now = new Date("2026-06-26T12:00:00Z");
    await saveTokens(
      h.db,
      "realm1",
      { accessToken: "stale", refreshToken: "old-rt", expiresIn: 120, refreshTokenExpiresIn: 8640000 },
      now,
    );
    const later = new Date(now.getTime() + 60_000);
    const { fetchImpl, calls } = tokenFetch({
      ...TOKEN_RESP,
      access_token: "fresh",
      refresh_token: "new-rt",
    });
    const token = await getValidAccessToken(h.db, cfg, "realm1", { fetchImpl, now: later });
    expect(token).toBe("fresh");
    expect(calls).toHaveLength(1);
    const row = await getTokenRow(h.db, "realm1");
    expect(row?.accessToken).toBe("fresh");
    expect(row?.refreshToken).toBe("new-rt");
  });
});

describe("oauth routes", () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    await h.close();
  });

  it("connect redirects to Intuit and callback exchanges + stores tokens", async () => {
    const { fetchImpl } = tokenFetch(TOKEN_RESP);
    const app = buildServer({ db: h.db, sink: noopSink, qbo: { cfg, fetchImpl } });

    const connect = await app.inject({ method: "GET", url: "/oauth/connect" });
    expect(connect.statusCode).toBe(302);
    const location = connect.headers.location ?? "";
    const state = new URL(String(location)).searchParams.get("state") ?? "";
    expect(state).not.toBe("");

    const cb = await app.inject({
      method: "GET",
      url: `/oauth/callback?code=abc&state=${state}&realmId=9130347`,
    });
    expect(cb.statusCode).toBe(200);
    expect(cb.json()).toMatchObject({ connected: true, realmId: "9130347" });

    const row = await getTokenRow(h.db, "9130347");
    expect(row?.accessToken).toBe("at");
    await app.close();
  });

  it("rejects a callback with an unknown state", async () => {
    const app = buildServer({ db: h.db, sink: noopSink, qbo: { cfg } });
    const cb = await app.inject({
      method: "GET",
      url: "/oauth/callback?code=abc&state=bogus&realmId=9130347",
    });
    expect(cb.statusCode).toBe(400);
    await app.close();
  });
});
