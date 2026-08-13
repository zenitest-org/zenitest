"use client";

import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { NavGroup } from "@/components/nav-group";
import { navGroups } from "@/components/app-shared";
import { NavUser } from "@/components/nav-user";

export function AppSidebar() {
  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="py-3.5 px-3 flex flex-row items-center justify-start gap-2.5 border-b border-border/40 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <Link
          href="/"
          className="flex items-center gap-2.5 group focus-visible:outline-none"
        >
          <img
            src="/favicon.svg"
            alt="ZeniTest"
            className="size-7  shrink-0 object-contain shadow-xs transition-transform"
          />
          <span className="font-bold text-sm tracking-tight text-foreground truncate group-data-[collapsible=icon]:hidden">
            ZeniTest
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="py-3.5 flex flex-col items-center">
        {navGroups.map((group, index) => (
          <NavGroup key={`sidebar-group-${index}`} {...group} />
        ))}
      </SidebarContent>

      <SidebarFooter className="py-3 px-2 flex flex-col items-center justify-center border-t border-border/50">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
