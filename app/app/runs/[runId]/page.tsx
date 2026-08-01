import { AppShell } from "@/components/app-shell";
import { RunDetailView } from "@/components/run-detail-view";

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunDetailPage({ params }: PageProps) {
  const { runId } = await params;

  return (
    <AppShell>
      <RunDetailView runId={runId} />
    </AppShell>
  );
}
