"use client";
/* AppShell — fixed left sidebar + sticky top bar, on every dashboard screen.
   Ported from AppShell.jsx; active nav + breadcrumb derive from the pathname. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import { Icon } from "./icon";

interface NavEntry {
  id: string;
  label: string;
  icon: string;
  href: string;
  countKey?: "conflictCount";
}

const NAV: NavEntry[] = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard", href: "/dashboard" },
  { id: "invoices", label: "Invoices", icon: "FileText", href: "/invoices" },
  { id: "conflicts", label: "Conflicts", icon: "GitMerge", href: "/conflicts", countKey: "conflictCount" },
  { id: "events", label: "Events", icon: "Activity", href: "/events" },
  { id: "audit", label: "Audit", icon: "ScrollText", href: "/audit" },
  { id: "demo", label: "Demo", icon: "FlaskConical", href: "/demo" },
];

const ACTIVE: Record<string, string> = { invoices: "invoices", conflicts: "conflicts", events: "events", audit: "audit", demo: "demo" };
const LABEL: Record<string, string> = { invoices: "Invoices", conflicts: "Conflicts", events: "Events", audit: "Audit", demo: "Demo", dashboard: "Overview" };

type Crumb = { label: string; href?: string };

function derive(pathname: string): { active: string; crumbs: Crumb[] } {
  const parts = pathname.split("/").filter(Boolean);
  const root = parts[0] ?? "dashboard";
  const active = ACTIVE[root] ?? "overview";
  if (root === "dashboard" || parts.length === 0) return { active, crumbs: [{ label: "Overview" }] };
  const crumbs: Crumb[] = [{ label: LABEL[root] ?? root, href: parts.length > 1 ? `/${root}` : undefined }];
  if (parts.length > 1) crumbs.push({ label: decodeURIComponent(parts[1]) });
  return { active, crumbs };
}

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 6px" }}>
      <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--accent)", color: "var(--accent-fg)", display: "grid", placeItems: "center", boxShadow: "var(--shadow-xs)" }}>
        <Icon name="ArrowLeftRight" size={15} stroke={2} />
      </span>
      <span style={{ font: "var(--fw-semibold) 15px/1 var(--font-sans)", letterSpacing: "-0.01em", color: "var(--text-strong)" }}>
        Ledger<span style={{ color: "var(--accent)" }}>Bridge</span>
      </span>
    </div>
  );
}

function NavItem({ item, active, count }: { item: NavEntry; active: boolean; count: number | null }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        height: 32,
        padding: "0 8px",
        borderRadius: "var(--radius-sm)",
        textDecoration: "none",
        background: active ? "var(--surface-active)" : hover ? "var(--surface-hover)" : "transparent",
        color: active ? "var(--text-strong)" : "var(--text-muted)",
        font: "var(--fw-medium) var(--text-sm)/1 var(--font-sans)",
        transition: "background var(--dur-fast), color var(--dur-fast)",
      }}
    >
      <Icon name={item.icon} size={16} color={active ? "var(--accent)" : "currentColor"} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {count != null && count > 0 && (
        <span
          style={{
            font: "var(--fw-medium) var(--text-2xs)/1 var(--font-mono)",
            color: item.id === "conflicts" ? "var(--status-conflict-fg)" : "var(--text-faint)",
            background: item.id === "conflicts" ? "var(--status-conflict-fill)" : "var(--surface-hover)",
            padding: "2px 6px",
            borderRadius: "var(--radius-pill)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function ConnectionStatus() {
  const mock = api.MOCK_MODE;
  return (
    <span
      title={mock ? "Rendering on mock fixtures — set NEXT_PUBLIC_API_URL to go live" : `Live: ${api.API_BASE}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 28,
        padding: "0 10px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
        font: "var(--fw-medium) var(--text-2xs)/1 var(--font-mono)",
        color: "var(--text-secondary)",
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ position: "relative", display: "inline-flex" }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: mock ? "var(--status-inflight-solid)" : "var(--status-synced-solid)" }} />
        {!mock && <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--status-synced-solid)", animation: "lb-cs 1.8s var(--ease-in-out) infinite" }} />}
      </span>
      {mock ? "Mock data" : "Live"}
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The icon is CSS-driven (shown by the .dark/.light class next-themes sets before
  // hydration), so SSR and client markup match — no hydration mismatch. resolvedTheme
  // is read only at click time (an event handler, post-mount).
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")}
      aria-label="Toggle theme"
      title="Toggle theme"
      style={{ width: 30, height: 30, display: "grid", placeItems: "center", background: "transparent", border: "1px solid transparent", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", cursor: "pointer" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span className="hidden dark:block">
        <Icon name="Moon" size={16} />
      </span>
      <span className="block dark:hidden">
        <Icon name="Sun" size={16} />
      </span>
    </button>
  );
}

function Sidebar({ active, conflictCount }: { active: string; conflictCount: number | null }) {
  return (
    <aside style={{ width: "var(--sidebar-w)", flexShrink: 0, height: "100%", background: "var(--surface-panel)", borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 14, padding: "14px 10px" }}>
      <div style={{ height: "calc(var(--topbar-h) - 14px)", display: "flex", alignItems: "center" }}>
        <Logo />
      </div>
      <nav aria-label="Primary" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((n) => (
          <NavItem key={n.id} item={n} active={active === n.id} count={n.countKey ? conflictCount : null} />
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <div style={{ padding: "0 6px 4px" }}>
        <div style={{ padding: "10px 11px", borderRadius: "var(--radius-md)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ flexShrink: 0, width: 7, height: 7, borderRadius: 999, background: "var(--status-synced-solid)" }} />
            <span style={{ font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Engine healthy</span>
          </div>
          <p style={{ margin: "8px 0 0", font: "var(--text-2xs)/1.5 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>QBO realm 9130·4471</p>
          <p style={{ margin: "2px 0 0", font: "var(--text-2xs)/1.5 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>uptime 99.98% · p95 0.9s</p>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ crumbs }: { crumbs: Crumb[] }) {
  const all: Crumb[] = [{ label: "LedgerBridge" }, ...crumbs];
  return (
    <header style={{ height: "var(--topbar-h)", flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: "1px solid var(--border-subtle)", background: "color-mix(in oklch, var(--surface-canvas) 80%, transparent)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 5 }}>
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        {all.map((c, i) => {
          const isLast = i === all.length - 1;
          const style = { font: isLast ? "var(--fw-medium) var(--text-sm)/1 var(--font-sans)" : "var(--text-sm)/1 var(--font-sans)", color: isLast ? "var(--text-strong)" : "var(--text-muted)", whiteSpace: "nowrap" as const, textDecoration: "none" };
          return (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <Icon name="ChevronRight" size={14} color="var(--text-faint)" />}
              {c.href && !isLast ? <Link href={c.href} style={style}>{c.label}</Link> : <span style={style}>{c.label}</span>}
            </span>
          );
        })}
      </nav>
      <div style={{ flex: 1 }} />
      <div role="search" style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 9px", width: 220, background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", color: "var(--text-faint)" }}>
        <Icon name="Search" size={14} />
        <span style={{ font: "var(--text-sm)/1 var(--font-sans)", flex: 1 }}>Search…</span>
        <span style={{ font: "var(--text-2xs)/1 var(--font-mono)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "2px 5px" }}>⌘K</span>
      </div>
      <ConnectionStatus />
      <Link
        href="/demo"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", font: "var(--fw-medium) var(--text-sm)/1 var(--font-sans)", textDecoration: "none", boxShadow: "var(--ring-inset-top)" }}
      >
        <Icon name="FlaskConical" size={15} color="var(--accent)" />
        Demo
      </Link>
      <ThemeToggle />
      <Avatar name="Dana Okafor" size={26} />
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { active, crumbs } = derive(pathname);
  const { data: status } = useApi(() => api.getStatus(), [], { pollMs: 5000 });
  return (
    <div style={{ display: "flex", height: "100vh", minHeight: 0, background: "var(--surface-canvas)" }}>
      <Sidebar active={active} conflictCount={status?.conflictCount ?? null} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
        <TopBar crumbs={crumbs} />
        <main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</main>
      </div>
    </div>
  );
}
