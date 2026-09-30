import {
  BarChart3,
  Bot,
  CalendarDays,
  CheckCheck,
  Handshake,
  HelpCircle,
  Home,
  LayoutGrid,
  Megaphone,
  PenSquare,
  Settings,
  Share2,
  Brain,
  Inbox,
  FileText,
  MessageCircle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; key: string; icon: LucideIcon; badge?: "approvals" | "leads" };

/**
 * Reference app navigation: a black icon rail of hubs, and a light sidebar listing the active hub's pages.
 * Every page keeps its URL; a hub is just a group.
 */
export type NavGroup = { key: "home" | "growth" | "sales" | "insights" | "ai"; icon: LucideIcon; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "home",
    icon: Home,
    items: [
      { href: "/home", key: "home", icon: Home },
      { href: "/approvals", key: "approvals", icon: CheckCheck, badge: "approvals" },
    ],
  },
  {
    key: "growth",
    icon: PenSquare,
    items: [
      { href: "/content", key: "content", icon: PenSquare },
      { href: "/calendar", key: "calendar", icon: CalendarDays },
      { href: "/social", key: "social", icon: Share2 },
      { href: "/campaigns", key: "campaigns", icon: Megaphone },
    ],
  },
  {
    key: "sales",
    icon: Handshake,
    items: [
      { href: "/sales", key: "sales", icon: Handshake, badge: "leads" },
      { href: "/whatsapp", key: "whatsapp", icon: MessageCircle },
      { href: "/inbox", key: "inbox", icon: Inbox },
    ],
  },
  {
    key: "insights",
    icon: BarChart3,
    items: [
      { href: "/analytics", key: "analytics", icon: BarChart3 },
      { href: "/reports", key: "reports", icon: FileText },
    ],
  },
  {
    key: "ai",
    icon: Sparkles,
    items: [
      { href: "/team", key: "team", icon: Bot },
      { href: "/knowledge", key: "knowledge", icon: Brain },
    ],
  },
];

export const PRIMARY_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const FOOTER_NAV: NavItem[] = [
  { href: "/settings", key: "settings", icon: Settings },
  { href: "/help", key: "help", icon: HelpCircle },
];

/** Mobile bottom bar — the rest lives behind "More". */
export const MOBILE_TABS: NavItem[] = [
  { href: "/home", key: "home", icon: Home },
  { href: "/approvals", key: "approvals", icon: CheckCheck, badge: "approvals" },
  { href: "/sales", key: "sales", icon: Handshake, badge: "leads" },
];

export const MORE_ICON = LayoutGrid;
