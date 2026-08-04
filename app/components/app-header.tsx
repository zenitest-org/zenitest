"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { navLinks } from "@/components/app-shared";

export function AppHeader() {
  const pathname = usePathname();
  const navMatch = navLinks.find((item) => item.path === pathname);

  const isRunDetailPage =
    pathname.startsWith("/runs/") &&
    pathname.split("/").filter(Boolean).length >= 2;

  const segments = isRunDetailPage ? pathname.split("/").filter(Boolean) : [];
  const rawRunId = segments[1] || "";

  const { getToken, isSignedIn } = useAuth();

  const { data: executionResponse } = useQuery({
    queryKey: ["execution", rawRunId],
    queryFn: async () => {
      const token = await getToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const response = await fetch(`${apiUrl}/api/executions/${rawRunId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: isSignedIn && isRunDetailPage && !!rawRunId,
  });

  const execNumber = executionResponse?.data?.number;

  let activeItem: { title: string; parent?: { title: string; href: string } };

  if (isRunDetailPage) {
    let displayTitle = "";
    if (execNumber) {
      displayTitle = `#${execNumber}`;
    } else if (/^\d+$/.test(rawRunId)) {
      displayTitle = `#${rawRunId}`;
    } else if (rawRunId.startsWith("#")) {
      displayTitle = rawRunId;
    } else {
      displayTitle = `#${rawRunId}`;
    }

    activeItem = {
      title: displayTitle,
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
