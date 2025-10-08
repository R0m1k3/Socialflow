import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Facebook, Instagram, Clock, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { ScheduledPost, SocialPage, Post } from "@shared/schema";

type ScheduledPostWithRelations = ScheduledPost & {
  post?: Post;
  page?: SocialPage;
};

export default function RecentPublications() {
  const { data: scheduledPosts = [], isLoading } = useQuery<ScheduledPostWithRelations[]>({
    queryKey: ['/api/scheduled-posts'],
  });

  // Filter and sort published posts
  const recentPublished = scheduledPosts
    .filter(sp => sp.publishedAt)
    .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime())
    .slice(0, 10);

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg" data-testid="card-recent-publications">
      <CardHeader>
        <CardTitle>Historique des publications</CardTitle>
        <CardDescription>
          Vos 10 dernières publications sur les réseaux sociaux
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : recentPublished.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Aucune publication pour le moment</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentPublished.map((scheduledPost) => (
              <div
                key={scheduledPost.id}
                className="flex items-start gap-4 p-4 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                data-testid={`publication-${scheduledPost.id}`}
              >
                {/* Platform icon */}
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  scheduledPost.page?.platform === 'facebook' 
                    ? 'bg-blue-500' 
                    : 'bg-gradient-to-br from-purple-500 to-pink-500'
                }`}>
                  {scheduledPost.page?.platform === 'facebook' ? (
                    <Facebook className="w-5 h-5 text-white" />
                  ) : (
                    <Instagram className="w-5 h-5 text-white" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm truncate" data-testid={`text-page-name-${scheduledPost.id}`}>
                        {scheduledPost.page?.pageName || 'Page inconnue'}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {scheduledPost.post?.content ? (
                          <span className="line-clamp-2">{scheduledPost.post.content}</span>
                        ) : (
                          <span className="italic">Aucun texte</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                      {scheduledPost.error ? (
                        <XCircle className="w-4 h-4 text-destructive" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="capitalize">
                      {scheduledPost.postType === 'feed' ? 'Publication' : 
                       scheduledPost.postType === 'story' ? 'Story' : scheduledPost.postType}
                    </span>
                    <span>•</span>
                    <span>
                      {format(new Date(scheduledPost.publishedAt!), "d MMM yyyy 'à' HH:mm", { locale: fr })}
                    </span>
                    {scheduledPost.error && (
                      <>
                        <span>•</span>
                        <span className="text-destructive">Erreur</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
