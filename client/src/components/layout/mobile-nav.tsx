import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Calendar, ChevronRight, Home, Images, LogOut, Menu, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CREATE_ITEMS, isActivePath, visibleGroups } from "@/components/layout/nav-config";
import { useLogout, useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Accueil", icon: Home, testId: "tab-home" },
  { href: "/calendar", label: "Calendrier", icon: Calendar, testId: "tab-calendar" },
  { href: "/media", label: "Médias", icon: Images, testId: "tab-media" },
];

/** Barre de navigation inférieure (mobile et tablette, < lg). */
export function MobileNav() {
  const [location, setLocation] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { session, isAdmin } = useSession();
  const logout = useLogout();

  const go = (href: string) => {
    setCreateOpen(false);
    setMenuOpen(false);
    setLocation(href);
  };

  const tab = (t: (typeof TABS)[number]) => {
    const active = isActivePath(location, t.href);
    const Icon = t.icon;
    return (
      <Link
        key={t.href}
        href={t.href}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
          active ? "text-primary" : "text-muted-foreground",
        )}
        aria-current={active ? "page" : undefined}
        data-testid={t.testId}
      >
        <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />
        {t.label}
      </Link>
    );
  };

  // Les entrées déjà accessibles par les onglets ou « Créer » ne sont pas répétées dans le menu.
  const menuGroups = visibleGroups(isAdmin)
    .filter((g) => g.label !== "Créer")
    .map((g) => ({ ...g, items: g.items.filter((i) => !["/", "/calendar", "/media"].includes(i.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur-lg pb-safe lg:hidden"
        aria-label="Navigation mobile"
      >
        <div className="mx-auto flex h-16 max-w-xl items-stretch px-2">
          {tab(TABS[0])}
          {tab(TABS[1])}
          <div className="flex flex-1 items-center justify-center">
            <button
              onClick={() => setCreateOpen(true)}
              className="flex h-12 w-12 -translate-y-3 items-center justify-center rounded-2xl gradient-brand text-white shadow-lg shadow-primary/30 ring-4 ring-background"
              aria-label="Créer"
              data-testid="tab-create"
            >
              <Plus className="h-6 w-6" strokeWidth={2.5} />
            </button>
          </div>
          {tab(TABS[2])}
          <button
            onClick={() => setMenuOpen(true)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
              menuOpen ? "text-primary" : "text-muted-foreground",
            )}
            data-testid="tab-menu"
          >
            <Menu className="h-[22px] w-[22px]" />
            Menu
          </button>
        </div>
      </nav>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="text-left">
            <SheetTitle>Que voulez-vous créer ?</SheetTitle>
            <SheetDescription>Choisissez le type de contenu à préparer.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {CREATE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => go(item.href)}
                  className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                  data-testid={`create-${item.href.replace(/\W+/g, "-")}`}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{item.label}</span>
                    {item.description && <span className="block text-xs text-muted-foreground">{item.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-8">
          <SheetHeader className="text-left">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription className="sr-only">Toutes les sections de Social Flow</SheetDescription>
          </SheetHeader>

          {session && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-muted/60 p-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                  {session.username.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{session.username}</p>
                <p className="text-xs text-muted-foreground">{isAdmin ? "Administrateur" : "Utilisateur"}</p>
              </div>
            </div>
          )}

          {menuGroups.map((group) => (
            <div key={group.label ?? "root"} className="mt-5">
              {group.label && (
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              )}
              <div className="overflow-hidden rounded-xl border bg-card">
                {group.items.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.href}
                      onClick={() => go(item.href)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-accent",
                        i > 0 && "border-t",
                        isActivePath(location, item.href) && "text-primary",
                      )}
                      data-testid={`menu-${item.testId}`}
                    >
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <span className="flex-1 font-medium">{item.label}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-5">
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Apparence</p>
            <ThemeToggle />
          </div>

          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/5"
            data-testid="button-logout-mobile"
          >
            <LogOut className="h-4 w-4" />
            {logout.isPending ? "Déconnexion…" : "Se déconnecter"}
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
