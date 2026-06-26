import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { saveTokens } from "../../src/oauth/store";
import { createInvoice, qboQuery, updateInvoice, voidInvoice } from "../../src/qbo/client";
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

function recordingFetch(status = 200, json: unknown = { Invoice: { Id: "1", SyncToken: "0" } }) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: String(init?.method), headers, body: String(init?.body) });
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("qbo client", () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await createTestDb();
    await saveTokens(h.db, "r1", {
      accessToken: "AT",
      refreshToken: "RT",
      expiresIn: 3600,
      refreshTokenExpiresIn: 8640000,
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it("create sends Bearer auth, the pinned minorversion, and the Request-Id idempotency header", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await createInvoice({ db: h.db, cfg, realmId: "r1", fetchImpl }, { DocNumber: "INV-1" }, "req-1");
    const c = calls[0];
    expect(c?.method).toBe("POST");
    expect(c?.url).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/r1/invoice?minorversion=73");
    expect(c?.headers.authorization).toBe("Bearer AT");
    expect(c?.headers["Request-Id"]).toBe("req-1");
  });

  it("update marks the request sparse", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await updateInvoice({ db: h.db, cfg, realmId: "r1", fetchImpl }, { Id: "1", SyncToken: "0" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ Id: "1", SyncToken: "0", sparse: true });
  });

  it("void targets operation=void and carries the SyncToken", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await voidInvoice({ db: h.db, cfg, realmId: "r1", fetchImpl }, "1", "3");
    expect(calls[0]?.url).toContain("/invoice?operation=void");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ Id: "1", SyncToken: "3" });
  });

  it("throws on a non-2xx response (so the worker retries)", async () => {
    const { fetchImpl } = recordingFetch(500, { Fault: { Error: [{ Message: "boom" }] } });
    await expect(
      qboQuery({ db: h.db, cfg, realmId: "r1", fetchImpl }, "select Id from Invoice"),
    ).rejects.toThrow(/500/);
  });

  it("query url-encodes the statement", async () => {
    const { fetchImpl, calls } = recordingFetch(200, { QueryResponse: {} });
    await qboQuery({ db: h.db, cfg, realmId: "r1", fetchImpl }, "select * from Invoice where DocNumber = 'INV-1'");
    expect(calls[0]?.url).toContain("/query?query=select%20*%20from%20Invoice");
    expect(calls[0]?.url).toContain("minorversion=73");
  });
});
