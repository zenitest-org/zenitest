import { Hono } from "hono";
import { authMiddleware, AuthUser } from "../middleware/auth";
import { supabase } from "../db/supabase";

export function createAuthRouter() {
  const router = new Hono();

  // Apply authentication middleware to verify endpoint
  router.use("/verify", authMiddleware);

  const handleVerify = async (c: any) => {
    const user = c.get("user") as AuthUser;

    let usedWebMinutes = 0;
    let usedMobileMinutes = 0;

    try {
      const { data: userExecutions } = await supabase
        .from("executions")
        .select("duration, duration_ms, platform")
        .eq("user_id", user.id);

      if (userExecutions && Array.isArray(userExecutions)) {
        for (const exec of userExecutions) {
          const durationSeconds = Number(exec.duration || (exec.duration_ms ? exec.duration_ms / 1000 : 0)) || 0;
          const mins = durationSeconds / 60;
          if (exec.platform === "mobile" || exec.platform === "ios" || exec.platform === "android") {
            usedMobileMinutes += mins;
          } else {
            usedWebMinutes += mins;
          }
        }
      }
    } catch (err) {
      console.warn("[Auth Verify] Failed to calculate execution usage minutes:", err);
    }

    const plan = (user.plan || "free").toLowerCase();
    const maxWebMinutes = plan === "pro" ? -1 : 100;
    const maxMobileMinutes = plan === "pro" ? 100 : 0;

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
        used_web_minutes: Math.ceil(usedWebMinutes),
        max_web_minutes: maxWebMinutes,
        used_mobile_minutes: Math.ceil(usedMobileMinutes),
        max_mobile_minutes: maxMobileMinutes,
      },
    });
  };


  router.get("/verify", handleVerify);
  router.post("/verify", handleVerify);

  return router;
}
