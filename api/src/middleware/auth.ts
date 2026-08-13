import { Context, Next } from "hono";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { supabase } from "../db/supabase";
import crypto from "crypto";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  api_key: string;
  plan?: string;
  subscription_status?: string;
  subscribe_at?: string;
  expire_at?: string;
  minutes_used_web?: number;
  minutes_used_mobile?: number;
  geminiApiKey?: string;
}

const secretKey = process.env.CLERK_SECRET_KEY;
const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const clerkClient = createClerkClient({
  secretKey,
  publishableKey,
});

function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(32);
  let result = "zt-";
  for (let i = 0; i < 32; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
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
        .select("id, email, name, api_key, plan, subscription_status, subscribe_at, expire_at, minutes_used_web, minutes_used_mobile")
        .eq("api_key", apiKey)
        .single();

      if (!error && user) {
        authenticatedUser = user;
      }
    }

    // Validate Access Token via Clerk Auth if API key failed or was not provided
    if (!authenticatedUser && token) {
      try {
        const verifiedPayload = await verifyToken(token, {
          secretKey,
          publishableKey,
          jwtKey: process.env.CLERK_JWT_KEY,
        });

        const userId = verifiedPayload.sub;
        if (userId) {
          let email = (verifiedPayload as any).email || "";
          let name = (verifiedPayload as any).name || "";

          if (!email || !name) {
            try {
              const clerkUser = await clerkClient.users.getUser(userId);
              email =
                clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress ||
                clerkUser.emailAddresses[0]?.emailAddress ||
                "";
              name =
                [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
                clerkUser.username ||
                email ||
                "User";
            } catch {
              if (!name) name = email || "User";
            }
          }

          // Search public.users table by email
          let dbUser: AuthUser | null = null;
          if (email) {
            const { data } = await supabase
              .from("users")
              .select("id, email, name, api_key, plan, subscription_status, subscribe_at, expire_at, minutes_used_web, minutes_used_mobile")
              .eq("email", email)
              .maybeSingle();
            dbUser = data;
          }

          if (dbUser) {
            authenticatedUser = dbUser;
          } else {
            const newApiKey = generateApiKey();
            const { data: createdUser, error: insertErr } = await supabase
              .from("users")
              .insert({
                email,
                name,
                api_key: newApiKey,
              })
              .select("id, email, name, api_key, plan, subscription_status, subscribe_at, expire_at, minutes_used_web, minutes_used_mobile")
              .single();



            if (!insertErr && createdUser) {
              authenticatedUser = createdUser;
            } else {
              if (insertErr) {
                console.error("[Auth Middleware] Error creating user record in users table:", insertErr);
              }
              authenticatedUser = {
                id: userId,
                email,
                name,
                api_key: newApiKey,
              };
            }
          }
        }
      } catch (clerkErr) {
        console.error("[Auth Middleware] Clerk token verification failed:", clerkErr);
      }
    }

    if (!authenticatedUser) {
      return c.json(
        {
          success: false,
          error: "Unauthorized: Invalid or missing API key (x-api-key / Bearer zt-...) or Clerk Access Token",
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
