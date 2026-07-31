import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "@/components/ui/breadcrumb";

/** Current page segment shown in the header — pass a nav item or `{ title }`. */
export type AppBreadcrumbPage = {
	title: string;
};

export function AppBreadcrumbs({ page }: { page?: AppBreadcrumbPage | null }) {
	if (!page?.title) {
		return null;
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
