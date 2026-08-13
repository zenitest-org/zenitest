"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  XCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  ChevronDownIcon,
  RocketIcon,
  BookOpenIcon,
  GlobeIcon,
  SmartphoneIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsView } from "@/components/settings-view";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";

type RunStatus = "passed" | "failed" | "running";

interface RunItem {
  id: string;
  number?: number;
  suite: string;
  status: RunStatus;
  platforms: string[];
  tests: { passed: number; total: number };
  duration: string;
  timestamp: string;
  triggeredBy: string;
}

export function PlatformBadge({ platform }: { platform: string }) {
  const norm = platform.toLowerCase().trim();
  const icon =
    norm === "web" ? (
      <GlobeIcon className="size-3" />
    ) : (
      <SmartphoneIcon className="size-3" />
    );
  const label =
    norm === "web"
      ? "Web"
      : norm === "ios"
        ? "iOS"
        : norm === "android"
          ? "Android"
          : platform;

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-800 shrink-0">
      {icon}
      <span>{label}</span>
    </span>
  );
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${minutes}m ${remSec}s`;
}

function formatTimeAgo(isoString: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function RunsTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  const statusFilter = searchParams.get("status") || "all";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = 10;
  const offset = (page - 1) * pageSize;

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const { getToken, isSignedIn } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["executions", statusFilter, page, pageSize],
    queryFn: async () => {
      const token = await getToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));

      const response = await fetch(
        `${apiUrl}/api/executions/query?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to query executions");
      }
      return response.json();
    },
    enabled: isSignedIn,
  });

  const updateParams = (
    newQ: string,
    newStatus: string,
    newPage: number = 1,
  ) => {
    const params = new URLSearchParams();
    if (newQ) params.set("q", newQ);
    if (newStatus && newStatus !== "all") params.set("status", newStatus);
    if (newPage > 1) params.set("page", String(newPage));
    const queryString = params.toString();
    router.replace(pathname + (queryString ? `?${queryString}` : ""));
  };

  const rawExecutions: any[] = data?.data || [];
  const totalItems = data?.meta?.total || rawExecutions.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems > 0 ? offset + 1 : 0;
  const endItem = Math.min(offset + pageSize, totalItems);

  const runs: RunItem[] = rawExecutions.map((item) => ({
    id: item.id,
    number: item.number,
    suite: item.title || `Execution #${item.number || item.id.substring(0, 6)}`,
    status:
      item.status === "completed" || item.status === "passed"
        ? "passed"
        : item.status === "failed" || item.status === "cancelled"
          ? "failed"
          : "running",
    platforms:
      Array.isArray(item.platforms) && item.platforms.length > 0
        ? item.platforms
        : [item.environment || "web"],
    tests: {
      passed: item.passed_test_cases || 0,
      total: item.total_test_cases || 0,
    },
    duration: formatDuration(item.total_duration_ms),
    timestamp: formatTimeAgo(item.created_at),
    triggeredBy: "CLI / Runner",
  }));

  const filteredRuns = runs.filter((run) => {
    const matchesSearch =
      run.suite.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (run.number && `#${run.number}`.includes(searchQuery));
    const matchesStatus = statusFilter === "all" || run.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusOptions = [
    { value: "all", label: "All Status" },
    { value: "passed", label: "Passed" },
    { value: "failed", label: "Failed" },
    { value: "running", label: "Running" },
  ];

  return (
    <div className="space-y-4">
      {/* Table Container Card */}
      <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 shadow-xs overflow-hidden">
        {/* Controls Toolbar */}
        <div className="p-3 sm:px-2 border-b border-zinc-200/80 dark:border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-zinc-950">
          <div className="pl-3 relative flex-1 max-w-sm flex items-center gap-3">
            <SearchIcon className=" text-muted-foreground size-3.5" />
            <input
              type="text"
              placeholder="Search test suite or run ID..."
              value={searchQuery}
              onChange={(e) => updateParams(e.target.value, statusFilter, 1)}
              className="w-full  py-1.5 text-xs text-foreground bg-transparent dark:bg-transparent border-none rounded-lg focus:outline-none focus:ring-0 transition-all placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex items-center gap-1 bg-transparent dark:bg-transparent border-none p-0.5 rounded-lg shrink-0">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateParams(searchQuery, opt.value, 1)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                  statusFilter === opt.value
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table Body */}
        <div className="relative w-full overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-[11px] font-medium tracking-wider uppercase text-muted-foreground border-b border-zinc-200/80 dark:border-zinc-800/80">
              <tr>
                <th className="px-5 py-3 font-semibold">Run ID</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Platforms</th>
                <th className="px-5 py-3 font-semibold">Passed</th>
                <th className="px-5 py-3 font-semibold text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-muted-foreground"
                  >
                    <RefreshCwIcon className="size-4 animate-spin mx-auto mb-2 text-foreground" />
                    <span>Loading test runs...</span>
                  </td>
                </tr>
              ) : filteredRuns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
                      <div className="size-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-foreground border border-zinc-200/80 dark:border-zinc-800">
                        <RocketIcon className="size-5" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xs font-semibold text-foreground">
                          No test executions found
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Run tests using the CLI runner or check your search
                          filters.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => setSettingsModalOpen(true)}
                          className="h-8 text-xs font-medium cursor-pointer"
                        >
                          Get started
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push("/installation")}
                          className="h-8 text-xs font-medium cursor-pointer"
                        >
                          <BookOpenIcon className="size-3.5 mr-1.5" />
                          Read docs
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    className={cn(
                      "transition-colors",
                      run.status === "running"
                        ? "cursor-not-allowed opacity-80 select-none bg-sky-50/20 dark:bg-sky-950/10"
                        : "hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40 cursor-pointer",
                    )}
                    onClick={() => {
                      if (run.status === "running") return;
                      router.push(`/runs/${run.id}`);
                    }}
                  >
                    <td className="px-5 py-3.5 font-medium text-foreground">
                      <span className="font-mono text-xs font-bold text-foreground">
                        {run.number ? `#${run.number}` : run.id}
                      </span>
                    </td>

                    <td className="px-5 py-3.5">
                      {run.status === "passed" && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                          <CheckCircle2Icon className="size-3" />
                          <span>Passed</span>
                        </span>
                      )}
                      {run.status === "failed" && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20">
                          <XCircleIcon className="size-3" />
                          <span>Failed</span>
                        </span>
                      )}
                      {run.status === "running" && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/20">
                          <RefreshCwIcon className="size-3 animate-spin" />
                          <span>Running</span>
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {run.platforms.map((plat) => (
                          <PlatformBadge key={plat} platform={plat} />
                        ))}
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      {(() => {
                        const total = run.tests.total;
                        const passed = run.tests.passed;
                        const pct =
                          total > 0 ? Math.round((passed / total) * 100) : 0;
                        const isSuccess = total > 0 && passed === total;
                        const isZero = total === 0 || passed === 0;

                        return (
                          <div className="flex flex-col gap-1 w-48 sm:w-56">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span
                                className={cn(
                                  "font-semibold",
                                  isSuccess
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : isZero
                                      ? "text-muted-foreground"
                                      : "text-rose-600 dark:text-rose-400",
                                )}
                              >
                                {passed} / {total}
                              </span>
                              <span className="text-[11px] text-muted-foreground font-sans font-medium">
                                {pct}%
                              </span>
                            </div>
                            <div className="w-full bg-zinc-100 dark:bg-zinc-800/80 h-1.5 rounded-none overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-none transition-all duration-300",
                                  isSuccess
                                    ? "bg-emerald-500"
                                    : isZero
                                      ? "bg-zinc-300 dark:bg-zinc-700"
                                      : "bg-rose-500",
                                )}
                                style={{
                                  width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })()}
                    </td>

                    <td className="px-5 py-3.5 text-right font-mono text-xs text-muted-foreground">
                      {run.timestamp}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Container */}
      {totalItems > 0 && (
        <Pagination className="px-1 py-1">
          <div className="text-xs text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">{startItem}</span>-
            <span className="font-medium text-foreground">{endItem}</span> of{" "}
            <span className="font-medium text-foreground">{totalItems}</span>{" "}
            runs
          </div>

          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() =>
                  updateParams(searchQuery, statusFilter, page - 1)
                }
                disabled={page <= 1}
              />
            </PaginationItem>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={p === page}
                  onClick={() => updateParams(searchQuery, statusFilter, p)}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}

            <PaginationItem>
              <PaginationNext
                onClick={() =>
                  updateParams(searchQuery, statusFilter, (p) => p + 1)
                }
                disabled={page >= totalPages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {/* Settings Modal Dialog */}
      <Dialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen}>
        <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <SettingsView />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RunsView() {
  return (
    <Suspense fallback={null}>
      <RunsTable />
    </Suspense>
  );
}
