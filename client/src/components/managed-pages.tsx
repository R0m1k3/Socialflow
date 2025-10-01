import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

export default function ManagedPages() {
  const { data: pages, isLoading } = useQuery({
    queryKey: ["/api/pages"],
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="skeleton h-8 w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-32 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="border-b border-border p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Pages gérées</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Gérez vos pages Facebook et Instagram connectées
          </p>
        </div>
        <Button data-testid="button-connect-page">
          <Plus className="w-4 h-4 mr-2" />
          Connecter une page
        </Button>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {pages && (pages as any[]).length > 0 ? (
            (pages as any[]).map((page: any) => (
              <div
                key={page.id}
                className="border border-border rounded-lg p-4 hover:shadow-lg transition-all cursor-pointer"
                data-testid={`page-card-${page.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`
                    w-12 h-12 rounded-lg flex items-center justify-center
                    ${page.platform === "facebook" ? "bg-chart-1/10" : "bg-chart-5/10"}
                  `}>
                    <i className={`
                      fab text-2xl
                      ${page.platform === "facebook" ? "fa-facebook text-chart-1" : "fa-instagram text-chart-5"}
                    `}></i>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-chart-2 text-white">
                    {page.isActive === "true" ? "Actif" : "Inactif"}
                  </span>
                </div>
                <h4 className="font-semibold text-foreground mb-1">{page.pageName}</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  {page.platform === "facebook" ? "Facebook Page" : "Instagram Business"}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{page.followersCount?.toLocaleString() || 0} abonnés</span>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-12">
              <p className="text-muted-foreground mb-4">Aucune page connectée</p>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Connecter votre première page
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
