"use client";

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useMemo,
  useRef,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  MessageSquare,
  Search,
  BarChart3,
  FlaskConical,
  Bell,
  Sparkles,
  Star,
  LayoutTemplate,
  Store,
  BookOpen,
  Users,
  Settings,
  Activity,
  Gauge,
  UsersRound,
  ShieldCheck,
  Menu,
  LogOut,
  Download,
  User,
  ChevronDown,
  Plus,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { useUser } from "@/contexts/user-context";
import { useTeam } from "@/contexts/team-context";
import { usePwaContext } from "@/components/pwa-provider";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { AlertNotificationBell } from "@/components/alert-notification-bell";
import { LocaleSwitcher } from "@/components/locale-switcher";

// Context for mobile sidebar control
const MobileSidebarContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function MobileSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <MobileSidebarContext.Provider value={value}>
      {children}
    </MobileSidebarContext.Provider>
  );
}

export function useMobileSidebar() {
  return useContext(MobileSidebarContext);
}

interface NavItem {
  href: string;
  /** Translation key under `nav.*`. */
  labelKey: string;
  Icon: LucideIcon;
  adminOnly?: boolean;
  badgeCount?: number;
}

const overviewItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", Icon: LayoutDashboard },
  { href: "/sessions", labelKey: "sessions", Icon: MessageSquare },
  { href: "/search", labelKey: "search", Icon: Search },
];

const insightsItems: NavItem[] = [
  { href: "/analytics", labelKey: "analytics", Icon: BarChart3 },
  { href: "/experiments", labelKey: "experiments", Icon: FlaskConical },
  { href: "/alerts", labelKey: "alerts", Icon: Bell },
  { href: "/insights", labelKey: "aiInsights", Icon: Sparkles },
];

const libraryItems: NavItem[] = [
  { href: "/prompts/favorites", labelKey: "favorites", Icon: Star },
  { href: "/templates", labelKey: "templates", Icon: LayoutTemplate },
  { href: "/marketplace", labelKey: "marketplace", Icon: Store },
];

const workspaceItems: NavItem[] = [
  { href: "/teams", labelKey: "teams", Icon: Users },
  { href: "/settings", labelKey: "settings", Icon: Settings },
  { href: "/docs", labelKey: "docs", Icon: BookOpen },
];

const adminNavItems: NavItem[] = [
  { href: "/admin/monitoring", labelKey: "monitoring", Icon: Activity, adminOnly: true },
  { href: "/admin/diagnostics", labelKey: "diagnostics", Icon: Gauge, adminOnly: true },
  { href: "/admin/sessions", labelKey: "sessions", Icon: MessageSquare, adminOnly: true },
  { href: "/admin/analytics", labelKey: "aiInsights", Icon: BarChart3, adminOnly: true },
  { href: "/admin/users", labelKey: "users", Icon: UsersRound, adminOnly: true },
  { href: "/admin/allowlist", labelKey: "allowlist", Icon: ShieldCheck, adminOnly: true },
];

function SidebarNavLink({
  item,
  isActive,
  onClick,
  label,
}: {
  item: NavItem;
  isActive: boolean;
  onClick?: () => void;
  label: string;
}) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      onClick={onClick}
      className={`
        relative flex items-center gap-3 rounded-lg px-3 py-2
        text-sm transition-colors
        ${
          isActive
            ? "bg-sidebar-active text-sidebar-active-foreground font-semibold"
            : "font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        }
      `}
    >
      {isActive && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sidebar-active-indicator" />
      )}
      <span className={isActive ? "text-sidebar-active-indicator" : ""}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      {label}
      {item.badgeCount !== undefined && item.badgeCount > 0 && (
        <span className="ml-auto flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
          {item.badgeCount > 99 ? "99+" : item.badgeCount}
        </span>
      )}
    </Link>
  );
}

