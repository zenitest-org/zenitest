import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";

export async function GET(request: Request) {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress;

  const { origin } = new URL(request.url);
  const settingsUrl = `${origin}/settings`;

  if (!email) {
    return NextResponse.redirect(`${origin}/sign-in`);
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  try {
    const response = await fetch(`${apiUrl}/api/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        successUrl: settingsUrl,
        success_url: settingsUrl,
      }),
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();
      const redirectUrl = data.checkout_url || data.checkoutUrl;
      if (redirectUrl) {
        return NextResponse.redirect(redirectUrl, 303);
      }
    } else {
      console.error("[Checkout Route] Backend API returned non-OK status:", response.status);
    }
  } catch (error) {
    console.error("[Checkout Route] Error fetching checkout URL from API:", error);
  }

  return NextResponse.redirect(settingsUrl);
}
