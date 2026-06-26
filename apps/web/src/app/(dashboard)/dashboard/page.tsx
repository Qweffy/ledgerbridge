"use client";
/* /dashboard — Overview. Reads GET /status + GET /events, polls every 5s for a
   live feel. Ported from the bundle's overview.jsx. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EventDto, StatusDto } from "@ledgerbridge/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/dashboard/icon";
import { PageHeader } from "@/components/dashboard/page-header";
import { StateBlock } from "@/components/dashboard/state-block";
import {
  HealthIndicator,
  LagGauge,
  MetricTile,
  Skeleton,
  EventStatusPill,
  SystemBadge,
} from "@/components/dashboard/widgets";
import { api } from "@/lib/api/client";
import { useApi, useTick } from "@/lib/api/hooks";
import { timeAgo } from "@/lib/api/time";

const POLL = 5000;
const FEED_COLS = "104px 132px minmax(0,1fr) 64px 84px";
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

function MetricsRow({ status, loading }: { status: StatusDto | null; loading: boolean }) {
  const grid = { display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(6, minmax(0, 1fr))" } as const;
  if (loading || !status) {
    return (
      <div style={grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4) var(--space-5)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)" }}>
            <Skeleton w="60%" h={11} />
            <Skeleton w="42%" h={22} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={grid}>
      <MetricTile label="Queued" value={fmtNum(status.counts.pending)} icon="Clock" accent="var(--status-inflight-fg)" />
      <MetricTile label="In flight" value={fmtNum(status.counts.processing)} icon="Loader" accent="var(--status-inflight-fg)" />
      <MetricTile label="Synced" value={fmtNum(status.counts.done)} icon="CheckCircle2" accent="var(--status-synced-fg)" />
      <MetricTile label="Dead-letter" value={fmtNum(status.deadLetterCount)} icon="AlertOctagon" accent="var(--status-failed-fg)" />
      <MetricTile label="Conflicts" value={fmtNum(status.conflictCount)} icon="GitMerge" accent="var(--status-conflict-fg)" />
      <LagGauge seconds={status.oldestPendingLagSec} />
    </div>
  );
}

function EventRow({ ev }: { ev: EventDto }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "grid", alignItems: "center", gap: "var(--space-4)", gridTemplateColumns: FEED_COLS, padding: "0 var(--space-5)", height: 46, borderTop: "1px solid var(--border-subtle)", background: hover ? "var(--surface-hover)" : "transparent", transition: "background var(--dur-fast)" }}
    >
      <EventStatusPill status={ev.status} />
      <SystemBadge source={ev.source} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={{ font: "var(--fw-medium) var(--text-sm)/1.3 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap", flexShrink: 0 }}>{ev.externalId}</span>
          <span style={{ font: "var(--text-2xs)/1.3 var(--font-sans)", color: "var(--text-faint)", textTransform: "capitalize", whiteSpace: "nowrap" }}>{ev.operation} · {ev.entityType}</span>
        </div>
        {ev.lastError && (ev.status === "dead" || ev.status === "processing") && (
          <div style={{ marginTop: 3, font: "var(--text-2xs)/1.3 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.lastError}</div>
        )}
      </div>
      <span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: ev.attempts >= ev.maxAttempts ? "var(--status-failed-fg)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {ev.attempts}/{ev.maxAttempts}
      </span>
      <span title={ev.receivedAt ?? undefined} style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", textAlign: "right", whiteSpace: "nowrap" }}>
        {timeAgo(ev.receivedAt)}
      </span>
    </div>
  );
}

function FeedHeaderRow() {
  const cell = { font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)" } as const;
  return (
    <div style={{ display: "grid", alignItems: "center", gap: "var(--space-4)", gridTemplateColumns: FEED_COLS, padding: "0 var(--space-5)", height: 30 }}>
      <span style={cell}>Status</span>
      <span style={cell}>Source</span>
      <span style={cell}>Entity</span>
      <span style={{ ...cell, textAlign: "right" }}>Tries</span>
      <span style={{ ...cell, textAlign: "right" }}>Received</span>
    </div>
  );
}

function RecentEvents({ events, loading, error, onRetry }: { events: EventDto[] | null; loading: boolean; error: Error | null; onRetry: () => void }) {
  const live = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>
      <span style={{ position: "relative", display: "inline-flex" }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--status-synced-solid)" }} />
        <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--status-synced-solid)", animation: "lb-pulse2 1.8s var(--ease-in-out) infinite" }} />
      </span>
      Live · every 5s
    </span>
  );
  let inner: React.ReactNode;
  if (loading) {
    inner = (
      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: "grid", alignItems: "center", gap: "var(--space-4)", gridTemplateColumns: FEED_COLS, padding: "0 var(--space-5)", height: 46, borderTop: "1px solid var(--border-subtle)" }}>
            <Skeleton w={84} h={18} r="var(--radius-pill)" />
            <Skeleton w={96} h={18} r="var(--radius-sm)" />
            <Skeleton w="70%" h={12} />
            <Skeleton w={32} h={12} style={{ marginLeft: "auto" }} />
            <Skeleton w={48} h={12} style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    );
  } else if (error) {
    inner = <StateBlock icon="WifiOff" title="Couldn't load events" body={String(error.message)} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={onRetry}>Retry</Button>} />;
  } else if (!events || events.length === 0) {
    inner = <StateBlock icon="Inbox" title="No events yet" body="Nothing has flowed through the sync engine. New events from internal invoicing or QBO will appear here." />;
  } else {
    inner = <div>{events.map((ev) => <EventRow key={ev.id} ev={ev} />)}</div>;
  }
  return (
    <Card title="Recent events" description="Latest activity across both systems" actions={live} padded={false} style={{ marginTop: "var(--space-5)" }}>
      {!loading && !error && events && events.length > 0 && <FeedHeaderRow />}
      {inner}
    </Card>
  );
}

export default function OverviewPage() {
  const router = useRouter();
  const s = useApi(() => api.getStatus(), [], { pollMs: POLL });
  const e = useApi(() => api.getEvents(), [], { pollMs: POLL });
  useTick(1000); // keep relative timestamps live
  const statusLoading = s.loading && !s.data;
  const actions = (
    <>
      <Button variant="secondary" size="md" leadingIcon={<Icon name="Activity" size={15} />} onClick={() => router.push("/invoices")}>
        View invoices
      </Button>
      <Button variant="primary" size="md" leadingIcon={<Icon name="RefreshCw" size={15} />} onClick={() => { s.reload(); e.reload(); }}>
        Run reconcile
      </Button>
    </>
  );
  return (
    <>
      <PageHeader title="Overview" description="Watch syncs flow between internal invoicing and QuickBooks Online. Resolve conflicts, replay dead-lettered jobs, and trace every change." actions={actions} />
      <div style={{ padding: "var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {s.error && !s.data ? (
          <StateBlock icon="WifiOff" title="Couldn't load status" body={String(s.error.message)} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={s.reload}>Retry</Button>} />
        ) : statusLoading ? (
          <Skeleton w="100%" h={70} r="var(--radius-lg)" />
        ) : (
          s.data && <HealthIndicator status={s.data} />
        )}
        <MetricsRow status={s.data} loading={statusLoading} />
        <RecentEvents events={e.data} loading={e.loading && !e.data} error={e.error && !e.data ? e.error : null} onRetry={e.reload} />
      </div>
    </>
  );
}
