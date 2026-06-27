"use client";
/* /audit — the append-only record of every action the engine + operators took
   (GET /audit). A filterable DataTable; selecting an entry opens a Sheet with a
   before→after diff (time-travel feel), the error text when it failed, and a jump
   to the originating event. Ported from the bundle's audit.jsx. */
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AuditAction, AuditEntryDto } from "@ledgerbridge/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/dashboard/icon";
import { PageHeader } from "@/components/dashboard/page-header";
import { StateBlock } from "@/components/dashboard/state-block";
import { ACTION_META, Skeleton, SystemBadge } from "@/components/dashboard/widgets";
import { DataTable, FilterBar, FilterSelect, Pagination, type Column } from "@/components/dashboard/table";
import { Sheet } from "@/components/dashboard/overlays";
import { api } from "@/lib/api/client";
import { useApi, useTick } from "@/lib/api/hooks";
import { ageSec, timeAgo } from "@/lib/api/time";

const PAGE_SIZE = 10;

type BadgeTone = "neutral" | "accent" | "green" | "amber" | "red" | "violet";
const ACTION_TONE: Record<string, BadgeTone> = {
  create: "green", update: "accent", void: "amber", delete: "red",
  skip: "neutral", conflict: "amber", conflict_resolved: "violet", error: "red",
};
const ACTION_LABEL: Record<string, string> = {
  create: "Create", update: "Update", void: "Void", delete: "Delete",
  skip: "Skip", conflict: "Conflict", conflict_resolved: "Resolved", error: "Error",
};

function ActionBadge({ action, size = "md" }: { action: AuditAction; size?: "sm" | "md" }) {
  const meta = ACTION_META[action] ?? ACTION_META.update;
  return (
    <Badge tone={ACTION_TONE[action] ?? "neutral"} size={size}>
      <Icon name={meta.icon} size={11} /> {ACTION_LABEL[action] ?? action}
    </Badge>
  );
}

function ResultTag({ result }: { result: "ok" | "error" }) {
  const ok = result === "ok";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", color: ok ? "var(--status-synced-fg)" : "var(--status-failed-fg)", whiteSpace: "nowrap" }}>
      <Icon name={ok ? "CheckCircle2" : "XCircle"} size={13} /> {ok ? "OK" : "Error"}
    </span>
  );
}

// value renderer — a system identity gets a badge, an object/array is pretty-printed
// JSON (snapshots + the reconciler heartbeat carry objects), else mono scalar.
function Val({ value, accent }: { value: unknown; accent?: string }) {
  if (value == null || value === "") return <span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-faint)", fontStyle: "italic" }}>none</span>;
  if (value === "internal" || value === "qbo") return <SystemBadge source={value} size="md" />;
  if (typeof value === "object") return <pre style={{ margin: 0, font: "var(--text-xs)/1.5 var(--font-mono)", color: accent ?? "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 220, overflow: "auto" }}>{JSON.stringify(value, null, 2)}</pre>;
  return <span style={{ font: "var(--fw-medium) var(--text-md)/1.2 var(--font-mono)", color: accent ?? "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{String(value)}</span>;
}

function BeforeAfter({ entry }: { entry: AuditEntryDto }) {
  const afterAccent = entry.result === "error" ? "var(--status-failed-fg)" : "var(--status-synced-fg)";
  const panel = (title: string, value: unknown, accent?: string, border?: string) => (
    <div style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--surface-sunken)", border: `1px solid ${border ?? "var(--border-subtle)"}` }}>
      <div style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 10 }}>{title}</div>
      <Val value={value} accent={accent} />
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "var(--space-3)" }}>
      {panel("Before", entry.before)}
      <div style={{ display: "grid", placeItems: "center", color: "var(--text-faint)" }}><Icon name="ArrowRight" size={18} /></div>
      {panel("After", entry.after, afterAccent, "color-mix(in oklch, var(--status-synced-solid) 22%, var(--border-subtle))")}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</div>
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  );
}

function AuditSheet({ entry, onClose }: { entry: AuditEntryDto; onClose: () => void }) {
  const router = useRouter();
  const label = ACTION_LABEL[entry.action] ?? entry.action;
  const footer = (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <span style={{ font: "var(--text-2xs)/1 var(--font-mono)", color: "var(--text-faint)", flex: 1 }}>{entry.correlationId ?? "—"}</span>
      <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
      {entry.eventId && <Button variant="secondary" size="md" trailingIcon={<Icon name="ArrowUpRight" size={15} />} onClick={() => router.push(`/events/${entry.eventId}`)}>View event</Button>}
    </div>
  );
  return (
    <Sheet open onClose={onClose} subtitle="Audit entry" title={`${label} · ${entry.entityType ?? "—"}`} headerAccessory={<ResultTag result={entry.result} />} footer={footer}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <ActionBadge action={entry.action} />
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span title={entry.ts} style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-muted)" }}>{entry.ts}</span>
        </div>

        <BeforeAfter entry={entry} />

        {entry.result === "error" && entry.error && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--status-failed-fill)", border: "1px solid color-mix(in oklch, var(--status-failed-solid) 30%, transparent)" }}>
            <Icon name="XCircle" size={15} color="var(--status-failed-fg)" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ font: "var(--text-sm)/1.4 var(--font-mono)", color: "var(--status-failed-fg)" }}>{entry.error}</span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", padding: "var(--space-4)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <Meta label="Entity"><span style={{ font: "var(--text-sm)/1 var(--font-sans)", color: "var(--text-primary)", textTransform: "capitalize" }}>{entry.entityType ?? "—"}</span></Meta>
          <Meta label="Originating event"><span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-primary)" }}>{entry.eventId ?? "—"}</span></Meta>
          <Meta label="Correlation ID"><span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-secondary)" }}>{entry.correlationId ?? "—"}</span></Meta>
          <Meta label="Result"><ResultTag result={entry.result} /></Meta>
        </div>
      </div>
    </Sheet>
  );
}

