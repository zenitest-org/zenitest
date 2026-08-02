import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Clock02Icon, Settings01Icon } from "@hugeicons/core-free-icons";

export type SidebarNavItem = {
  title: string;
  path?: string;
  icon?: ReactNode;
  isActive?: boolean;
  isModal?: boolean;
  subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
  label?: string;
  items: SidebarNavItem[];
};

export const navGroups: SidebarNavGroup[] = [
  {
    items: [
      {
        title: "Runs",
        path: "/runs",
        icon: <HugeiconsIcon icon={Clock02Icon} strokeWidth={2.2} />,
      },
      {
        title: "Settings",
        isModal: true,
        icon: <HugeiconsIcon icon={Settings01Icon} strokeWidth={2.2} />,
      },
    ],
  },
];

export const footerNavLinks: SidebarNavItem[] = [];

export const navLinks: SidebarNavItem[] = [
  ...navGroups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.subItems?.length ? [item, ...item.subItems] : [item],
    ),
  ),
];
