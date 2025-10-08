import { Home, PlusCircle, Calendar, Images, Users, Bot, Clock, Settings, Database, UserCog, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState, useEffect } from "react";

interface SidebarProps {
  onLinkClick?: () => void;
}

export default function Sidebar({ onLinkClick }: SidebarProps = {}) {
  const [location] = useLocation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(isCollapsed));
  }, [isCollapsed]);

  const { data: session } = useQuery<{ id: string; username: string; role: string }>({
    queryKey: ["/api/auth/session"],
    retry: false,
  });

  const isAdmin = session?.role === "admin";

  const handleLinkClick = () => {
    if (onLinkClick) {
      onLinkClick();
    }
  };

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout", {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
      toast({
        title: "Déconnecté",
        description: "Vous avez été déconnecté avec succès",
      });
    },
  });

  const navItems = [
    { icon: Home, label: "Tableau de bord", href: "/", badge: null },
    { icon: PlusCircle, label: "Nouvelle publication", href: "/new", badge: null },
    { icon: Calendar, label: "Calendrier", href: "/calendar", badge: null },
    { icon: Images, label: "Médiathèque", href: "/media", badge: null },
    { icon: Bot, label: "Assistant IA", href: "/ai", badge: null },
  ];

  const statsItems = [
    { icon: Clock, label: "Historique", href: "/history" },
  ];

  return (
    <aside className={`bg-sidebar border-r border-sidebar-border flex flex-col h-screen transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-72'}`}>
      {/* Logo & Brand */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center shadow-lg">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-xl font-bold gradient-text">Social Flow</h1>
              <p className="text-xs text-muted-foreground">Automatisation sociale</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <li key={item.href} className="relative group">
                <Link 
                  href={item.href}
                  onClick={handleLinkClick}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all relative
                    ${isActive 
                      ? 'bg-gradient-to-r from-primary/10 to-secondary/10 text-primary shadow-sm' 
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                  `}
                  data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 gradient-primary rounded-r-full" />
                  )}
                  <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold gradient-primary text-white shadow-sm">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
                {isCollapsed && (
                  <div className="absolute left-full ml-2 px-3 py-2 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50">
                    {item.label}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Stats Section */}
        <div className="mt-8 pt-6 border-t border-sidebar-border">
          {!isCollapsed && (
            <p className="text-xs font-semibold text-muted-foreground mb-3 px-4 uppercase tracking-wider">Statistiques</p>
          )}
          <ul className="space-y-1">
            {statsItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              return (
                <li key={item.href} className="relative group">
                  <Link 
                    href={item.href}
                    onClick={handleLinkClick}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-xl transition-all relative
                      ${isActive 
                        ? 'bg-gradient-to-r from-primary/10 to-secondary/10 text-primary shadow-sm' 
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                      }
                      ${isCollapsed ? 'justify-center' : ''}
                    `}
                    data-testid={`link-${item.label.toLowerCase()}`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 gradient-primary rounded-r-full" />
                    )}
                    <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
                    {!isCollapsed && <span>{item.label}</span>}
                  </Link>
                  {isCollapsed && (
                    <div className="absolute left-full ml-2 px-3 py-2 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50">
                      {item.label}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Admin & User Section */}
      <div className="p-4 border-t border-sidebar-border space-y-2">
        {isAdmin && (
          <>
            {!isCollapsed && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-muted-foreground mb-2 px-4 uppercase tracking-wider">Administration</p>
              </div>
            )}
            <Link 
              href="/pages"
              onClick={handleLinkClick}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all relative group
                ${location === "/pages"
                  ? 'bg-gradient-to-r from-primary/10 to-secondary/10 text-primary shadow-sm' 
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                }
                ${isCollapsed ? 'justify-center' : ''}
              `}
              data-testid="link-pages-gérées"
            >
              {location === "/pages" && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 gradient-primary rounded-r-full" />
              )}
              <Users className="w-5 h-5" />
              {!isCollapsed && <span>Pages gérées</span>}
              {isCollapsed && (
                <div className="absolute left-full ml-2 px-3 py-2 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50">
                  Pages gérées
                </div>
              )}
            </Link>
            <Link 
              href="/users"
              onClick={handleLinkClick}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all relative group
                ${location === "/users"
                  ? 'bg-gradient-to-r from-primary/10 to-secondary/10 text-primary shadow-sm' 
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                }
                ${isCollapsed ? 'justify-center' : ''}
              `}
              data-testid="link-users"
            >
              {location === "/users" && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 gradient-primary rounded-r-full" />
              )}
              <UserCog className="w-5 h-5" />
              {!isCollapsed && <span>Utilisateurs</span>}
              {isCollapsed && (
                <div className="absolute left-full ml-2 px-3 py-2 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50">
                  Utilisateurs
                </div>
              )}
            </Link>
            <Link 
              href="/sql"
              onClick={handleLinkClick}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all relative group
                ${location === "/sql"
                  ? 'bg-gradient-to-r from-primary/10 to-secondary/10 text-primary shadow-sm' 
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                }
                ${isCollapsed ? 'justify-center' : ''}
              `}
              data-testid="link-sql"
            >
              {location === "/sql" && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 gradient-primary rounded-r-full" />
              )}
              <Database className="w-5 h-5" />
              {!isCollapsed && <span>SQL</span>}
              {isCollapsed && (
                <div className="absolute left-full ml-2 px-3 py-2 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50">
                  SQL
                </div>
              )}
            </Link>
            <Link 
              href="/settings"
              onClick={handleLinkClick}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all relative group
                ${location === "/settings"
                  ? 'bg-gradient-to-r from-primary/10 to-secondary/10 text-primary shadow-sm' 
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                }
                ${isCollapsed ? 'justify-center' : ''}
              `}
              data-testid="link-settings"
            >
              {location === "/settings" && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 gradient-primary rounded-r-full" />
              )}
              <Settings className="w-5 h-5" />
              {!isCollapsed && <span>Paramètres</span>}
              {isCollapsed && (
                <div className="absolute left-full ml-2 px-3 py-2 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50">
                  Paramètres
                </div>
              )}
            </Link>
          </>
        )}
        
        <div className="pt-2 relative group">
          <Button
            variant="ghost"
            className={`w-full text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-xl ${isCollapsed ? 'justify-center px-0' : 'justify-start'}`}
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
          >
            <LogOut className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} />
            {!isCollapsed && (logoutMutation.isPending ? "Déconnexion..." : "Déconnexion")}
          </Button>
          {isCollapsed && (
            <div className="absolute left-full ml-2 px-3 py-2 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 top-0">
              Déconnexion
            </div>
          )}
        </div>
        
        {/* User Profile Card */}
        {session && (
          <div className={`mt-4 bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/10 rounded-xl ${isCollapsed ? 'p-2' : 'p-4'}`}>
            <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
              <Avatar className="w-10 h-10 border-2 border-primary/20">
                <AvatarFallback className="gradient-primary text-white font-semibold">
                  {session.username.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{session.username}</p>
                  <p className="text-xs text-muted-foreground capitalize">{session.role}</p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="mt-2 w-full flex items-center justify-center p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 border-2 border-border hover:border-primary/50 rounded-xl transition-all"
          data-testid="button-toggle-sidebar"
        >
          {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>
    </aside>
  );
}
