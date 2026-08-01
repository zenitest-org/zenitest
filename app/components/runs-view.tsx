"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  CheckCircle2Icon,
  XCircleIcon,
  RefreshCwIcon,
  PlayCircleIcon,
  SearchIcon,
  ChevronDownIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type RunStatus = "passed" | "failed" | "running";

interface RunItem {
  id: string;
  suite: string;
  status: RunStatus;
  tests: { passed: number; total: number };
  duration: string;
  timestamp: string;
  triggeredBy: string;
}

const mockRuns: RunItem[] = [
  {
    id: "run-9842",
    suite: "E2E Checkout Flow",
    status: "passed",
    tests: { passed: 42, total: 42 },
    duration: "1m 14s",
    timestamp: "2 mins ago",
    triggeredBy: "GitHub Action (#412)",
  },
  {
    id: "run-9841",
    suite: "Auth & Session Verification",
    status: "running",
    tests: { passed: 18, total: 24 },
    duration: "45s",
    timestamp: "In progress",
    triggeredBy: "Shaban Haider",
  },
  {
    id: "run-9840",
    suite: "Payment Gateway Integration",
    status: "failed",
    tests: { passed: 11, total: 14 },
    duration: "2m 05s",
    timestamp: "1 hour ago",
    triggeredBy: "CLI Runner",
  },
  {
    id: "run-9839",
    suite: "Dashboard Layout & Components",
    status: "passed",
    tests: { passed: 88, total: 88 },
    duration: "48s",
    timestamp: "3 hours ago",
    triggeredBy: "GitHub Action (#411)",
  },
  {
    id: "run-9838",
    suite: "User Permissions & Roles",
    status: "passed",
    tests: { passed: 31, total: 31 },
    duration: "1m 02s",
    timestamp: "5 hours ago",
    triggeredBy: "Shaban Haider",
  },
];

function RunsTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  const statusFilter = searchParams.get("status") || "all";

  const updateParams = (newQ: string, newStatus: string) => {
    const params = new URLSearchParams();
    if (newQ) params.set("q", newQ);
    if (newStatus && newStatus !== "all") params.set("status", newStatus);
    const queryString = params.toString();
    router.replace(pathname + (queryString ? `?${queryString}` : ""));
  };

  const filteredRuns = mockRuns.filter((run) => {
    const matchesSearch =
      run.suite.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || run.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <Card className="py-0 gap-0">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3">
        <div className="relative w-full sm:w-72">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search test suite or run ID..."
            value={searchQuery}
            onChange={(e) => updateParams(e.target.value, statusFilter)}
            className="pl-8 h-8 text-xs border-zinc-200 dark:border-zinc-800"
          />
        </div>

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
              {filteredRuns.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-muted-foreground"
                  >
                    No test runs found.
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
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{run.id}</span>
                      </div>
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
  );
}

export function RunsView() {
  return (
    <Suspense fallback={null}>
      <RunsTable />
    </Suspense>
  );
}
