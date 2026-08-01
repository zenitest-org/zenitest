import Link from "next/link";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** Current page segment shown in the header — pass a nav item or `{ title, parent }`. */
export type AppBreadcrumbPage = {
	title: string;
	parent?: { title: string; href: string };
};

export function AppBreadcrumbs({ page }: { page?: AppBreadcrumbPage | null }) {
	if (!page?.title) {
		return null;
	}

	if (page.parent) {
		return (
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<Link
							href={page.parent.href}
							className="text-base font-semibold text-zinc-500 dark:text-zinc-400 hover:text-foreground transition-colors"
						>
							{page.parent.title}
						</Link>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage className="text-base font-semibold text-foreground font-mono">
							{page.title}
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		);
	}

	return (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbPage className="text-base font-semibold text-foreground">
						{page.title}
					</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	);
}
