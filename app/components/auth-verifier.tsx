"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";

export function AuthVerifier() {
  const { isSignedIn, getToken } = useAuth();
  const hasVerified = useRef(false);

  useEffect(() => {
    if (!isSignedIn) {
      hasVerified.current = false;
      return;
    }

    if (hasVerified.current) return;

    async function verifyUserWithBackend() {
      try {
        const token = await getToken();
        if (!token) return;

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        const response = await fetch(`${apiUrl}/api/auth/verify`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const data = await response.json();
          hasVerified.current = true;
          console.log("[AuthVerifier] Dashboard arrival: Verified user with backend API:", data.user);
        } else {
          console.warn("[AuthVerifier] Backend auth verification response status:", response.status);
        }
      } catch (error) {
        console.error("[AuthVerifier] Failed to verify user with backend API:", error);
      }
    }

    verifyUserWithBackend();
  }, [isSignedIn, getToken]);

  return null;
}
