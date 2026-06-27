import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { saveTokens } from "../../src/oauth/store";
import { createQboInvoiceOps, qboQuoteLiteral } from "../../src/bridge/qbo-ops";
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

describe("qboQuoteLiteral", () => {
  it("escapes single quotes and backslashes so a value can't break out of the literal", () => {
    expect(qboQuoteLiteral("INV-1")).toBe("INV-1");
    expect(qboQuoteLiteral("a'b")).toBe("a\\'b");
    expect(qboQuoteLiteral("a\\b")).toBe("a\\\\b");
    expect(qboQuoteLiteral("x' or '1'='1")).toBe("x\\' or \\'1\\'=\\'1");
  });
});

describe("createQboInvoiceOps query escaping", () => {
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

  it("escapes a quote-bearing docNumber before it reaches the QBO query", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ QueryResponse: { Invoice: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const ops = createQboInvoiceOps({ db: h.db, cfg, realmId: "r1", fetchImpl });
    await ops.findByDocNumber("x' or '1'='1");

    // The statement is url-encoded onto the query string; decoded, the quotes must be
    // backslash-escaped — never a bare quote that closes the literal early.
    const decoded = decodeURIComponent(calls[0] ?? "");
    expect(decoded).toContain("DocNumber = 'x\\' or \\'1\\'=\\'1'");
  });
});
