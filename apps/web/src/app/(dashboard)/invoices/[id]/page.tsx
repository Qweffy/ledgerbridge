"use client";
/* /invoices/[id] — field-level diff (GET /links/:id) + status summary + timeline. */
import { useRouter } from "next/navigation";
import { use, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/dashboard/icon";
import { PageHeader } from "@/components/dashboard/page-header";
import { StateBlock } from "@/components/dashboard/state-block";
import { Skeleton, SystemBadge, Timeline } from "@/components/dashboard/widgets";
import { DriftIndicator, LinkStatusPill } from "@/components/dashboard/table";
import { api, type LinkDetailView } from "@/lib/api/client";
import { useApi, useTick } from "@/lib/api/hooks";
import { timeAgo } from "@/lib/api/time";

type Snapshot = Record<string, string>;
interface DiffRow { field: string; iv: string | null; qv: string | null; differ: boolean }

function diffRows(internal: Snapshot, qbo: Snapshot): DiffRow[] {
  const keys: string[] = [];
  Object.keys(internal ?? {}).forEach((k) => keys.push(k));
  Object.keys(qbo ?? {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
  return keys.map((k) => {
    const iv = internal && k in internal ? String(internal[k]) : null;
    const qv = qbo && k in qbo ? String(qbo[k]) : null;
    return { field: k, iv, qv, differ: (iv ?? "") !== (qv ?? "") };
  });
}

function SnapshotValue({ value, differ, side }: { value: string | null; differ: boolean; side: "internal" | "qbo" }) {
  if (value == null) return <span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-faint)", fontStyle: "italic" }}>absent</span>;
  const color = differ ? (side === "internal" ? "var(--system-internal-fg)" : "var(--system-quickbooks-fg)") : "var(--text-secondary)";
  return <span style={{ font: `${differ ? "var(--fw-medium)" : "var(--fw-regular)"} var(--text-sm)/1.3 var(--font-mono)`, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>;
}

function DiffViewer({ internal, qbo }: { internal: Snapshot; qbo: Snapshot }) {
  const rows = diffRows(internal, qbo);
  const diffCount = rows.filter((r) => r.differ).length;
  const head = { font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase" as const, color: "var(--text-faint)" };
  const template = "minmax(120px,0.7fr) minmax(0,1fr) 24px minmax(0,1fr)";
  return (
    <Card padded={false} title="Field-level diff" description={diffCount ? `${diffCount} field${diffCount > 1 ? "s" : ""} differ between systems` : "Snapshots are identical across both systems"} actions={<div style={{ display: "flex", gap: 6 }}><SystemBadge source="internal" /><SystemBadge source="qbo" /></div>}>
      <div role="table">
        <div role="row" style={{ display: "grid", gridTemplateColumns: template, gap: "var(--space-4)", alignItems: "center", padding: "0 var(--space-5)", height: 32, borderBottom: "1px solid var(--border-subtle)" }}>
          <span style={head}>Field</span>
          <span style={{ ...head, color: "var(--system-internal-fg)" }}>Internal</span>
          <span />
          <span style={{ ...head, color: "var(--system-quickbooks-fg)" }}>QuickBooks</span>
        </div>
        {rows.map((r) => (
          <div key={r.field} role="row" style={{ display: "grid", gridTemplateColumns: template, gap: "var(--space-4)", alignItems: "center", padding: "0 var(--space-5)", minHeight: 42, borderBottom: "1px solid var(--border-subtle)", background: r.differ ? "var(--status-conflict-fill)" : "transparent" }}>
            <span style={{ font: "var(--text-sm)/1.3 var(--font-mono)", color: "var(--text-primary)" }}>{r.field}</span>
            <SnapshotValue value={r.iv} differ={r.differ} side="internal" />
            <span style={{ display: "grid", placeItems: "center", color: r.differ ? "var(--status-conflict-fg)" : "var(--text-faint)" }}>
              <Icon name={r.differ ? "ArrowLeftRight" : "Equal"} size={13} />
            </span>
            <SnapshotValue value={r.qv} differ={r.differ} side="qbo" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</div>
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  );
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: link, loading, error, reload } = useApi<LinkDetailView>(() => api.getLink(id), [id]);
  useTick(1000);

  if (loading && !link) {
    return (
      <>
        <PageHeader title="Loading…" />
        <div style={{ padding: "var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <Skeleton w="100%" h={64} r="var(--radius-lg)" />
          <Skeleton w="100%" h={260} r="var(--radius-lg)" />
        </div>
      </>
    );
  }
  if (error || !link) {
    return (
      <>
        <PageHeader title="Invoice" />
        <div style={{ padding: "var(--space-7)" }}>
          <Card><StateBlock icon="WifiOff" title="Couldn't load this link" body={error ? String(error.message) : "Not found"} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={reload}>Retry</Button>} /></Card>
        </div>
      </>
    );
  }

  const actions = (
    <>
      <Button variant="ghost" size="md" leadingIcon={<Icon name="ArrowLeft" size={15} />} onClick={() => router.push("/invoices")}>Back</Button>
      {link.status === "conflict" && <Button variant="primary" size="md" leadingIcon={<Icon name="GitMerge" size={15} />} onClick={() => router.push("/conflicts")}>Resolve conflict</Button>}
    </>
  );

  return (
    <>
      <PageHeader eyebrow={link.entityType} title={link.internalId ?? id} description="Field-level comparison between the internal record and its QuickBooks Online counterpart." actions={actions} />
      <div style={{ padding: "var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexWrap: "wrap" }}>
            <SummaryItem label="Status"><LinkStatusPill status={link.status} size="md" /></SummaryItem>
            <SummaryItem label="Internal"><span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{link.internalId}</span></SummaryItem>
            <SummaryItem label="QuickBooks"><span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: link.qboId ? "var(--text-primary)" : "var(--text-faint)", whiteSpace: "nowrap" }}>{link.qboId ?? "not created"}</span></SummaryItem>
            <SummaryItem label="Drift"><DriftIndicator drift={link.drift} /></SummaryItem>
            <SummaryItem label="Last synced"><span title={link.lastSyncedAt ?? undefined} style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-secondary)" }}>{timeAgo(link.lastSyncedAt)}</span></SummaryItem>
          </div>
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: "var(--space-5)", alignItems: "start" }}>
          <DiffViewer internal={link.internalSnapshot} qbo={link.qboSnapshot} />
          <Card title="Recent changes" description="Audit trail for this entity">
            <Timeline items={link.timeline} />
          </Card>
        </div>
      </div>
    </>
  );
}
