/* Landing — the #architecture diagram: ingest → durable outbox + leased worker →
   map / conflict-resolve / apply → QBO, plus the periodic reconciler closing the
   loop (animated dashed connector). Ported from architecture.jsx. */
import { Icon } from "@/components/dashboard/icon";
import { eyebrow } from "./shared";

function Node({ icon, title, sub, fill, fg }: { icon: string; title: string; sub: string; fill: string; fg: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, padding: "var(--space-4)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--ring-inset-top)" }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: fill, color: fg, marginBottom: 10 }}><Icon name={icon} size={16} stroke={2} /></span>
      <div style={{ font: "var(--fw-semibold) var(--text-sm)/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{title}</div>
      <div style={{ marginTop: 4, font: "var(--text-xs)/1.45 var(--font-sans)", color: "var(--text-muted)", textWrap: "pretty" }}>{sub}</div>
    </div>
  );
}

function Bridge() {
  return (
    <div className="lb-arch-bridge" style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center", justifyContent: "center", color: "var(--text-faint)" }}>
      <Icon name="ArrowRight" size={16} />
      <Icon name="ArrowLeft" size={16} />
    </div>
  );
}

function MiniStage({ icon, title, fg }: { icon: string; title: string; fg: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 7, padding: "12px 12px", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
      <Icon name={icon} size={15} color={fg} />
      <span style={{ font: "var(--fw-medium) var(--text-xs)/1.2 var(--font-sans)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{title}</span>
    </div>
  );
}

function Pipeline() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: "var(--radius-xl)", border: "1px dashed var(--border-default)", background: "var(--surface-sunken)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "var(--space-3) var(--space-3)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--blue-tint)", color: "var(--accent)", flexShrink: 0 }}><Icon name="DatabaseZap" size={16} /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "var(--fw-semibold) var(--text-sm)/1.2 var(--font-sans)", color: "var(--text-strong)" }}>Durable outbox + leased worker</div>
          <div style={{ marginTop: 3, font: "var(--text-xs)/1.4 var(--font-sans)", color: "var(--text-muted)" }}>Append-only, deduped by event key. A single leased worker drains it in order.</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <MiniStage icon="Shuffle" title="Map" fg="var(--status-inflight-fg)" />
        <Icon name="ChevronRight" size={14} color="var(--text-faint)" />
        <MiniStage icon="GitMerge" title="Conflict-resolve" fg="var(--status-conflict-fg)" />
        <Icon name="ChevronRight" size={14} color="var(--text-faint)" />
        <MiniStage icon="Upload" title="Apply" fg="var(--accent)" />
      </div>
    </div>
  );
}

function Reconciler() {
  return (
    <div style={{ marginTop: 18, position: "relative" }}>
      <svg viewBox="0 0 1000 36" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 36 }} aria-hidden="true">
        <path d="M 120 2 C 120 28, 500 34, 500 34 C 500 34, 880 28, 880 2" fill="none" stroke="var(--border-default)" strokeWidth="1.5" strokeDasharray="5 5" style={{ animation: "lb-dash 1.2s linear infinite" }} />
        <path d="M 116 9 L 120 1 L 124 9" fill="none" stroke="var(--border-default)" strokeWidth="1.5" />
        <path d="M 876 9 L 880 1 L 884 9" fill="none" stroke="var(--border-default)" strokeWidth="1.5" />
      </svg>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "var(--space-3) var(--space-5)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--ring-inset-top)", maxWidth: 560 }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--violet-tint)", color: "var(--status-replayed-fg)", flexShrink: 0 }}><Icon name="RefreshCw" size={16} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ font: "var(--fw-semibold) var(--text-sm)/1.2 var(--font-sans)", color: "var(--text-strong)", whiteSpace: "nowrap" }}>Periodic reconciler</span>
              <span style={{ font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>every 5 min</span>
            </div>
            <div style={{ marginTop: 3, font: "var(--text-xs)/1.45 var(--font-sans)", color: "var(--text-muted)" }}>Field-level diff against QBO catches missed webhooks and silent drift — opening a conflict only on true divergence.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Architecture() {
  return (
    <section id="architecture" style={{ padding: "92px 0", borderTop: "1px solid var(--border-subtle)", scrollMarginTop: 70 }}>
      <div className="lb-wrap">
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={eyebrow}>Architecture</div>
          <h2 style={{ margin: "12px auto 0", maxWidth: 580, font: "var(--fw-semibold) var(--text-4xl)/1.1 var(--font-sans)", letterSpacing: "-0.02em", color: "var(--text-strong)" }}>A durable pipe between two ledgers</h2>
          <p style={{ margin: "14px auto 0", maxWidth: 540, font: "var(--text-md)/1.55 var(--font-sans)", color: "var(--text-muted)", textWrap: "pretty" }}>Every write goes through a durable outbox and a single leased worker, so duplicate and out-of-order events can never double-apply.</p>
        </div>
        <div className="lb-arch">
          <Node icon="Webhook" title="Ingest" sub="Internal invoicing emits invoice events over webhooks." fill="var(--blue-tint)" fg="var(--system-internal-fg)" />
          <Bridge />
          <Pipeline />
          <Bridge />
          <Node icon="Landmark" title="QuickBooks Online" sub="Writes land exactly once; reads reconcile back upstream." fill="var(--green-tint)" fg="var(--system-quickbooks-fg)" />
        </div>
        <Reconciler />
      </div>
    </section>
  );
}
