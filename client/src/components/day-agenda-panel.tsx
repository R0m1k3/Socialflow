import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, CalendarCheck, Clapperboard, Image, Layers, Loader2, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PlatformIcon } from "@/components/platform-icon";
import { cn } from "@/lib/utils";
import { conflictsFor, groupByPage, type AgendaItem, type AgendaStatus } from "@shared/agenda";

const TYPE_META: Record<string, { label: string; icon: typeof Image }> = {
  reel: { label: "Reel", icon: Clapperboard },
  story: { label: "Story", icon: Smartphone },
  both: { label: "Post + Story", icon: Layers },
  feed: { label: "Post", icon: Image },
};

const STATUS_META: Record<AgendaStatus, { label: string; className: string }> = {
  scheduled: { label: "Programmé", className: "bg-info/15 text-info" },
  rendering: { label: "En montage", className: "bg-warning/15 text-warning" },
  published: { label: "Publié", className: "bg-success/15 text-success" },
  failed: { label: "Échec", className: "bg-destructive/15 text-destructive" },
};

const time = (item: AgendaItem) => format(new Date(item.scheduledAt), "HH:mm");

interface DayAgendaPanelProps {
  date: Date;
  items: AgendaItem[];
  selectedPageIds: string[];
}

/** Ce qui est déjà prévu le jour choisi, magasin par magasin. */
export function DayAgendaPanel({ date, items, selectedPageIds }: DayAgendaPanelProps) {
  const dayLabel = format(date, "EEEE d MMMM", { locale: fr });
  const conflicts = conflictsFor(items, selectedPageIds);
  const reelConflicts = conflicts.filter((item) => item.postType === "reel");

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground" data-testid="day-agenda-empty">
        <CalendarCheck className="h-4 w-4 text-success" />
        Rien de prévu le {dayLabel} : la journée est libre sur tous les magasins.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="day-agenda-panel">
      {conflicts.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning" data-testid="day-agenda-conflict">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            {(reelConflicts.length > 0 ? reelConflicts : conflicts).map((item) => (
              <p key={item.id}>
                <span className="font-semibold">{item.pageName}</span> a déjà {reelConflicts.length > 0 ? "un Reel" : "une publication"} à {time(item)} ce jour-là.
              </p>
            ))}
            <p className="text-warning/80">Vous pouvez quand même programmer, ou choisir un autre jour.</p>
          </div>
        </div>
      )}

      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold">
          Déjà prévu le {dayLabel}
        </div>
        <div className="divide-y">
          {groupByPage(items, selectedPageIds).map(({ page, selected, items: pageItems }) => (
            <div key={page.id} className={cn("space-y-1.5 px-3 py-2", selected && "bg-primary/5")}>
              <div className="flex items-center gap-2">
                <PlatformIcon platform={page.platform} size="sm" className="h-5 w-5 rounded" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{page.pageName}</span>
                {selected && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Sélectionné</Badge>}
              </div>
              {pageItems.map((item) => {
                const type = TYPE_META[item.postType] ?? TYPE_META.feed;
                const status = STATUS_META[item.status];
                const TypeIcon = type.icon;
                return (
                  <div key={item.id} className="flex items-center gap-2 pl-7 text-xs" data-testid={`day-agenda-item-${item.id}`}>
                    <span className="w-10 shrink-0 font-mono font-semibold">{time(item)}</span>
                    <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="shrink-0">{type.label}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.preview}</span>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", status.className)}>
                      {item.status === "rendering" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
