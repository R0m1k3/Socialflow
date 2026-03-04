import { Menu, Search, ChevronLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";

interface TopBarProps {
  onMenuClick?: () => void;
  hideMenuButton?: boolean;
}

export default function TopBar({ onMenuClick, hideMenuButton = false }: TopBarProps) {
  const [location] = useLocation();
  const showBackButton = location !== "/";

  return (
    <header className="bg-card/50 backdrop-blur-xl border-b border-border/50 sticky top-0 z-10">
      <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
        <div className="flex items-center gap-3 sm:gap-6 flex-1">
          <div className="lg:hidden flex items-center gap-2">
            {showBackButton ? (
              <Link href="/">
                <Button variant="ghost" size="icon" className="text-foreground hover:text-primary transition-all">
                  <ChevronLeft className="w-6 h-6" />
                </Button>
              </Link>
            ) : (
              !hideMenuButton && (
                <button
                  className="text-foreground hover:text-primary transition-all hover:scale-110 active:scale-95 p-2 hover:bg-primary/10 rounded-xl"
                  onClick={onMenuClick}
                  data-testid="button-menu"
                  aria-label="Toggle menu"
                >
                  <Menu className="w-6 h-6" />
                </button>
              )
            )}
          </div>
          <div className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher des publications, pages, médias..."
                className="pl-10 bg-muted/30 border-muted focus:border-primary/50 rounded-xl"
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
