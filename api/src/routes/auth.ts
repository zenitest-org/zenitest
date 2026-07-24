import { Hono } from "hono";
import { authMiddleware, AuthUser } from "../middleware/auth";

export function createAuthRouter() {
  const router = new Hono();

  // Apply authentication middleware to verify endpoint
  router.use("/verify", authMiddleware);

  const handleVerify = (c: any) => {
    const user = c.get("user") as AuthUser;
    return c.json({
      success: true,
      message: "API key verified successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  };

  router.get("/verify", handleVerify);
  router.post("/verify", handleVerify);

  return router;
}
