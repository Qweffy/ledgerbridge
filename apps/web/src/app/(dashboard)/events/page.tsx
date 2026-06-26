"use client";
/* /events — the sync outbox (GET /events). A filterable DataTable over every
   webhook/sync event, with a separated dead-letter section that offers Replay
   (POST /events/:id/replay). Filtering + pagination are client-side over the
   polled set; a replayed row is optimistically flipped to processing. */
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { EventDto } from "@ledgerbridge/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/dashboard/icon";
import { PageHeader } from "@/components/dashboard/page-header";
import { StateBlock } from "@/components/dashboard/state-block";
import { EventStatusPill, Skeleton, SystemBadge } from "@/components/dashboard/widgets";
import { DataTable, FilterBar, FilterSelect, Pagination, type Column } from "@/components/dashboard/table";
import { showToast } from "@/components/dashboard/overlays";
import { api } from "@/lib/api/client";
import { useApi, useTick } from "@/lib/api/hooks";
import { timeAgo } from "@/lib/api/time";

const PAGE_SIZE = 8;

type EventOverride = Partial<Pick<EventDto, "status" | "nextAttemptAt" | "lastError">>;

function Attempts({ e }: { e: EventDto }) {
  const exhausted = e.attempts >= e.maxAttempts;
  return (
    <span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: exhausted ? "var(--status-failed-fg)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {e.attempts}/{e.maxAttempts}
    </span>
  );
}

