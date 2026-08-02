"use client";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	useSidebar,
} from "@/components/ui/sidebar";
import { NavGroup } from "@/components/nav-group";
import { navGroups } from "@/components/app-shared";
import { NavUser } from "@/components/nav-user";

export function AppSidebar() {
	return (
		<Sidebar collapsible="icon">
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
