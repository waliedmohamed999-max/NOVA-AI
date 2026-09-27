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
  Plug,
  Settings,
  Share2,
  Users,
  Brain,
  Inbox,
  FileText,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; key: string; icon: LucideIcon; badge?: "approvals" | "leads" };

export const PRIMARY_NAV: NavItem[] = [
  { href: "/home", key: "home", icon: Home },
  { href: "/team", key: "team", icon: Bot },
  { href: "/content", key: "content", icon: PenSquare },
  { href: "/calendar", key: "calendar", icon: CalendarDays },
  { href: "/social", key: "social", icon: Share2 },
  { href: "/leads", key: "leads", icon: Users, badge: "leads" },
  { href: "/sales", key: "sales", icon: Handshake },
  { href: "/analytics", key: "analytics", icon: BarChart3 },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/approvals", key: "approvals", icon: CheckCheck, badge: "approvals" },
  { href: "/campaigns", key: "campaigns", icon: Megaphone },
  { href: "/inbox", key: "inbox", icon: Inbox },
  { href: "/knowledge", key: "knowledge", icon: Brain },
  { href: "/reports", key: "reports", icon: FileText },
];

export const FOOTER_NAV: NavItem[] = [
  { href: "/integrations", key: "integrations", icon: Plug },
  { href: "/settings", key: "settings", icon: Settings },
  { href: "/help", key: "help", icon: HelpCircle },
];

/** Mobile bottom bar — the rest lives behind "More". */
export const MOBILE_TABS: NavItem[] = [
  { href: "/home", key: "home", icon: Home },
  { href: "/approvals", key: "approvals", icon: CheckCheck, badge: "approvals" },
  { href: "/leads", key: "leads", icon: Users, badge: "leads" },
];

export const MORE_ICON = LayoutGrid;
