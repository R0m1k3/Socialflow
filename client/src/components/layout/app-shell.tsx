import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import Sidebar from "@/components/sidebar";
import { Logo } from "@/components/brand/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { titleForPath } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

/** Cadre de l'application connectée : sidebar (desktop), en-tête + barre basse (mobile). */
export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur-lg lg:hidden">
          <Link href="/" aria-label="Accueil Social Flow">
            <Logo size={30} subtitle={false} />
          </Link>
          <span className="sr-only">{titleForPath(location)}</span>
        </header>
        <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}

const WIDTHS = {
  narrow: "max-w-3xl",
  default: "max-w-6xl",
  wide: "max-w-[1400px]",
} as const;

interface PageProps {
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
}

/** Conteneur de contenu standard : largeur max, marges et animation d'entrée. */
export function Page({ children, width = "default", className }: PageProps) {
  return (
    <div className={cn("fade-in mx-auto w-full px-4 py-5 sm:px-6 sm:py-8 lg:px-8", WIDTHS[width], className)}>
      {children}
    </div>
  );
}
