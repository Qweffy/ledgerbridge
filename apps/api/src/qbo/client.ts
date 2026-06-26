import type { QboConfig } from "../config";
import type { Database } from "../../db/types";
import { getValidAccessToken } from "../oauth/manager";

// A thin QBO Accounting API client for Invoices: talks to the API with a fresh
// access token and the pinned minorversion. Response shapes are returned as
// `unknown` and narrowed by the caller.
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
  extraHeaders?: Record<string, string>,
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
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`QBO ${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// requestId becomes QBO's Request-Id header — Intuit dedupes identical Request-Ids
// within a window, so a retried create after a lost response won't double-insert.
export function createInvoice(
  deps: QboClientDeps,
  invoice: unknown,
  requestId?: string,
): Promise<unknown> {
  return qboRequest(
    deps,
    "POST",
    "/invoice",
    invoice,
    requestId ? { "Request-Id": requestId } : undefined,
  );
}

export function getInvoice(deps: QboClientDeps, id: string): Promise<unknown> {
  return qboRequest(deps, "GET", `/invoice/${id}`);
}

// A QBO Payment carries a LinkedTxn to the invoice it pays. requestId → Request-Id,
// so a retried create after a lost response is deduped by Intuit (Payments have no
// DocNumber, so this header is the API-level idempotency key).
export function createPayment(
  deps: QboClientDeps,
  payment: unknown,
  requestId?: string,
): Promise<unknown> {
  return qboRequest(
    deps,
    "POST",
    "/payment",
    payment,
    requestId ? { "Request-Id": requestId } : undefined,
  );
}

export function getPayment(deps: QboClientDeps, id: string): Promise<unknown> {
  return qboRequest(deps, "GET", `/payment/${id}`);
}

// Sparse update — `invoice` must carry Id + SyncToken; only the supplied fields change.
export function updateInvoice(deps: QboClientDeps, invoice: Record<string, unknown>): Promise<unknown> {
  return qboRequest(deps, "POST", "/invoice", { ...invoice, sparse: true });
}

export function voidInvoice(deps: QboClientDeps, id: string, syncToken: string): Promise<unknown> {
  return qboRequest(deps, "POST", "/invoice?operation=void", { Id: id, SyncToken: syncToken });
}

// Run a QBO SQL-like query (used to find an invoice by DocNumber for idempotent
// check-before-create, and to look up the default customer/item).
export function qboQuery(deps: QboClientDeps, statement: string): Promise<unknown> {
  return qboRequest(deps, "GET", `/query?query=${encodeURIComponent(statement)}`);
}
