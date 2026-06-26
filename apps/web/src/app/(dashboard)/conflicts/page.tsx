"use client";
/* /conflicts — queue of conflicted links (GET /conflicts). Selecting one opens a
   right Sheet (GET /conflicts/:id) with a before/after diff and a Resolve action
   that picks the winning side (POST /conflicts/:id/resolve). */
import { useState, type ReactNode } from "react";
import type { ConflictDto, DashboardSource } from "@ledgerbridge/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Icon } from "@/components/dashboard/icon";
import { PageHeader } from "@/components/dashboard/page-header";
import { StateBlock } from "@/components/dashboard/state-block";
import { Skeleton, SystemBadge } from "@/components/dashboard/widgets";
import { ConfirmDialog, Sheet, showToast } from "@/components/dashboard/overlays";
import { api, type ConflictDetailView } from "@/lib/api/client";
import { useApi, useTick } from "@/lib/api/hooks";
import { timeAgo } from "@/lib/api/time";

function FieldChip({ children }: { children: ReactNode }) {
  return <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 6px", borderRadius: "var(--radius-xs)", background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)", font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{children}</span>;
}

function ConflictRow({ c, onOpen }: { c: ConflictDto; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(c.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(c.id); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-4) var(--space-5)", borderBottom: "1px solid var(--border-subtle)", background: hover ? "var(--surface-hover)" : "transparent", cursor: "pointer", transition: "background var(--dur-fast)" }}
    >
      <span style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--status-conflict-fill)", color: "var(--status-conflict-fg)", flexShrink: 0 }}>
        <Icon name="GitMerge" size={16} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ font: "var(--fw-medium) var(--text-sm)/1 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{c.internalId}</span>
          <StatusBadge status="conflict" label="Conflict" size="sm" />
          <span style={{ font: "var(--text-xs)/1 var(--font-sans)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{c.customer}</span>
        </div>
        <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ font: "var(--text-xs)/1 var(--font-sans)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{c.reason}</span>
          {c.conflictingFields.length > 0 && <span style={{ color: "var(--text-faint)" }}>·</span>}
          {c.conflictingFields.map((f) => <FieldChip key={f}>{f}</FieldChip>)}
        </div>
      </div>
      <span title={c.openedAt ?? undefined} style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap", flexShrink: 0 }}>{timeAgo(c.openedAt)}</span>
      <Icon name="ChevronRight" size={16} color="var(--text-faint)" />
    </div>
  );
}

function SideHeader({ side, selected, onSelect }: { side: DashboardSource; selected: boolean; onSelect: (s: DashboardSource) => void }) {
  const accent = side === "internal" ? "var(--system-internal-fg)" : "var(--system-quickbooks-fg)";
  return (
    <button type="button" onClick={() => onSelect(side)} aria-pressed={selected} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: "var(--radius-md)", cursor: "pointer", background: selected ? "var(--surface-active)" : "var(--surface-card)", border: `1px solid ${selected ? accent : "var(--border-default)"}`, boxShadow: selected ? `0 0 0 1px ${accent}` : "none", transition: "border-color var(--dur-fast), box-shadow var(--dur-fast), background var(--dur-fast)" }}>
      <span style={{ width: 16, height: 16, borderRadius: 999, border: `2px solid ${selected ? accent : "var(--border-strong)"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
        {selected && <span style={{ width: 7, height: 7, borderRadius: 999, background: accent }} />}
      </span>
      <SystemBadge source={side} size="md" />
      <span style={{ marginLeft: "auto", font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", color: selected ? accent : "var(--text-faint)" }}>{selected ? "Winner" : "Keep"}</span>
    </button>
  );
}

function WinnerDiff({ detail, winner, onWinner }: { detail: ConflictDetailView; winner: DashboardSource | null; onWinner: (s: DashboardSource) => void }) {
  const conflicting = new Set(detail.conflictingFields ?? []);
  const keys: string[] = [];
  Object.keys(detail.before ?? {}).forEach((k) => keys.push(k));
  Object.keys(detail.after ?? {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
  const head = { font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase" as const, color: "var(--text-faint)" };
  const template = "minmax(110px,0.7fr) minmax(0,1fr) minmax(0,1fr)";
  const winCol = (col: DashboardSource) => (winner === col ? { boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${col === "internal" ? "var(--system-internal-fg)" : "var(--system-quickbooks-fg)"} 50%, transparent)`, borderRadius: "var(--radius-sm)" } : undefined);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <SideHeader side="internal" selected={winner === "internal"} onSelect={onWinner} />
        <SideHeader side="qbo" selected={winner === "qbo"} onSelect={onWinner} />
      </div>
      <div role="table" style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        <div role="row" style={{ display: "grid", gridTemplateColumns: template, gap: "var(--space-3)", alignItems: "center", padding: "0 var(--space-4)", height: 30, borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
          <span style={head}>Field</span>
          <span style={{ ...head, color: "var(--system-internal-fg)" }}>Internal</span>
          <span style={{ ...head, color: "var(--system-quickbooks-fg)" }}>QuickBooks</span>
        </div>
        {keys.map((k) => {
          const clash = conflicting.has(k);
          const iv = detail.before && k in detail.before ? String(detail.before[k]) : null;
          const qv = detail.after && k in detail.after ? String(detail.after[k]) : null;
          const cell = (val: string | null, col: DashboardSource) => (
            <span style={{ ...winCol(col), padding: "3px 6px", font: `${clash ? "var(--fw-medium)" : "var(--fw-regular)"} var(--text-sm)/1.3 var(--font-mono)`, color: clash ? (col === "internal" ? "var(--system-internal-fg)" : "var(--system-quickbooks-fg)") : "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{val ?? "absent"}</span>
          );
          return (
            <div key={k} role="row" style={{ display: "grid", gridTemplateColumns: template, gap: "var(--space-3)", alignItems: "center", padding: "8px var(--space-4)", borderBottom: "1px solid var(--border-subtle)", background: clash ? "var(--status-conflict-fill)" : "transparent" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "var(--text-sm)/1.3 var(--font-mono)", color: "var(--text-primary)" }}>
                {clash && <Icon name="GitMerge" size={12} color="var(--status-conflict-fg)" />}{k}
              </span>
              {cell(iv, "internal")}
              {cell(qv, "qbo")}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConflictSheet({ id, onClose, onResolved }: { id: string; onClose: () => void; onResolved: (id: string) => void }) {
  const { data: detail, loading, error, reload } = useApi<ConflictDetailView>(() => api.getConflict(id), [id]);
  const [winner, setWinner] = useState<DashboardSource | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [resolving, setResolving] = useState(false);
  const label = (w: DashboardSource | null) => (w === "internal" ? "Internal" : "QuickBooks");

  const doResolve = () => {
    if (!winner) return;
    setResolving(true);
    api.resolveConflict(id, winner).then(
      () => { setResolving(false); setConfirm(false); showToast(`Conflict resolved — kept ${label(winner)}`, "success"); onResolved(id); },
      (err: unknown) => { setResolving(false); setConfirm(false); showToast(`Couldn't resolve: ${err instanceof Error ? err.message : String(err)}`, "error"); },
    );
  };

  const footer = detail ? (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <span style={{ font: "var(--text-xs)/1.3 var(--font-sans)", color: "var(--text-muted)", flex: 1 }}>{winner ? `${label(winner)} wins — the other system will be overwritten.` : "Pick the winning side to resolve."}</span>
      <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
      <Button variant="primary" size="md" disabled={!winner} leadingIcon={<Icon name="Check" size={15} />} onClick={() => setConfirm(true)}>Resolve</Button>
    </div>
  ) : null;

  return (
    <>
      <Sheet open onClose={onClose} subtitle="Resolve conflict" title={detail ? (detail.internalId ?? id) : loading ? "Loading…" : "Conflict"} headerAccessory={detail ? <StatusBadge status="conflict" label="Conflict" size="sm" /> : undefined} footer={footer}>
        {loading && !detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <Skeleton w="60%" h={14} /><Skeleton w="100%" h={64} r="var(--radius-md)" /><Skeleton w="100%" h={180} r="var(--radius-md)" />
          </div>
        )}
        {error && <StateBlock icon="WifiOff" title="Couldn't load conflict" body={String(error.message)} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={reload}>Retry</Button>} />}
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "var(--fw-medium) var(--text-sm)/1 var(--font-sans)", color: "var(--text-primary)" }}>
                <Icon name="GitMerge" size={15} color="var(--status-conflict-fg)" />{detail.reason}
              </span>
              <span style={{ color: "var(--text-faint)" }}>·</span>
              <span style={{ font: "var(--text-xs)/1 var(--font-sans)", color: "var(--text-muted)" }}>{detail.customer}</span>
              <span style={{ color: "var(--text-faint)" }}>·</span>
              <span title={detail.openedAt ?? undefined} style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)" }}>opened {timeAgo(detail.openedAt)}</span>
            </div>
            <WinnerDiff detail={detail} winner={winner} onWinner={setWinner} />
          </div>
        )}
      </Sheet>
      <ConfirmDialog open={confirm} loading={resolving} title={`Keep ${label(winner)}?`} body={`LedgerBridge will write the ${label(winner)} values to the other system and close this conflict. This can't be undone automatically.`} confirmLabel="Resolve conflict" onConfirm={doResolve} onCancel={() => setConfirm(false)} />
    </>
  );
}

export default function ConflictsPage() {
  const { data, loading, error, reload } = useApi(() => api.getConflicts(), [], { pollMs: 5000 });
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useTick(1000);
  const visible = (data ?? []).filter((c) => !removed.has(c.id));

  const onResolved = (id: string) => {
    setRemoved((s) => { const n = new Set(s); n.add(id); return n; });
    setSelectedId(null);
  };

  let body: ReactNode;
  if (loading && !data) {
    body = (
      <div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-4) var(--space-5)", borderBottom: "1px solid var(--border-subtle)" }}>
            <Skeleton w={32} h={32} r="var(--radius-md)" /><div style={{ flex: 1 }}><Skeleton w="40%" h={13} /><Skeleton w="65%" h={11} style={{ marginTop: 8 }} /></div>
          </div>
        ))}
      </div>
    );
  } else if (error) {
    body = <StateBlock icon="WifiOff" title="Couldn't load conflicts" body={String(error.message)} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={reload}>Retry</Button>} />;
  } else if (visible.length === 0) {
    body = <StateBlock icon="CheckCircle2" title="No conflicts — everything in sync" body="Every event reconciled cleanly. New conflicts will queue here for review." />;
  } else {
    body = <div>{visible.map((c) => <ConflictRow key={c.id} c={c} onOpen={setSelectedId} />)}</div>;
  }

  return (
    <>
      <PageHeader title="Conflicts" description={visible.length > 0 ? `You have ${visible.length} unresolved conflict${visible.length > 1 ? "s" : ""} awaiting a decision.` : "Conflicts surface when both systems edit the same record. Resolve them by picking a winning side."} />
      <div style={{ padding: "var(--space-7)" }}>
        <Card padded={false}>{body}</Card>
      </div>
      {selectedId && <ConflictSheet key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} onResolved={onResolved} />}
    </>
  );
}
