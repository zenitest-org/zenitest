"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { 
	CheckCircle2Icon, 
	XCircleIcon, 
	RefreshCwIcon
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

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
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  const statusFilter = searchParams.get("status") || "all";

  const filteredRuns = mockRuns.filter((run) => {
    const matchesSearch =
      run.suite.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || run.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <Card className="py-0 gap-0 border-none ring-0 shadow-sm">
      <CardContent className="p-0">
        <div className="relative w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-100/70 dark:bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-700 dark:text-zinc-300 font-bold border-b border-zinc-200/80 dark:border-zinc-800/80">
              <tr>
                <th className="px-6 py-3.5 font-bold">Run ID</th>
                <th className="px-6 py-3.5 font-bold">Test Suite</th>
                <th className="px-4 py-3.5 font-bold w-28">Status</th>
                <th className="px-6 py-3.5 font-bold">Passed</th>
                <th className="px-6 py-3.5 font-bold">Duration</th>
                <th className="px-6 py-3.5 font-bold">Triggered By</th>
                <th className="px-6 py-3.5 font-bold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/40">
              {filteredRuns.map((run) => (
                <tr
                  key={run.id}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-5.5 font-mono font-medium text-xs text-zinc-700 dark:text-zinc-300">
                    {run.id}
                  </td>
                  <td className="px-6 py-5.5 font-semibold text-zinc-900 dark:text-zinc-100">
                    {run.suite}
                  </td>
                  <td className="px-4 py-5.5 w-28">
                    {run.status === "passed" && (
                      <Badge
                        variant="outline"
                        className="bg-emerald-50 text-emerald-700 border-emerald-300 gap-1.5 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700 font-medium"
                      >
                        <CheckCircle2Icon className="size-3.5" />
                        Passed
                      </Badge>
                    )}
                    {run.status === "failed" && (
                      <Badge
                        variant="outline"
                        className="bg-rose-50 text-rose-700 border-rose-300 gap-1.5 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-700 font-medium"
                      >
                        <XCircleIcon className="size-3.5" />
                        Failed
                      </Badge>
                    )}
                    {run.status === "running" && (
                      <Badge
                        variant="outline"
                        className="bg-blue-50 text-blue-700 border-blue-300 gap-1.5 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700 font-medium"
                      >
                        <RefreshCwIcon className="size-3.5 animate-spin" />
                        Running
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-5.5 font-medium text-zinc-700 dark:text-zinc-300">
                    {run.tests.passed} / {run.tests.total}
                  </td>
                  <td className="px-6 py-5.5 font-medium text-zinc-700 dark:text-zinc-300">
                    {run.duration}
                  </td>
                  <td className="px-6 py-5.5 text-zinc-600 dark:text-zinc-400 text-xs font-medium">
                    {run.triggeredBy}
                  </td>
                  <td className="px-6 py-5.5 text-zinc-600 dark:text-zinc-400 text-xs font-medium whitespace-nowrap">
                    {run.timestamp}
                  </td>
                </tr>
              ))}
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
