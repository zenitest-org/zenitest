import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Helper: Verify Creem HMAC-SHA256 signature using Web Crypto API
async function verifySignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );

    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computedHex.toLowerCase() === signature.trim().toLowerCase();
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

serve(async (req: Request) => {
  // CORS Headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, creem-signature",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("creem-signature") || "";
    const webhookSecret = Deno.env.get("CREEM_WEBHOOK_SECRET") || "";

    // Verify signature if secret is set
    if (webhookSecret) {
      const isValid = await verifySignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        console.error("Invalid webhook signature received");
        return new Response(
          JSON.stringify({ error: "Invalid webhook signature" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      console.warn("CREEM_WEBHOOK_SECRET is not configured. Skipping signature verification in dev mode.");
    }

    const event = JSON.parse(rawBody);
    const eventType = event.eventType || event.event_type;
    const data = event.object || event.data || {};

    console.log(`[Creem Webhook] Event received: ${eventType} (${event.id || "N/A"})`);

    // Initialize Supabase Admin Client using Service Role Key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Extract customer email & plan details from webhook payload
    let customerEmail =
      data.customer?.email ||
      data.customer_email ||
      data.email;

    if (customerEmail && customerEmail.trim().toLowerCase() === "test-customer@creem.io") {
      console.log("[Creem Webhook] Test email 'test-customer@creem.io' received. Mapping to 'kmthach.ai@gmail.com'");
      customerEmail = "kmthach.ai@gmail.com";
    }

    const productName = (data.product?.name || data.product_name || "pro").toLowerCase();
    const planName = productName.includes("pro") ? "pro" : "free";

    if (!customerEmail) {
      console.warn("Webhook payload does not contain customer email");
      return new Response(
        JSON.stringify({ success: true, message: "Ignored payload with missing customer email" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Query user strictly based on email
    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id, email, plan")
      .eq("email", customerEmail)
      .maybeSingle();

    if (userError || !targetUser) {
      console.error(`User not found in database for email: ${customerEmail}`);
      return new Response(
        JSON.stringify({ success: false, error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    const now = new Date().toISOString();

    // Handle Subscription Active / Payment Completed events -> Grant 'pro' Access
    if (
      eventType === "checkout.completed" ||
      eventType === "subscription.active" ||
      eventType === "subscription.paid" ||
      eventType === "subscription.trialing"
    ) {
      // Set expiration (e.g. 1 month from now or current_period_end)
      let expireAt: string;
      if (data.current_period_end_date || data.current_period_end) {
        expireAt = new Date(data.current_period_end_date || data.current_period_end * 1000).toISOString();
      } else {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        expireAt = nextMonth.toISOString();
      }

      const { error: updateError } = await supabase
        .from("users")
        .update({
          plan: planName,
          subscription_status: "active",
          subscribe_at: now,
          expire_at: expireAt,
          updated_at: now,
        })
        .eq("id", targetUser.id);

      if (updateError) {
        console.error("Failed to update user subscription status:", updateError);
        throw updateError;
      }

      console.log(`[Creem Webhook] Granted '${planName}' plan to user ${targetUser.email} (${targetUser.id})`);
    }

    // Handle Subscription Canceled / Expired / Paused events
    else if (
      eventType === "subscription.canceled" ||
      eventType === "subscription.expired" ||
      eventType === "subscription.paused"
    ) {
      const updateData: Record<string, any> = {
        updated_at: now,
      };

      if (eventType === "subscription.canceled") {
        updateData.subscription_status = "canceled";
      } else {
        // For expired / paused events, reset plan to 'free' while keeping subscription_status as 'active'
        updateData.plan = "free";
        updateData.subscription_status = "active";
        updateData.expire_at = now;
      }

      const { error: updateError } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", targetUser.id);

      if (updateError) {
        console.error("Failed to update user subscription status:", updateError);
        throw updateError;
      }

      console.log(
        `[Creem Webhook] Updated user ${targetUser.email} (${targetUser.id}) for event '${eventType}'`
      );
    } else {

      console.log(`[Creem Webhook] Unhandled event type: ${eventType}`);
    }

    return new Response(
      JSON.stringify({ success: true, eventType, user: targetUser.email }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[Creem Webhook Handler Error]:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
