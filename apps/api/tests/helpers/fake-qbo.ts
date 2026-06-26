import type { QboInvoiceOps } from "../../src/bridge/qbo-ops";

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

  return {
    ops,
    byId,
    byDoc,
    seed(docNumber: string): string {
      const id = String((seq += 1));
      byId.set(id, { Id: id, SyncToken: "0", DocNumber: docNumber, voided: false, totalCents: 0 });
      byDoc.set(docNumber, id);
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
  };
}
