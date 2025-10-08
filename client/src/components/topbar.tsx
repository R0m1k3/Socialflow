import { Menu, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TopBarProps {
  onMenuClick: () => void;
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header className="bg-card/50 backdrop-blur-xl border-b border-border/50 sticky top-0 z-10">
      <div className="flex items-center justify-between px-6 lg:px-8 py-5">
        <div className="flex items-center gap-6 flex-1">
          <button 
            className="lg:hidden text-foreground hover:text-primary transition-colors"
            onClick={onMenuClick}
            data-testid="button-menu"
          >
            <Menu className="w-6 h-6" />
          </button>
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
