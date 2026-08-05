"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import {
  CheckCircle2Icon,
  XCircleIcon,
  CheckIcon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  TerminalIcon,
  InfoIcon,
  LayersIcon,
  ImageIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type StepType = "act" | "navigate" | "validate";

export interface StepItem {
  id: string;
  description: string;
  type: StepType;
  status?: "passed" | "failed";
}

export interface NetworkItem {
  id: string;
  method: string;
  url: string;
  status: number;
  time?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  responseHeaders?: Record<string, string>;
  responseBody?: string | null;
}

export interface LogItem {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface TestCaseInfo {
  specFile: string;
  browser: string;
  duration: string;
  url: string;
}

export interface ScreenshotItem {
  id: string;
  title: string;
  url?: string;
}

export interface TestCaseData {
  id: string;
  title: string;
  status: "passed" | "failed";
  duration: string;
  steps: StepItem[];
  network: NetworkItem[];
  logs: LogItem[];
  info: TestCaseInfo;
  screenshots: ScreenshotItem[];
}

const mockTestCases: TestCaseData[] = [
  {
    id: "tc-1",
    title: "TC-01: Verify user login with valid credentials",
    status: "passed",
    duration: "2.4s",
    steps: [
      {
        id: "s1",
        description: "Navigate to login page (/login)",
        type: "navigate",
        status: "passed",
      },
      {
        id: "s2",
        description: "Fill email address and password input fields",
        type: "act",
        status: "passed",
      },
      {
        id: "s3",
        description: "Click on 'Sign In' submit button",
        type: "act",
        status: "passed",
      },
      {
        id: "s4",
        description: "Validate redirect response to /dashboard URL",
        type: "validate",
        status: "passed",
      },
      {
        id: "s5",
        description: "Validate user profile greeting banner is visible",
        type: "validate",
        status: "passed",
      },
    ],
    network: [
      {
        id: "n1",
        method: "GET",
        url: "https://app.zenitest.com/login",
        status: 200,
        requestHeaders: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        responseHeaders: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
        },
        responseBody:
          '<!DOCTYPE html>\n<html>\n  <head><title>Login - ZeniTest</title></head>\n  <body><div id="root"></div></body>\n</html>',
      },
      {
        id: "n2",
        method: "POST",
        url: "https://app.zenitest.com/api/auth/login",
        status: 200,
        requestHeaders: {
          "content-type": "application/json",
          accept: "application/json",
        },
        requestBody: JSON.stringify(
          { email: "user@example.com", password: "••••••••" },
          null,
          2,
        ),
        responseHeaders: {
          "content-type": "application/json",
          "set-cookie": "session_id=sess_abc123; Path=/; HttpOnly; Secure",
        },
        responseBody: JSON.stringify(
          {
            success: true,
            user: { id: "u_1", email: "user@example.com", name: "Alex" },
          },
          null,
          2,
        ),
      },
      {
        id: "n3",
        method: "GET",
        url: "https://app.zenitest.com/api/user/profile",
        status: 200,
        requestHeaders: {
          authorization: "Bearer eyJhbGciOiJIUzI1Ni...",
          accept: "application/json",
        },
        responseHeaders: {
          "content-type": "application/json",
        },
        responseBody: JSON.stringify(
          { id: "u_1", name: "Alex", role: "admin" },
          null,
          2,
        ),
      },
      {
        id: "n4",
        method: "GET",
        url: "https://app.zenitest.com/api/analytics/summary",
        status: 200,
        requestHeaders: {
          accept: "application/json",
        },
        responseHeaders: {
          "content-type": "application/json",
        },
        responseBody: JSON.stringify(
          { totalRuns: 142, passRate: 0.98 },
          null,
          2,
        ),
      },
    ],
    logs: [
      {
        id: "l1",
        timestamp: "00:00.110",
        level: "info",
        message: "Navigating to http://localhost:3000/login...",
      },
      {
        id: "l2",
        timestamp: "00:00.430",
        level: "info",
        message: "Submitting auth payload for user@example.com",
      },
      {
        id: "l3",
        timestamp: "00:00.750",
        level: "info",
        message: "Auth successful. Token saved to session storage.",
      },
      {
        id: "l4",
        timestamp: "00:01.200",
        level: "info",
        message: "Dashboard element #user-banner successfully found.",
      },
    ],
    info: {
      specFile: "tests/e2e/auth.spec.ts",
      browser: "Chromium 124.0",
      duration: "2.4s",
      url: "http://localhost:3000/login",
    },
    screenshots: [
      { id: "sc1", title: "Step 1: Login Page Loaded" },
      { id: "sc2", title: "Step 2: Credentials Entered" },
      { id: "sc3", title: "Step 3: Sign In Clicked" },
      { id: "sc4", title: "Step 4: Redirected to Dashboard" },
      { id: "sc5", title: "Step 5: Profile Banner Verified" },
    ],
  },
  {
    id: "tc-2",
    title: "TC-02: Checkout cart with promotional discount code",
    status: "passed",
    duration: "3.8s",
    steps: [
      {
        id: "s21",
        description: "Navigate to shopping cart page (/cart)",
        type: "navigate",
        status: "passed",
      },
      {
        id: "s22",
        description: "Enter coupon code 'SUMMER2026' into promo field",
        type: "act",
        status: "passed",
      },
      {
        id: "s23",
        description: "Click 'Apply Coupon' button",
        type: "act",
        status: "passed",
      },
      {
        id: "s24",
        description: "Validate 20% discount subtotal deduction",
        type: "validate",
        status: "passed",
      },
    ],
    network: [
      { id: "n21", method: "GET", url: "/cart", status: 200, time: "85ms" },
      {
        id: "n22",
        method: "POST",
        url: "/api/cart/apply-coupon",
        status: 200,
        time: "210ms",
      },
      {
        id: "n23",
        method: "GET",
        url: "/checkout",
        status: 200,
        time: "140ms",
      },
    ],
    logs: [
      {
        id: "l21",
        timestamp: "00:00.085",
        level: "info",
        message: "Cart view rendered with 2 items.",
      },
      {
        id: "l22",
        timestamp: "00:01.120",
        level: "info",
        message: "Posting code SUMMER2026 to endpoint.",
      },
      {
        id: "l23",
        timestamp: "00:01.330",
        level: "info",
        message: "Coupon applied: -$15.00 discount verified.",
      },
    ],
    info: {
      specFile: "tests/e2e/checkout.spec.ts",
      browser: "Chromium 124.0",
      duration: "3.8s",
      url: "http://localhost:3000/cart",
    },
    screenshots: [
      { id: "sc21", title: "Step 1: Shopping Cart Page Loaded" },
      { id: "sc22", title: "Step 2: Coupon SUMMER2026 Entered" },
      { id: "sc23", title: "Step 3: Apply Coupon Clicked" },
      { id: "sc24", title: "Step 4: 20% Discount Deduction Verified" },
    ],
  },
  {
    id: "tc-3",
    title: "TC-03: Validate credit card decline handling",
    status: "failed",
    duration: "4.1s",
    steps: [
      {
        id: "s31",
        description: "Navigate to checkout payment step (/checkout/payment)",
        type: "navigate",
        status: "passed",
      },
      {
        id: "s32",
        description: "Enter test declined card details (4000 0000 0000 0002)",
        type: "act",
        status: "passed",
      },
      {
        id: "s33",
        description: "Click 'Complete Order' button",
        type: "act",
        status: "passed",
      },
      {
        id: "s34",
        description: "Validate card declined error dialog is displayed",
        type: "validate",
        status: "failed",
      },
    ],
    network: [
      {
        id: "n31",
        method: "GET",
        url: "/checkout/payment",
        status: 200,
        time: "95ms",
      },
      {
        id: "n32",
        method: "POST",
        url: "/api/payment/charge",
        status: 402,
        time: "540ms",
      },
    ],
    logs: [
      {
        id: "l31",
        timestamp: "00:00.095",
        level: "info",
        message: "Payment form rendered.",
      },
      {
        id: "l32",
        timestamp: "00:01.400",
        level: "warn",
        message: "API endpoint returned status 402 Payment Required.",
      },
      {
        id: "l33",
        timestamp: "00:02.100",
        level: "error",
        message: "Assert error: Expected error modal to auto-dismiss after 3s.",
      },
    ],
    info: {
      specFile: "tests/e2e/payment.spec.ts",
      browser: "Firefox 125.0",
      duration: "4.1s",
      url: "http://localhost:3000/checkout/payment",
    },
    screenshots: [
      { id: "sc31", title: "Step 1: Payment Page Loaded" },
      { id: "sc32", title: "Step 2: Declined Card Info Entered" },
      { id: "sc33", title: "Step 3: Complete Order Clicked" },
      { id: "sc34", title: "Step 4: Card Declined Error Modal Shown" },
    ],
  },
];

