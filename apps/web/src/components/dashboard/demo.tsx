"use client";
/* Demo control panel — ported from the bundle's demo.jsx. A /demo page AND a
   top-bar slide-in Sheet share one result-log via a module-level store consumed
   through useSyncExternalStore (no setState-in-effect → React-Compiler-clean).
   Each action posts to its /demo/* endpoint, toasts, and appends a row with a
   "what to watch" link into the rest of the dashboard. */
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { Icon } from "./icon";
import { PageHeader } from "./page-header";
import { Sheet, showToast } from "./overlays";

type ActionKey = "create" | "editBoth" | "reconcile" | "fault";

interface DemoAction {
  key: ActionKey;
  label: string;
  desc: string;
  icon: string;
  tone: "inflight" | "conflict" | "synced" | "failed";
  fn: () => Promise<unknown>;
  ok: string;
  hint: string;
  watch: string; // dashboard route to follow the effect
  watchLabel: string;
}

const ACTIONS: DemoAction[] = [
  { key: "create", label: "Create invoice", desc: "Emit a fresh invoice from internal invoicing into the pipeline.", icon: "FilePlus2", tone: "inflight", fn: () => api.demo.createInvoice(), ok: "New invoice queued — flowing internal → QBO.", hint: "Watch it move through Events.", watch: "/events", watchLabel: "Events" },
  { key: "editBoth", label: "Edit in both", desc: "Edit the same invoice on both sides at once to force a conflict.", icon: "GitMerge", tone: "conflict", fn: () => api.demo.editBoth(), ok: "Both sides edited — a conflict was opened.", hint: "Check the Conflicts queue.", watch: "/conflicts", watchLabel: "Conflicts" },
  { key: "reconcile", label: "Run reconciler", desc: "Re-compare both systems and reconcile any drift.", icon: "RefreshCw", tone: "synced", fn: () => api.demo.reconcile(), ok: "Reconcile pass complete — drift recomputed.", hint: "Drift indicators clear on Invoices.", watch: "/invoices", watchLabel: "Invoices" },
  { key: "fault", label: "Inject fault", desc: "Make the next QBO write fail repeatedly until it dead-letters.", icon: "TriangleAlert", tone: "failed", fn: () => api.demo.injectFault(), ok: "Fault injected — next write will exhaust retries.", hint: "Watch dead-letter on Events.", watch: "/events", watchLabel: "Events" },
];

interface LogEntry { id: number; label: string; ok: boolean; msg: string; ts: string; hint?: string; watch?: string; watchLabel?: string }
interface DemoState { log: LogEntry[]; running: Record<string, boolean> }

// Module-level external store: page + sheet subscribe to the same instance, so a run
// in one surface shows in the other. State is replaced immutably so getSnapshot's
// reference is stable between renders (required by useSyncExternalStore).
let state: DemoState = { log: [], running: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const store = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
  getSnapshot: () => state,
};
let seq = 0;
const clock = () => new Date().toISOString().slice(11, 19) + "Z";

function run(a: DemoAction): void {
  if (state.running[a.key]) return;
  state = { ...state, running: { ...state.running, [a.key]: true } };
  emit();
  a.fn().then(
    () => {
      state = { running: { ...state.running, [a.key]: false }, log: [{ id: ++seq, label: a.label, ok: true, msg: a.ok, ts: clock(), hint: a.hint, watch: a.watch, watchLabel: a.watchLabel }, ...state.log] };
      emit();
      showToast(`${a.label} — ${a.hint}`, "success");
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      state = { running: { ...state.running, [a.key]: false }, log: [{ id: ++seq, label: a.label, ok: false, msg, ts: clock() }, ...state.log] };
      emit();
      showToast(`${a.label} failed: ${msg}`, "error");
    },
  );
}

function clearLog(): void {
  state = { ...state, log: [] };
  emit();
}