function SidebarGroup({
  label,
  items,
  pathname,
  onLinkClick,
  tNav,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onLinkClick?: () => void;
  tNav: (key: string) => string;
}) {
  return (
    <div>
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="space-y-1">
        {items.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <SidebarNavLink
              key={item.href}
              item={item}
              isActive={isActive}
              onClick={onLinkClick}
              label={tNav(item.labelKey)}
            />
          );
        })}
      </div>
    </div>
  );
}

function TeamSwitcher() {
  const { teams, selectedTeamId, selectTeam, loading } = useTeam();
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  const tNav = useTranslations("nav");

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  if (loading || !user) return null;

  const personalLabel = tNav("personal");

  return (
    <div className="shrink-0 px-3 pb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="team-switcher-menu"
        aria-label="Select team"
        className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
      >
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 truncate text-left">
          {selectedTeam ? selectedTeam.name : personalLabel}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id="team-switcher-menu"
          role="menu"
          className="mt-1 rounded-lg border border-border bg-card shadow-sm"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              selectTeam(null);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/50 ${!selectedTeamId ? "text-primary font-medium" : "text-muted-foreground"}`}
          >
            <User className="h-4 w-4" aria-hidden="true" />
            {personalLabel}
          </button>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              role="menuitem"
              onClick={() => {
                selectTeam(team.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/50 ${selectedTeamId === team.id ? "text-primary font-medium" : "text-muted-foreground"}`}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1 truncate text-left">{team.name}</span>
              <span className="text-[10px] uppercase text-muted-foreground/60">{team.role}</span>
            </button>
          ))}
          <div className="border-t border-border px-3 py-2">
            <Link
              href="/teams"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {tNav("manageTeams")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname();
  const { user, loading, logout } = useUser();
  const { teams } = useTeam();
  const { isOffline, isInstallable, installPrompt } = usePwaContext();
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");

  useEffect(() => {
    async function fetchUnread() {
      try {
        const res = await fetch("/api/alerts/notifications?unreadOnly=true");
        if (res.ok) {
          const data = await res.json();
          setUnreadAlerts(data.notifications.length);
        }
      } catch {
        // Silently fail
      }
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, []);

  const insightsItemsWithBadges = insightsItems.map((item) =>
    item.href === "/alerts" && unreadAlerts > 0
      ? { ...item, badgeCount: unreadAlerts }
      : item
  );

  return (
    <>
      <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
        <Link
          href="/dashboard"
          className="flex items-center"
          onClick={onLinkClick}
        >
          <img
            src="/logo-dark.svg"
            alt="Oh My Prompt"
            className="h-8 w-auto dark:invert-0 invert"
          />
        </Link>
      </div>

      {/* Offline banner */}
      {isOffline && (
        <div className="shrink-0 px-3 py-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            {tCommon("offline")}
          </p>
        </div>
      )}

      <nav className="flex-1 min-h-0 overflow-y-auto space-y-5 px-3 py-4" aria-label="Main navigation">
        <SidebarGroup
          label={tNav("overview")}
          items={overviewItems}
          pathname={pathname}
          onLinkClick={onLinkClick}
          tNav={tNav}
        />
        <SidebarGroup
          label={tNav("insights")}
          items={insightsItemsWithBadges}
          pathname={pathname}
          onLinkClick={onLinkClick}
          tNav={tNav}
        />
        <SidebarGroup
          label={tNav("library")}
          items={libraryItems}
          pathname={pathname}
          onLinkClick={onLinkClick}
          tNav={tNav}
        />
        <SidebarGroup
          label={tNav("workspace")}
          items={workspaceItems}
          pathname={pathname}
          onLinkClick={onLinkClick}
          tNav={tNav}
        />

        {/* Teams Section */}
        {teams.length > 0 && (
          <div>
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {tNav("teams")}
            </p>
            <div className="space-y-1">
              {teams.map((team) => {
                const href = `/teams/${team.id}`;
                const isActive = pathname === href;
                return (
                  <Link
                    key={team.id}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onLinkClick}
                    className={`
                      relative flex items-center gap-3 rounded-lg px-3 py-2
                      text-sm transition-colors
                      ${
                        isActive
                          ? "bg-sidebar-active text-sidebar-active-foreground font-semibold"
                          : "font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      }
                    `}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sidebar-active-indicator" />
                    )}
                    <span className={isActive ? "text-sidebar-active-indicator" : ""}>
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="truncate">{team.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Admin Section */}
        {user?.isAdmin && (
          <SidebarGroup
            label={tNav("admin")}
            items={adminNavItems}
            pathname={pathname}
            onLinkClick={onLinkClick}
            tNav={tNav}
          />
        )}
      </nav>

      {/* Team Switcher */}
      <TeamSwitcher />

      {/* Utility controls: language, notifications, theme */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
        <LocaleSwitcher variant="compact" align="start" direction="up" />
        <div className="flex items-center gap-0.5">
          {isOffline && (
            <span
              className="inline-flex h-2 w-2 rounded-full bg-destructive"
              title="Offline"
            />
          )}
          <AlertNotificationBell />
          <ThemeToggle />
        </div>
      </div>

      {/* User Info Section */}
      <div className="shrink-0 p-4">
        {loading ? (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-skeleton animate-pulse" />
            <div className="flex-1">
              <div className="h-4 w-24 bg-skeleton rounded animate-pulse" />
            </div>
          </div>
        ) : user ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user.name || user.email.split("@")[0]}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              {user.isAdmin && (
                <Badge variant="warning" className="shrink-0">
                  {tNav("admin")}
                </Badge>
              )}
            </div>
            {/* Install App button */}
            {isInstallable && (
              <button
                type="button"
                onClick={installPrompt}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/5 hover:border-primary/30"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {tNav("installApp")}
              </button>
            )}

            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {tCommon("signOut")}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function MobileHeader() {
  const { open, setOpen } = useMobileSidebar();
  const { isOffline } = usePwaContext();
  const tCommon = useTranslations("common");

  return (
    <div className="md:hidden flex items-center h-14 border-b border-border px-4 bg-card">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="mobile-sidebar"
        aria-label={tCommon("openNav")}
        className="p-2 -ml-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      <Link href="/dashboard" className="ml-3">
        <img
          src="/logo-dark.svg"
          alt="Oh My Prompt"
          className="h-8 w-auto dark:invert-0 invert"
        />
      </Link>
      {isOffline && (
        <div className="ml-auto flex items-center gap-1.5 text-xs text-destructive">
          <span className="inline-flex h-2 w-2 rounded-full bg-destructive" />
          Offline
        </div>
      )}
    </div>
  );
}

function MobileSidebarOverlay() {
  const { open, setOpen } = useMobileSidebar();
  const drawerRef = useRef<HTMLElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Focus trap + restore focus on close
  useEffect(() => {
    if (!open) {
      // Restore focus when drawer closes
      previouslyFocused.current?.focus?.();
      previouslyFocused.current = null;
      return;
    }

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const drawer = drawerRef.current;
    if (!drawer) return;

    const focusableSelector =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

    const getFocusable = () =>
      Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null
      );

    // Focus the first focusable element on open
    const focusables = getFocusable();
    focusables[0]?.focus();

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    drawer.addEventListener("keydown", handleTabKey);
    return () => drawer.removeEventListener("keydown", handleTabKey);
  }, [open]);

  return (
    <div
      className={`fixed inset-0 z-50 md:hidden ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={close}
      />
      {/* Drawer */}
      <aside
        ref={drawerRef}
        id="mobile-sidebar"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={`fixed left-0 top-0 h-full w-64 flex flex-col border-r border-border bg-card shadow-xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent onLinkClick={close} />
      </aside>
    </div>
  );
}

export function Sidebar() {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex h-screen w-64 flex-col border-r border-border bg-card">
        <SidebarContent />
      </aside>

      {/* Mobile overlay sidebar */}
      <MobileSidebarOverlay />
    </>
  );
}
