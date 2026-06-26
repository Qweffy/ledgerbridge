import { Placeholder } from "@/components/dashboard/placeholder";

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Placeholder eyebrow="Event" title={id} description="Raw payload and the full audit trail for this event." />;
}
