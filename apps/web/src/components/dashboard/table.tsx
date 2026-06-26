"use client";
/* Table + filter primitives ported from the bundle's table.jsx — a dense,
   hover/keyboard-activatable DataTable, FilterBar/FilterSelect, Pagination, and the
   link-status + drift pills. Reused by Invoices/Events/Audit. */
import { useState, type CSSProperties, type ReactNode } from "react";
import type { LinkStatus, SyncStatus } from "@ledgerbridge/shared";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Icon } from "./icon";

const LINK_STATUS: Record<LinkStatus, { status: SyncStatus; label: string }> = {
  linked: { status: "synced", label: "Linked" },
  conflict: { status: "conflict", label: "Conflict" },
  error: { status: "failed", label: "Error" },
  skip: { status: "skipped", label: "Skipped" },
};

export function LinkStatusPill({ status, size = "sm" }: { status: LinkStatus; size?: "sm" | "md" }) {
  const m = LINK_STATUS[status] ?? LINK_STATUS.linked;
  return <StatusBadge status={m.status} label={m.label} size={size} />;
}

export function DriftIndicator({ drift }: { drift: boolean }) {
  if (!drift) return <span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 18, padding: "0 7px", borderRadius: "var(--radius-sm)", background: "var(--status-conflict-fill)", color: "var(--status-conflict-fg)", font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", whiteSpace: "nowrap" }}>
      <Icon name="GitCompareArrows" size={11} /> Drift
    </span>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  render?: (row: T, hover: boolean) => ReactNode;
}

export function DataTable<T>({ columns, rows, getRowKey, onRowClick, emptyState }: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
}) {
  const template = columns.map((c) => c.width ?? "minmax(0,1fr)").join(" ");
  if (rows.length === 0 && emptyState) return <>{emptyState}</>;
  return (
    <div role="table" style={{ width: "100%" }}>
      <div role="row" style={{ display: "grid", gridTemplateColumns: template, gap: "var(--space-4)", alignItems: "center", padding: "0 var(--space-5)", height: 34, borderBottom: "1px solid var(--border-subtle)" }}>
        {columns.map((c) => (
          <span key={c.key} role="columnheader" style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)", textAlign: c.align ?? "left" }}>
            {c.header}
          </span>
        ))}
      </div>
      {rows.map((row) => <TableRow key={getRowKey(row)} row={row} columns={columns} template={template} onRowClick={onRowClick} />)}
    </div>
  );
}

function TableRow<T>({ row, columns, template, onRowClick }: { row: T; columns: Column<T>[]; template: string; onRowClick?: (row: T) => void }) {
  const [hover, setHover] = useState(false);
  const clickable = !!onRowClick;
  return (
    <div
      role="row"
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onRowClick?.(row) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick?.(row); } } : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "grid", gridTemplateColumns: template, gap: "var(--space-4)", alignItems: "center", padding: "0 var(--space-5)", height: 48, borderBottom: "1px solid var(--border-subtle)", background: hover && clickable ? "var(--surface-hover)" : "transparent", cursor: clickable ? "pointer" : "default", transition: "background var(--dur-fast)" }}
    >
      {columns.map((c) => (
        <div key={c.key} role="cell" style={{ textAlign: c.align ?? "left", minWidth: 0, display: "flex", justifyContent: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start" }}>
          {c.render ? c.render(row, hover) : <span style={{ font: "var(--text-sm)/1.3 var(--font-sans)", color: "var(--text-secondary)" }}>{String((row as Record<string, unknown>)[c.key] ?? "")}</span>}
        </div>
      ))}
    </div>
  );
}

export function FilterBar({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", padding: "var(--space-4) var(--space-5)", borderBottom: "1px solid var(--border-subtle)" }}>
      {children}
      {trailing && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>{trailing}</div>}
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ font: "var(--fw-medium) var(--text-xs)/1 var(--font-sans)", color: "var(--text-muted)" }}>{label}</span>
      <Select size="sm" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 132 } as CSSProperties}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </label>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const navBtn = (dir: number, disabled: boolean, icon: string, label: string) => (
    <button type="button" aria-label={label} disabled={disabled} onClick={() => onPage(page + dir)} style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", border: "1px solid var(--border-default)", color: disabled ? "var(--text-faint)" : "var(--text-secondary)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <Icon name={icon} size={15} />
    </button>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)", padding: "var(--space-3) var(--space-5)", borderTop: "1px solid var(--border-subtle)" }}>
      <span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{from}–{to} of {total}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {navBtn(-1, page <= 0, "ChevronLeft", "Previous page")}
        <span style={{ font: "var(--text-xs)/1 var(--font-mono)", color: "var(--text-muted)", minWidth: 64, textAlign: "center", whiteSpace: "nowrap" }}>Page {page + 1} / {pages}</span>
        {navBtn(1, page >= pages - 1, "ChevronRight", "Next page")}
      </div>
    </div>
  );
}
