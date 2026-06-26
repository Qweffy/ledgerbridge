/* Dashboard widgets ported from the bundle's components.jsx — metric tiles, the
   lag gauge, the health banner, status/system badges, skeletons. Pure components
   (the consuming screen owns the polling + live-time ticking). */
import type { CSSProperties, ReactNode } from "react";
import type { DashboardSource, EventStatus, SyncStatus } from "@ledgerbridge/shared";
import type { StatusDto } from "@ledgerbridge/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { timeAgo } from "@/lib/api/time";
import { Icon } from "./icon";

export function Skeleton({ w = "100%", h = 12, r = "var(--radius-sm)", style }: { w?: number | string; h?: number; r?: string; style?: CSSProperties }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: r, background: "var(--surface-hover)", animation: "lb-shimmer 1.4s var(--ease-in-out) infinite", ...style }} />;
}

export function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// event lifecycle → StatusBadge vocabulary
const EVENT_STATUS: Record<EventStatus, SyncStatus> = {
  pending: "queued",
  processing: "inflight",
  done: "synced",
  dead: "deadletter",
};

export function EventStatusPill({ status, size = "sm" }: { status: EventStatus; size?: "sm" | "md" }) {
  return <StatusBadge status={EVENT_STATUS[status] ?? "queued"} size={size} />;
}

export function SystemBadge({ source, size = "sm" }: { source: DashboardSource; size?: "sm" | "md" }) {
  const qbo = source === "qbo";
  const fg = qbo ? "var(--system-quickbooks-fg)" : "var(--system-internal-fg)";
  const bg = qbo ? "var(--system-quickbooks-bg)" : "var(--system-internal-bg)";
  const sm = size === "sm";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: sm ? 18 : 20, padding: sm ? "0 7px" : "0 8px", borderRadius: "var(--radius-sm)", background: bg, color: fg, font: `var(--fw-medium) ${sm ? "var(--text-2xs)" : "var(--text-xs)"}/1 var(--font-sans)`, whiteSpace: "nowrap" }}>
      <Icon name={qbo ? "Landmark" : "Building2"} size={sm ? 11 : 12} />
      {qbo ? "QuickBooks" : "Internal"}
    </span>
  );
}

export function MetricTile({ label, value, unit, icon, accent = "var(--text-faint)", children, style }: { label: string; value?: ReactNode; unit?: string; icon?: string; accent?: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4) var(--space-5)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--ring-inset-top)", minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-muted)" }}>
        {icon && <span style={{ display: "inline-flex", color: accent, flexShrink: 0 }}><Icon name={icon} size={14} /></span>}
        <span style={{ font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", letterSpacing: "0.01em", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      {children ?? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ font: "var(--fw-semibold) var(--text-2xl)/1 var(--font-mono)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{value}</span>
          {unit && <span style={{ font: "var(--fw-regular) var(--text-sm)/1 var(--font-sans)", color: "var(--text-faint)" }}>{unit}</span>}
        </div>
      )}
    </div>
  );
}

function lagTone(sec: number): { fg: string; solid: string; word: string } {
  if (sec >= 120) return { fg: "var(--status-failed-fg)", solid: "var(--status-failed-solid)", word: "high" };
  if (sec >= 30) return { fg: "var(--status-conflict-fg)", solid: "var(--status-conflict-solid)", word: "elevated" };
  return { fg: "var(--status-synced-fg)", solid: "var(--status-synced-solid)", word: "nominal" };
}

export function LagGauge({ seconds }: { seconds: number | null }) {
  const s = seconds ?? 0;
  const t = lagTone(s);
  const pct = Math.max(4, Math.min(100, Math.round((s / 180) * 100)));
  return (
    <MetricTile label="Oldest lag" icon="Timer" accent={t.fg}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ font: "var(--fw-semibold) var(--text-2xl)/1 var(--font-mono)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{fmtDuration(seconds)}</span>
        <span style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", color: t.fg, marginLeft: 2 }}>{t.word}</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--surface-hover)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: t.solid, borderRadius: 999, transition: "width var(--dur-normal) var(--ease-out)" }} />
      </div>
    </MetricTile>
  );
}

type HealthTone = "failed" | "conflict" | "synced";
function deriveHealth(s: StatusDto): { level: string; tone: HealthTone; icon: string } {
  const lag = s.oldestPendingLagSec ?? 0;
  if (s.deadLetterCount >= 5 || lag >= 300) return { level: "At risk", tone: "failed", icon: "AlertOctagon" };
  if (s.deadLetterCount > 0 || s.conflictCount > 0 || lag >= 60) return { level: "Degraded", tone: "conflict", icon: "AlertTriangle" };
  return { level: "Healthy", tone: "synced", icon: "CheckCircle2" };
}

export function HealthIndicator({ status }: { status: StatusDto }) {
  const h = deriveHealth(status);
  const fg = `var(--status-${h.tone}-fg)`;
  const fill = `var(--status-${h.tone}-fill)`;
  const solid = `var(--status-${h.tone}-solid)`;
  const lag = status.oldestPendingLagSec ?? 0;
  const reasons: { icon: string; text: string }[] = [];
  if (status.conflictCount > 0) reasons.push({ icon: "GitMerge", text: `${status.conflictCount} unresolved conflict${status.conflictCount > 1 ? "s" : ""}` });
  if (status.deadLetterCount > 0) reasons.push({ icon: "Inbox", text: `${status.deadLetterCount} dead-lettered job${status.deadLetterCount > 1 ? "s" : ""}` });
  if (lag >= 30) reasons.push({ icon: "Timer", text: `lag ${fmtDuration(status.oldestPendingLagSec)}` });
  if (reasons.length === 0) reasons.push({ icon: "Check", text: "every event reconciled cleanly" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", flexWrap: "wrap", padding: "var(--space-4) var(--space-5)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--ring-inset-top)" }}>
      <span style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: fill, color: fg, flexShrink: 0 }}>
        <Icon name={h.icon} size={20} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: "var(--fw-semibold) var(--text-lg)/1 var(--font-sans)", color: "var(--text-strong)", letterSpacing: "-0.01em" }}>{h.level}</span>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: solid }} />
        </div>
        <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {reasons.map((r, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "var(--text-xs)/1 var(--font-sans)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              <Icon name={r.icon} size={13} color="var(--text-faint)" />
              {r.text}
            </span>
          ))}
        </div>
      </div>
      <div style={{ marginLeft: "auto", textAlign: "right", flexShrink: 0 }}>
        <div style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)", whiteSpace: "nowrap" }}>Last reconcile</div>
        <div style={{ marginTop: 5, font: "var(--fw-medium) var(--text-sm)/1 var(--font-mono)", color: "var(--text-secondary)" }}>{timeAgo(status.lastReconcileAt)}</div>
      </div>
    </div>
  );
}
