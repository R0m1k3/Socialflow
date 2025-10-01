import { Bell, Menu } from "lucide-react";

interface TopBarProps {
  onMenuClick: () => void;
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header className="bg-card border-b border-border sticky top-0 z-10">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <button 
            className="lg:hidden text-foreground"
            onClick={onMenuClick}
            data-testid="button-menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Tableau de bord</h2>
            <p className="text-sm text-muted-foreground">Gérez vos publications sur tous vos réseaux</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="relative p-2 text-muted-foreground hover:text-foreground transition-all" data-testid="button-notifications">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full"></span>
          </button>
          <div className="flex items-center gap-3 pl-4 border-l border-border">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-semibold">SF</span>
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-medium text-foreground">Social Flow</p>
              <p className="text-xs text-muted-foreground">admin@socialflow.app</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
