import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Users, Eye, Heart, BarChart3 } from "lucide-react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Analytics() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['/api/stats'],
  });

  const metrics = [
    {
      title: "Publications totales",
      value: "0",
      description: "Toutes plateformes",
      icon: TrendingUp,
      gradient: "from-primary to-primary/80",
    },
    {
      title: "Portée totale",
      value: "0",
      description: "Personnes atteintes",
      icon: Users,
      gradient: "from-secondary to-secondary/80",
    },
    {
      title: "Impressions",
      value: "0",
      description: "Vues totales",
      icon: Eye,
      gradient: "from-success to-success/80",
    },
    {
      title: "Engagement",
      value: "0",
      description: "Interactions totales",
      icon: Heart,
      gradient: "from-warning to-warning/80",
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-8 max-w-[1600px] mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Analyses</h1>
            <p className="text-muted-foreground mt-2">
              Statistiques et performances de vos publications
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {metrics.map((metric, index) => {
              const Icon = metric.icon;
              return (
                <Card key={index} className="rounded-2xl border-border/50 shadow-lg overflow-hidden">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {metric.title}
                      </CardTitle>
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${metric.gradient} flex items-center justify-center shadow-md`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold" data-testid={`text-${metric.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      {metric.value}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 font-medium">{metric.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="border-b border-border/50 p-6 bg-gradient-to-r from-primary/5 to-secondary/5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
                  <BarChart3 className="text-white w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">Fonctionnalité à venir</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Graphiques et statistiques détaillées</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8">
              <div className="text-center py-12">
                <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-6">
                  <BarChart3 className="w-10 h-10 text-muted-foreground opacity-50" />
                </div>
                <p className="text-muted-foreground text-lg mb-2">
                  Les analyses détaillées et les graphiques de performance seront disponibles prochainement.
                </p>
                <p className="text-sm text-muted-foreground">
                  Vous pourrez suivre l'évolution de vos statistiques au fil du temps
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
