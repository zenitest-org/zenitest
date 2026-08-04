"use client";

import { UserButton, SignInButton, useUser } from "@clerk/nextjs";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { LogInIcon } from "lucide-react";

export function NavUser() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="h-10 w-full flex items-center justify-center animate-pulse bg-sidebar-accent/50 rounded-md" />
    );
  }

  if (!isSignedIn) {
    return (
      <SignInButton mode="redirect">
        <SidebarMenuButton size="lg" className="w-full justify-center cursor-pointer">
          <LogInIcon className="size-4 mr-2" />
          <span className="group-data-[collapsible=icon]:hidden">Sign In</span>
        </SidebarMenuButton>
      </SignInButton>
    );
  }

  return (
    <div className="flex items-center justify-center w-full py-1">
      <UserButton
        showName
        appearance={{
          elements: {
            rootBox: "flex w-full justify-center items-center",
            userButtonOuterIdentifier: "truncate font-medium text-sm text-foreground max-w-[120px] group-data-[collapsible=icon]:hidden",
            userButtonBox: "flex items-center gap-2 flex-row-reverse group-data-[collapsible=icon]:flex-row",
          },
        }}
      />
    </div>
  );
}
