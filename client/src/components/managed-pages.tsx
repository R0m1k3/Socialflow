import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { SiFacebook, SiInstagram } from "react-icons/si";

export default function ManagedPages() {
  const { data: pages, isLoading } = useQuery({
    queryKey: ["/api/pages"],
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl border border-border/50 p-8 shadow-lg">
        <div className="skeleton h-8 w-48 mb-6 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-40 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-lg">
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-primary/5 to-secondary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
              <Users className="text-white w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Pages gérées</h3>
              <p className="text-sm text-muted-foreground">
                {(pages as any[])?.length || 0} page(s) connectée(s)
              </p>
            </div>
          </div>
          <Button 
            className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 rounded-xl"
            data-testid="button-connect-page"
          >
            <Plus className="w-4 h-4 mr-2" />
            Connecter une page
          </Button>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pages && (pages as any[]).length > 0 ? (
            (pages as any[]).map((page: any) => (
              <div
                key={page.id}
                className="border border-border/50 rounded-2xl p-6 hover:shadow-xl hover:border-primary/30 transition-all cursor-pointer bg-card"
                data-testid={`page-card-${page.id}`}
              >
                <div className="flex items-start justify-between mb-5">
                  <div className={`
                    w-14 h-14 rounded-xl flex items-center justify-center shadow-md
                    ${page.platform === "facebook" ? "bg-[#1877F2]/10" : "bg-[#E4405F]/10"}
                  `}>
                    {page.platform === "facebook" ? (
                      <SiFacebook className="text-[#1877F2] text-2xl" />
                    ) : (
                      <SiInstagram className="text-[#E4405F] text-2xl" />
                    )}
                  </div>
                  <span className={`
                    inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold
                    ${page.isActive === "true" ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}
                  `}>
                    {page.isActive === "true" ? "Actif" : "Inactif"}
                  </span>
                </div>
                <h4 className="font-semibold text-foreground text-lg mb-2">{page.pageName}</h4>
                <p className="text-sm text-muted-foreground mb-4 font-medium">
                  {page.platform === "facebook" ? "Facebook Page" : "Instagram Business"}
                </p>
                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground font-medium">
                      {page.followersCount?.toLocaleString() || 0} abonnés
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-16">
              <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-6">
                <Users className="w-10 h-10 text-muted-foreground opacity-50" />
              </div>
              <p className="text-muted-foreground mb-6 text-lg">Aucune page connectée</p>
              <Button className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 rounded-xl">
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
