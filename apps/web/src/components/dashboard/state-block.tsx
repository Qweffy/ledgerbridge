/* Centered empty/placeholder state (ported from components.jsx StateBlock). */
import type { ReactNode } from "react";
import { Icon } from "./icon";

export interface StateBlockProps {
  icon: string;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}

export function StateBlock({ icon, title, body, action }: StateBlockProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-3)", padding: "var(--space-9) var(--space-5)", textAlign: "center" }}>
      <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
        <Icon name={icon} size={18} />
      </span>
      <div>
        <div style={{ font: "var(--fw-semibold) var(--text-md)/1.3 var(--font-sans)", color: "var(--text-strong)" }}>{title}</div>
        {body && <div style={{ marginTop: 4, font: "var(--text-sm)/1.5 var(--font-sans)", color: "var(--text-muted)", maxWidth: 360 }}>{body}</div>}
      </div>
      {action}
    </div>
  );
}
