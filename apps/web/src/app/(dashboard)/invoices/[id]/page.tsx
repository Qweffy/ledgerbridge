import { Placeholder } from "@/components/dashboard/placeholder";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Placeholder eyebrow="Invoice" title={id} description="Side-by-side internal vs QuickBooks diff and the per-entity timeline." />;
}
