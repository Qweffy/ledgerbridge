import type { QboAccountOps, QboInvoiceOps, QboPaymentOps } from "../../src/bridge/qbo-ops";

// Reach into a QBO invoice body's first line amount (dollars) → integer cents.
export function bodyCents(invoice: Record<string, unknown>): number {
  const line = (invoice.Line as Array<{ Amount?: number }> | undefined)?.[0];
  return Math.round((line?.Amount ?? 0) * 100);
}

// In-memory QBO double: tracks invoices by Id and DocNumber, and records what the
// processor actually asked it to do (creates, updates, the request id, the void
// SyncToken) so tests can assert the side effects — not just the wiring. The void
// bumps the SyncToken and stamps the "Voided" marker, mirroring real QBO.
export function createFakeQbo() {
  interface Inv {
    Id: string;
    SyncToken: string;
    DocNumber: string;
    voided: boolean;
    totalCents: number;
  }
  const byId = new Map<string, Inv>();
  const byDoc = new Map<string, string>();
  let seq = 100;
  let createCalls = 0;
  let updateCalls = 0;
  let lastCreateRequestId: string | undefined;
  let lastUpdate: Record<string, unknown> | undefined;
  let lastVoidSyncToken: string | undefined;

  const ops: QboInvoiceOps = {
    async findByDocNumber(docNumber) {
      const id = byDoc.get(docNumber);
      if (id === undefined) return undefined;
      const inv = byId.get(id);
      return inv ? { Id: inv.Id, SyncToken: inv.SyncToken } : undefined;
    },
    async listByDocNumber(docNumber) {
      const out = [];
      for (const inv of byId.values()) {
        if (inv.DocNumber === docNumber) {
          out.push({ Id: inv.Id, SyncToken: inv.SyncToken, totalCents: inv.totalCents, voided: inv.voided, docNumber: inv.DocNumber });
        }
      }
      return out;
    },
    async create(invoice, requestId) {
      createCalls += 1;
      lastCreateRequestId = requestId;
      const id = String((seq += 1));
      const docNumber = String((invoice as { DocNumber?: unknown }).DocNumber ?? id);
      byId.set(id, { Id: id, SyncToken: "0", DocNumber: docNumber, voided: false, totalCents: bodyCents(invoice) });
      byDoc.set(docNumber, id);
      return { Id: id, SyncToken: "0" };
    },
    async read(id) {
      const inv = byId.get(id);
      if (!inv) throw new Error(`qbo invoice ${id} not found`);
      return { Id: inv.Id, SyncToken: inv.SyncToken, totalCents: inv.totalCents, voided: inv.voided, docNumber: inv.DocNumber };
    },
    async update(invoice) {
      updateCalls += 1;
      lastUpdate = invoice;
      const id = String((invoice as { Id?: unknown }).Id);
      const inv = byId.get(id);
      if (!inv) throw new Error(`qbo invoice ${id} not found`);
      inv.SyncToken = String(Number(inv.SyncToken) + 1);
      if (invoice.Line !== undefined) inv.totalCents = bodyCents(invoice);
      return { Id: inv.Id, SyncToken: inv.SyncToken };
    },
    async voidInvoice(id, syncToken) {
      lastVoidSyncToken = syncToken;
      const inv = byId.get(id);
      if (!inv) throw new Error(`qbo invoice ${id} not found`);
      inv.voided = true;
      inv.SyncToken = String(Number(inv.SyncToken) + 1);
      return { Id: inv.Id, SyncToken: inv.SyncToken };
    },
  };

  const paymentsById = new Map<string, Record<string, unknown>>();
  const paymentByReqId = new Map<string, string>();
  let paymentSeq = 500;
  let paymentCreateCalls = 0;
  let lastPaymentBody: Record<string, unknown> | undefined;

  const payments: QboPaymentOps = {
    async create(payment, requestId) {
      // Mirror Intuit's Request-Id dedup: a retry with the same id returns the
      // original payment instead of inserting a duplicate.
      const seen = paymentByReqId.get(requestId);
      if (seen) return { Id: seen, SyncToken: "0" };
      paymentCreateCalls += 1;
      lastPaymentBody = payment;
      const id = String((paymentSeq += 1));
      paymentsById.set(id, payment);
      paymentByReqId.set(requestId, id);
      return { Id: id, SyncToken: "0" };
    },
  };

  interface Acct {
    Id: string;
    SyncToken: string;
    Name: string;
    body: Record<string, unknown>;
  }
  const accountsById = new Map<string, Acct>();
  const accountByName = new Map<string, string>();
  const accountByReqId = new Map<string, string>();
  let accountSeq = 900;
  let accountCreateCalls = 0;
  let accountUpdateCalls = 0;
  let lastAccountBody: Record<string, unknown> | undefined;

  const accounts: QboAccountOps = {
    async findByName(name) {
      const id = accountByName.get(name);
      if (id === undefined) return undefined;
      const a = accountsById.get(id);
      return a ? { Id: a.Id, SyncToken: a.SyncToken } : undefined;
    },
    async create(account, requestId) {
      // Mirror Intuit's Request-Id dedup: a retry with the same id returns the original.
      const seen = accountByReqId.get(requestId);
      if (seen) return { Id: seen, SyncToken: "0" };
      accountCreateCalls += 1;
      lastAccountBody = account;
      const id = String((accountSeq += 1));
      const name = String((account as { Name?: unknown }).Name ?? id);
      accountsById.set(id, { Id: id, SyncToken: "0", Name: name, body: account });
      accountByName.set(name, id);
      accountByReqId.set(requestId, id);
      return { Id: id, SyncToken: "0" };
    },
    async read(id) {
      const a = accountsById.get(id);
      if (!a) throw new Error(`qbo account ${id} not found`);
      return { Id: a.Id, SyncToken: a.SyncToken };
    },
    async update(account) {
      accountUpdateCalls += 1;
      lastAccountBody = account;
      const id = String((account as { Id?: unknown }).Id);
      const a = accountsById.get(id);
      if (!a) throw new Error(`qbo account ${id} not found`);
      a.SyncToken = String(Number(a.SyncToken) + 1);
      const newName = (account as { Name?: unknown }).Name;
      if (typeof newName === "string" && newName !== a.Name) {
        accountByName.delete(a.Name);
        a.Name = newName;
        accountByName.set(newName, id);
      }
      return { Id: a.Id, SyncToken: a.SyncToken };
    },
  };

  return {
    ops,
    payments,
    paymentsById,
    accounts,
    accountsById,
    byId,
    byDoc,
    seed(docNumber: string, totalCents = 0): string {
      const id = String((seq += 1));
      byId.set(id, { Id: id, SyncToken: "0", DocNumber: docNumber, voided: false, totalCents });
      byDoc.set(docNumber, id);
      return id;
    },
    // Seed a QBO Account that exists with no link to us (e.g. a create that landed but
    // whose link write was lost) — the account adopt-by-Name path should find it.
    seedAccount(name: string): string {
      const id = String((accountSeq += 1));
      accountsById.set(id, { Id: id, SyncToken: "0", Name: name, body: {} });
      accountByName.set(name, id);
      return id;
    },
    // Simulate a change made directly in QBO (not by us): bump the version so the
    // reverse direction sees it as a genuine external edit, not an echo.
    externalEdit(qboId: string, patch: { totalCents?: number; voided?: boolean }): void {
      const inv = byId.get(qboId);
      if (!inv) throw new Error(`qbo invoice ${qboId} not found`);
      if (patch.totalCents !== undefined) inv.totalCents = patch.totalCents;
      if (patch.voided !== undefined) inv.voided = patch.voided;
      inv.SyncToken = String(Number(inv.SyncToken) + 1);
    },
    get createCalls() {
      return createCalls;
    },
    get updateCalls() {
      return updateCalls;
    },
    get lastCreateRequestId() {
      return lastCreateRequestId;
    },
    get lastUpdate() {
      return lastUpdate;
    },
    get lastVoidSyncToken() {
      return lastVoidSyncToken;
    },
    get paymentCreateCalls() {
      return paymentCreateCalls;
    },
    get lastPaymentBody() {
      return lastPaymentBody;
    },
    get accountCreateCalls() {
      return accountCreateCalls;
    },
    get accountUpdateCalls() {
      return accountUpdateCalls;
    },
    get lastAccountBody() {
      return lastAccountBody;
    },
  };
}
