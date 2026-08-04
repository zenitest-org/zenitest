"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import {
  CheckCircle2Icon,
  XCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  ChevronDownIcon,
  RocketIcon,
  BookOpenIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  tests: { passed: number; total: number };
  duration: string;
  timestamp: string;
  triggeredBy: string;
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

      const response = await fetch(`${apiUrl}/api/executions/query?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to query executions");
      }
      return response.json();
    },
    enabled: isSignedIn,
  });

  const updateParams = (newQ: string, newStatus: string, newPage: number = 1) => {
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
    status: item.status === "completed" || item.status === "passed" ? "passed" : item.status === "failed" || item.status === "cancelled" ? "failed" : "running",
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

  return (
    <div className="space-y-3">
      <Card className="py-0 gap-0">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2">
          <div className="relative w-full sm:w-72">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search test suite or run ID..."
              value={searchQuery}
              onChange={(e) => updateParams(e.target.value, statusFilter, 1)}
              className="pl-8 h-8 text-xs border-none shadow-none bg-transparent dark:bg-transparent focus-visible:ring-0 focus-visible:border-none focus:outline-none"
            />
          </div>

          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => updateParams(searchQuery, e.target.value, 1)}
              className="h-8 rounded-md border-none bg-background px-3 py-1 pr-8 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-0 appearance-none shadow-none"
            >
              <option value="all">All Status</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
            </select>
            <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative w-full overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-y">
                <tr>
                  <th className="px-6 py-3 font-semibold">Run ID</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Passed</th>
                  <th className="px-6 py-3 font-semibold">Duration</th>
                  <th className="px-6 py-3 font-semibold">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground text-xs">
                      <RefreshCwIcon className="size-4 animate-spin mx-auto mb-2" />
                      Loading executions...
                    </td>
                  </tr>
                ) : filteredRuns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
                        <div className="size-10 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground border border-border/40">
                          <RocketIcon className="size-5" />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold text-foreground">
                            No test executions found
                          </h3>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Set up your ZeniTest CLI or API key to start running automated test suites.
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
                      className="hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => router.push(`/runs/${run.id}`)}
                    >
                      <td className="px-6 py-4 font-medium text-foreground">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {run.number ? `#${run.number}` : run.id}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">
                        {run.status === "passed" && (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-300 gap-1.5 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700 font-normal text-[11px]"
                          >
                            <CheckCircle2Icon className="size-3.5" />
                            Passed
                          </Badge>
                        )}
                        {run.status === "failed" && (
                          <Badge
                            variant="outline"
                            className="bg-rose-50 text-rose-700 border-rose-300 gap-1.5 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-700 font-normal text-[11px]"
                          >
                            <XCircleIcon className="size-3.5" />
                            Failed
                          </Badge>
                        )}
                        {run.status === "running" && (
                          <Badge
                            variant="outline"
                            className="bg-blue-50 text-blue-700 border-blue-300 gap-1.5 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700 font-normal text-[11px]"
                          >
                            <RefreshCwIcon className="size-3.5 animate-spin" />
                            Running
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                        {run.tests.passed} / {run.tests.total}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">
                        {run.duration}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">
                        <Badge
                          variant="secondary"
                          className="font-normal text-[11px]"
                        >
                          {run.timestamp}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Shadcn Pagination Component Outside Below Table */}
      {totalItems > 0 && (
        <Pagination className="px-1 py-1">
          <div className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground">{startItem}</span>-
            <span className="font-medium text-foreground">{endItem}</span> of{" "}
            <span className="font-medium text-foreground">{totalItems}</span> runs
          </div>

          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => updateParams(searchQuery, statusFilter, page - 1)}
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
                onClick={() => updateParams(searchQuery, statusFilter, page + 1)}
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
