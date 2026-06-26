/* Temporary screen scaffold — each route renders this until its M9 chunk lands. */
import type { ReactNode } from "react";
import { PageHeader } from "./page-header";
import { StateBlock } from "./state-block";

export function Placeholder({ title, description, eyebrow }: { title: string; description?: ReactNode; eyebrow?: string }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div style={{ padding: "var(--space-7)" }}>
        <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)" }}>
          <StateBlock icon="Hammer" title={`${title} — coming next`} body="This screen lands in the next M9 chunk." />
        </div>
      </div>
    </>
  );
}
