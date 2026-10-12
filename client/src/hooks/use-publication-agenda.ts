import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, endOfMonth, startOfMonth } from "date-fns";
import { groupByDay, type AgendaItem } from "@shared/agenda";

/**
 * Publications prévues autour du mois affiché, rangées par jour.
 *
 * La clé commence par `/api/scheduled-posts` : toute invalidation des
 * publications planifiées (création, suppression, fin de montage) la rafraîchit.
 */
export function usePublicationAgenda(month: Date) {
  // Le calendrier montre aussi les jours des mois voisins
  const startDate = addDays(startOfMonth(month), -7).toISOString();
  const endDate = addDays(endOfMonth(month), 7).toISOString();

  const { data: items = [], isLoading } = useQuery<AgendaItem[]>({
    queryKey: ["/api/scheduled-posts", "agenda", { startDate, endDate }],
    refetchInterval: 30000,
  });

  const itemsByDay = useMemo(() => groupByDay(items), [items]);
  return { items, itemsByDay, isLoading };
}