function DeadLetterSection({ rows, onReplay, replayingId, onOpen }: { rows: EventDto[]; onReplay: (id: string) => void; replayingId: string | null; onOpen: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <Card padded={false} style={{ borderColor: "color-mix(in oklch, var(--status-failed-solid) 32%, var(--border-subtle))" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-4) var(--space-5)", borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--status-failed-fill)", color: "var(--status-failed-fg)" }}>
          <Icon name="Inbox" size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, font: "var(--fw-semibold) var(--text-md)/1.2 var(--font-sans)", color: "var(--text-strong)" }}>Dead-letter</h3>
          <p style={{ margin: "2px 0 0", font: "var(--text-xs)/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{rows.length} job{rows.length > 1 ? "s" : ""} exhausted retries. Replay to requeue for processing.</p>
        </div>
        <Button size="sm" variant="secondary" leadingIcon={<Icon name="RotateCcw" size={13} />} onClick={() => rows.forEach((r) => onReplay(r.id))}>Replay all</Button>
      </header>
      {rows.map((e) => (
        <div key={e.id} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 64px 96px", gap: "var(--space-4)", alignItems: "center", padding: "var(--space-3) var(--space-5)", borderBottom: "1px solid var(--border-subtle)" }}>
          <SystemBadge source={e.source} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen(e.id)}
            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(e.id); } }}
            style={{ minWidth: 0, cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ font: "var(--fw-medium) var(--text-sm)/1.3 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{e.externalId}</span>
              <span style={{ font: "var(--text-2xs)/1.3 var(--font-sans)", color: "var(--text-faint)", textTransform: "capitalize", whiteSpace: "nowrap" }}>{e.operation} · {e.entityType}</span>
            </div>
            {e.lastError && <div style={{ marginTop: 3, font: "var(--text-2xs)/1.3 var(--font-mono)", color: "var(--status-failed-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.lastError}</div>}
          </div>
          <Attempts e={e} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" variant="primary" loading={replayingId === e.id} leadingIcon={replayingId === e.id ? undefined : <Icon name="RotateCcw" size={13} />} onClick={() => onReplay(e.id)}>Replay</Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

interface LogFilters {
  status: string;
  source: string;
  entity: string;
  operation: string;
}

const opt = (arr: string[]) => arr.map((v) => ({ value: v, label: v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1) }));

export default function EventsPage() {
  const router = useRouter();
  const { data, loading, error, reload } = useApi(() => api.getEvents(), [], { pollMs: 8000 });
  const [overrides, setOverrides] = useState<Record<string, EventOverride>>({});
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LogFilters>({ status: "all", source: "all", entity: "all", operation: "all" });
  const [page, setPage] = useState(0);
  useTick(1000);
  const setF = (k: keyof LogFilters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0); };
  const open = (id: string) => router.push(`/events/${id}`);

  const merged: EventDto[] = (data ?? []).map((e) => (overrides[e.id] ? { ...e, ...overrides[e.id] } : e));
  const deadLetters = merged.filter((e) => e.status === "dead");
  const filtered = merged.filter(
    (e) =>
      (filters.status === "all" || e.status === filters.status) &&
      (filters.source === "all" || e.source === filters.source) &&
      (filters.entity === "all" || e.entityType === filters.entity) &&
      (filters.operation === "all" || e.operation === filters.operation),
  );
  const total = filtered.length;
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const replay = (id: string) => {
    setReplayingId(id);
    api.replayEvent(id).then(
      () => {
        setReplayingId(null);
        setOverrides((o) => ({ ...o, [id]: { status: "processing", nextAttemptAt: null, lastError: null } }));
        showToast(`Replaying ${id} — requeued`, "success");
      },
      (err: unknown) => {
        setReplayingId(null);
        showToast(`Replay failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      },
    );
  };

  const columns: Column<EventDto>[] = [
    { key: "status", header: "Status", width: "104px", render: (e) => <EventStatusPill status={e.status} /> },
    { key: "source", header: "Source", width: "120px", render: (e) => <SystemBadge source={e.source} /> },
    {
      key: "event",
      header: "Event",
      width: "minmax(0,1fr)",
      render: (e) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ font: "var(--fw-medium) var(--text-sm)/1.3 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{e.externalId}</span>
            <span style={{ font: "var(--text-2xs)/1.3 var(--font-sans)", color: "var(--text-faint)", textTransform: "capitalize", whiteSpace: "nowrap" }}>{e.operation} · {e.entityType}</span>
          </div>
          {e.lastError && (e.status === "dead" || e.status === "processing") && (
            <div style={{ marginTop: 3, font: "var(--text-2xs)/1.3 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.lastError}</div>
          )}
        </div>
      ),
    },
    { key: "attempts", header: "Tries", width: "64px", align: "right", render: (e) => <Attempts e={e} /> },
    { key: "receivedAt", header: "Received", width: "96px", align: "right", render: (e) => <span title={e.receivedAt ?? undefined} style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{timeAgo(e.receivedAt)}</span> },
    { key: "go", header: "", width: "24px", align: "right", render: () => <Icon name="ChevronRight" size={16} color="var(--text-faint)" /> },
  ];

  let logBody: ReactNode;
  if (loading && !data) {
    logBody = (
      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "0 var(--space-5)", height: 48, borderBottom: "1px solid var(--border-subtle)" }}>
            <Skeleton w={84} h={18} r="var(--radius-pill)" />
            <Skeleton w={96} h={18} r="var(--radius-sm)" />
            <Skeleton w="50%" h={12} />
            <Skeleton w={40} h={12} style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    );
  } else if (error) {
    logBody = <StateBlock icon="WifiOff" title="Couldn't load events" body={String(error.message)} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={reload}>Retry</Button>} />;
  } else {
    logBody = (
      <>
        <DataTable
          columns={columns}
          rows={pageRows}
          getRowKey={(r) => r.id}
          onRowClick={(r) => open(r.id)}
          emptyState={total === 0 ? <StateBlock icon="SearchX" title="No events match" body="No sync events for this filter. Clear the filters to see the full log." /> : null}
        />
        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Events" description="Every webhook and sync event flowing through LedgerBridge — idempotent, retried, and dead-lettered on exhaustion." />
      <div style={{ padding: "var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {!loading && !error && <DeadLetterSection rows={deadLetters} onReplay={replay} replayingId={replayingId} onOpen={open} />}
        <Card padded={false}>
          <FilterBar trailing={<span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{total} event{total === 1 ? "" : "s"}</span>}>
            <FilterSelect label="Status" value={filters.status} onChange={(v) => setF("status", v)} options={opt(["all", "pending", "processing", "done", "dead"])} />
            <FilterSelect label="Source" value={filters.source} onChange={(v) => setF("source", v)} options={[{ value: "all", label: "All" }, { value: "internal", label: "Internal" }, { value: "qbo", label: "QBO" }]} />
            <FilterSelect label="Entity" value={filters.entity} onChange={(v) => setF("entity", v)} options={opt(["all", "invoice", "account", "payment"])} />
            <FilterSelect label="Operation" value={filters.operation} onChange={(v) => setF("operation", v)} options={opt(["all", "create", "update", "void", "delete"])} />
          </FilterBar>
          {logBody}
        </Card>
      </div>
    </>
  );
}
