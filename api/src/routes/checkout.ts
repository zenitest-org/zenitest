import { Hono } from "hono";
import { Creem } from "creem";
import { supabase } from "../db/supabase";

export function createCheckoutRouter() {
  const router = new Hono();

  const handleCheckout = async (c: any) => {
    try {
      let email: string | undefined;
      let productId: string | undefined;
      let successUrl: string | undefined;

      if (c.req.method === "POST") {
        const body = await c.req.json().catch(() => ({}));
        email = body.email;
        productId = body.productId || body.product_id;
        successUrl = body.successUrl || body.success_url;
      } else {
        email = c.req.query("email");
        productId = c.req.query("productId") || c.req.query("product_id");
        successUrl = c.req.query("successUrl") || c.req.query("success_url");
      }

      if (!email) {
        return c.json(
          {
            success: false,
            error: "Email is required to generate checkout URL",
          },
          400
        );
      }

      const apiKey = process.env.CREEM_API_KEY || "";
      const targetProductId = productId || process.env.CREEM_PRODUCT_ID || "";

      // If CREEM_API_KEY is missing or set to initial placeholder
      if (!apiKey || apiKey.includes("your_creem_api_key")) {
        console.warn("[Checkout API] CREEM_API_KEY is not configured. Returning test mode fallback URL.");
        const fallbackUrl = `https://test.creem.io/checkout/mock?email=${encodeURIComponent(email)}${successUrl ? `&success_url=${encodeURIComponent(successUrl)}` : ""}`;
        return c.json({
          success: true,
          checkout_url: fallbackUrl,
          checkoutUrl: fallbackUrl,
          mock: true,
          message: "CREEM_API_KEY environment variable is not configured. Returning fallback URL.",
        });
      }

      const isTestMode = apiKey.startsWith("creem_test_");
      const creem = new Creem({
        apiKey,
        server: isTestMode ? "test" : "prod",
      });

      const checkoutResponse = await creem.checkouts.create({
        productId: targetProductId,
        customer: {
          email,
        },
        ...(successUrl ? { successUrl } : {}),
      });

      const checkoutUrl = checkoutResponse.checkoutUrl;

      if (!checkoutUrl) {
        return c.json(
          {
            success: false,
            error: "Failed to obtain checkout URL from Creem API",
          },
          500
        );
      }

      return c.json({
        success: true,
        checkout_url: checkoutUrl,
        checkoutUrl: checkoutUrl,
        checkout: checkoutResponse,
      });
    } catch (err: any) {
      console.error("[Checkout API Error]:", err);
      return c.json(
        {
          success: false,
          error: err.message || "Failed to generate checkout session",
        },
        500
      );
    }
  };

  const handleCancel = async (c: any) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const email = body.email || c.req.query("email");
      const subscriptionId = body.subscriptionId || body.subscription_id;

      if (!email) {
        return c.json({ success: false, error: "Email is required to cancel subscription" }, 400);
      }

      // Update user subscription_status to 'canceled' in Supabase
      const now = new Date().toISOString();
      const { data: updatedUser, error: updateErr } = await supabase
        .from("users")
        .update({
          subscription_status: "canceled",
          expire_at: now,
          updated_at: now,
        })
        .eq("email", email)
        .select()
        .maybeSingle();

      if (updateErr) {
        console.error("[Cancel API] Supabase update error:", updateErr);
      }

      // If Creem API key & subscriptionId are present, cancel via Creem SDK
      const apiKey = process.env.CREEM_API_KEY || "";
      if (apiKey && !apiKey.includes("your_creem_api_key") && subscriptionId) {
        try {
          const isTestMode = apiKey.startsWith("creem_test_");
          const creem = new Creem({
            apiKey,
            server: isTestMode ? "test" : "prod",
          });
          await creem.subscriptions.cancel(subscriptionId, { mode: "immediate" });
          console.log(`[Cancel API] Creem subscription ${subscriptionId} canceled.`);
        } catch (creemErr) {
          console.warn("[Cancel API] Creem SDK cancel warning:", creemErr);
        }
      }

      return c.json({
        success: true,
        message: "Subscription canceled successfully",
        user: updatedUser,
      });
    } catch (err: any) {
      console.error("[Cancel API Error]:", err);
      return c.json({ success: false, error: err.message || "Failed to cancel subscription" }, 500);
    }
  };

  const handleReactivate = async (c: any) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const email = body.email || c.req.query("email");

      if (!email) {
        return c.json({ success: false, error: "Email is required to reactivate subscription" }, 400);
      }

      // Update user subscription_status to 'active' and plan to 'pro'
      const now = new Date().toISOString();
      const { data: updatedUser, error: updateErr } = await supabase
        .from("users")
        .update({
          subscription_status: "active",
          plan: "pro",
          subscribe_at: now,
          expire_at: null,
          updated_at: now,
        })
        .eq("email", email)
        .select()
        .maybeSingle();

      if (updateErr) {
        console.error("[Reactivate API] Supabase update error:", updateErr);
      }

      return c.json({
        success: true,
        message: "Subscription reactivated successfully",
        user: updatedUser,
      });
    } catch (err: any) {
      console.error("[Reactivate API Error]:", err);
      return c.json({ success: false, error: err.message || "Failed to reactivate subscription" }, 500);
    }
  };

  router.post("/", handleCheckout);
  router.get("/", handleCheckout);
  router.post("/cancel", handleCancel);
  router.post("/reactivate", handleReactivate);

  return router;
}
