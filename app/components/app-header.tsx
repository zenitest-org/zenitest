"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, ChevronDownIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { navLinks } from "@/components/app-shared";

function HeaderControls() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isRunsPage = pathname === "/" || pathname === "/runs";
  if (!isRunsPage) return null;

  const searchQuery = searchParams.get("q") || "";
  const statusFilter = searchParams.get("status") || "all";

  const updateParams = (newQ: string, newStatus: string) => {
    const params = new URLSearchParams();
    if (newQ) params.set("q", newQ);
    if (newStatus && newStatus !== "all") params.set("status", newStatus);
    const queryString = params.toString();
    router.replace(pathname + (queryString ? `?${queryString}` : ""));
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search Input on the left of status filter */}
      <div className="relative w-44 sm:w-60">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500" />
        <Input
          placeholder="Search test suite or run ID..."
          value={searchQuery}
          onChange={(e) => updateParams(e.target.value, statusFilter)}
          className="pl-8 h-8 text-xs border-zinc-200 dark:border-zinc-800"
        />
      </div>

      {/* Status Filter Select on the right */}
      <div className="relative">
        <select
          value={statusFilter}
          onChange={(e) => updateParams(searchQuery, e.target.value)}
          className="h-8 rounded-md border border-zinc-200 dark:border-zinc-800 bg-background px-3 py-1 pr-8 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
        >
          <option value="all">All Status</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
        <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500 pointer-events-none" />
      </div>
    </div>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const activeItem =
    navLinks.find((item) => item.path === pathname) || navLinks[0];

  return (
    <header
      className={cn("mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3")}
    >
      <div className="flex items-center gap-3">
        <AppBreadcrumbs page={activeItem} />
      </div>
      <Suspense fallback={null}>
        <HeaderControls />
      </Suspense>
    </header>
  );
}
