"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CheckIcon,
  ArrowRightIcon,
  GlobeIcon,
  SmartphoneIcon,
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

interface PlanLimit {
  max_minutes_web: number;
  max_minutes_mobile: number;
  max_parallel_web: number;
  max_parallel_mobile: number;
}

interface UserProfileResponse {
  success: boolean;
  limitations?: Record<string, PlanLimit>;
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
    max_parallel_web?: number;
    max_parallel_mobile?: number;
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
  const { isSignedIn } = useAuth();
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

  const { data: profileData, refetch } = useQuery<UserProfileResponse | null>({
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

  const limitations = profileData?.limitations;
  const freeLimit = limitations?.free || { max_minutes_web: 100, max_parallel_web: 1 };
  const proLimit = limitations?.pro || { max_minutes_web: -1, max_parallel_web: -1 };

  const usedWebMins = userData?.used_web_minutes ?? userData?.minutes_used_web ?? 0;
  const maxWebMins = userData?.max_web_minutes ?? limitations?.[currentPlan]?.max_minutes_web ?? (currentPlan === "pro" ? -1 : 100);
  const webPct = maxWebMins > 0 ? Math.min(100, Math.round((usedWebMins / maxWebMins) * 100)) : 0;

  const usedMobileMins = userData?.used_mobile_minutes ?? userData?.minutes_used_mobile ?? 0;
  const maxMobileMins = userData?.max_mobile_minutes ?? limitations?.[currentPlan]?.max_minutes_mobile ?? (currentPlan === "pro" ? -1 : 100);
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
    const targetEmail = userData?.email;
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
    <div className="w-full max-w-3xl mx-auto space-y-8 pb-14 text-foreground">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-xs text-zinc-900 bg-white border border-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-800 rounded-lg px-4 py-2.5 font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Usage Section */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Usage</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 pt-0.5">
          {/* Web Testing */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <GlobeIcon className="size-3.5 text-muted-foreground shrink-0" />
              <h3 className="text-xs font-semibold text-foreground">Web Testing</h3>
            </div>

            <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
              {usedWebMins}m{" "}
              <span className="text-xs font-normal font-sans text-muted-foreground">
                / {maxWebMins < 0 ? "Unlimited" : `${maxWebMins}m`}
              </span>
            </div>

            <div className="w-full bg-zinc-100 dark:bg-zinc-800/80 rounded-full h-1.5 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  maxWebMins < 0
                    ? "bg-emerald-500"
                    : webPct >= 90
                    ? "bg-rose-500"
                    : "bg-zinc-900 dark:bg-zinc-100"
                )}
                style={{
                  width: maxWebMins < 0 ? "100%" : usedWebMins === 0 ? "0%" : `${Math.max(1, webPct)}%`,
                }}
              />
            </div>
          </div>

          {/* Mobile Testing */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <SmartphoneIcon className="size-3.5 text-muted-foreground shrink-0" />
              <h3 className="text-xs font-semibold text-foreground">Mobile Testing</h3>
            </div>

            <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
              {usedMobileMins}m{" "}
              <span className="text-xs font-normal font-sans text-muted-foreground">
                / {maxMobileMins < 0 ? "Unlimited" : `${maxMobileMins}m`}
              </span>
            </div>

            <div className="w-full bg-zinc-100 dark:bg-zinc-800/80 rounded-full h-1.5 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  maxMobileMins < 0
                    ? "bg-emerald-500"
                    : mobilePct >= 90
                    ? "bg-rose-500"
                    : "bg-zinc-900 dark:bg-zinc-100"
                )}
                style={{
                  width: maxMobileMins < 0 ? "100%" : usedMobileMins === 0 ? "0%" : `${Math.max(1, mobilePct)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* API Key Section */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">API Key</h2>

        <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-lg p-1.5 pl-3">
          <div className="font-mono text-xs text-foreground flex-1 min-w-0 truncate select-all">
            {displayKey}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {apiKey && (
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground bg-white hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-800 rounded-md transition-colors cursor-pointer"
              >
                {showApiKey ? "Hide" : "Show"}
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyKey}
              disabled={!apiKey}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-md transition-colors cursor-pointer disabled:opacity-50"
            >
              {copiedKey ? (
                <>
                  <CheckIcon className="size-3 text-emerald-400 dark:text-emerald-600" />
                  <span>Copied</span>
                </>
              ) : (
                <span>Copy</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Subscription Section */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Subscription</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-0.5">
          {/* Free Plan */}
          <div
            className={cn(
              "rounded-xl border p-4 flex flex-col justify-between space-y-3.5 transition-all",
              currentPlan === "free"
                ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-950"
                : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
            )}
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">Free</h3>
                {currentPlan === "free" && (
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Current
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono text-foreground">$0</span>
                <span className="text-xs text-muted-foreground">/ month</span>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground pt-1">
                <p>
                  {freeLimit.max_minutes_web < 0 ? "Unlimited" : freeLimit.max_minutes_web} test minutes
                </p>
                <p>
                  {freeLimit.max_parallel_web < 0 ? "Unlimited" : freeLimit.max_parallel_web} parallel execution
                </p>
                <p>Web + Mobile included</p>
              </div>
            </div>
          </div>

          {/* Pro Plan */}
          <div
            className={cn(
              "rounded-xl border p-4 flex flex-col justify-between space-y-3.5 transition-all",
              currentPlan === "pro"
                ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-950"
                : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
            )}
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <h3 className="font-semibold text-sm text-foreground">Pro</h3>
                  <span className="text-xs text-purple-500">✦</span>
                </div>
                {currentPlan === "pro" && (
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Current
                  </span>
                )}
              </div>

              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold font-mono text-foreground">$99</span>
                  <span className="text-xs text-muted-foreground">/ month</span>
                </div>
                {currentPlan === "pro" && userData?.expire_at && (
                  <span className="text-xs text-muted-foreground">
                    {subscriptionStatus === "active" ? "Renews on " : "Expires on "}
                    <span className="font-medium text-foreground">{formatDate(userData.expire_at)}</span>
                  </span>
                )}
              </div>

              <div className="space-y-1 text-xs text-foreground pt-1">
                <p>
                  {proLimit.max_minutes_web < 0 ? "Unlimited" : `${proLimit.max_minutes_web}`} test minutes
                </p>
                <p>
                  {proLimit.max_parallel_web < 0 ? "Unlimited" : `${proLimit.max_parallel_web}`} parallel execution
                </p>
                <p>Web + Mobile included</p>
              </div>
            </div>

            <div className="pt-1">
              {currentPlan === "pro" && subscriptionStatus === "active" ? (
                <div className="flex items-center justify-start text-xs pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmCancelOpen(true)}
                    disabled={isCanceling}
                    className="text-[11px] text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 transition-colors underline-offset-4 hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Cancel subscription
                  </button>
                </div>
              ) : currentPlan === "pro" && subscriptionStatus === "canceled" ? (
                <Link
                  href="/checkout"
                  className="text-xs font-medium text-foreground hover:underline inline-flex items-center gap-1"
                >
                  <span>Reactivate subscription</span>
                  <ArrowRightIcon className="size-3" />
                </Link>
              ) : (
                <Link
                  href="/checkout"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
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
              {userData?.expire_at ? (
                <>
                  Are you sure you want to cancel your Pro subscription? You will still have full access to Pro features until{" "}
                  <strong className="text-foreground font-semibold">{formatDate(userData.expire_at)}</strong>, after which your account will switch to the Free plan.
                </>
              ) : (
                "Are you sure you want to cancel your Pro subscription? You will still have full access to Pro features until the end of your current billing period."
              )}
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
              {isCanceling && <span className="size-3.5 animate-spin" />}
              <span>Confirm Cancellation</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