interface AuditFilters {
  action: string;
  result: string;
  entity: string;
  range: string;
}

const RANGES: Record<string, number> = { all: Infinity, "1h": 3600, "24h": 86400, "7d": 604800 };
const opt = (arr: string[]) => arr.map((v) => ({ value: v, label: v === "all" ? "All" : (ACTION_LABEL[v] ?? v.charAt(0).toUpperCase() + v.slice(1)) }));

export default function AuditPage() {
  const { data, loading, error, reload } = useApi(() => api.getAudit(), []);
  const [filters, setFilters] = useState<AuditFilters>({ action: "all", result: "all", entity: "all", range: "all" });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);
  useTick(1000);
  const setF = (k: keyof AuditFilters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0); };

  const filtered = (data ?? []).filter(
    (e) =>
      (filters.action === "all" || e.action === filters.action) &&
      (filters.result === "all" || e.result === filters.result) &&
      (filters.entity === "all" || e.entityType === filters.entity) &&
      (filters.range === "all" || ageSec(e.ts) <= RANGES[filters.range]),
  );
  const total = filtered.length;
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const columns: Column<AuditEntryDto>[] = [
    { key: "action", header: "Action", width: "130px", render: (e) => <ActionBadge action={e.action} size="sm" /> },
    { key: "result", header: "Result", width: "84px", render: (e) => <ResultTag result={e.result} /> },
    { key: "entityType", header: "Entity", width: "110px", render: (e) => <span style={{ font: "var(--text-sm)/1 var(--font-sans)", color: "var(--text-secondary)", textTransform: "capitalize" }}>{e.entityType ?? "—"}</span> },
    { key: "eventId", header: "Event", width: "minmax(0,1fr)", render: (e) => <span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{e.eventId ?? "—"}</span> },
    { key: "correlationId", header: "Correlation", width: "120px", render: (e) => <span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{e.correlationId ?? "—"}</span> },
    { key: "ts", header: "Time", width: "96px", align: "right", render: (e) => <span title={e.ts} style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{timeAgo(e.ts)}</span> },
    { key: "go", header: "", width: "24px", align: "right", render: () => <Icon name="ChevronRight" size={16} color="var(--text-faint)" /> },
  ];

  let body: ReactNode;
  if (loading && !data) {
    body = (
      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "0 var(--space-5)", height: 48, borderBottom: "1px solid var(--border-subtle)" }}>
            <Skeleton w={96} h={18} r="var(--radius-sm)" />
            <Skeleton w={60} h={12} />
            <Skeleton w="40%" h={12} />
            <Skeleton w={48} h={12} style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    );
  } else if (error) {
    body = <StateBlock icon="WifiOff" title="Couldn't load the audit log" body={String(error.message)} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={reload}>Retry</Button>} />;
  } else {
    body = (
      <>
        <DataTable
          columns={columns}
          rows={pageRows}
          getRowKey={(r) => r.id}
          onRowClick={(r) => setSelected(r)}
          emptyState={total === 0 ? <StateBlock icon="SearchX" title="No audit entries" body="No actions match this filter. Clear the filters to see the full history." /> : null}
        />
        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Audit" description="Every action LedgerBridge and operators took, in order. Select an entry to time-travel through the change." />
      <div style={{ padding: "var(--space-7)" }}>
        <Card padded={false}>
          <FilterBar trailing={<span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{total} entr{total === 1 ? "y" : "ies"}</span>}>
            <FilterSelect label="Action" value={filters.action} onChange={(v) => setF("action", v)} options={opt(["all", "create", "update", "void", "delete", "skip", "conflict", "conflict_resolved", "error"])} />
            <FilterSelect label="Result" value={filters.result} onChange={(v) => setF("result", v)} options={[{ value: "all", label: "All" }, { value: "ok", label: "OK" }, { value: "error", label: "Error" }]} />
            <FilterSelect label="Entity" value={filters.entity} onChange={(v) => setF("entity", v)} options={opt(["all", "invoice", "account", "payment"])} />
            <FilterSelect label="Range" value={filters.range} onChange={(v) => setF("range", v)} options={[{ value: "all", label: "All time" }, { value: "1h", label: "Last hour" }, { value: "24h", label: "Last 24h" }, { value: "7d", label: "Last 7 days" }]} />
          </FilterBar>
          {body}
        </Card>
      </div>
      {selected && <AuditSheet entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
