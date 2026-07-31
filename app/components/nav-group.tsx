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
import type { SidebarNavGroup } from "@/components/app-shared";
import { ChevronRightIcon } from "lucide-react";

export function NavGroup({ label, items }: SidebarNavGroup) {
	const pathname = usePathname();

	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarMenu>
				{items.map((item) => {
					const isActive = item.path === pathname || (item.path === "/runs" && (pathname === "/" || pathname === "/runs"));

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
	);
}
