"use client";

import { useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CopyIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  ArrowRightIcon,
  Loader2Icon,
  GlobeIcon,
  SmartphoneIcon,
  KeyIcon,
  SparklesIcon,
  LockIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface UserProfileResponse {
  success: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    api_key: string;
    plan: string;
    subscription_status: string;
    subscribe_at: string | null;
    expire_at: string | null;
    minutes_used_web?: number;
    minutes_used_mobile?: number;
    used_web_minutes?: number;
    max_web_minutes?: number;
    used_mobile_minutes?: number;
    max_mobile_minutes?: number;
  };
}

function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function getInitials(name?: string, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email && email.trim()) {
    return email.slice(0, 2).toUpperCase();
  }
  return "U";
}

export function SettingsView() {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { getToken } = useAuth();

  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const { data: profileData, isLoading, refetch } = useQuery<UserProfileResponse | null>({
    queryKey: ["user-profile"],
    queryFn: async () => {
      const token = await getToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const response = await fetch(`${apiUrl}/api/auth/verify`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) return null;
      return response.json();
    },
    enabled: isSignedIn,
  });

  const userData = profileData?.user;
  const currentPlan = (userData?.plan || "free").toLowerCase();
  const subscriptionStatus = (userData?.subscription_status || "active").toLowerCase();
  const apiKey = userData?.api_key || "";
  const displayKey = showApiKey ? apiKey : "••••••••••••••••••••••••••••••••••••••••";

  const userName = userData?.name || clerkUser?.fullName || "User";
  const userEmail = userData?.email || clerkUser?.primaryEmailAddress?.emailAddress || "—";
  const userInitials = getInitials(userName, userEmail);

  const usedWebMins = userData?.used_web_minutes ?? userData?.minutes_used_web ?? 0;
  const maxWebMins = userData?.max_web_minutes ?? (currentPlan === "pro" ? -1 : 100);
  const webPct = maxWebMins > 0 ? Math.min(100, Math.round((usedWebMins / maxWebMins) * 100)) : 0;

  const usedMobileMins = userData?.used_mobile_minutes ?? userData?.minutes_used_mobile ?? 0;
  const maxMobileMins = userData?.max_mobile_minutes ?? (currentPlan === "pro" ? 100 : 0);
  const mobilePct = maxMobileMins > 0 ? Math.min(100, Math.round((usedMobileMins / maxMobileMins) * 100)) : 0;

  const handleCopyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    showToast("API key copied to clipboard");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleConfirmCancelSubscription = async () => {
    setConfirmCancelOpen(false);
    const targetEmail = userData?.email || clerkUser?.primaryEmailAddress?.emailAddress;
    if (!targetEmail) return;

    setIsCanceling(true);
    try {
      const token = await getToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const response = await fetch(`${apiUrl}/api/checkout/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        showToast("Subscription canceled successfully");
        refetch();
      } else {
        showToast(data.error || "Failed to cancel subscription");
      }
    } catch (err: any) {
      console.error("[Cancel Subscription Error]:", err);
      showToast("Failed to cancel subscription");
    } finally {
      setIsCanceling(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 pb-12 text-foreground">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-xs text-zinc-900 bg-white border border-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-800 rounded-lg px-4 py-2.5 font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Account Profile Header Section */}
      <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="size-12 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 flex items-center justify-center font-bold text-base shrink-0 shadow-xs">
              {userInitials}
            </div>
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-foreground truncate">{userName}</h1>
              </div>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs font-medium">
              <span className="capitalize text-foreground font-semibold">{currentPlan} Plan</span>
              <span className="text-zinc-300 dark:text-zinc-700">•</span>
              <span
                className={cn(
                  "font-medium",
                  subscriptionStatus === "active"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                )}
              >
                {subscriptionStatus === "active" ? "Active" : "Canceled"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quotas & Testing Usage Section */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Monthly Testing Quota</h2>
          <p className="text-xs text-muted-foreground">Execution minutes available for web and mobile test runners.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Web Testing Usage Card */}
          <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 flex items-center justify-center text-foreground shrink-0">
                  <GlobeIcon className="size-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Web Testing</p>
                  <p className="text-[11px] text-muted-foreground">Automated browser runs</p>
                </div>
              </div>

              <span className="text-xs font-mono font-medium text-foreground shrink-0">
                {maxWebMins < 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{usedWebMins}m / Unlimited</span>
                ) : (
                  <span>{usedWebMins} / {maxWebMins}m</span>
                )}
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden relative">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    maxWebMins < 0
                      ? "bg-emerald-500"
                      : webPct >= 90
                      ? "bg-rose-500"
                      : "bg-zinc-900 dark:bg-zinc-100"
                  )}
                  style={{ width: maxWebMins < 0 ? "100%" : `${Math.max(3, webPct)}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                <span>{maxWebMins < 0 ? "Pro tier active" : `${webPct}% used`}</span>
                <span>{maxWebMins < 0 ? "Unlimited" : `${Math.max(0, maxWebMins - usedWebMins)}m remaining`}</span>
              </div>
            </div>
          </div>

          {/* Mobile Testing Usage Card */}
          <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 flex items-center justify-center text-foreground shrink-0">
                  <SmartphoneIcon className="size-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Mobile Testing</p>
                  <p className="text-[11px] text-muted-foreground">iOS & Android devices</p>
                </div>
              </div>

              {maxMobileMins === 0 ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                  <LockIcon className="size-3" />
                  <span>Pro Feature</span>
                </span>
              ) : (
                <span className="text-xs font-mono font-medium text-foreground shrink-0">
                  {usedMobileMins} / {maxMobileMins}m
                </span>
              )}
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    maxMobileMins === 0
                      ? "bg-transparent"
                      : mobilePct >= 90
                      ? "bg-rose-500"
                      : "bg-purple-500"
                  )}
                  style={{ width: maxMobileMins === 0 ? "0%" : `${Math.max(3, mobilePct)}%` }}
                />
              </div>

              <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                {maxMobileMins === 0 ? (
                  <>
                    <span>Requires Pro subscription</span>
                    <Link
                      href="/checkout"
                      className="text-foreground hover:underline font-medium inline-flex items-center gap-1"
                    >
                      <span>Upgrade</span>
                      <ArrowRightIcon className="size-3" />
                    </Link>
                  </>
                ) : (
                  <>
                    <span>{mobilePct}% used</span>
                    <span>{Math.max(0, maxMobileMins - usedMobileMins)}m remaining</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Key Section */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">API Key</h2>
          <p className="text-xs text-muted-foreground">Authenticate your local CLI runner or CI/CD pipelines.</p>
        </div>

        <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 p-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="size-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 flex items-center justify-center text-foreground shrink-0">
                <KeyIcon className="size-4" />
              </div>
              <div className="font-mono text-xs text-foreground bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-lg px-3 py-2 flex-1 min-w-0 truncate">
                {displayKey}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              {apiKey && (
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                >
                  {showApiKey ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
                  <span>{showApiKey ? "Hide" : "Show"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyKey}
                disabled={!apiKey}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {copiedKey ? (
                  <>
                    <CheckIcon className="size-3.5 text-emerald-400 dark:text-emerald-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3.5" />
                    <span>Copy Key</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Tier Cards Section */}
      <div className="space-y-4 pt-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Subscription Plan</h2>
          <p className="text-xs text-muted-foreground">Select a plan tailored to your execution scale.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Free Plan Card */}
          <div
            className={cn(
              "rounded-xl border p-5 flex flex-col justify-between space-y-4 transition-all shadow-xs",
              currentPlan === "free"
                ? "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                : "border-zinc-200/80 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-950/60"
            )}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">Free</h3>
                {currentPlan === "free" && (
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 rounded-full">
                    Current Plan
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-foreground">$0</span>
                <span className="text-xs text-muted-foreground">/ month</span>
              </div>

              <ul className="space-y-2 text-xs text-muted-foreground pt-3 border-t border-zinc-100 dark:border-zinc-800/60">
                <li className="flex items-center gap-2 text-foreground">
                  <span className="size-1.5 rounded-full bg-zinc-400 shrink-0" />
                  <span><strong>100</strong> Web execution minutes</span>
                </li>
                <li className="flex items-center gap-2 text-foreground">
                  <span className="size-1.5 rounded-full bg-zinc-400 shrink-0" />
                  <span><strong>2</strong> Parallel web runners</span>
                </li>
                <li className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
                  <span className="size-1.5 rounded-full bg-zinc-300 dark:bg-zinc-800 shrink-0" />
                  <span>Mobile execution unavailable</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <button
                disabled
                className="w-full py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-muted-foreground text-xs font-medium cursor-default text-center bg-transparent"
              >
                {currentPlan === "free" ? "Current Plan" : "Free Tier"}
              </button>
            </div>
          </div>

          {/* Pro Plan Card */}
          <div
            className={cn(
              "rounded-xl border p-5 flex flex-col justify-between space-y-4 transition-all shadow-xs relative overflow-hidden",
              currentPlan === "pro"
                ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-950 ring-1 ring-zinc-900 dark:ring-zinc-100"
                : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            )}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-semibold text-sm text-foreground">Pro</h3>
                  <SparklesIcon className="size-3.5 text-purple-500 fill-purple-500/20" />
                </div>
                {currentPlan === "pro" ? (
                  <span className={cn(
                    "text-[11px] font-medium px-2.5 py-0.5 rounded-full border",
                    subscriptionStatus === "active"
                      ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800"
                      : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800"
                  )}>
                    {subscriptionStatus === "active" ? "Active" : "Canceled"}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 rounded-full">
                    Recommended
                  </span>
                )}
              </div>

              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-foreground">$29</span>
                  <span className="text-xs text-muted-foreground">/ month</span>
                </div>
                {currentPlan === "pro" && subscriptionStatus === "active" && userData?.expire_at && (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {`Renews: ${formatDate(userData.expire_at)}`}
                  </span>
                )}
              </div>

              <ul className="space-y-2 text-xs text-foreground pt-3 border-t border-zinc-100 dark:border-zinc-800/60">
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span><strong>Unlimited</strong> Web execution minutes</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span><strong>Unlimited</strong> Parallel web runners</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span><strong>100</strong> Mobile execution minutes</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span>Priority queue & AI bug analysis</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              {currentPlan === "pro" && subscriptionStatus === "active" ? (
                <button
                  type="button"
                  onClick={() => setConfirmCancelOpen(true)}
                  disabled={isCanceling}
                  className="w-full py-2 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100/60 dark:hover:bg-rose-900/50 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                >
                  {isCanceling ? (
                    <>
                      <Loader2Icon className="size-3.5 animate-spin" />
                      <span>Canceling Subscription...</span>
                    </>
                  ) : (
                    <span>Cancel Subscription</span>
                  )}
                </button>
              ) : currentPlan === "pro" && subscriptionStatus === "canceled" ? (
                <Link
                  href="/checkout"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors cursor-pointer shadow-xs"
                >
                  <span>Reactivate Subscription</span>
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              ) : (
                <Link
                  href="/checkout"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                >
                  <span>Upgrade to Pro</span>
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              )}
            </div>
          </div>

          {/* Custom Plan Card */}
          <div
            className={cn(
              "rounded-xl border p-5 flex flex-col justify-between space-y-4 transition-all shadow-xs",
              currentPlan === "custom"
                ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-950"
                : "border-zinc-200/80 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-950/60"
            )}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">Custom</h3>
                {currentPlan === "custom" ? (
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
                    Current Plan
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full">
                    Enterprise
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-foreground">Custom</span>
              </div>

              <ul className="space-y-2 text-xs text-foreground pt-3 border-t border-zinc-100 dark:border-zinc-800/60">
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span><strong>Custom</strong> Web execution minutes</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span><strong>Custom</strong> Mobile execution minutes</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span><strong>Dedicated</strong> infrastructure & SLA</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 shrink-0" />
                  <span>Custom integrations & support</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <button
                type="button"
                className="w-full py-2 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-foreground text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer text-center"
              >
                Contact Us
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cancel Subscription Confirmation Dialog */}
      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Subscription</DialogTitle>
            <DialogDescription className="pt-2 text-xs leading-normal">
              Are you sure you want to cancel your Pro plan subscription? You will lose access to unlimited execution minutes and priority runners.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-4 flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setConfirmCancelOpen(false)}
              className="px-3.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Keep Subscription
            </button>
            <button
              type="button"
              onClick={handleConfirmCancelSubscription}
              disabled={isCanceling}
              className="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 text-xs font-medium transition-colors cursor-pointer shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {isCanceling && <Loader2Icon className="size-3.5 animate-spin" />}
              <span>Confirm Cancellation</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
