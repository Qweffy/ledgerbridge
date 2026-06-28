"use client";
/* ⌘K command palette — a keyboard-first jump-to-screen, adapted from the hand-rolled
   palette in Settle (no cmdk dependency). Substring match over the dashboard routes,
   ↑↓ / Enter / Esc navigation. The content only mounts while open, so the reset is the
   fresh mount (no setState-in-effect) — React-Compiler-clean. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";

export interface Command {
  id: string;
  label: string;
  icon: string;
  href: string;
  keywords: string[];
}

export const COMMANDS: Command[] = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard", href: "/dashboard", keywords: ["overview", "dashboard", "home", "status", "metrics", "feed"] },
  { id: "invoices", label: "Invoices", icon: "FileText", href: "/invoices", keywords: ["invoices", "links", "diff", "drift"] },
  { id: "conflicts", label: "Conflicts", icon: "GitMerge", href: "/conflicts", keywords: ["conflicts", "resolve", "merge", "mismatch"] },
  { id: "events", label: "Events", icon: "Activity", href: "/events", keywords: ["events", "log", "outbox", "dead-letter", "replay", "retry"] },
  { id: "audit", label: "Audit", icon: "ScrollText", href: "/audit", keywords: ["audit", "history", "time-travel", "before", "after", "trail"] },
  { id: "demo", label: "Demo", icon: "FlaskConical", href: "/demo", keywords: ["demo", "playground", "drive", "create", "inject", "fault", "reconcile"] },
  { id: "landing", label: "Landing page", icon: "ArrowLeftRight", href: "/", keywords: ["landing", "home", "marketing", "public"] },
];

// Substring match over label + keywords; an empty query returns everything. Pure, so
// the search behaviour is unit-tested without a DOM.
export function filterCommands(query: string, commands: Command[] = COMMANDS): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q)));
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <Palette onClose={onClose} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => filterCommands(q), [q]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (cmd?: Command) => {
    if (!cmd) return;
    router.push(cmd.href);
    onClose();
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "start center", paddingTop: "12vh" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0 0 0 / 0.5)", backdropFilter: "blur(2px)", animation: "lb-fade var(--dur-fast) var(--ease-out)" }} />
      <div role="dialog" aria-modal="true" aria-label="Command palette" style={{ position: "relative", width: 560, maxWidth: "92vw", background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", display: "flex", flexDirection: "column", maxHeight: "60vh", overflow: "hidden", animation: "lb-pop var(--dur-fast) var(--ease-out)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 15px", borderBottom: "1px solid var(--border-subtle)" }}>
          <Icon name="Search" size={16} color="var(--text-faint)" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Jump to a screen…"
            aria-label="Search"
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", font: "var(--text-md)/1 var(--font-sans)" }}
          />
          <span style={{ font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-faint)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "2px 6px" }}>esc</span>
        </div>

        <div role="listbox" aria-label="Results" style={{ overflowY: "auto", padding: 7 }}>
          {results.length === 0 ? (
            <div style={{ padding: "18px 12px", textAlign: "center", font: "var(--text-sm)/1 var(--font-sans)", color: "var(--text-faint)" }}>No results for “{q}”.</div>
          ) : (
            <>
              <div style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)", padding: "8px 9px 5px" }}>Go to</div>
              {results.map((cmd, i) => {
                const isActive = i === active;
                return (
                  <div
                    key={cmd.id}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(cmd)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", borderRadius: "var(--radius-sm)", cursor: "pointer", background: isActive ? "var(--surface-active)" : "transparent", color: isActive ? "var(--text-strong)" : "var(--text-primary)" }}
                  >
                    <Icon name={cmd.icon} size={16} color={isActive ? "var(--accent)" : "var(--text-muted)"} />
                    <span style={{ flex: 1, font: "var(--fw-medium) var(--text-sm)/1 var(--font-sans)" }}>{cmd.label}</span>
                    {isActive && <span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)" }}>↵</span>}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "9px 14px", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
          <Hint keys={["↑", "↓"]} label="Navigate" />
          <Hint keys={["↵"]} label="Open" />
          <Hint keys={["esc"]} label="Close" />
        </div>
      </div>
    </div>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "var(--text-2xs)/1 var(--font-sans)", color: "var(--text-faint)" }}>
      {keys.map((k) => (
        <span key={k} style={{ font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-muted)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{k}</span>
      ))}
      {label}
    </span>
  );
}
