import { Button } from "@/components/ui/button";
import { Image, Video, CalendarPlus, Clock, Plug } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function QuickActions() {
  const { data: recentActivity } = useQuery({
    queryKey: ["/api/posts"],
    select: (data) => (data as any[])?.slice(0, 4) || [],
  });

  return (
    <div className="space-y-6">
      {/* New Publication Card */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <i className="fas fa-plus-circle text-primary"></i>
          Nouvelle publication
        </h3>
        <div className="space-y-3">
          <Button className="w-full" data-testid="button-new-media-post">
            <Image className="w-4 h-4 mr-2" />
            Publication avec média
          </Button>
          <Button variant="outline" className="w-full" data-testid="button-new-story">
            <Video className="w-4 h-4 mr-2" />
            Story vidéo
          </Button>
          <Button variant="outline" className="w-full" data-testid="button-schedule-series">
            <CalendarPlus className="w-4 h-4 mr-2" />
            Planifier série
          </Button>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-chart-3" />
          Activité récente
        </h3>
        <div className="space-y-3">
          {recentActivity && recentActivity.length > 0 ? (
            recentActivity.map((activity: any, index: number) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0"
                data-testid={`activity-${index}`}
              >
                <div className="w-2 h-2 rounded-full bg-chart-2 mt-2"></div>
                <div className="flex-1">
                  <p className="text-sm text-foreground">
                    {activity.status === "scheduled" ? "Publication planifiée" : "Brouillon créé"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(activity.createdAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">Aucune activité récente</p>
            </div>
          )}
        </div>
      </div>

      {/* API Status */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <Plug className="w-5 h-5 text-chart-2" />
          État des services
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between" data-testid="status-openrouter">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-chart-2"></div>
              <span className="text-sm text-foreground">OpenRouter API</span>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-chart-2 text-white">
              Actif
            </span>
          </div>
          <div className="flex items-center justify-between" data-testid="status-facebook">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-chart-2"></div>
              <span className="text-sm text-foreground">Facebook API</span>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-chart-2 text-white">
              Actif
            </span>
          </div>
          <div className="flex items-center justify-between" data-testid="status-instagram">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-chart-2"></div>
              <span className="text-sm text-foreground">Instagram API</span>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-chart-2 text-white">
              Actif
            </span>
          </div>
          <div className="flex items-center justify-between" data-testid="status-database">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-chart-2"></div>
              <span className="text-sm text-foreground">PostgreSQL</span>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-chart-2 text-white">
              Actif
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
