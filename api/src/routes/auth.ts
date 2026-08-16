import { Hono } from "hono";
import { authMiddleware, AuthUser } from "../middleware/auth";
import { supabase } from "../db/supabase";

export function createAuthRouter() {
  const router = new Hono();

  // Public endpoint to retrieve plan limitations
  router.get("/limitations", async (c) => {
    try {
      const { data, error } = await supabase.from("limitation").select("*");
      if (error) {
        return c.json({ success: false, error: error.message }, 500);
      }
      return c.json({ success: true, data: data || [] });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  // Apply authentication middleware to verify endpoint
  router.use("/verify", authMiddleware);

  const handleVerify = async (c: any) => {
    const user = c.get("user") as AuthUser;

    let usedWebMinutes = user.minutes_used_web ?? 0;
    let usedMobileMinutes = user.minutes_used_mobile ?? 0;

    // Fetch latest user details from users table
    try {
      const { data: dbUser } = await supabase
        .from("users")
        .select("minutes_used_web, minutes_used_mobile, plan, subscription_status, subscribe_at, expire_at")
        .eq("id", user.id)
        .maybeSingle();

      if (dbUser) {
        usedWebMinutes = dbUser.minutes_used_web ?? usedWebMinutes;
        usedMobileMinutes = dbUser.minutes_used_mobile ?? usedMobileMinutes;
        if (dbUser.plan) user.plan = dbUser.plan;
        if (dbUser.subscription_status) user.subscription_status = dbUser.subscription_status;
        if (dbUser.subscribe_at) user.subscribe_at = dbUser.subscribe_at;
        if (dbUser.expire_at) user.expire_at = dbUser.expire_at;
      }
    } catch (err) {
      console.warn("[Auth Verify] Failed to fetch stored user usage minutes:", err);
    }

    // Fetch all plan limitations from limitation table
    const limitationsMap: Record<string, {
      max_minutes_web: number;
      max_minutes_mobile: number;
      max_parallel_web: number;
      max_parallel_mobile: number;
    }> = {};

    try {
      const { data: limitRows, error: limitErr } = await supabase
        .from("limitation")
        .select("plan, max_minutes_web, max_minutes_mobile, max_parallel_web, max_parallel_mobile");

      if (!limitErr && limitRows) {
        for (const row of limitRows) {
          limitationsMap[row.plan.toLowerCase()] = {
            max_minutes_web: row.max_minutes_web,
            max_minutes_mobile: row.max_minutes_mobile,
            max_parallel_web: row.max_parallel_web,
            max_parallel_mobile: row.max_parallel_mobile,
          };
        }
      }
    } catch (err) {
      console.warn("[Auth Verify] Failed to fetch limitation table:", err);
    }

    const userPlan = (user.plan || "free").toLowerCase();
    const activeLimit = limitationsMap[userPlan] || {
      max_minutes_web: userPlan === "pro" ? -1 : 100,
      max_minutes_mobile: userPlan === "pro" ? -1 : 100,
      max_parallel_web: userPlan === "pro" ? -1 : 1,
      max_parallel_mobile: userPlan === "pro" ? -1 : 1,
    };

    return c.json({
      success: true,
      message: "User verified successfully",
      limitations: limitationsMap,
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
        max_web_minutes: activeLimit.max_minutes_web,
        used_mobile_minutes: usedMobileMinutes,
        max_mobile_minutes: activeLimit.max_minutes_mobile,
        max_parallel_web: activeLimit.max_parallel_web,
        max_parallel_mobile: activeLimit.max_parallel_mobile,
      },
    });
  };

  router.get("/verify", handleVerify);
  router.post("/verify", handleVerify);

  return router;
}
