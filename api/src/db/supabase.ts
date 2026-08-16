import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn(
    "[Supabase Warning] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables."
  );
}

/**
 * Supabase client initialized with Service Role Access Key for backend API access.
 * This client bypasses Row Level Security (RLS) and should only be used server-side.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

/**
 * Uploads a base64-encoded step screenshot to the Supabase 'screenshots' storage bucket.
 * Returns the relative storage path (e.g. "executions/<execId>/<tcId>/step_<idx>_<timestamp>.png")
 */
export async function uploadScreenshot(
  executionId: string,
  testCaseId: string,
  stepIndex: number,
  base64Data: string
): Promise<{ path: string; publicUrl?: string } | null> {
  try {
    if (!base64Data) return null;
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const filePath = `executions/${executionId}/${testCaseId}/step_${stepIndex}_${Date.now()}.png`;

    const { data, error } = await supabase.storage
      .from("screenshots")
      .upload(filePath, buffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (error) {
      console.error("[Supabase Storage] Error uploading screenshot:", error.message);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from("screenshots")
      .getPublicUrl(filePath);

    return {
      path: data.path,
      publicUrl: publicUrlData?.publicUrl,
    };
  } catch (err: any) {
    console.error("[Supabase Storage] Exception uploading screenshot:", err.message || err);
    return null;
  }
}

/**
 * Generates a signed URL for a relative screenshot path in the 'screenshots' storage bucket.
 * Default expiration is 3600 seconds (1 hour).
 */
export async function getSignedScreenshotUrl(
  filePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  try {
    if (!filePath) return null;
    const cleanPath = filePath.replace(/^screenshots\//, "");

    const { data, error } = await supabase.storage
      .from("screenshots")
      .createSignedUrl(cleanPath, expiresIn);

    if (error || !data?.signedUrl) {
      console.error("[Supabase Storage] Error creating signed URL:", error?.message);
      return null;
    }

    return data.signedUrl;
  } catch (err: any) {
    console.error("[Supabase Storage] Exception creating signed URL:", err.message || err);
    return null;
  }
}

/**
 * Iterates over execution details and generates signed URLs for step report screenshots.
 */
export async function attachSignedUrlsToDetails(details: any[]): Promise<any[]> {
  if (!Array.isArray(details) || details.length === 0) return details;

  return Promise.all(
    details.map(async (detail) => {
      if (!detail.step_reports || !Array.isArray(detail.step_reports)) {
        return detail;
      }

      const updatedSteps = await Promise.all(
        detail.step_reports.map(async (step: any) => {
          const path = step.screenshotPath || step.screenshot_path;
          if (path) {
            const signedUrl = await getSignedScreenshotUrl(path);
            if (signedUrl) {
              return {
                ...step,
                signedUrl,
                screenshotUrl: signedUrl,
              };
            }
          }
          return step;
        })
      );

      return {
        ...detail,
        step_reports: updatedSteps,
      };
    })
  );
}

/**
 * Tracks and increments minutes_used_web or minutes_used_mobile for a user in public.users table.
 * For mobile testing, durationMs MUST be step execution duration (excluding device/session initialization time).
 */
export async function trackUserUsage(
  userId: string,
  platform: string,
  durationMs: number
): Promise<void> {
  if (!userId || durationMs <= 0) return;

  const minutes = Math.ceil(durationMs / 60000);
  if (minutes <= 0) return;

  const norm = (platform || "").toLowerCase().trim();
  const isMobile =
    norm === "mobile" ||
    norm === "ios" ||
    norm === "android" ||
    norm === "mobile-ios" ||
    norm === "mobile-android";

  const minutesWeb = isMobile ? 0 : minutes;
  const minutesMobile = isMobile ? minutes : 0;

  try {
    const { error: rpcError } = await supabase.rpc("increment_user_usage", {
      p_user_id: userId,
      p_minutes_web: minutesWeb,
      p_minutes_mobile: minutesMobile,
    });

    if (rpcError) {
      console.warn("[Usage Tracking] RPC warning, falling back to direct update:", rpcError.message);
      const { data: user } = await supabase
        .from("users")
        .select("minutes_used_web, minutes_used_mobile")
        .eq("id", userId)
        .maybeSingle();

      if (user) {
        await supabase
          .from("users")
          .update({
            minutes_used_web: (user.minutes_used_web || 0) + minutesWeb,
            minutes_used_mobile: (user.minutes_used_mobile || 0) + minutesMobile,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }
    }
    console.log(`[Usage Tracking ✅] Tracked ${minutes} min(s) (${isMobile ? "mobile" : "web"}) for user ${userId}`);
  } catch (err: any) {
    console.error("[Usage Tracking Error]:", err.message || err);
  }
}

export interface UserLimitationResult {
  allowed: boolean;
  reason?: string;
  plan: string;
  minutesUsed: number;
  maxMinutes: number;
}

/**
 * Checks if a user has exceeded their plan's web or mobile usage minutes in public.users & public.limitation.
 */
export async function checkUserLimitation(
  userId: string,
  platform: string
): Promise<UserLimitationResult> {
  const norm = (platform || "").toLowerCase().trim();
  const isMobile =
    norm === "mobile" ||
    norm === "ios" ||
    norm === "android" ||
    norm === "mobile-ios" ||
    norm === "mobile-android";

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("plan, subscription_status, minutes_used_web, minutes_used_mobile")
    .eq("id", userId)
    .maybeSingle();

  if (userError || !user) {
    return { allowed: true, plan: "free", minutesUsed: 0, maxMinutes: 100 };
  }

  const plan = (user.plan || "free").toLowerCase();

  const { data: limitRow } = await supabase
    .from("limitation")
    .select("*")
    .eq("plan", plan)
    .maybeSingle();

  const maxWeb = limitRow ? limitRow.max_minutes_web : (plan === "pro" ? -1 : 100);
  const maxMobile = limitRow ? limitRow.max_minutes_mobile : (plan === "pro" ? -1 : 100);

  if (isMobile) {
    const used = user.minutes_used_mobile || 0;
    if (maxMobile === 0) {
      return {
        allowed: false,
        reason: `Mobile testing is not available on the ${plan.toUpperCase()} plan. Please upgrade to Pro.`,
        plan,
        minutesUsed: used,
        maxMinutes: maxMobile,
      };
    }
    if (maxMobile !== -1 && used >= maxMobile) {
      return {
        allowed: false,
        reason: `Mobile testing limit exceeded (${used}/${maxMobile} minutes used). Please upgrade your plan.`,
        plan,
        minutesUsed: used,
        maxMinutes: maxMobile,
      };
    }
    return { allowed: true, plan, minutesUsed: used, maxMinutes: maxMobile };
  } else {
    const used = user.minutes_used_web || 0;
    if (maxWeb === 0) {
      return {
        allowed: false,
        reason: `Web testing is not available on your current plan (${plan.toUpperCase()}).`,
        plan,
        minutesUsed: used,
        maxMinutes: maxWeb,
      };
    }
    if (maxWeb !== -1 && used >= maxWeb) {
      return {
        allowed: false,
        reason: `Web testing limit exceeded (${used}/${maxWeb} minutes used). Please upgrade to Pro for unlimited web testing.`,
        plan,
        minutesUsed: used,
        maxMinutes: maxWeb,
      };
    }
    return { allowed: true, plan, minutesUsed: used, maxMinutes: maxWeb };
  }
}

export default supabase;


