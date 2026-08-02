"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { SettingsView } from "@/components/settings-view";
import type { SidebarNavGroup } from "@/components/app-shared";
import { ChevronRightIcon } from "lucide-react";

export function NavGroup({ label, items }: SidebarNavGroup) {
	const pathname = usePathname();
	const [settingsModalOpen, setSettingsModalOpen] = useState(false);

	return (
		<>
			<SidebarGroup>
				{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
				<SidebarMenu>
					{items.map((item) => {
						const isActive = !item.isModal && (item.path === pathname || (item.path === "/runs" && (pathname === "/" || pathname.startsWith("/runs"))));

						if (item.isModal) {
							return (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton
										tooltip={item.title}
										onClick={() => setSettingsModalOpen(true)}
									>
										{item.icon}
										<span>{item.title}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						}

						return (
							<Collapsible className="group/collapsible" defaultOpen={
								isActive || item.subItems?.some((i) => i.path === pathname)
							} key={item.title} render={<SidebarMenuItem />}>{item.subItems?.length ? (
									<>
										<CollapsibleTrigger render={<SidebarMenuButton isActive={isActive} tooltip={item.title} />}>{item.icon}<span>{item.title}</span><ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" /></CollapsibleTrigger>
										<CollapsibleContent>
											<SidebarMenuSub>
												{item.subItems?.map((subItem) => (
													<SidebarMenuSubItem key={subItem.title}>
														<SidebarMenuSubButton isActive={subItem.path === pathname} render={<Link href={subItem.path || "#"} />}>{subItem.icon}<span>{subItem.title}</span></SidebarMenuSubButton>
													</SidebarMenuSubItem>
												))}
											</SidebarMenuSub>
										</CollapsibleContent>
									</>
								) : (
									<SidebarMenuButton isActive={isActive} tooltip={item.title} render={<Link href={item.path || "#"} />}>{item.icon}<span>{item.title}</span></SidebarMenuButton>
								)}</Collapsible>
						);
					})}
				</SidebarMenu>
			</SidebarGroup>

			<Dialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen}>
				<DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
					</DialogHeader>
					<div className="py-2">
						<SettingsView />
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
