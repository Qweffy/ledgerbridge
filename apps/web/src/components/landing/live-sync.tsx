"use client";
/* Landing — the #live split-screen sync view (Internal | QuickBooks). A phased
   tick walks an invoice across the bridge: queued → inflight → synced. Ported from
   livesync.jsx; the tick lives in an effect (client-only) so SSR never reads
   window, and it respects prefers-reduced-motion. */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { SyncStatus } from "@ledgerbridge/shared";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Icon } from "@/components/dashboard/icon";
import { eyebrow } from "./shared";

interface Invoice { inv: string; cust: string; amt: string }

const INVOICES: Invoice[] = [
  { inv: "INV-20296", cust: "Globex Corp", amt: "$84,205.18" },
  { inv: "INV-20297", cust: "Acme Robotics", amt: "$1,009.50" },
  { inv: "INV-20298", cust: "Initech", amt: "$540.00" },
  { inv: "INV-20299", cust: "Soylent Inc", amt: "$7,250.00" },
];
const PHASES: SyncStatus[] = ["queued", "inflight", "synced"];

function SystemTag({ source }: { source: "internal" | "qbo" }) {
  const qbo = source === "qbo";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "var(--fw-semibold) var(--text-sm)/1 var(--font-sans)", color: qbo ? "var(--system-quickbooks-fg)" : "var(--system-internal-fg)", whiteSpace: "nowrap" }}>
      <Icon name={qbo ? "Landmark" : "Building2"} size={16} /> {qbo ? "QuickBooks Online" : "Internal invoicing"}
    </span>
  );
}

function InvoiceCard({ data, status, dim }: { data: Invoice; status: SyncStatus | null; dim?: boolean }) {
  return (
    <div style={{ padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)", opacity: dim ? 0.5 : 1, transition: "opacity var(--dur-normal) var(--ease-out)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ font: "var(--fw-medium) var(--text-sm)/1 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{data.inv}</span>
        {status ? <StatusBadge status={status} size="sm" /> : <span style={{ font: "var(--text-2xs)/1 var(--font-sans)", color: "var(--text-faint)" }}>source</span>}
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ font: "var(--text-sm)/1 var(--font-sans)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{data.cust}</span>
        <span style={{ font: "var(--fw-medium) var(--text-sm)/1 var(--font-mono)", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{data.amt}</span>
      </div>
    </div>
  );
}

function Panel({ source, children }: { source: "internal" | "qbo"; children: ReactNode }) {
  return (
    <Card padded={false} style={{ background: "var(--surface-card)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-subtle)" }}>
        <SystemTag source={source} />
      </div>
      <div style={{ padding: "var(--space-4)" }}>{children}</div>
    </Card>
  );
}

function Bridge({ phase }: { phase: SyncStatus }) {
  const inflight = phase === "inflight";
  return (
    <div className="lb-arch-bridge" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 150, padding: "0 6px" }}>
      <div style={{ position: "relative", width: "100%", height: 2, background: "var(--border-default)", borderRadius: 2 }}>
        {inflight && <span style={{ position: "absolute", top: -3, width: 8, height: 8, borderRadius: 999, background: "var(--status-inflight-solid)", boxShadow: "0 0 8px var(--status-inflight-solid)", animation: "lb-travel 1.5s var(--ease-in-out) infinite" }} />}
      </div>
      <div style={{ marginTop: 12 }}>
        <StatusBadge status={phase} size="sm" />
      </div>
      <div style={{ marginTop: 8, font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-faint)" }}>
        {phase === "queued" ? "outbox" : phase === "inflight" ? "applying" : "committed"}
      </div>
    </div>
  );
}

// Read prefers-reduced-motion without setState-in-effect (React-Compiler-clean);
// the server snapshot is false so SSR renders the animated initial frame.
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function LiveSync() {
  const reduced = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, [reduced]);

  const phase = reduced ? "synced" : (PHASES[tick % 3] ?? "synced");
  const data = reduced ? INVOICES[0]! : (INVOICES[Math.floor(tick / 3) % INVOICES.length] ?? INVOICES[0]!);

  return (
    <section id="live" style={{ padding: "92px 0", borderTop: "1px solid var(--border-subtle)", scrollMarginTop: 70 }}>
      <div className="lb-wrap">
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={eyebrow}>Live sync</div>
          <h2 style={{ margin: "12px auto 0", maxWidth: 620, font: "var(--fw-semibold) var(--text-4xl)/1.1 var(--font-sans)", letterSpacing: "-0.02em", color: "var(--text-strong)" }}>Watch an invoice cross the bridge</h2>
          <p style={{ margin: "14px auto 0", maxWidth: 540, font: "var(--text-md)/1.55 var(--font-sans)", color: "var(--text-muted)", textWrap: "pretty" }}>An event leaves your internal system, lands in the durable outbox, is mapped and applied to QuickBooks — exactly once.</p>
        </div>
        <div className="lb-stack" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Panel source="internal"><InvoiceCard data={data} status={null} /></Panel>
          <Bridge phase={phase} />
          <Panel source="qbo"><InvoiceCard data={data} status={phase} dim={phase === "queued"} /></Panel>
        </div>
      </div>
    </section>
  );
}
