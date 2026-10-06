import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronsLeft, ChevronsRight, LogOut, Plus } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isActivePath, visibleGroups, type NavItem } from "@/components/layout/nav-config";
import { useLogout, useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem("sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
      data-testid={item.testId}
    >
      {active && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />}
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/** Barre latérale desktop (≥ lg). Sur mobile, la navigation passe par MobileNav. */
export default function Sidebar() {
  const [location] = useLocation();
  const { session, isAdmin } = useSession();
  const logout = useLogout();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", String(collapsed));
    } catch {
      /* stockage indisponible : on ignore */
    }
  }, [collapsed]);

  const groups = visibleGroups(isAdmin);
  const initials = session?.username.substring(0, 2).toUpperCase() ?? "?";

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      <div className={cn("flex h-16 items-center border-b border-sidebar-border", collapsed ? "justify-center" : "px-5")}>
        <Link href="/" aria-label="Accueil Social Flow">
          {collapsed ? <LogoMark size={34} /> : <Logo size={34} />}
        </Link>
      </div>

      <div className={cn("pt-4", collapsed ? "px-3" : "px-4")}>
        <Button asChild variant="brand" className={cn("w-full", collapsed && "px-0")} data-testid="button-sidebar-create">
          <Link href="/new" aria-label="Créer une publication">
            <Plus className="h-4 w-4" />
            {!collapsed && "Créer"}
          </Link>
        </Button>
      </div>

      <nav className={cn("flex-1 overflow-y-auto py-4 scrollbar-none", collapsed ? "px-3" : "px-4")} aria-label="Navigation principale">
        {groups.map((group, gi) => (
          <div key={group.label ?? gi} className={cn(gi > 0 && "mt-4")}>
            {group.label &&
              (collapsed ? (
                <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
              ) : (
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {group.label}
                </p>
              ))}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActivePath(location, item.href)} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("border-t border-sidebar-border p-3", collapsed && "flex flex-col items-center gap-2")}>
        {session && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-sidebar-accent",
                  collapsed && "justify-center",
                )}
                data-testid="button-user-menu"
              >
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials}</AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{session.username}</p>
                    <p className="text-xs text-muted-foreground">{isAdmin ? "Administrateur" : "Utilisateur"}</p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side={collapsed ? "right" : "top"} align="start" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{session.username}</p>
                <p className="text-xs text-muted-foreground">{isAdmin ? "Administrateur" : "Utilisateur"}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <p className="mb-1.5 text-xs text-muted-foreground">Apparence</p>
                <ThemeToggle />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                className="text-destructive focus:text-destructive"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
                {logout.isPending ? "Déconnexion…" : "Se déconnecter"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "mt-1 flex w-full items-center justify-center gap-2 rounded-lg p-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
          )}
          aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
          data-testid="button-toggle-sidebar"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Replier</>}
        </button>
      </div>
    </aside>
  );
}
