import TopBar from "@/components/topbar";
import OngoingReels from "@/components/ongoing-reels";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  Video,
  Calendar,
  BarChart3,
  Images,
  Wand2,
  Clock,
  Settings,
  Users,
  ChevronRight,
  Sparkles
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DashboardMobile() {
  const [, setLocation] = useLocation();

  const mainActions = [
    { icon: PlusCircle, label: "Nv. Post", href: "/new", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", description: "Créer une publication" },
    { icon: Video, label: "Nv. Reel", href: "/reel", color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20", description: "Générer une vidéo IA" },
    { icon: Calendar, label: "Calendrier", href: "/calendar", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", description: "Voir le planning" },
    { icon: BarChart3, label: "Analytics", href: "/analytics", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20", description: "Statistiques" },
  ];

  const secondaryMenu = [
    { icon: Images, label: "Médiathèque", href: "/media" },
    { icon: Wand2, label: "Éditeur d'images", href: "/image-editor" },
    { icon: Clock, label: "Historique", href: "/history" },
    { icon: Users, label: "Pages connectées", href: "/pages" },
    { icon: Settings, label: "Paramètres", href: "/settings" },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => { }} hideMenuButton={true} />

        <div className="p-4 space-y-6 pb-20">

          {/* Header Section */}
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                Social Flow
              </h1>
              <p className="text-xs text-muted-foreground">Tableau de bord</p>
            </div>
          </div>

          {/* 1. Status Section */}
          <OngoingReels compact />

          {/* 2. Main Action Grid */}
          <Card className="rounded-2xl border-border/50 shadow-lg overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base font-semibold">Actions Rapides</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-3">
                {mainActions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div className={`
                        flex flex-col items-center justify-center p-4 rounded-xl border cursor-pointer transition-all active:scale-95 hover:opacity-80
                        ${item.bg} ${item.border}
                      `}>
                        <div className={`p-2 rounded-full bg-background/80 shadow-sm mb-2`}>
                          <Icon className={`w-6 h-6 ${item.color}`} />
                        </div>
                        <span className="font-semibold text-sm text-foreground">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground mt-1 text-center">{item.description}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 3. Secondary Menu List */}
          <Card className="rounded-2xl border-border/50 shadow-lg overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base font-semibold">Menu</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {secondaryMenu.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors cursor-pointer active:bg-muted">
                        <div className="p-2 rounded-lg bg-muted text-foreground">
                          <Icon className="w-5 h-5" />
                        </div>
                        <span className="flex-1 font-medium text-sm">{item.label}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
