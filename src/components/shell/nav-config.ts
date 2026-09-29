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
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; key: string; icon: LucideIcon; badge?: "approvals" | "leads" };

export const PRIMARY_NAV: NavItem[] = [
  { href: "/home", key: "home", icon: Home },
  { href: "/team", key: "team", icon: Bot },
  { href: "/content", key: "content", icon: PenSquare },
  { href: "/calendar", key: "calendar", icon: CalendarDays },
  { href: "/social", key: "social", icon: Share2 },
  { href: "/sales", key: "sales", icon: Handshake, badge: "leads" },
  { href: "/whatsapp", key: "whatsapp", icon: MessageCircle },
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
