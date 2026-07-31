import { AppShell } from "@/components/app-shell";
import { RunsView } from "@/components/runs-view";

export default function HomePage() {
  return (
    <AppShell>
      <RunsView />
    </AppShell>
  );
}
