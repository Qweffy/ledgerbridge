"use client";
/* Overlay primitives ported from the bundle's overlays.jsx — a right Sheet (drawer),
   a centered ConfirmDialog, and an event-bus toast system. Enter animations are
   CSS keyframes (no enter/exit state, so it's React-Compiler-clean); closing
   unmounts. Esc closes. */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "./icon";

function useEsc(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

export function Sheet({ open, onClose, title, subtitle, headerAccessory, children, footer, width = 580 }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: string;
  headerAccessory?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0 0 0 / 0.48)", backdropFilter: "blur(2px)", animation: "lb-fade var(--dur-normal) var(--ease-out)" }} />
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} style={{ position: "absolute", top: 0, right: 0, height: "100%", width, maxWidth: "94vw", background: "var(--surface-panel)", borderLeft: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", minHeight: 0, animation: "lb-slide-in var(--dur-normal) var(--ease-out)" }}>
        <header style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", padding: "var(--space-5) var(--space-6)", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {subtitle && <div style={{ font: "var(--fw-medium) var(--text-2xs)/1 var(--font-sans)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 6 }}>{subtitle}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, font: "var(--fw-semibold) var(--text-lg)/1.2 var(--font-sans)", color: "var(--text-strong)", letterSpacing: "-0.01em" }}>{title}</h2>
              {headerAccessory}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ width: 30, height: 30, display: "grid", placeItems: "center", background: "transparent", border: "1px solid transparent", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
            <Icon name="X" size={16} />
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--space-6)" }}>{children}</div>
        {footer && <footer style={{ flexShrink: 0, padding: "var(--space-4) var(--space-6)", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "primary", loading = false, onConfirm, onCancel }: {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEsc(open, onCancel);
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: "var(--space-5)" }}>
      <div onClick={loading ? undefined : onCancel} style={{ position: "absolute", inset: 0, background: "oklch(0 0 0 / 0.5)", backdropFilter: "blur(2px)", animation: "lb-fade var(--dur-fast) var(--ease-out)" }} />
      <div role="alertdialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} style={{ position: "relative", width: 420, maxWidth: "100%", background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: "var(--space-6)", animation: "lb-pop var(--dur-fast) var(--ease-out)" }}>
        <h3 style={{ margin: 0, font: "var(--fw-semibold) var(--text-md)/1.3 var(--font-sans)", color: "var(--text-strong)" }}>{title}</h3>
        {body && <p style={{ margin: "var(--space-2) 0 0", font: "var(--text-sm)/1.5 var(--font-sans)", color: "var(--text-muted)", textWrap: "pretty" }}>{body}</p>}
        <div style={{ marginTop: "var(--space-5)", display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button variant="ghost" size="md" disabled={loading} onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone} size="md" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export type ToastTone = "success" | "error" | "info";
interface ToastItem { id: string; message: string; tone: ToastTone }

const TONE: Record<ToastTone, { icon: string; fg: string }> = {
  success: { icon: "CheckCircle2", fg: "var(--status-synced-fg)" },
  error: { icon: "XCircle", fg: "var(--status-failed-fg)" },
  info: { icon: "Info", fg: "var(--text-secondary)" },
};

export function showToast(message: string, tone: ToastTone = "success") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lb-toast", { detail: { message, tone } }));
}

function Toast({ message, tone }: { message: string; tone: ToastTone }) {
  const t = TONE[tone] ?? TONE.info;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "10px 14px", borderRadius: "var(--radius-md)", background: "color-mix(in oklch, var(--surface-raised) 92%, transparent)", backdropFilter: "blur(8px)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-lg)", font: "var(--fw-medium) var(--text-sm)/1.3 var(--font-sans)", color: "var(--text-primary)", animation: "lb-toast var(--dur-normal) var(--ease-out)", maxWidth: 420 }}>
      <Icon name={t.icon} size={16} color={t.fg} />
      {message}
    </div>
  );
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; tone: ToastTone }>).detail;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((x) => [...x, { id, message: detail.message, tone: detail.tone }]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3600);
    };
    window.addEventListener("lb-toast", on);
    return () => window.removeEventListener("lb-toast", on);
  }, []);
  return (
    <div aria-live="polite" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 80, display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none" }}>
      {toasts.map((t) => <Toast key={t.id} message={t.message} tone={t.tone} />)}
    </div>
  );
}
