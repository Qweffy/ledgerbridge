/* The single page-header pattern every dashboard screen reuses (ported from
   PageHeader.jsx): optional eyebrow, title, description, right-aligned actions. */
import type { CSSProperties, ReactNode } from "react";

export interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}

export function PageHeader({ eyebrow, title, description, actions, style }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--space-5)",
        flexWrap: "wrap",
        padding: "var(--space-6) var(--space-7)",
        borderBottom: "1px solid var(--border-subtle)",
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div
            style={{
              font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)",
              letterSpacing: "var(--tracking-caps)",
              textTransform: "uppercase",
              color: "var(--text-faint)",
              marginBottom: "var(--space-2)",
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1 style={{ margin: 0, font: "var(--font-h1)", color: "var(--text-strong)", letterSpacing: "var(--tracking-tight)" }}>{title}</h1>
        {description && (
          <p
            style={{
              margin: "var(--space-2) 0 0",
              maxWidth: 620,
              font: "var(--fw-regular) var(--text-sm)/var(--leading-normal) var(--font-sans)",
              color: "var(--text-muted)",
              textWrap: "pretty",
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}
