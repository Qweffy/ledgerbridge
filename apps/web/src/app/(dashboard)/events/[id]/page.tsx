"use client";
/* /events/[id] — one sync event (GET /events/:id): retry metadata + correlation,
   the raw payload as a colorized JSON block (copyable), and the event's audit
   Timeline. Dead events expose Replay (POST /events/:id/replay) → toast + the
   header optimistically flips to processing. */
import { useRouter } from "next/navigation";
import { use, useState, type CSSProperties, type ReactNode } from "react";
import type { EventStatus } from "@ledgerbridge/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/dashboard/icon";
import { PageHeader } from "@/components/dashboard/page-header";
import { StateBlock } from "@/components/dashboard/state-block";
import { EventStatusPill, Skeleton, SystemBadge, Timeline } from "@/components/dashboard/widgets";
import { showToast } from "@/components/dashboard/overlays";
import { api, type EventDetailView } from "@/lib/api/client";
import { useApi, useTick } from "@/lib/api/hooks";
import { timeAgo } from "@/lib/api/time";

function colorizeJson(json: string): ReactNode[] {
  const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (let m = re.exec(json); m !== null; m = re.exec(json)) {
    if (m.index > last) out.push(json.slice(last, m.index));
    let color = "var(--text-secondary)";
    if (m[1]) color = "var(--system-internal-fg)";
    else if (m[2]) color = "var(--status-synced-fg)";
    else if (m[3]) color = "var(--status-replayed-fg)";
    else if (m[4]) color = "var(--status-inflight-fg)";
    out.push(<span key={i++} style={{ color }}>{m[0]}</span>);
    last = re.lastIndex;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

function JSONViewer({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  const copy = () => {
    const ok = () => showToast("Payload copied to clipboard", "success");
    const fail = () => showToast("Copy failed", "error");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(ok, fail);
    else fail();
  };
  return (
    <Card title="Raw payload" description="Exactly as received by LedgerBridge" padded={false} actions={<Button size="sm" variant="secondary" leadingIcon={<Icon name="Copy" size={13} />} onClick={copy}>Copy</Button>}>
      <pre style={{ margin: 0, padding: "var(--space-5)", overflow: "auto", maxHeight: 420, background: "var(--surface-sunken)", font: "var(--text-xs)/1.65 var(--font-mono)", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{colorizeJson(json)}</pre>
    </Card>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</div>
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  );
}

const mono: CSSProperties = { font: "var(--text-sm)/1.3 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" };

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: e, loading, error, reload } = useApi<EventDetailView>(() => api.getEvent(id), [id]);
  const [replaying, setReplaying] = useState(false);
  const [replayed, setReplayed] = useState(false);
  useTick(1000);

  const replay = () => {
    setReplaying(true);
    api.replayEvent(id).then(
      () => { setReplaying(false); setReplayed(true); showToast(`Replaying ${id} — requeued`, "success"); },
      (err: unknown) => { setReplaying(false); showToast(`Replay failed: ${err instanceof Error ? err.message : String(err)}`, "error"); },
    );
  };

  if (loading && !e) {
    return (
      <>
        <PageHeader title="Loading…" />
        <div style={{ padding: "var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <Skeleton w="100%" h={88} r="var(--radius-lg)" />
          <Skeleton w="100%" h={280} r="var(--radius-lg)" />
        </div>
      </>
    );
  }
  if (error || !e) {
    return (
      <>
        <PageHeader title="Event" />
        <div style={{ padding: "var(--space-7)" }}>
          <Card><StateBlock icon="WifiOff" title="Couldn't load this event" body={error ? String(error.message) : "Not found"} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={reload}>Retry</Button>} /></Card>
        </div>
      </>
    );
  }

  const status: EventStatus = replayed ? "processing" : e.status;
  const payload = e.payload && Object.keys(e.payload).length ? e.payload : { id: e.eventId, note: "No payload captured" };
  const actions = (
    <>
      <Button variant="ghost" size="md" leadingIcon={<Icon name="ArrowLeft" size={15} />} onClick={() => router.push("/events")}>Back</Button>
      {status === "dead" && <Button variant="primary" size="md" loading={replaying} leadingIcon={replaying ? undefined : <Icon name="RotateCcw" size={15} />} onClick={replay}>Replay</Button>}
    </>
  );

  return (
    <>
      <PageHeader eyebrow="sync event" title={e.eventId} description={`${e.operation} · ${e.entityType} · ${e.source === "qbo" ? "QuickBooks" : "Internal"}`} actions={actions} />
      <div style={{ padding: "var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--space-6)" }}>
            <MetaItem label="Status"><EventStatusPill status={status} size="md" /></MetaItem>
            <MetaItem label="Source"><SystemBadge source={e.source} size="md" /></MetaItem>
            <MetaItem label="Attempts"><span style={{ ...mono, color: e.attempts >= e.maxAttempts && status === "dead" ? "var(--status-failed-fg)" : "var(--text-primary)" }}>{e.attempts} / {e.maxAttempts}</span></MetaItem>
            <MetaItem label="Next attempt"><span style={{ ...mono, color: "var(--text-secondary)" }}>{e.nextAttemptAt ? timeAgo(e.nextAttemptAt) : "—"}</span></MetaItem>
            <MetaItem label="Correlation ID"><span style={mono}>{e.correlationId}</span></MetaItem>
            <MetaItem label="Received"><span title={e.receivedAt ?? undefined} style={{ ...mono, color: "var(--text-secondary)" }}>{timeAgo(e.receivedAt)}</span></MetaItem>
          </div>
          {e.lastError && (
            <div style={{ marginTop: "var(--space-5)", display: "flex", alignItems: "flex-start", gap: 9, padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--status-failed-fill)", border: "1px solid color-mix(in oklch, var(--status-failed-solid) 30%, transparent)" }}>
              <Icon name="XCircle" size={15} color="var(--status-failed-fg)" style={{ marginTop: 1, flexShrink: 0 }} />
              <span style={{ font: "var(--text-sm)/1.4 var(--font-mono)", color: "var(--status-failed-fg)" }}>{e.lastError}</span>
            </div>
          )}
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: "var(--space-5)", alignItems: "start" }}>
          <JSONViewer value={payload} />
          <Card title="Audit trail" description="What LedgerBridge did with this event">
            <Timeline items={e.auditTrail} />
          </Card>
        </div>
      </div>
    </>
  );
}
