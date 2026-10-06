import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme" disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}

const OPTIONS = [
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
  { value: "system", label: "Système", icon: Monitor },
] as const;

/** Sélecteur segmenté clair / sombre / système. */
export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const current = theme ?? "system";

  return (
    <div
      role="radiogroup"
      aria-label="Thème de l'interface"
      className={cn("inline-flex w-full items-center gap-1 rounded-lg bg-muted p-1", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
            current === value ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
          )}
          data-testid={`theme-${value}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}
