"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import {
  Check,
  Hash,
  Search,
  Plus,
  MoreHorizontal,
  RotateCcw,
  Sun,
  Moon,
} from "lucide-react";
import { syncStatusSchema } from "@ledgerbridge/shared";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Kbd } from "@/components/ui/kbd";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs font-medium tracking-caps text-faint-foreground uppercase">
        {title}
      </h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export default function DesignGallery() {
  const { resolvedTheme, setTheme } = useTheme();
  const [tab, setTab] = useState("overview");

  return (
    <main className="mx-auto max-w-[1120px] px-8 py-12">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            LedgerBridge — Design System
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Component gallery · pixel-perfect import
          </p>
        </div>
        <IconButton
          label="Toggle theme"
          variant="outline"
          size="lg"
          onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")}
        >
          {resolvedTheme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </IconButton>
      </div>

      <div className="flex flex-col gap-12">
        <Section title="Buttons">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" leadingIcon={<Plus size={16} />}>
            New invoice
          </Button>
          <Button variant="secondary" loading>
            Syncing
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
        </Section>

        <Section title="Icon buttons">
          <IconButton label="Search" variant="ghost">
            <Search size={16} />
          </IconButton>
          <IconButton label="Add" variant="outline">
            <Plus size={16} />
          </IconButton>
          <IconButton label="More" variant="solid">
            <MoreHorizontal size={16} />
          </IconButton>
          <IconButton label="Replay" variant="ghost" disabled>
            <RotateCcw size={16} />
          </IconButton>
        </Section>

        <Section title="Status badges">
          {syncStatusSchema.options.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
          <StatusBadge status="synced" variant="outline" />
          <StatusBadge status="inflight" variant="solid" />
          <StatusBadge status="conflict" size="sm" />
        </Section>

        <Section title="Badges">
          <Badge tone="neutral">neutral</Badge>
          <Badge tone="accent">accent</Badge>
          <Badge tone="green">green</Badge>
          <Badge tone="amber">amber</Badge>
          <Badge tone="red">red</Badge>
          <Badge tone="violet">violet</Badge>
          <Badge tone="accent" variant="outline">
            outline
          </Badge>
          <Badge tone="green" variant="solid">
            solid
          </Badge>
        </Section>

        <Section title="Inputs & selects">
          <Input placeholder="Customer name" className="w-[220px]" />
          <Input
            placeholder="Search invoices"
            leadingIcon={<Search size={15} />}
            className="w-[220px]"
          />
          <Input
            mono
            defaultValue="INV-20294"
            leadingIcon={<Hash size={15} />}
            className="w-[180px]"
          />
          <Input invalid defaultValue="bad@" className="w-[180px]" />
          <Input disabled placeholder="Disabled" className="w-[160px]" />
          <Select className="w-[160px]" defaultValue="all">
            <option value="all">All statuses</option>
            <option value="synced">Synced</option>
            <option value="conflict">Conflict</option>
          </Select>
        </Section>

        <Section title="Checkbox & switch">
          <Checkbox label="Auto-reconcile" defaultChecked />
          <Checkbox label="Unchecked" />
          <Checkbox label="Indeterminate" indeterminate />
          <Checkbox label="Disabled" disabled />
          <Switch label="Webhooks enabled" defaultChecked />
          <Switch label="Off" />
          <Switch label="Small" size="sm" defaultChecked />
        </Section>

        <Section title="Surfaces">
          <Card
            title="Sync health"
            description="Last reconcile 2m ago"
            actions={
              <IconButton label="More">
                <MoreHorizontal size={16} />
              </IconButton>
            }
            className="w-[320px]"
          >
            <p className="text-sm text-foreground-secondary">
              Every event reconciled cleanly.
            </p>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Synced" value="1,284" icon={<Check size={14} />} />
            <Stat
              label="In flight"
              value="12"
              delta="+4"
              deltaTone="up"
              unit="events"
            />
            <Stat label="Conflicts" value="3" delta="+1" deltaTone="warn" />
            <Stat label="Dead-letter" value="0" delta="0" deltaTone="neutral" />
          </div>
        </Section>

        <Section title="Avatar & kbd">
          <Avatar name="Nico Mastakas" />
          <Avatar name="Finance Ops" size={32} />
          <Avatar tone="system" name="System" size={32} />
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <Kbd>Esc</Kbd>
        </Section>

        <Section title="Tabs">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "overview", label: "Overview" },
              { value: "invoices", label: "Invoices", count: 128 },
              { value: "conflicts", label: "Conflicts", count: 3 },
              { value: "audit", label: "Audit" },
            ]}
          />
        </Section>
      </div>
    </main>
  );
}
