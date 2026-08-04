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

export default supabase;
