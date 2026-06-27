"use client";
/* Landing — Nav + Hero. Ported from the bundle's sections.jsx; the theme toggle
   uses next-themes (CSS-driven Moon/Sun, no hydration mismatch) instead of the
   bundle's localStorage approach. */
import Link from "next/link";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/icon";
import { GITHUB_URL } from "./shared";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")}
      aria-label="Toggle theme"
      title="Toggle theme"
      style={{ width: 32, height: 32, display: "grid", placeItems: "center", background: "transparent", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", color: "var(--text-muted)", cursor: "pointer" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span className="hidden dark:block"><Icon name="Moon" size={16} /></span>
      <span className="block dark:hidden"><Icon name="Sun" size={16} /></span>
    </button>
  );
}

const NAV_LINKS: [string, string][] = [["Live sync", "#live"], ["Architecture", "#architecture"], ["Reliability", "#reliability"]];

export function Nav() {
  return (
    <nav style={{ position: "sticky", top: 0, zIndex: 20, borderBottom: "1px solid var(--border-subtle)", background: "color-mix(in oklch, var(--surface-canvas) 78%, transparent)", backdropFilter: "blur(10px)" }}>
      <div className="lb-wrap" style={{ height: 60, display: "flex", alignItems: "center", gap: 22 }}>
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--accent)", color: "var(--accent-fg)", display: "grid", placeItems: "center" }}><Icon name="ArrowLeftRight" size={15} stroke={2} /></span>
          <span style={{ font: "var(--fw-semibold) 15px/1 var(--font-sans)", letterSpacing: "-0.01em", color: "var(--text-strong)" }}>Ledger<span style={{ color: "var(--accent)" }}>Bridge</span></span>
        </a>
        <div className="lb-nav-links" style={{ marginLeft: 6 }}>
          {NAV_LINKS.map(([l, href]) => <a key={l} href={href} style={{ padding: "6px 10px", borderRadius: 6, font: "var(--font-ui)", color: "var(--text-muted)", textDecoration: "none", whiteSpace: "nowrap" }}>{l}</a>)}
        </div>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub" style={{ width: 32, height: 32, display: "grid", placeItems: "center", background: "transparent", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", color: "var(--text-muted)" }}>
          <Icon name="Github" size={16} />
        </a>
        <Link href="/dashboard" style={{ textDecoration: "none" }}>
          <Button variant="primary" size="sm" trailingIcon={<Icon name="ArrowRight" size={14} />}>Open dashboard</Button>
        </Link>
      </div>
    </nav>
  );
}

export function Hero() {
  return (
    <section id="top" style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(58% 46% at 50% -8%, var(--blue-tint), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 1px 1px, var(--gray-800) 1px, transparent 0)", backgroundSize: "30px 30px", opacity: 0.45, maskImage: "linear-gradient(180deg, transparent, black 24%, black 58%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 24%, black 58%, transparent)", pointerEvents: "none" }} />
      <div className="lb-wrap" style={{ position: "relative", paddingTop: 88, paddingBottom: 64, textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 4px 4px 12px", borderRadius: 999, border: "1px solid var(--border-default)", background: "var(--surface-card)", marginBottom: 26 }}>
          <span style={{ font: "var(--font-ui)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Idempotent · ordered · conflict-aware</span>
          <Badge tone="accent">v2 engine</Badge>
        </div>
        <h1 style={{ margin: "0 auto", maxWidth: 800, font: "var(--fw-semibold) clamp(38px, 6vw, 62px)/1.03 var(--font-sans)", letterSpacing: "-0.025em", color: "var(--text-strong)", textWrap: "balance" }}>
          Two-way invoice sync that survives the real world.
        </h1>
        <p style={{ margin: "20px auto 0", maxWidth: 600, font: "var(--fw-regular) var(--text-lg)/1.55 var(--font-sans)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          LedgerBridge keeps internal invoicing and QuickBooks Online in lockstep — tolerant of duplicate events, out-of-order delivery, write conflicts and partial failures. Every event is observable, replayable and audited.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 30 }}>
          <Link href="/dashboard" style={{ textDecoration: "none" }}><Button variant="primary" size="lg" trailingIcon={<Icon name="ArrowRight" size={16} />}>Open the dashboard</Button></Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Button variant="secondary" size="lg" leadingIcon={<Icon name="Github" size={16} />}>View on GitHub</Button></a>
        </div>
      </div>
    </section>
  );
}
