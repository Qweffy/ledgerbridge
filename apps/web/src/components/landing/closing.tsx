/* Landing — Reliability cards, tech stack, closing CTA, footer. Ported from
   closing.jsx. */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/icon";
import { eyebrow, GITHUB_URL } from "./shared";

interface FeatureItem { icon: string; title: string; body: string; fill: string; fg: string }

const FEATURES: FeatureItem[] = [
  { icon: "CopyMinus", title: "Idempotency", body: "Duplicate and replayed events collapse to a single QBO mutation, keyed by event ID — no double-billing, ever.", fill: "var(--green-tint)", fg: "var(--status-synced-fg)" },
  { icon: "GitMerge", title: "Conflict resolution", body: "Last-writer-wins by default, with a flag when both sides truly diverge — surfaced field-by-field for a one-click call.", fill: "var(--amber-tint)", fg: "var(--status-conflict-fg)" },
  { icon: "RotateCcw", title: "Retries + dead-letter", body: "Exponential backoff on transient failures, then a replayable dead-letter queue. Nothing is silently dropped.", fill: "var(--red-tint)", fg: "var(--status-failed-fg)" },
  { icon: "ScrollText", title: "Auditability", body: "Every state transition — automated or human — is recorded with actor, before/after and correlation ID.", fill: "var(--violet-tint)", fg: "var(--status-replayed-fg)" },
];

function Feature({ icon, title, body, fill, fg }: FeatureItem) {
  return (
    <div style={{ padding: "20px 18px", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--ring-inset-top)" }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: fill, color: fg, marginBottom: 14 }}><Icon name={icon} size={17} /></span>
      <div style={{ font: "var(--fw-semibold) var(--text-md)/1.3 var(--font-sans)", color: "var(--text-strong)", letterSpacing: "-0.01em" }}>{title}</div>
      <p style={{ margin: "7px 0 0", font: "var(--text-sm)/1.55 var(--font-sans)", color: "var(--text-muted)", textWrap: "pretty" }}>{body}</p>
    </div>
  );
}

export function Reliability() {
  return (
    <section id="reliability" style={{ padding: "92px 0", borderTop: "1px solid var(--border-subtle)", scrollMarginTop: 70 }}>
      <div className="lb-wrap">
        <div style={{ marginBottom: 40, maxWidth: 560 }}>
          <div style={eyebrow}>Reliability</div>
          <h2 style={{ margin: "12px 0 0", font: "var(--fw-semibold) var(--text-4xl)/1.1 var(--font-sans)", letterSpacing: "-0.02em", color: "var(--text-strong)" }}>Calm under partial failure</h2>
        </div>
        <div className="lb-grid4">
          {FEATURES.map((it) => <Feature key={it.title} {...it} />)}
        </div>
      </div>
    </section>
  );
}

const STACK: [string, string][] = [
  ["Hexagon", "Next.js 16"], ["FileCode2", "TypeScript"], ["Wind", "Tailwind v4"],
  ["Component", "shadcn/ui"], ["Database", "Postgres outbox"], ["Landmark", "QuickBooks API"],
];

export function TechStack() {
  return (
    <section style={{ padding: "0 0 92px" }}>
      <div className="lb-wrap" style={{ textAlign: "center" }}>
        <div style={{ font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 20 }}>Built on a boring, durable stack</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {STACK.map(([icon, label]) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: "var(--radius-pill)", border: "1px solid var(--border-default)", background: "var(--surface-card)", font: "var(--fw-medium) var(--text-sm)/1 var(--font-sans)", color: "var(--text-secondary)" }}>
              <Icon name={icon} size={15} color="var(--text-muted)" /> {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CTA() {
  return (
    <section style={{ padding: "0 0 96px", borderTop: "1px solid var(--border-subtle)", paddingTop: 56 }}>
      <div className="lb-wrap">
        <div style={{ position: "relative", overflow: "hidden", padding: "56px 40px", borderRadius: "var(--radius-2xl)", border: "1px solid var(--border-default)", background: "var(--surface-card)", textAlign: "center" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(70% 130% at 50% 0%, var(--blue-tint), transparent 70%)", pointerEvents: "none" }} />
          <h2 style={{ position: "relative", margin: 0, font: "var(--fw-semibold) var(--text-3xl)/1.15 var(--font-sans)", letterSpacing: "-0.02em", color: "var(--text-strong)" }}>Put your invoice sync on solid ground.</h2>
          <p style={{ position: "relative", margin: "12px auto 0", maxWidth: 480, font: "var(--text-md)/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>Open the operational dashboard, or read the source. Everything runs on mock data out of the box.</p>
          <div style={{ position: "relative", display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 26 }}>
            <Link href="/dashboard" style={{ textDecoration: "none" }}><Button variant="primary" size="lg" trailingIcon={<Icon name="ArrowRight" size={16} />}>Open the dashboard</Button></Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Button variant="secondary" size="lg" leadingIcon={<Icon name="Github" size={16} />}>View on GitHub</Button></a>
          </div>
        </div>
      </div>
    </section>
  );
}

const FOOTER_COLS: [string, [string, string][]][] = [
  ["Product", [["Live sync", "#live"], ["Architecture", "#architecture"], ["Reliability", "#reliability"], ["Dashboard", "/dashboard"]]],
  ["Developers", [["Docs", "#"], ["API reference", "#"], ["Webhooks", "#"], ["GitHub", GITHUB_URL]]],
  ["Company", [["About", "#"], ["Security", "#"], ["Status", "#"], ["Contact", "#"]]],
];

export function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-panel)" }}>
      <div className="lb-wrap lb-foot" style={{ padding: "48px 24px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: "var(--accent)", color: "var(--accent-fg)", display: "grid", placeItems: "center" }}><Icon name="ArrowLeftRight" size={14} stroke={2} /></span>
            <span style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--text-strong)" }}>LedgerBridge</span>
          </div>
          <p style={{ margin: 0, font: "var(--text-xs)/1.6 var(--font-sans)", color: "var(--text-faint)", maxWidth: 240 }}>Two-way invoice sync between your internal systems and QuickBooks Online.</p>
        </div>
        {FOOTER_COLS.map(([h, links]) => (
          <div key={h}>
            <div style={{ font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", color: "var(--text-secondary)", marginBottom: 12 }}>{h}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {links.map(([l, href]) => <a key={l} href={href} style={{ font: "var(--text-sm)/1 var(--font-sans)", color: "var(--text-muted)", textDecoration: "none" }}>{l}</a>)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <div className="lb-wrap" style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ font: "var(--text-xs)/1 var(--font-sans)", color: "var(--text-faint)" }}>© 2026 LedgerBridge, Inc.</span>
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "var(--text-xs)/1 var(--font-sans)", color: "var(--text-muted)" }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--status-synced-solid)" }} />All systems operational</span>
        </div>
      </div>
    </footer>
  );
}
