"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { navLinks } from "@/components/app-shared";

export function AppHeader() {
  const pathname = usePathname();
  const navMatch = navLinks.find((item) => item.path === pathname);

  let activeItem: { title: string; parent?: { title: string; href: string } };

  if (
    pathname.startsWith("/runs/") &&
    pathname.split("/").filter(Boolean).length >= 2
  ) {
    const segments = pathname.split("/").filter(Boolean);
    const runId = segments[1];
    activeItem = {
      title: runId,
      parent: {
        title: "Runs",
        href: "/runs",
      },
    };
  } else if (navMatch) {
    activeItem = { title: navMatch.title };
  } else {
    activeItem = navLinks[0];
  }

  return (
    <header
      className={cn(
        "mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3",
      )}
    >
      <div className="flex items-center gap-3">
        <AppBreadcrumbs page={activeItem} />
      </div>
    </header>
  );
}
