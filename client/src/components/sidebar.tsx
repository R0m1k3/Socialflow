import { Home, PlusCircle, Calendar, Images, Users, Bot, BarChart3, Clock, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";

export default function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { icon: Home, label: "Tableau de bord", href: "/", badge: null },
    { icon: PlusCircle, label: "Nouvelle publication", href: "/new", badge: null },
    { icon: Calendar, label: "Calendrier", href: "/calendar", badge: null },
    { icon: Images, label: "Médiathèque", href: "/media", badge: null },
    { icon: Users, label: "Pages gérées", href: "/pages", badge: "8" },
    { icon: Bot, label: "Assistant IA", href: "/ai", badge: null },
  ];

  const statsItems = [
    { icon: BarChart3, label: "Analyses", href: "/analytics" },
    { icon: Clock, label: "Historique", href: "/history" },
  ];

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col h-screen">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <i className="fas fa-share-nodes text-primary-foreground text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Social Flow</h1>
            <p className="text-xs text-muted-foreground">Automatisation</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <li key={item.href}>
                <Link href={item.href}>
                  <a 
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all
                      ${isActive 
                        ? 'bg-accent text-accent-foreground' 
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      }
                    `}
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                    {item.badge && (
                      <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary text-primary-foreground">
                        {item.badge}
                      </span>
                    )}
                  </a>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 pt-8 border-t border-border">
          <p className="text-xs text-muted-foreground mb-3 px-4 uppercase tracking-wider">Statistiques</p>
          <ul className="space-y-2">
            {statsItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              return (
                <li key={item.href}>
                  <Link href={item.href}>
                    <a 
                      className={`
                        flex items-center gap-3 px-4 py-3 rounded-lg transition-all
                        ${isActive 
                          ? 'bg-accent text-accent-foreground' 
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        }
                      `}
                      data-testid={`link-${item.label.toLowerCase()}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </a>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      <div className="p-4 border-t border-border">
        <Link href="/settings">
          <a 
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all"
            data-testid="link-settings"
          >
            <Settings className="w-5 h-5" />
            <span>Paramètres</span>
          </a>
        </Link>
      </div>
    </aside>
  );
}
