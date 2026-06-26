"use client";
/* /invoices — filterable, paginated list of linked entities (GET /links). */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EntityType, LinkDto, LinkStatus } from "@ledgerbridge/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/dashboard/icon";
import { PageHeader } from "@/components/dashboard/page-header";
import { StateBlock } from "@/components/dashboard/state-block";
import { Skeleton } from "@/components/dashboard/widgets";
import { DataTable, DriftIndicator, FilterBar, FilterSelect, LinkStatusPill, Pagination, type Column } from "@/components/dashboard/table";
import { api, type LinksFilter } from "@/lib/api/client";
import { useApi, useTick } from "@/lib/api/hooks";
import { timeAgo } from "@/lib/api/time";

const PAGE_SIZE = 5;
const ENTITY_ICON: Record<string, string> = { invoice: "FileText", account: "User", customer: "User", payment: "CreditCard" };
const statusOpts = [
  { value: "all", label: "All" },
  { value: "linked", label: "Linked" },
  { value: "conflict", label: "Conflict" },
  { value: "error", label: "Error" },
];
const entityOpts = [
  { value: "all", label: "All" },
  { value: "invoice", label: "Invoice" },
  { value: "account", label: "Account" },
  { value: "payment", label: "Payment" },
];

export default function InvoicesPage() {
  const router = useRouter();
  const [status, setStatus] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(0);
  const filter: LinksFilter = {};
  if (status !== "all") filter.status = status as LinkStatus;
  if (entityType !== "all") filter.entityType = entityType as EntityType;
  const { data: links, loading, error, reload } = useApi(() => api.getLinks(filter), [status, entityType]);
  useTick(1000);
  // reset paging when a filter changes (in the handler, not an effect)
  const onStatus = (v: string) => { setStatus(v); setPage(0); };
  const onEntity = (v: string) => { setEntityType(v); setPage(0); };

  const total = links ? links.length : 0;
  const pageRows = links ? links.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];

  const columns: Column<LinkDto>[] = [
    { key: "entityType", header: "Entity", width: "150px", render: (r) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Icon name={ENTITY_ICON[r.entityType] ?? "Box"} size={15} color="var(--text-muted)" />
        <span style={{ font: "var(--fw-medium) var(--text-sm)/1 var(--font-sans)", color: "var(--text-primary)", textTransform: "capitalize" }}>{r.entityType}</span>
      </span>
    ) },
    { key: "internalId", header: "Internal ID", width: "minmax(0,1fr)", render: (r) => <span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{r.internalId}</span> },
    { key: "qboId", header: "QBO ID", width: "minmax(0,1fr)", render: (r) => <span style={{ font: "var(--text-sm)/1 var(--font-mono)", color: r.qboId ? "var(--text-secondary)" : "var(--text-faint)", whiteSpace: "nowrap" }}>{r.qboId ?? "not created"}</span> },
    { key: "status", header: "Status", width: "120px", render: (r) => <LinkStatusPill status={r.status} /> },
    { key: "lastSyncedAt", header: "Last synced", width: "110px", render: (r) => <span title={r.lastSyncedAt ?? undefined} style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{timeAgo(r.lastSyncedAt)}</span> },
    { key: "drift", header: "Drift", width: "84px", render: (r) => <DriftIndicator drift={r.drift} /> },
    { key: "go", header: "", width: "28px", align: "right", render: () => <Icon name="ChevronRight" size={16} color="var(--text-faint)" /> },
  ];

  let body: React.ReactNode;
  if (loading && !links) {
    body = (
      <div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "0 var(--space-5)", height: 48, borderBottom: "1px solid var(--border-subtle)" }}>
            <Skeleton w={120} h={14} /><Skeleton w={90} h={12} /><Skeleton w={70} h={18} r="var(--radius-pill)" style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    );
  } else if (error) {
    body = <StateBlock icon="WifiOff" title="Couldn't load links" body={String(error.message)} action={<Button variant="secondary" size="sm" leadingIcon={<Icon name="RotateCcw" size={14} />} onClick={reload}>Retry</Button>} />;
  } else {
    body = (
      <>
        <DataTable
          columns={columns}
          rows={pageRows}
          getRowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/invoices/${r.id}`)}
          emptyState={total === 0 ? <StateBlock icon="SearchX" title="No links match" body="No linked entities for this filter. Clear the filters to see all links." /> : null}
        />
        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Invoices" description="Every linked entity between internal invoicing and QuickBooks Online. Open one to inspect the field-level diff." actions={<Button variant="secondary" size="md" leadingIcon={<Icon name="Download" size={15} />}>Export</Button>} />
      <div style={{ padding: "var(--space-7)" }}>
        <Card padded={false}>
          <FilterBar trailing={<span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{total} link{total === 1 ? "" : "s"}</span>}>
            <FilterSelect label="Status" value={status} onChange={onStatus} options={statusOpts} />
            <FilterSelect label="Entity" value={entityType} onChange={onEntity} options={entityOpts} />
          </FilterBar>
          {body}
        </Card>
      </div>
    </>
  );
}
