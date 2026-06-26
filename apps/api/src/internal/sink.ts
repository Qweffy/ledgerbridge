import { createHmac } from "node:crypto";

// A change in the internal system, sent to the bridge as a "ping". The bridge
// refetches the full entity rather than trusting this payload.
export interface ChangeEvent {
  eventId: string;
  entity: "invoice" | "payment";
  entityId: string;
  changeType: "create" | "update" | "pay" | "delete";
  version: number;
  occurredAt: string;
}

export interface ChangeSink {
  emit(event: ChangeEvent): Promise<void>;
}

export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// Production sink: POST a signed webhook to the bridge's internal ingest endpoint.
export function createWebhookSink(opts: {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
}): ChangeSink {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async emit(event) {
      const body = JSON.stringify(event);
      await doFetch(opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lb-signature": signPayload(body, opts.secret),
        },
        body,
      });
    },
  };
}

// Used until the bridge ingest endpoint (M4) is wired up.
export const noopSink: ChangeSink = {
  async emit() {},
};
