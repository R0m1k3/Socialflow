import {
  BarChart3,
  Bot,
  Calendar,
  CalendarClock,
  Clock,
  Database,
  Film,
  Home,
  Images,
  Link2,
  Music,
  PenSquare,
  Settings,
  UserCog,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Courte description affichée dans les menus mobiles. */
  description?: string;
  adminOnly?: boolean;
  testId: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
  adminOnly?: boolean;
}

/** Source unique de la navigation (sidebar desktop, barre mobile, menus). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/", label: "Tableau de bord", icon: Home, testId: "link-tableau-de-bord" }],
  },
  {
    label: "Créer",
    items: [
      { href: "/new", label: "Publication", icon: PenSquare, description: "Photo ou vidéo avec texte", testId: "link-nouvelle-publication" },
      { href: "/reel", label: "Reel", icon: Film, description: "Montage guidé avec musique et voix", testId: "link-nouveau-reel" },
      { href: "/reel/schedule", label: "Programmer un Reel", icon: CalendarClock, description: "Vidéo déjà montée", testId: "link-programmer-un-reel" },
      { href: "/image-editor", label: "Éditeur d'images", icon: Wand2, description: "Bandeaux, prix et logo", testId: "link-éditeur-d'images" },
    ],
  },
  {
    label: "Planifier",
    items: [
      { href: "/calendar", label: "Calendrier", icon: Calendar, testId: "link-calendrier" },
      { href: "/history", label: "Historique", icon: Clock, testId: "link-historique" },
    ],
  },
  {
    label: "Bibliothèque",
    items: [
      { href: "/media", label: "Médiathèque", icon: Images, testId: "link-médiathèque" },
      { href: "/audio-admin", label: "Musiques", icon: Music, adminOnly: true, testId: "link-audio-admin" },
    ],
  },
  {
    label: "Analyser",
    items: [
      { href: "/analytics", label: "Statistiques", icon: BarChart3, testId: "link-analytics" },
      { href: "/ai", label: "Assistant IA", icon: Bot, adminOnly: true, testId: "link-assistant-ia" },
    ],
  },
  {
    label: "Administration",
    adminOnly: true,
    items: [
      { href: "/pages", label: "Comptes connectés", icon: Link2, testId: "link-pages-gérées" },
      { href: "/users", label: "Utilisateurs", icon: UserCog, testId: "link-users" },
      { href: "/settings", label: "Paramètres", icon: Settings, testId: "link-settings" },
      { href: "/sql", label: "Base de données", icon: Database, testId: "link-sql" },
    ],
  },
];

export const CREATE_ITEMS = NAV_GROUPS.find((g) => g.label === "Créer")!.items;

export function visibleGroups(isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.filter((g) => isAdmin || !g.adminOnly)
    .map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || !i.adminOnly) }))
    .filter((g) => g.items.length > 0);
}

export function isActivePath(location: string, href: string): boolean {
  if (href === "/") return location === "/";
  // /reel ne doit pas rester actif sur /reel/schedule
  if (href === "/reel") return location === "/reel";
  return location === href || location.startsWith(href + "/");
}

/** Titre de la page courante (header mobile). */
export function titleForPath(location: string): string {
  for (const g of NAV_GROUPS) {
    for (const i of g.items) {
      if (isActivePath(location, i.href)) return i.label;
    }
  }
  return "Social Flow";
}
