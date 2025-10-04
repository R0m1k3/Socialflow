import { CalendarCheck, Users, Bot, Images, TrendingUp, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function StatsCards() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/stats"],
  });

  const statCards = [
    {
      icon: CalendarCheck,
      iconColor: "from-blue-500 to-blue-600",
      title: (stats as any)?.scheduledPosts ?? 0,
      subtitle: "Publications planifiées",
      change: "+12%",
      trending: "up",
      changeLabel: "vs mois dernier",
    },
    {
      icon: Users,
      iconColor: "from-purple-500 to-purple-600",
      title: (stats as any)?.connectedPages ?? 0,
      subtitle: "Pages connectées",
      info: "Facebook • Instagram",
    },
    {
      icon: Bot,
      iconColor: "from-green-500 to-green-600",
      title: (stats as any)?.aiTextsGenerated ?? 0,
      subtitle: "Textes générés par IA",
      change: "+8%",
      trending: "up",
      changeLabel: "vs hier",
    },
    {
      icon: Images,
      iconColor: "from-cyan-500 to-cyan-600",
      title: (stats as any)?.mediaStored ?? 0,
      subtitle: "Médias stockés",
      info: "Images • Vidéos",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="skeleton h-12 w-12 rounded-xl mb-4" />
            <div className="skeleton h-10 w-20 mb-2" />
            <div className="skeleton h-4 w-36" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {statCards.map((stat, index) => {
        const Icon = stat.icon;
        const TrendIcon = stat.trending === "up" ? TrendingUp : TrendingDown;
        
        return (
          <div 
            key={index} 
            className="group bg-card rounded-2xl border border-border p-6 hover:border-primary/30 transition-all cursor-pointer card-hover shadow-sm"
            data-testid={`stat-card-${index}`}
          >
            <div className="flex items-start justify-between mb-6">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${stat.iconColor} flex items-center justify-center shadow-lg`}>
                <Icon className="text-white w-7 h-7" />
              </div>
            </div>
            
            <div className="space-y-1">
              <h3 className="text-4xl font-bold text-foreground" data-testid={`stat-value-${index}`}>
                {stat.title}
              </h3>
              <p className="text-sm text-muted-foreground font-medium">{stat.subtitle}</p>
            </div>
            
            {stat.change && (
              <div className="mt-4 flex items-center gap-2">
                <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${stat.trending === "up" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  <TrendIcon className="w-3 h-3" />
                  <span className="text-xs font-semibold">{stat.change}</span>
                </div>
                <span className="text-xs text-muted-foreground">{stat.changeLabel}</span>
              </div>
            )}
            
            {stat.info && (
              <div className="mt-4">
                <span className="text-xs text-muted-foreground font-medium">{stat.info}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
