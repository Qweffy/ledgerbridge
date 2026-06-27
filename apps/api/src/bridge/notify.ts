import pg from "pg";

// Neon's pooled host carries a `-pooler` segment that PgBouncer terminates, and
// PgBouncer's transaction pooling silently drops LISTEN. Derive the direct (session)
// host so the listener keeps an open connection. A non-Neon URL is returned unchanged.
export function deriveUnpooledUrl(url: string): string {
  return url.replace("-pooler.", ".");
}

export interface NotifyListener {
  stop: () => Promise<void>;
}

const RECONNECT_DELAY_MS = 2000;

// A dedicated session that LISTENs on the sync_events channel and calls onWake for
// each NOTIFY (fired by the AFTER INSERT trigger), reconnecting on error. This is a
// latency optimization layered on top of the worker's polling: if the connection is
// never established the worker still drains the outbox by polling, so sync correctness
// never depends on it. Used in production (Railway → Neon over TCP); tests drive
// processOne directly and don't start it.
export function startNotifyListener(opts: {
  url: string;
  channel?: string;
  onWake: () => void;
  onError?: (err: unknown) => void;
  onReady?: () => void;
}): NotifyListener {
  const channel = opts.channel ?? "sync_events";
  let stopped = false;
  let client: pg.Client | undefined;

  async function run(): Promise<void> {
    while (!stopped) {
      const c = new pg.Client({ connectionString: opts.url });
      client = c;
      try {
        await new Promise<void>((resolve, reject) => {
          c.on("notification", () => opts.onWake());
          c.on("error", reject);
          c.on("end", () => resolve());
          c.connect()
            .then(() => c.query(`LISTEN ${quoteIdent(channel)}`))
            .then(() => opts.onReady?.())
            .catch(reject);
        });
      } catch (err) {
        if (!stopped) opts.onError?.(err);
      }
      try {
        await c.end();
      } catch {
        // already torn down
      }
      if (!stopped) await sleep(RECONNECT_DELAY_MS); // the poller covers this gap
    }
  }

  void run();

  return {
    async stop() {
      stopped = true;
      try {
        await client?.end();
      } catch {
        // already torn down
      }
    },
  };
}

// channel is an internal constant, never user input; quote defensively regardless.
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
