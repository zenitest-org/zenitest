import { AppShell } from "@/components/app-shell";
import { SettingsView } from "@/components/settings-view";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="flex-1 flex flex-col items-center justify-center py-6 w-full">
        <SettingsView />
      </div>
    </AppShell>
  );
}
