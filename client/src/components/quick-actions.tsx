import { Button } from "@/components/ui/button";
import { Image, Video, CalendarPlus, Clock, Plug, Zap, PlusCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function QuickActions() {
  const { data: recentActivity } = useQuery({
    queryKey: ["/api/posts"],
    select: (data) => (data as any[])?.slice(0, 4) || [],
  });

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <PlusCircle className="text-white w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Nouvelle publication</h3>
        </div>
        <div className="space-y-3">
          <Button className="w-full bg-gradient-to-r from-primary to-secondary hover:opacity-90 rounded-xl" data-testid="button-new-media-post">
            <Image className="w-4 h-4 mr-2" />
            Publication avec média
          </Button>
          <Button variant="outline" className="w-full rounded-xl border-border/50" data-testid="button-new-story">
            <Video className="w-4 h-4 mr-2" />
            Story vidéo
          </Button>
          <Button variant="outline" className="w-full rounded-xl border-border/50" data-testid="button-schedule-series">
            <CalendarPlus className="w-4 h-4 mr-2" />
            Planifier série
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
            <Clock className="text-warning w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Activité récente</h3>
        </div>
        <div className="space-y-4">
          {recentActivity && recentActivity.length > 0 ? (
            recentActivity.map((activity: any, index: number) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 pb-4 border-b border-border/50 last:border-0 last:pb-0"
                data-testid={`activity-${index}`}
              >
                <div className="w-2 h-2 rounded-full bg-success mt-2 shadow-sm"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {activity.status === "scheduled" ? "Publication planifiée" : "Brouillon créé"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 font-medium">
                    {new Date(activity.createdAt).toLocaleDateString("fr-FR", { 
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <Clock className="w-12 h-12 text-muted-foreground opacity-30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Aucune activité récente</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
            <Zap className="text-success w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">État des services</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between" data-testid="status-openrouter">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success shadow-sm"></div>
              <span className="text-sm font-medium text-foreground">OpenRouter API</span>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-success/20 text-success">
              Actif
            </span>
          </div>
          <div className="flex items-center justify-between" data-testid="status-facebook">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success shadow-sm"></div>
              <span className="text-sm font-medium text-foreground">Facebook API</span>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-success/20 text-success">
              Actif
            </span>
          </div>
          <div className="flex items-center justify-between" data-testid="status-instagram">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success shadow-sm"></div>
              <span className="text-sm font-medium text-foreground">Instagram API</span>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-success/20 text-success">
              Actif
            </span>
          </div>
          <div className="flex items-center justify-between" data-testid="status-database">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success shadow-sm"></div>
              <span className="text-sm font-medium text-foreground">PostgreSQL</span>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-success/20 text-success">
              Actif
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
