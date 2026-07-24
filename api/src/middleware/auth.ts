import { Context, Next } from "hono";
import { supabase } from "../db/supabase";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  api_key: string;
}

export async function authMiddleware(c: Context, next: Next) {
  try {
    let token: string | null = null;
    let apiKey: string | null = null;

    // 1. Check x-api-key header
    const xApiKey = c.req.header("x-api-key") || c.req.header("X-API-Key");
    if (xApiKey) {
      apiKey = xApiKey;
    }

    // 2. Check Authorization header (Bearer token or Bearer zt-...)
    const authHeader = c.req.header("Authorization") || c.req.header("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const value = authHeader.substring(7).trim();
      if (value.startsWith("zt-")) {
        apiKey = value;
      } else {
        token = value;
      }
    }

    // 3. Check query parameters if headers are absent
    if (!apiKey && !token) {
      apiKey = c.req.query("apiKey") || c.req.query("api_key") || null;
      token = c.req.query("accessToken") || c.req.query("access_token") || null;
    }

    // 4. Check JSON request body if headers & query params are absent
    if (!apiKey && !token && c.req.header("content-type")?.includes("application/json")) {
      try {
        const body = await c.req.json();
        if (body) {
          apiKey = body.apiKey || body.api_key || null;
          token = token || body.accessToken || body.access_token || null;
        }
      } catch {
        // Ignore JSON body parsing error
      }
    }

    let authenticatedUser: AuthUser | null = null;

    // Validate API Key against public.users table
    if (apiKey) {
      const { data: user, error } = await supabase
        .from("users")
        .select("id, email, name, api_key")
        .eq("api_key", apiKey)
        .single();

      if (!error && user) {
        authenticatedUser = user;
      }
    }

    // Validate Access Token via Supabase Auth if API key failed or was not provided
    if (!authenticatedUser && token) {
      const { data, error: authError } = await supabase.auth.getUser(token);
      if (!authError && data?.user) {
        const { data: dbUser } = await supabase
          .from("users")
          .select("id, email, name, api_key")
          .eq("id", data.user.id)
          .single();

        if (dbUser) {
          authenticatedUser = dbUser;
        } else {
          authenticatedUser = {
            id: data.user.id,
            email: data.user.email || "",
            name: data.user.user_metadata?.name || data.user.email || "User",
            api_key: "",
          };
        }
      }
    }

    if (!authenticatedUser) {
      return c.json(
        {
          success: false,
          error: "Unauthorized: Invalid or missing API key (x-api-key / Bearer zt-...) or Access Token",
        },
        401
      );
    }

    // Attach authenticated user to request context
    c.set("user", authenticatedUser);
    await next();
  } catch (err: any) {
    console.error("[Auth Middleware] Error validating credentials:", err);
    return c.json({ success: false, error: "Internal authentication error" }, 500);
  }
}
