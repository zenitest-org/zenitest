import { Hono } from "hono";
import { authMiddleware, AuthUser } from "../middleware/auth";
import { supabase } from "../db/supabase";

export function createAuthRouter() {
  const router = new Hono();

  // Apply authentication middleware to verify endpoint
  router.use("/verify", authMiddleware);

  const handleVerify = async (c: any) => {
    const user = c.get("user") as AuthUser;

    let usedWebMinutes = user.minutes_used_web ?? 0;
    let usedMobileMinutes = user.minutes_used_mobile ?? 0;

    // If stored minutes are not populated yet, check public.users table or calculate fallback
    try {
      const { data: dbUser } = await supabase
        .from("users")
        .select("minutes_used_web, minutes_used_mobile")
        .eq("id", user.id)
        .maybeSingle();

      if (dbUser) {
        usedWebMinutes = dbUser.minutes_used_web ?? usedWebMinutes;
        usedMobileMinutes = dbUser.minutes_used_mobile ?? usedMobileMinutes;
      }
    } catch (err) {
      console.warn("[Auth Verify] Failed to fetch stored user usage minutes:", err);
    }

    let maxWebMinutes = 100;
    let maxMobileMinutes = 100;
    try {
      const { data: limitRow } = await supabase
        .from("limitation")
        .select("max_minutes_web, max_minutes_mobile")
        .eq("plan", (user.plan || "free").toLowerCase())
        .maybeSingle();

      if (limitRow) {
        maxWebMinutes = limitRow.max_minutes_web;
        maxMobileMinutes = limitRow.max_minutes_mobile;
      } else {
        const plan = (user.plan || "free").toLowerCase();
        maxWebMinutes = plan === "pro" ? -1 : 100;
        maxMobileMinutes = plan === "pro" ? -1 : 100;
      }
    } catch {
      const plan = (user.plan || "free").toLowerCase();
      maxWebMinutes = plan === "pro" ? -1 : 100;
      maxMobileMinutes = plan === "pro" ? -1 : 100;
    }

    return c.json({
      success: true,
      message: "User verified successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        api_key: user.api_key,
        plan: user.plan || "free",
        subscription_status: user.subscription_status || "active",
        subscribe_at: user.subscribe_at || null,
        expire_at: user.expire_at || null,
        minutes_used_web: usedWebMinutes,
        minutes_used_mobile: usedMobileMinutes,
        used_web_minutes: usedWebMinutes,
        max_web_minutes: maxWebMinutes,
        used_mobile_minutes: usedMobileMinutes,
        max_mobile_minutes: maxMobileMinutes,
      },
    });
  };



  router.get("/verify", handleVerify);
  router.post("/verify", handleVerify);

  return router;
}