function StepTypeBadge({ type }: { type: StepType }) {
  const styles = {
    navigate:
      "text-sky-600 dark:text-sky-400 font-mono text-[10px] tracking-wider uppercase font-semibold",
    act: "text-purple-600 dark:text-purple-400 font-mono text-[10px] tracking-wider uppercase font-semibold",
    validate:
      "text-emerald-600 dark:text-emerald-400 font-mono text-[10px] tracking-wider uppercase font-semibold",
  };

  return (
    <span className={cn("px-1 py-0.5 shrink-0 select-none", styles[type])}>
      {type}
    </span>
  );
}

function NetworkUrlValue({ url }: { url: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = url.length > 90;

  return (
    <div className="sm:col-span-8 flex flex-col items-end gap-0.5">
      <span
        className={cn(
          "text-muted-foreground text-right [word-break:break-word] select-all font-normal transition-all",
          !expanded && "line-clamp-3",
        )}
        title={url}
      >
        {url}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-primary hover:underline font-medium focus:outline-none shrink-0"
        >
          {expanded ? "Show less" : "See all"}
        </button>
      )}
    </div>
  );
}

function NetworkHeadersSection({
  headers,
}: {
  headers?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!headers || Object.keys(headers).length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic font-mono p-3">
        No headers recorded.
      </div>
    );
  }

  const entries = Object.entries(headers);
  const isLong = entries.length > 5;
  const visibleEntries = expanded ? entries : entries.slice(0, 5);

  return (
    <div className="font-mono text-[11px] divide-y divide-border/30 border-b border-border/30">
      {visibleEntries.map(([key, val]) => (
        <div
          key={key}
          className="grid grid-cols-1 sm:grid-cols-12 gap-1 py-1.5 px-3 hover:bg-muted/20 transition-colors"
        >
          <span className="sm:col-span-4 text-foreground/80 font-medium break-all select-all">
            {key}:
          </span>
          <span className="sm:col-span-8 text-muted-foreground text-right break-all select-all font-normal">
            {val}
          </span>
        </div>
      ))}
      {isLong && (
        <div className="py-1.5 px-3 flex justify-end bg-muted/10">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-primary hover:underline font-medium focus:outline-none"
          >
            {expanded ? "Show less" : `See all (${entries.length - 5} more)`}
          </button>
        </div>
      )}
    </div>
  );
}

