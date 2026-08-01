"use client";

import { useState } from "react";
import {
  CheckCircle2Icon,
  XCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  TerminalIcon,
  InfoIcon,
  LayersIcon,
  ClockIcon,
  ImageIcon,
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

export type StepType = "act" | "navigate" | "validate";

export interface StepItem {
  id: string;
  description: string;
  type: StepType;
}

export interface NetworkItem {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  status: number;
  time: string;
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
  retries: number;
  environment: string;
}

export interface ScreenshotItem {
  id: string;
  title: string;
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
      },
      {
        id: "s2",
        description: "Fill email address and password input fields",
        type: "act",
      },
      {
        id: "s3",
        description: "Click on 'Sign In' submit button",
        type: "act",
      },
      {
        id: "s4",
        description: "Validate redirect response to /dashboard URL",
        type: "validate",
      },
      {
        id: "s5",
        description: "Validate user profile greeting banner is visible",
        type: "validate",
      },
    ],
    network: [
      { id: "n1", method: "GET", url: "/login", status: 200, time: "110ms" },
      {
        id: "n2",
        method: "POST",
        url: "/api/auth/login",
        status: 200,
        time: "320ms",
      },
      {
        id: "n3",
        method: "GET",
        url: "/api/user/profile",
        status: 200,
        time: "95ms",
      },
      {
        id: "n4",
        method: "GET",
        url: "/api/analytics/summary",
        status: 200,
        time: "180ms",
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
      retries: 0,
      environment: "Staging (Node v20.11.0)",
    },
    screenshots: [
      { id: "sc1", title: "Step 1: Login Page Loaded" },
      { id: "sc2", title: "Step 2: Credentials Entered" },
      { id: "sc3", title: "Step 4: Redirected to Dashboard" },
      { id: "sc4", title: "Step 5: Profile Banner Verified" },
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
      },
      {
        id: "s22",
        description: "Enter coupon code 'SUMMER2026' into promo field",
        type: "act",
      },
      { id: "s23", description: "Click 'Apply Coupon' button", type: "act" },
      {
        id: "s24",
        description: "Validate 20% discount subtotal deduction",
        type: "validate",
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
      retries: 0,
      environment: "Staging (Node v20.11.0)",
    },
    screenshots: [
      { id: "sc21", title: "Cart Summary View" },
      { id: "sc22", title: "Coupon Applied Screen" },
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
      },
      {
        id: "s32",
        description: "Enter test declined card details (4000 0000 0000 0002)",
        type: "act",
      },
      { id: "s33", description: "Click 'Complete Order' button", type: "act" },
      {
        id: "s34",
        description: "Validate card declined error dialog is displayed",
        type: "validate",
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
      retries: 1,
      environment: "Staging (Node v20.11.0)",
    },
    screenshots: [
      { id: "sc31", title: "Payment Form State" },
      { id: "sc32", title: "Card Declined Error Modal" },
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

function TestCaseDetail({ tc }: { tc: TestCaseData }) {
  const [screenshotIndex, setScreenshotIndex] = useState(0);

  const screenshots = tc.screenshots || [];
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
                className="size-6 rounded-md hover:bg-muted text-muted-foreground/70 hover:text-foreground shrink-0"
                onClick={prevShot}
                disabled={screenshotIndex === 0}
                title="Previous screenshot"
              >
                <ChevronLeftIcon className="size-3" />
              </Button>
              <span className="text-[11px] text-muted-foreground truncate select-none px-1">
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
                className="size-6 rounded-md hover:bg-muted text-muted-foreground/70 hover:text-foreground shrink-0"
                onClick={nextShot}
                disabled={screenshotIndex >= screenshots.length - 1}
                title="Next screenshot"
              >
                <ChevronRightIcon className="size-3" />
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
      <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-border/40">
        {/* Left Content Area */}
        <div className="lg:col-span-2 flex flex-col">
          <TabsContent value="steps" className="mt-0 space-y-1">
            {tc.steps.map((step, idx) => (
              <div
                key={step.id}
                className="flex items-center justify-between gap-3 px-2 py-2  hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[11px] font-mono text-muted-foreground/60 w-5 shrink-0 text-right">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-medium text-foreground/90 leading-relaxed truncate">
                    {step.description}
                  </span>
                </div>
                <StepTypeBadge type={step.type} />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="network" className="mt-0">
            <div className="bg-background overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase border-b border-border/40">
                  <tr>
                    <th className="py-2 px-3">Method</th>
                    <th className="py-2 px-3">URL</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {tc.network.map((req) => (
                    <tr key={req.id} className="hover:bg-muted/20">
                      <td className="py-2 px-3 font-mono font-semibold text-[11px]">
                        {req.method}
                      </td>
                      <td className="py-2 px-3 font-mono text-muted-foreground truncate max-w-[180px]">
                        {req.url}
                      </td>
                      <td className="py-2 px-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-mono text-[10px] px-1.5 py-0 rounded",
                            req.status < 300
                              ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20"
                              : "text-rose-600 bg-rose-500/10 border-rose-500/20",
                          )}
                        >
                          {req.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                        {req.time}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="mt-0">
            <div className="bg-background p-2 font-mono text-xs space-y-1.5 max-h-[260px] overflow-y-auto">
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
          </TabsContent>

          {/* Info Tab */}
          <TabsContent value="info" className="mt-0">
            <div className="bg-background px-2 text-xs divide-y divide-border/30">
              <div className="flex justify-between p-2">
                <span className="text-muted-foreground">Spec File:</span>
                <span className="font-mono font-medium text-foreground">
                  {tc.info.specFile}
                </span>
              </div>
              <div className="flex justify-between p-2">
                <span className="text-muted-foreground">Browser:</span>
                <span className="font-medium text-foreground">
                  {tc.info.browser}
                </span>
              </div>
              <div className="flex justify-between p-2">
                <span className="text-muted-foreground">Duration:</span>
                <span className="font-mono font-medium text-foreground">
                  {tc.info.duration}
                </span>
              </div>
              <div className="flex justify-between p-2">
                <span className="text-muted-foreground">Retries:</span>
                <span className="font-mono font-medium text-foreground">
                  {tc.info.retries}
                </span>
              </div>
              <div className="flex justify-between p-2">
                <span className="text-muted-foreground">Environment:</span>
                <span className="font-medium text-foreground">
                  {tc.info.environment}
                </span>
              </div>
            </div>
          </TabsContent>
        </div>

        {/* Right Content Area */}
        <div className="lg:col-span-3 flex flex-col justify-center">
          {currentShot ? (
            <div className="relative flex-1 min-h-[220px] w-full  bg-muted/20  border-border/30 flex flex-col items-center justify-center p-6 text-center select-none">
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
          ) : (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-xl text-xs text-muted-foreground bg-muted/20">
              No screenshots captured for this test case.
            </div>
          )}
        </div>
      </div>
    </Tabs>
  );
}

export function RunDetailView({ runId }: { runId: string }) {
  return (
    <div className="w-full space-y-3">
      <Accordion
        defaultValue={["tc-1"]}
        className="w-full space-y-3 border-none"
      >
        {mockTestCases.map((tc) => (
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

                <div className="flex items-center gap-3 text-xs text-muted-foreground/80 shrink-0 font-mono">
                  <span className="flex items-center gap-1">
                    <ClockIcon className="size-3.5" />
                    {tc.duration}
                  </span>
                  <span>{tc.steps.length} steps</span>
                </div>
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
