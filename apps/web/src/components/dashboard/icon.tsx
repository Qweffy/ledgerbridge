/* Thin lucide icon wrapper, keyed by name (the bundle's window.LBIcon → lucide-react).
   Names map 1:1 to lucide-react component names. Extend MAP as screens need more. */
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Filter,
  FlaskConical,
  GitCompareArrows,
  GitMerge,
  Hammer,
  Inbox,
  LayoutDashboard,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Sun,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

const MAP: Record<string, LucideIcon> = {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Filter,
  FlaskConical,
  GitCompareArrows,
  GitMerge,
  Hammer,
  Inbox,
  LayoutDashboard,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Sun,
  X,
  XCircle,
};

export interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  color?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, stroke = 1.75, color = "currentColor", style }: IconProps) {
  const Cmp = MAP[name];
  if (!Cmp) return null;
  return <Cmp size={size} strokeWidth={stroke} color={color} style={{ display: "block", flexShrink: 0, ...style }} aria-hidden />;
}
