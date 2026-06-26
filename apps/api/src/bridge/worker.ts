import { eq, sql } from "drizzle-orm";
import { syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";
import { processEvent, type ProcessorDeps, type SyncEventRow } from "./processor";

// Throw this from the processor to dead-letter immediately (a permanent 4xx),
// instead of retrying with backoff.
export class PermanentError extends Error {}

const DEFAULT_MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 5 * 60 * 1000;

// Atomically claim the next due event with a single statement. FOR UPDATE SKIP
// LOCKED means concurrent workers never grab the same row. A single statement is
// its own transaction, so this works over the stateless neon-http driver too.
export async function claimNext(
  db: Database,
  workerId: string,
  now: Date = new Date(),
): Promise<SyncEventRow | undefined> {
  const res = await db.execute(sql`
    update sync_events
       set status = 'processing', locked_at = ${now}, locked_by = ${workerId}, attempts = attempts + 1
     where id = (
       select id from sync_events
        where status = 'pending' and next_attempt_at <= ${now}
        order by next_attempt_at
          for update skip locked
        limit 1
     )
    returning id`);
  const rows = (res as unknown as { rows?: Array<{ id: number | string }> }).rows ?? [];
  const claimedId = rows[0]?.id;
  if (claimedId === undefined) return undefined;
  const [row] = await db
    .select()
    .from(syncEvents)
    .where(eq(syncEvents.id, Number(claimedId)))
    .limit(1);
  return row;
}

export interface WorkerDeps {
  processor: ProcessorDeps;
  workerId?: string;
  maxAttempts?: number;
  now?: () => Date;
}

// Claim and process exactly one event. Returns "idle" when nothing is due.
export async function processOne(
  db: Database,
  deps: WorkerDeps,
): Promise<"processed" | "idle"> {
  const workerId = deps.workerId ?? "worker-1";
  const now = deps.now?.() ?? new Date();
  const event = await claimNext(db, workerId, now);
  if (!event) return "idle";

  try {
    await processEvent(db, event, deps.processor);
    await db
      .update(syncEvents)
      .set({ status: "done", processedAt: now, lockedAt: null, lockedBy: null })
      .where(eq(syncEvents.id, event.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const permanent = err instanceof PermanentError;
    if (permanent || event.attempts >= maxAttempts) {
      await db
        .update(syncEvents)
        .set({ status: "dead", lastError: message, lockedAt: null, lockedBy: null })
        .where(eq(syncEvents.id, event.id));
    } else {
      const backoff = Math.min(BACKOFF_BASE_MS * 2 ** event.attempts, BACKOFF_CAP_MS);
      await db
        .update(syncEvents)
        .set({
          status: "pending",
          lastError: message,
          nextAttemptAt: new Date(now.getTime() + backoff),
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(syncEvents.id, event.id));
    }
  }
  return "processed";
}

export interface RunningWorker {
  stop: () => Promise<void>;
}

// Long-running poll loop with graceful shutdown — stop() lets the in-flight event
// finish before resolving.
export function startWorker(
  db: Database,
  deps: WorkerDeps & { pollIntervalMs?: number; onError?: (err: unknown) => void },
): RunningWorker {
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;
  let stopped = false;
  let current: Promise<unknown> = Promise.resolve();

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        current = processOne(db, deps);
        const result = await current;
        if (result === "idle") await sleep(pollIntervalMs);
      } catch (err) {
        deps.onError?.(err);
        await sleep(pollIntervalMs);
      }
    }
  }
  void loop();

  return {
    async stop() {
      stopped = true;
      await current;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
