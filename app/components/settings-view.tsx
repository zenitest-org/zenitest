"use client";

import { useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, ArrowRightIcon, RefreshCwIcon, Loader2Icon, GlobeIcon, SmartphoneIcon } from "lucide-react";

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

  const { data: profileData, isLoading, refetch, isRefetching } = useQuery<UserProfileResponse | null>({
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
  const displayKey = showApiKey ? apiKey : (apiKey ? `${apiKey.substring(0, 18)}...` : "zt-••••••••••••••••••••••••••••••••");

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
    showToast("API key copied");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleConfirmCancelSubscription = async () => {
    setConfirmCancelOpen(false);
    const userEmail = userData?.email || clerkUser?.primaryEmailAddress?.emailAddress;
    if (!userEmail) return;

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
        body: JSON.stringify({ email: userEmail }),
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
    <div className="w-full max-w-2xl mx-auto space-y-6 pb-8 text-foreground">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-xs text-zinc-900 bg-white border border-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-800 rounded-md px-3.5 py-2 font-medium shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Vertical Stack: User Info & Usage Progress + API Key Box */}
      <div className="flex flex-col gap-4">
        {/* User Card with Usage Progress Bar */}
        <div className="rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-[#f8f9fa] dark:bg-zinc-900/60 p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {userData?.name || clerkUser?.fullName || "User"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {userData?.email || clerkUser?.primaryEmailAddress?.emailAddress || "—"}
              </p>
            </div>

            <div className="flex flex-col items-end text-right shrink-0">
              <span className="text-base font-bold text-foreground capitalize">
                {currentPlan} Plan
              </span>
              <span
                className={cn(
                  "text-xs font-medium mt-0.5",
                  subscriptionStatus === "active"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                )}
              >
                {subscriptionStatus === "active"
                  ? userData?.expire_at
                    ? `Active (renew on ${formatDate(userData.expire_at)})`
                    : "Active"
                  : "Canceled"}
              </span>
            </div>
          </div>

          {/* Usage Metrics Section: Web Testing & Mobile Testing */}
          <div className="border-t border-zinc-200/80 dark:border-zinc-800/80 pt-4 space-y-3">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Monthly Testing Quota
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Web Testing Usage Card */}
              <div className="rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0">
                      <GlobeIcon className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">Web Testing</p>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-medium text-foreground shrink-0">
                    {maxWebMins < 0 ? (
                      <span className="text-cyan-600 dark:text-cyan-400 font-semibold">{usedWebMins}m / Unlimited</span>
                    ) : (
                      <span>{usedWebMins} / {maxWebMins}m</span>
                    )}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="w-full bg-zinc-100 dark:bg-zinc-800/80 rounded-full h-2 overflow-hidden relative">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        maxWebMins < 0
                          ? "bg-cyan-500"
                          : webPct >= 90
                          ? "bg-rose-500"
                          : "bg-cyan-500"
                      )}
                      style={{ width: maxWebMins < 0 ? "100%" : `${Math.max(4, webPct)}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                    <span>{maxWebMins < 0 ? "Pro Plan (Unlimited)" : `${webPct}% used`}</span>
                    <span>{maxWebMins < 0 ? "Active" : `${Math.max(0, maxWebMins - usedWebMins)}m remaining`}</span>
                  </div>
                </div>
              </div>

              {/* Mobile Testing Usage Card */}
              <div className="rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                      <SmartphoneIcon className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">Mobile Testing</p>
                    </div>
                  </div>

                  <span className="text-xs font-mono font-medium text-foreground shrink-0">
                    {maxMobileMins === 0 ? (
                      <span className="text-muted-foreground font-normal text-[11px]">0 / 0m</span>
                    ) : (
                      <span>{usedMobileMins} / {maxMobileMins}m</span>
                    )}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="w-full bg-zinc-100 dark:bg-zinc-800/80 rounded-full h-2 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        maxMobileMins === 0
                          ? "bg-zinc-300 dark:bg-zinc-700 opacity-40"
                          : mobilePct >= 90
                          ? "bg-rose-500"
                          : "bg-purple-500"
                      )}
                      style={{ width: maxMobileMins === 0 ? "0%" : `${Math.max(4, mobilePct)}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                    {maxMobileMins === 0 ? (
                      <>
                        <span className="text-amber-600 dark:text-amber-400 font-medium font-sans">Not in Free plan</span>
                        <Link href="/checkout" className="text-cyan-600 dark:text-cyan-400 hover:underline font-sans">Upgrade</Link>
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

        </div>

        {/* API Key Box */}
        <div className="rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-[#f8f9fa] dark:bg-zinc-900/60 p-4 space-y-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">API Key</span>
          <div className="rounded-md border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 px-3.5 py-2.5 font-mono text-xs text-foreground flex items-center justify-between gap-3">
            <span className="truncate flex-1">
              {displayKey}
            </span>
            <div className="flex items-center gap-2.5 shrink-0 font-sans">
              {apiKey && (
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {showApiKey ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
                  <span>{showApiKey ? "Hide" : "Show"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyKey}
                disabled={!apiKey}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {copiedKey ? (
                  <>
                    <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Copied</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Plans Section */}
      <div className="space-y-4 pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Free Plan */}
          <div
            className={cn(
              "rounded-lg border p-5 flex flex-col justify-between space-y-4 transition-colors",
              currentPlan === "free"
                ? "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                : "border-zinc-200/80 dark:border-zinc-800/80 bg-[#f8f9fa] dark:bg-zinc-900/40"
            )}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">Free</h3>
                {currentPlan === "free" && (
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                    Current Plan
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-foreground">$0</span>
                <span className="text-xs text-muted-foreground">/ month</span>
              </div>

              <ul className="space-y-2 text-xs text-muted-foreground pt-1 border-t border-zinc-100 dark:border-zinc-800/60">
                <li className="flex items-center gap-2 text-foreground">
                  <span className="size-1.5 rounded-full bg-zinc-400 shrink-0" />
                  <span><strong>100</strong> Web execution minutes</span>
                </li>
                <li className="flex items-center gap-2 text-foreground">
                  <span className="size-1.5 rounded-full bg-zinc-400 shrink-0" />
                  <span><strong>2</strong> Parallel web runners</span>
                </li>
                <li className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
                  <span className="size-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 shrink-0" />
                  <span>Mobile execution (not included)</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <button
                disabled
                className="w-full py-1.5 rounded-md border border-zinc-200/80 dark:border-zinc-800 text-muted-foreground text-xs font-medium cursor-default text-center bg-transparent"
              >
                {currentPlan === "free" ? "Current Plan" : "Free Tier"}
              </button>
            </div>
          </div>

          {/* Pro Plan */}
          <div
            className={cn(
              "rounded-lg border p-5 flex flex-col justify-between space-y-4 transition-colors",
              currentPlan === "pro"
                ? "border-zinc-400 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
            )}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">Pro</h3>
                {currentPlan === "pro" ? (
                  <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded border", subscriptionStatus === "active" ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800" : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800")}>
                    {subscriptionStatus === "active" ? "Current Plan" : "Canceled"}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
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

              <ul className="space-y-2 text-xs text-foreground pt-1 border-t border-zinc-100 dark:border-zinc-800/60">
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
                  <span><strong>100</strong> Mobile execution minutes (1 parallel)</span>
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
                  className="w-full py-1.5 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100/60 dark:hover:bg-rose-900/50 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
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
                  className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors cursor-pointer shadow-xs"
                >
                  <span>Reactivate Subscription</span>
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              ) : (
                <Link
                  href="/checkout"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                >
                  <span>Upgrade to Pro</span>
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              )}
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
              className="px-3.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Keep Subscription
            </button>
            <button
              type="button"
              onClick={handleConfirmCancelSubscription}
              disabled={isCanceling}
              className="px-3.5 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 text-xs font-medium transition-colors cursor-pointer shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5"
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