function renderNetworkHeaders(headers?: Record<string, string>) {
  return <NetworkHeadersSection headers={headers} />;
}

function renderNetworkBody(body?: string | null) {
  if (!body || body.trim() === "") {
    return (
      <div className="text-xs text-muted-foreground italic font-mono p-3">
        No body recorded.
      </div>
    );
  }

  let formatted = body;
  try {
    const parsed = JSON.parse(body);
    formatted = JSON.stringify(parsed, null, 2);
  } catch (_) {}

  return (
    <pre className="font-mono text-[11px] text-foreground/90 overflow-auto w-full h-full p-3 m-0 whitespace-pre">
      <code>{formatted}</code>
    </pre>
  );
}

function TestCaseDetail({ tc }: { tc: TestCaseData }) {
  const [selectedNetworkItem, setSelectedNetworkItem] =
    useState<NetworkItem | null>(null);
  const screenshots = tc.screenshots || [];
  const [screenshotIndex, setScreenshotIndex] = useState(() =>
    screenshots.length > 0 ? screenshots.length - 1 : 0,
  );
  const currentShot = screenshots[screenshotIndex];

  const prevShot = () => setScreenshotIndex((i) => Math.max(0, i - 1));
  const nextShot = () =>
    setScreenshotIndex((i) => Math.min(screenshots.length - 1, i + 1));

  return (
    <Tabs defaultValue="steps" className="w-full flex flex-col">
      {/* Connected Top Header Row spanning 100% width with unbroken bottom border */}
      <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-border/40 border-b border-border/40">
        {/* Left Header: Tabs */}
        <div className="lg:col-span-2 flex items-center px-4 lg:px-5 h-10">
          <TabsList className="w-fit justify-start bg-transparent p-0 h-full gap-6 border-none rounded-none">
            <TabsTrigger
              value="steps"
              className="rounded-none bg-transparent p-0 h-full text-xs font-semibold border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground hover:text-foreground shadow-none flex items-center gap-1.5 -mb-px"
            >
              <LayersIcon className="size-3.5" />
              Steps
            </TabsTrigger>
            <TabsTrigger
              value="network"
              className="rounded-none bg-transparent p-0 h-full text-xs font-semibold border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground hover:text-foreground shadow-none flex items-center gap-1.5 -mb-px"
            >
              <GlobeIcon className="size-3.5" />
              Network
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="rounded-none bg-transparent p-0 h-full text-xs font-semibold border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground hover:text-foreground shadow-none flex items-center gap-1.5 -mb-px"
            >
              <TerminalIcon className="size-3.5" />
              Logs
            </TabsTrigger>
            <TabsTrigger
              value="info"
              className="rounded-none bg-transparent p-0 h-full text-xs font-semibold border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground hover:text-foreground shadow-none flex items-center gap-1.5 -mb-px"
            >
              <InfoIcon className="size-3.5" />
              Info
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Right Header: Screenshot Title & Pagination */}
        <div className="lg:col-span-3 flex items-center justify-center px-4 lg:px-5 h-10">
          {currentShot ? (
            <div className="flex items-center gap-1 min-w-0 max-w-full">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6 rounded-md shrink-0 transition-colors",
                  screenshotIndex === 0
                    ? "text-muted-foreground/30 opacity-40 cursor-not-allowed"
                    : "text-black dark:text-white hover:bg-muted cursor-pointer",
                )}
                onClick={prevShot}
                disabled={screenshotIndex === 0}
                title="Previous screenshot"
              >
                <ChevronLeftIcon className="size-3.5 stroke-[1.75]" />
              </Button>
              <span
                className="w-64 sm:w-80 max-w-full text-[11px] text-muted-foreground truncate text-center select-none px-1 block"
                title={`Screenshot ${screenshotIndex + 1}/${screenshots.length}: ${currentShot.title.replace(/^Step \d+:\s*/, "")}`}
              >
                <span className="font-mono text-muted-foreground/70 mr-1">
                  Screenshot {screenshotIndex + 1}/{screenshots.length}:
                </span>
                <span className="font-normal text-foreground/80">
                  {currentShot.title.replace(/^Step \d+:\s*/, "")}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6 rounded-md shrink-0 transition-colors",
                  screenshotIndex >= screenshots.length - 1
                    ? "text-muted-foreground/30 opacity-40 cursor-not-allowed"
                    : "text-black dark:text-white hover:bg-muted cursor-pointer",
                )}
                onClick={nextShot}
                disabled={screenshotIndex >= screenshots.length - 1}
                title="Next screenshot"
              >
                <ChevronRightIcon className="size-3.5 stroke-[1.75]" />
              </Button>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              No screenshots
            </span>
          )}
        </div>
      </div>

      {/* Content Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-border/40 min-h-[350px]">
        {/* Left Content Area */}
        <div className="lg:col-span-2 flex flex-col h-full min-h-0">
          <TabsContent
            value="steps"
            className="mt-0 space-y-1 h-full flex-1 overflow-y-auto min-h-0 max-h-[500px]"
          >
            {tc.steps.map((step, idx) => (
              <div
                key={step.id}
                onClick={() => setScreenshotIndex(idx)}
                className={cn(
                  "flex items-center justify-between gap-3 px-5 py-2 transition-colors cursor-pointer",
                  step.status === "failed"
                    ? "bg-rose-500/5 dark:bg-rose-950/20 hover:bg-rose-500/10 dark:hover:bg-rose-950/30"
                    : "hover:bg-muted/40",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {step.status === "failed" ? (
                    <XIcon className="size-3.5 text-rose-600 dark:text-rose-400 shrink-0 stroke-[2.5]" />
                  ) : (
                    <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[2.5]" />
                  )}
                  <span className="text-xs font-medium text-foreground/90 leading-relaxed truncate">
                    {step.description}
                  </span>
                </div>
                <StepTypeBadge type={step.type} />
              </div>
            ))}
          </TabsContent>

          <TabsContent
            value="network"
            className="mt-0 h-full flex-1 flex flex-col min-h-0 relative overflow-hidden"
          >
            <div className="bg-background h-full flex-1 overflow-y-auto min-h-0 max-h-[500px]">
              {tc.network.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No network requests recorded for this test.
                </div>
              ) : (
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted/50 border-b border-border/40">
                    <tr className="text-[11px] font-semibold text-muted-foreground uppercase">
                      <th className="py-2.5 px-4 bg-muted/50">Method</th>
                      <th className="py-2.5 px-4 bg-muted/50">URL</th>
                      <th className="py-2.5 px-4 bg-muted/50">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {tc.network.map((req) => {
                      const isSelected = selectedNetworkItem?.id === req.id;
                      return (
                        <tr
                          key={req.id}
                          onClick={() => setSelectedNetworkItem(req)}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSelected
                              ? "bg-primary/10 dark:bg-primary/20"
                              : "hover:bg-muted/30",
                          )}
                        >
                          <td className="py-2.5 px-4 font-mono font-semibold text-[11px]">
                            {req.method}
                          </td>
                          <td
                            className="py-2.5 px-4 font-mono text-muted-foreground truncate max-w-[180px] sm:max-w-[260px]"
                            title={req.url}
                          >
                            {req.url}
                          </td>
                          <td className="py-2.5 px-4">
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-mono text-[10px] px-1.5 py-0 rounded",
                                req.status < 300
                                  ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20"
                                  : req.status < 400
                                    ? "text-amber-600 bg-amber-500/10 border-amber-500/20"
                                    : "text-rose-600 bg-rose-500/10 border-rose-500/20",
                              )}
                            >
                              {req.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Inline Drawer inside Network Table container */}
            {selectedNetworkItem && (
              <div className="absolute top-0 right-0 bottom-0 w-[80%] sm:w-[80%] max-w-full z-20 bg-background flex flex-col border-l border-border/40 shadow-xl animate-in slide-in-from-right duration-200">
                <Tabs
                  defaultValue="headers"
                  className="w-full flex flex-col h-full min-h-0"
                >
                  {/* Header Row: Close button on left, 3 tabs on right */}
                  <div className="px-3 h-9 border-b border-border/40 flex items-center justify-between bg-muted/20 shrink-0 gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedNetworkItem(null)}
                      className="size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 shrink-0"
                      title="Close details"
                    >
                      <XIcon className="size-3.5" />
                      <span className="sr-only">Close</span>
                    </Button>

                    <TabsList className="bg-transparent p-0 h-9 shrink-0 gap-4 border-b-0 rounded-none">
                      <TabsTrigger
                        value="headers"
                        className="h-9 px-0.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-semibold text-muted-foreground hover:text-foreground transition-all"
                      >
                        Headers
                      </TabsTrigger>
                      <TabsTrigger
                        value="request"
                        className="h-9 px-0.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-semibold text-muted-foreground hover:text-foreground transition-all"
                      >
                        Request
                      </TabsTrigger>
                      <TabsTrigger
                        value="response"
                        className="h-9 px-0.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-semibold text-muted-foreground hover:text-foreground transition-all"
                      >
                        Response
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* Tab Contents */}
                  <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                    <TabsContent
                      value="headers"
                      className="mt-0 space-y-0 p-0 overflow-y-auto flex-1 min-h-0"
                    >
                      {/* General Section */}
                      <div>
                        <h4 className="text-[11px] font-semibold text-foreground/90 uppercase tracking-wider font-mono px-3 py-1.5 bg-muted/40 border-b border-border/30">
                          General
                        </h4>
                        <div className="font-mono text-[11px] divide-y divide-border/30 border-b border-border/30">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1 py-1.5 px-3 hover:bg-muted/20 transition-colors items-start">
                            <span className="sm:col-span-4 text-foreground/80 font-medium select-all">
                              Request URL:
                            </span>
                            <NetworkUrlValue url={selectedNetworkItem.url} />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1 py-1.5 px-3 hover:bg-muted/20 transition-colors">
                            <span className="sm:col-span-4 text-foreground/80 font-medium select-all">
                              Request Method:
                            </span>
                            <span className="sm:col-span-8 text-foreground text-right font-semibold select-all">
                              {selectedNetworkItem.method}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1 py-1.5 px-3 items-center hover:bg-muted/20 transition-colors">
                            <span className="sm:col-span-4 text-foreground/80 font-medium select-all">
                              Status Code:
                            </span>
                            <div className="sm:col-span-8 flex items-center justify-end gap-1.5">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-mono text-[10px] px-1.5 py-0 rounded shrink-0",
                                  selectedNetworkItem.status < 300
                                    ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20"
                                    : selectedNetworkItem.status < 400
                                      ? "text-amber-600 bg-amber-500/10 border-amber-500/20"
                                      : "text-rose-600 bg-rose-500/10 border-rose-500/20",
                                )}
                              >
                                {selectedNetworkItem.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Response Headers Section */}
                      <div>
                        <h4 className="text-[11px] font-semibold text-foreground/90 uppercase tracking-wider font-mono px-3 py-1.5 bg-muted/40 border-b border-border/30">
                          Response Headers
                        </h4>
                        {renderNetworkHeaders(
                          selectedNetworkItem.responseHeaders,
                        )}
                      </div>

                      {/* Request Headers Section */}
                      <div>
                        <h4 className="text-[11px] font-semibold text-foreground/90 uppercase tracking-wider font-mono px-3 py-1.5 bg-muted/40 border-b border-border/30">
                          Request Headers
                        </h4>
                        {renderNetworkHeaders(
                          selectedNetworkItem.requestHeaders,
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent
                      value="request"
                      className="mt-0 h-full flex-1 overflow-auto min-h-0 p-0"
                    >
                      {renderNetworkBody(selectedNetworkItem.requestBody)}
                    </TabsContent>

                    <TabsContent
                      value="response"
                      className="mt-0 h-full flex-1 overflow-auto min-h-0 p-0"
                    >
                      {renderNetworkBody(selectedNetworkItem.responseBody)}
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            )}
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent
            value="logs"
            className="mt-0 h-full flex-1 flex flex-col min-h-0"
          >
            {tc.logs.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground font-mono">
                No console logs recorded for this test.
              </div>
            ) : (
              <div className="bg-background py-3 px-5 font-mono text-xs space-y-1.5 h-full flex-1 overflow-y-auto min-h-0 max-h-[500px]">
                {tc.logs.map((log) => (
                  <div key={log.id} className="flex gap-2 font-mono">
                    <span className="text-muted-foreground shrink-0">
                      [{log.timestamp}]
                    </span>
                    <span
                      className={cn(
                        log.level === "error"
                          ? "text-rose-600 dark:text-rose-400 font-semibold"
                          : log.level === "warn"
                            ? "text-amber-600 dark:text-amber-400 font-medium"
                            : "text-foreground",
                      )}
                    >
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Info Tab */}
          <TabsContent
            value="info"
            className="mt-0 h-full flex-1 flex flex-col min-h-0"
          >
            <div className="bg-background px-2 text-xs divide-y divide-border/30 h-full flex-1 overflow-y-auto min-h-0 max-h-[500px]">
              <div className="flex justify-between p-3">
                <span className="text-muted-foreground">Spec File:</span>
                <span className="font-mono font-medium text-foreground">
                  {tc.info.specFile}
                </span>
              </div>
              <div className="flex justify-between p-3">
                <span className="text-muted-foreground">Browser:</span>
                <span className="font-medium text-foreground">
                  {tc.info.browser}
                </span>
              </div>
              <div className="flex justify-between p-3">
                <span className="text-muted-foreground">Duration:</span>
                <span className="font-mono font-medium text-foreground">
                  {tc.info.duration}
                </span>
              </div>
              <div className="flex justify-between p-3">
                <span className="text-muted-foreground">URL:</span>
                <span
                  className="font-mono font-medium text-foreground truncate max-w-[220px]"
                  title={tc.info.url}
                >
                  {tc.info.url}
                </span>
              </div>
            </div>
          </TabsContent>
        </div>

        {/* Right Content Area */}
        <div className="lg:col-span-3 flex flex-col items-center justify-center bg-muted/10 p-0 overflow-hidden">
          {currentShot ? (
            <div className="relative w-full h-full min-h-[300px] flex items-center justify-center select-none">
              {currentShot.url ? (
                <img
                  src={currentShot.url}
                  alt={currentShot.title}
                  className="w-full max-w-full object-contain rounded-none border-none shadow-none"
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-center">
                  <div className="size-10 rounded-full bg-background flex items-center justify-center mb-2.5 text-muted-foreground/80 border border-border/50 shadow-2xs">
                    <ImageIcon className="size-4" />
                  </div>
                  <p className="text-xs font-semibold text-foreground mb-1">
                    {currentShot.title}
                  </p>
                  <p className="text-[11px] font-mono text-muted-foreground/70">
                    Screenshot Placeholder
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center text-xs text-muted-foreground">
              No screenshots captured for this test case.
            </div>
          )}
        </div>
      </div>
    </Tabs>
  );
}

export function RunDetailView({ runId }: { runId: string }) {
  const { getToken, isSignedIn } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["execution", runId],
    queryFn: async () => {
      const token = await getToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const resExec = await fetch(`${apiUrl}/api/executions/${runId}`, {
        headers,
      });
      if (!resExec.ok) return null;
      const execJson = await resExec.json();

      // Fetch executed test cases from execution details endpoint using executionId foreign key
      if (
        execJson?.success &&
        (!execJson.data.details || execJson.data.details.length === 0)
      ) {
        const resDetails = await fetch(
          `${apiUrl}/api/executions/details/query/${runId}`,
          { headers },
        );
        if (resDetails.ok) {
          const detailsJson = await resDetails.json();
          if (detailsJson?.data) {
            execJson.data.details = detailsJson.data;
          }
        }
      }

      return execJson;
    },
    enabled: isSignedIn && !!runId,
  });

  const executionData = data?.data;
  const executionDetails: any[] = executionData?.details || [];

  const realTestCases: TestCaseData[] = executionDetails.map(
    (detail: any, dIdx: number) => {
      const rawStepsAll: any[] = Array.isArray(detail.step_reports)
        ? detail.step_reports
        : [];

      const metaStep = rawStepsAll.find((s: any) => s.type === "__meta__");
      const rawSteps = rawStepsAll.filter((s: any) => s.type !== "__meta__");

      const steps: StepItem[] = rawSteps.map((step: any, idx: number) => {
        const stepType = (step.type as StepType) || "act";
        let desc = step.description || `Step ${idx + 1}`;
        if (
          stepType === "navigate" &&
          !desc.toLowerCase().startsWith("navigate to")
        ) {
          desc = `Navigate to ${desc}`;
        }
        const isFailed =
          step.success === false || step.status === "failed" || step.error;
        return {
          id: `step-${idx + 1}`,
          description: desc,
          type: stepType,
          status: isFailed ? "failed" : "passed",
        };
      });

      const screenshots: ScreenshotItem[] = rawSteps
        .filter(
          (step: any) =>
            step.signedUrl ||
            step.screenshotUrl ||
            step.screenshotBase64 ||
            step.screenshotPath ||
            step.screenshot_path,
        )
        .map((step: any, idx: number) => {
          let shotUrl: string | undefined = undefined;
          if (step.signedUrl) {
            shotUrl = step.signedUrl;
          } else if (step.screenshotUrl) {
            shotUrl = step.screenshotUrl.startsWith("http")
              ? step.screenshotUrl
              : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/${step.screenshotUrl}`;
          } else if (step.screenshotBase64) {
            shotUrl = step.screenshotBase64;
          } else if (step.screenshotPath || step.screenshot_path) {
            const path = step.screenshotPath || step.screenshot_path;
            shotUrl = path.startsWith("http")
              ? path
              : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/${path}`;
          }

          let stepDesc = step.description || "Captured state";
          if (
            step.type === "navigate" &&
            !stepDesc.toLowerCase().startsWith("navigate to")
          ) {
            stepDesc = `Navigate to ${stepDesc}`;
          }

          return {
            id: `sc-${idx + 1}`,
            title: `Step ${step.index || idx + 1}: ${stepDesc}`,
            url: shotUrl,
          };
        });

      const parseJsonArray = (val: any) => {
        if (Array.isArray(val)) return val;
        if (typeof val === "string") {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed;
          } catch (_) {}
        }
        return [];
      };

      const network: NetworkItem[] =
        parseJsonArray(detail.network_reports || detail.network).length > 0
          ? parseJsonArray(detail.network_reports || detail.network)
          : metaStep?.networkReports || [];

      const logs: LogItem[] =
        parseJsonArray(detail.log_reports || detail.logs).length > 0
          ? parseJsonArray(detail.log_reports || detail.logs)
          : metaStep?.logReports || [];

      const rawInfo =
        detail.info &&
        typeof detail.info === "object" &&
        Object.keys(detail.info).length > 0
          ? detail.info
          : metaStep?.info || {};

      const info: TestCaseInfo = {
        specFile: rawInfo.specFile || detail.test_case_id || "test.yaml",
        browser: rawInfo.browser || "Chromium 124.0",
        duration:
          rawInfo.duration ||
          `${((detail.duration_ms || 0) / 1000).toFixed(1)}s`,
        url:
          rawInfo.url ||
          rawInfo.environment ||
          detail.target_url ||
          executionData?.target_url ||
          "—",
      };

      return {
        id: detail.id || `tc-${dIdx + 1}`,
        title: detail.title || `TC-${dIdx + 1}: ${detail.test_case_id}`,
        status: detail.status === "passed" ? "passed" : "failed",
        duration: `${((detail.duration_ms || 0) / 1000).toFixed(1)}s`,
        steps,
        network,
        logs,
        info,
        screenshots,
      };
    },
  );

  const isRealExecutionFound = data?.success && !!executionData;
  const testCasesToDisplay = isRealExecutionFound
    ? realTestCases
    : mockTestCases;
  const defaultAccordionValue =
    testCasesToDisplay.length > 0 ? [testCasesToDisplay[0].id] : [];

  if (isLoading) {
    return (
      <div className="w-full py-12 text-center text-xs text-muted-foreground">
        <RefreshCwIcon className="size-4 animate-spin mx-auto mb-2" />
        Loading execution details...
      </div>
    );
  }

  if (isRealExecutionFound && testCasesToDisplay.length === 0) {
    return (
      <div className="w-full py-12 text-center text-xs text-muted-foreground bg-card rounded-xl border border-border/60">
        No test case details recorded for this execution yet.
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      <Accordion
        defaultValue={defaultAccordionValue}
        className="w-full space-y-3 border-none"
      >
        {testCasesToDisplay.map((tc) => (
          <AccordionItem
            key={tc.id}
            value={tc.id}
            className="border border-border/60 rounded-xl bg-card shadow-2xs overflow-hidden transition-all"
          >
            <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3 w-full pr-2 text-left">
                {tc.status === "passed" ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1.5 dark:bg-emerald-950/60 dark:text-emerald-400 font-medium text-[11px] shrink-0 px-2.5 py-0.5 rounded-full"
                  >
                    <CheckCircle2Icon className="size-3.5" />
                    Passed
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-rose-500/10 text-rose-600 border-rose-500/20 gap-1.5 dark:bg-rose-950/60 dark:text-rose-400 font-medium text-[11px] shrink-0 px-2.5 py-0.5 rounded-full"
                  >
                    <XCircleIcon className="size-3.5" />
                    Failed
                  </Badge>
                )}

                <span className="font-semibold text-xs sm:text-sm text-foreground flex-1 truncate tracking-tight">
                  {tc.title}
                </span>
              </div>
            </AccordionTrigger>

            <AccordionContent className="border-t border-border/40 bg-card p-0">
              <TestCaseDetail tc={tc} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
