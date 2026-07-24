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

export default supabase;
