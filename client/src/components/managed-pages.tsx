import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Link2, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";

interface ManagedPage {
  id: string;
  pageName: string;
  platform: string;
  isActive: string;
  followersCount?: number | null;
}

export default function ManagedPages() {
  const { data: pages, isLoading } = useQuery<ManagedPage[]>({
    queryKey: ["/api/pages"],
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Comptes connectés</CardTitle>
          <CardDescription>{pages?.length ?? 0} compte(s) prêt(s) à publier</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="text-primary">
          <Link href="/pages">
            Gérer <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-[72px] rounded-lg" />
            ))}
          </div>
        ) : pages && pages.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {pages.map((page) => (
              <div key={page.id} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`page-card-${page.id}`}>
                <PlatformIcon platform={page.platform} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{page.pageName}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {platformLabel(page.platform)}
                    {page.followersCount ? (
                      <>
                        <span>·</span>
                        <Users className="h-3 w-3" />
                        {page.followersCount.toLocaleString("fr-FR")}
                      </>
                    ) : null}
                  </p>
                </div>
                <Badge variant={page.isActive === "true" ? "success" : "muted"}>
                  {page.isActive === "true" ? "Actif" : "Inactif"}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={Link2}
            title="Aucun compte connecté"
            description="Connectez une page Facebook, Instagram ou TikTok pour commencer à publier."
            action={
              <Button asChild size="sm">
                <Link href="/pages">Connecter un compte</Link>
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