function useDemo(): DemoState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function ActionCard({ a, running }: { a: DemoAction; running: boolean }) {
  const fg = `var(--status-${a.tone}-fg)`;
  const fill = `var(--status-${a.tone}-fill)`;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}>
      <span style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", background: fill, color: fg, flexShrink: 0 }}>
        <Icon name={a.icon} size={16} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: "var(--fw-semibold) var(--text-sm)/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{a.label}</div>
        <p style={{ margin: "4px 0 0", font: "var(--text-xs)/1.45 var(--font-sans)", color: "var(--text-muted)", textWrap: "pretty" }}>{a.desc}</p>
        <div style={{ marginTop: "var(--space-3)" }}>
          <Button size="sm" variant={a.key === "fault" ? "danger" : "secondary"} loading={running} leadingIcon={running ? undefined : <Icon name="Play" size={13} />} onClick={() => run(a)}>
            {running ? "Running…" : "Run"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultLog({ log, max, onNavigate }: { log: LogEntry[]; max?: number; onNavigate?: () => void }) {
  const items = max ? log.slice(0, max) : log;
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
        <span style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)" }}>Result log</span>
        {log.length > 0 && <button type="button" onClick={clearLog} style={{ background: "transparent", border: "none", cursor: "pointer", font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", color: "var(--text-faint)" }}>Clear</button>}
      </div>
      {items.length === 0 ? (
        <div style={{ padding: "var(--space-6) var(--space-4)", textAlign: "center", borderRadius: "var(--radius-md)", border: "1px dashed var(--border-default)", font: "var(--text-xs)/1.5 var(--font-sans)", color: "var(--text-faint)" }}>No actions run yet. Trigger one above to drive the system.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {items.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "var(--space-3)", borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)" }}>
              <Icon name={e.ok ? "CheckCircle2" : "XCircle"} size={14} color={e.ok ? "var(--status-synced-fg)" : "var(--status-failed-fg)"} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ font: "var(--fw-medium) var(--text-xs)/1.3 var(--font-sans)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{e.label}</span>
                  <span style={{ marginLeft: "auto", font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{e.ts}</span>
                </div>
                <div style={{ marginTop: 3, font: "var(--text-xs)/1.4 var(--font-mono)", color: e.ok ? "var(--text-muted)" : "var(--status-failed-fg)" }}>{e.msg}</div>
                {e.ok && e.hint && (
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "var(--text-2xs)/1 var(--font-sans)", color: "var(--text-secondary)" }}>
                      <Icon name="Eye" size={12} color="var(--text-faint)" />{e.hint}
                    </span>
                    {e.watch && (
                      <Link href={e.watch} onClick={onNavigate} style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", color: "var(--text-link)" }}>
                        {e.watchLabel}<Icon name="ArrowRight" size={11} />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DemoControls({ layout, onNavigate }: { layout: "page" | "sheet"; onNavigate?: () => void }) {
  const s = useDemo();
  const sheet = layout === "sheet";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div style={{ display: "grid", gridTemplateColumns: sheet ? "1fr" : "repeat(auto-fit, minmax(232px, 1fr))", gap: "var(--space-3)" }}>
        {ACTIONS.map((a) => <ActionCard key={a.key} a={a} running={!!s.running[a.key]} />)}
      </div>
      <ResultLog log={s.log} max={sheet ? 6 : undefined} onNavigate={onNavigate} />
    </div>
  );
}

export function DemoPage() {
  return (
    <>
      <PageHeader title="Demo" description="Drive LedgerBridge live. Each action posts to the demo API — then follow the hint to see the effect ripple through the dashboard." />
      <div style={{ padding: "var(--space-7)", maxWidth: 980 }}>
        <DemoControls layout="page" />
      </div>
    </>
  );
}

export function DemoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mock = api.MOCK_MODE;
  return (
    <Sheet open={open} onClose={onClose} subtitle="Live demo" title="Demo controls" width={460} headerAccessory={<Badge tone={mock ? "accent" : "green"} size="sm">{mock ? "Mock" : "Live"}</Badge>}>
      <DemoControls layout="sheet" onNavigate={onClose} />
    </Sheet>
  );
}
