import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { UserIcon, BellIcon, CommandIcon, LifeBuoyIcon, BookOpenIcon, CreditCardIcon, LogOutIcon, ChevronsUpDownIcon } from "lucide-react";

const user = {
	name: "Shaban Haider",
	email: "shaban@efferd.com",
	avatar: "https://github.com/shabanhr.png",
};

export function NavUser() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={
				<SidebarMenuButton
					size="lg"
					tooltip={user.name}
					className="cursor-pointer data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground justify-center mx-auto"
				/>
			}>
				<Avatar className="size-8 shrink-0">
					<AvatarImage src={user.avatar} alt={user.name} />
					<AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
				</Avatar>
				<div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
					<span className="truncate font-medium text-foreground">{user.name}</span>
					<span className="truncate text-xs text-muted-foreground">{user.email}</span>
				</div>
				<ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="right" className="w-60">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="font-normal p-2">
						<div className="flex items-center gap-3">
							<Avatar className="size-10">
								<AvatarImage src={user.avatar} alt={user.name} />
								<AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
							</Avatar>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium text-foreground">{user.name}</span>
								<span className="truncate text-xs text-muted-foreground">{user.email}</span>
								<span className="mt-0.5 text-[10px] text-muted-foreground">Store owner</span>
							</div>
						</div>
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem>
						<UserIcon />
						Profile
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem>
						<BellIcon />
						Notifications
					</DropdownMenuItem>
					<DropdownMenuItem>
						<CommandIcon />
						Keyboard shortcuts
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem>
						<LifeBuoyIcon />
						Seller help
					</DropdownMenuItem>
					<DropdownMenuItem>
						<BookOpenIcon />
						Seller guides
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem>
						<CreditCardIcon />
						Plan & billing
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						className="w-full cursor-pointer"
						variant="destructive"
					>
						<LogOutIcon />
						Log out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
