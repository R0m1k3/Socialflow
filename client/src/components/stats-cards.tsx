import { CalendarCheck, Users, Bot, Images } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function StatsCards() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/stats"],
  });

  const statCards = [
    {
      icon: CalendarCheck,
      iconColor: "text-chart-1",
      iconBg: "bg-chart-1/10",
      title: (stats as any)?.scheduledPosts ?? 0,
      subtitle: "Publications planifiées",
      change: "+12%",
      changeLabel: "vs mois dernier",
      period: "Ce mois",
    },
    {
      icon: Users,
      iconColor: "text-chart-2",
      iconBg: "bg-chart-2/10",
      title: (stats as any)?.connectedPages ?? 0,
      subtitle: "Pages connectées",
      info: "Facebook • Instagram",
      period: "Total",
    },
    {
      icon: Bot,
      iconColor: "text-chart-3",
      iconBg: "bg-chart-3/10",
      title: (stats as any)?.aiTextsGenerated ?? 0,
      subtitle: "Textes générés par IA",
      change: "+8%",
      changeLabel: "vs hier",
      period: "Aujourd'hui",
    },
    {
      icon: Images,
      iconColor: "text-chart-4",
      iconBg: "bg-chart-4/10",
      title: (stats as any)?.mediaStored ?? 0,
      subtitle: "Médias stockés",
      info: "Images • Vidéos",
      period: "Bibliothèque",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card rounded-lg border border-border p-6">
            <div className="skeleton h-12 w-12 rounded-lg mb-4" />
            <div className="skeleton h-8 w-16 mb-2" />
            <div className="skeleton h-4 w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {statCards.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div 
            key={index} 
            className="bg-card rounded-lg border border-border p-6 hover:shadow-lg transition-all cursor-pointer"
            data-testid={`stat-card-${index}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`w-12 h-12 rounded-lg ${stat.iconBg} flex items-center justify-center`}>
                <Icon className={`${stat.iconColor} w-6 h-6`} />
              </div>
              <span className="text-xs text-muted-foreground">{stat.period}</span>
            </div>
            <h3 className="text-3xl font-bold text-foreground mb-1" data-testid={`stat-value-${index}`}>
              {stat.title}
            </h3>
            <p className="text-sm text-muted-foreground">{stat.subtitle}</p>
            {stat.change && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs text-chart-2">{stat.change}</span>
                <span className="text-xs text-muted-foreground">{stat.changeLabel}</span>
              </div>
            )}
            {stat.info && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{stat.info}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
