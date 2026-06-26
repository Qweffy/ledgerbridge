import type { QboConfig } from "../config";
import type { Database } from "../../db/types";
import { getValidAccessToken } from "../oauth/manager";

// A thin QBO Accounting API client for Invoices. Mapping internal invoices to the
// QBO Invoice shape lands in M4; here the client just talks to the API with a
// fresh access token and the pinned minorversion. Response shapes are `unknown`
// until M4 types them.
export interface QboClientDeps {
  db: Database;
  cfg: QboConfig;
  realmId: string;
  fetchImpl?: typeof fetch;
}

async function qboRequest(
  deps: QboClientDeps,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const token = await getValidAccessToken(deps.db, deps.cfg, deps.realmId, {
    fetchImpl: deps.fetchImpl,
  });
  const sep = path.includes("?") ? "&" : "?";
  const url = `${deps.cfg.apiBaseUrl}/v3/company/${deps.realmId}${path}${sep}minorversion=${deps.cfg.minorVersion}`;
  const res = await (deps.fetchImpl ?? fetch)(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`QBO ${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export function createInvoice(deps: QboClientDeps, invoice: unknown): Promise<unknown> {
  return qboRequest(deps, "POST", "/invoice", invoice);
}

export function getInvoice(deps: QboClientDeps, id: string): Promise<unknown> {
  return qboRequest(deps, "GET", `/invoice/${id}`);
}

// Sparse update — `invoice` must carry Id + SyncToken; only the supplied fields change.
export function updateInvoice(deps: QboClientDeps, invoice: Record<string, unknown>): Promise<unknown> {
  return qboRequest(deps, "POST", "/invoice", { ...invoice, sparse: true });
}

export function voidInvoice(deps: QboClientDeps, id: string, syncToken: string): Promise<unknown> {
  return qboRequest(deps, "POST", "/invoice?operation=void", { Id: id, SyncToken: syncToken });
}
