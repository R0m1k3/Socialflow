import TopBar from "@/components/topbar";
import OngoingReels from "@/components/ongoing-reels";
import { useState } from "react";
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
  Bot,
  Database,
  ChevronRight
} from "lucide-react";

export default function DashboardMobile() {
  const [, setLocation] = useLocation();

  const mainActions = [
    { icon: PlusCircle, label: "Nv. Post", href: "/new", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    { icon: Video, label: "Nv. Reel", href: "/reel", color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    { icon: Calendar, label: "Calendrier", href: "/calendar", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    { icon: BarChart3, label: "Analytics", href: "/analytics", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  ];

  const secondaryMenu = [
    { icon: Images, label: "Médiathèque", href: "/media" },
    { icon: Wand2, label: "Éditeur", href: "/image-editor" },
    { icon: Clock, label: "Historique", href: "/history" },
    { icon: Users, label: "Pages", href: "/pages" },
    { icon: Settings, label: "Paramètres", href: "/settings" },
  ];

  // Admin items could be added here if needed, or integrated into secondaryMenu

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => { }} hideMenuButton={true} />

        <div className="p-4 space-y-6 pb-20">
          {/* 1. Status Section */}
          <OngoingReels compact />

          {/* 2. Main Action Grid */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-1">Actions Rapides</h2>
            <div className="grid grid-cols-2 gap-3">
              {mainActions.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div className={`
                      flex flex-col items-center justify-center p-4 rounded-xl border cursor-pointer transition-all active:scale-95
                      ${item.bg} ${item.border}
                    `}>
                      <Icon className={`w-8 h-8 mb-2 ${item.color}`} />
                      <span className="font-medium text-sm">{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 3. Secondary Menu List */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-1">Menu</h2>
            <div className="bg-card rounded-xl border border-border/50 shadow-sm divide-y divide-border/50">
              {secondaryMenu.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div className="flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors cursor-pointer">
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
          </div>
        </div>
      </main>
    </div>
  );
}
