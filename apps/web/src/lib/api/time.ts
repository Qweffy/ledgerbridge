/* Live relative time. In mock mode the clock is anchored to the fixture's NOW so
   "4s ago" reads right; in live mode it uses the real clock. Ported from the
   bundle's client.jsx (timeAgo / ageSec). */
import { fixtures } from "./fixtures";

const MOCK_MODE = !process.env.NEXT_PUBLIC_API_URL;
let anchorOffset: number | null = null;

function parse(ts: string): number {
  return Date.parse(String(ts).replace(" ", "T"));
}

function now(): number {
  if (!MOCK_MODE) return Date.now();
  if (anchorOffset == null) anchorOffset = parse(fixtures.NOW) - Date.now();
  return Date.now() + anchorOffset;
}

export function timeAgo(ts: string | null | undefined): string {
  if (!ts) return "—";
  const t = parse(String(ts));
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now() - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ageSec(ts: string | null | undefined): number {
  if (!ts) return Infinity;
  const t = parse(String(ts));
  if (Number.isNaN(t)) return Infinity;
  return (now() - t) / 1000;
}
