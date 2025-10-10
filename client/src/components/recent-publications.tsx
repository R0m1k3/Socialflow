import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Facebook, Instagram, Clock, CheckCircle2, XCircle, Eye, Image as ImageIcon, Smartphone } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { ScheduledPost, SocialPage, Post, Media } from "@shared/schema";
import { PreviewModal } from "@/components/preview-modal";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

type ScheduledPostWithRelations = ScheduledPost & {
  post?: Post;
  page?: SocialPage;
};

export default function RecentPublications() {
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ postText: string; mediaIds: string[]; allMedia: Media[] }>({ postText: '', mediaIds: [], allMedia: [] });
  const { toast } = useToast();

  const { data: scheduledPosts = [], isLoading } = useQuery<ScheduledPostWithRelations[]>({
    queryKey: ['/api/scheduled-posts'],
  });

  // Filter and sort attempted posts (scheduled in the past)
  const now = new Date();
  const recentPublished = scheduledPosts
    .filter(sp => sp.scheduledAt && new Date(sp.scheduledAt) <= now)
    .sort((a, b) => new Date(b.scheduledAt!).getTime() - new Date(a.scheduledAt!).getTime())
    .slice(0, 10);

  const handlePreviewPost = async (scheduledPost: ScheduledPostWithRelations) => {
    try {
      const response = await fetch(`/api/posts/${scheduledPost.postId}`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch post");
      }
      
      const postWithMedia = await response.json();
      const mediaIds = postWithMedia.media?.map((m: Media) => m.id) || [];
      const allMedia = postWithMedia.media || [];
      
      setPreviewData({
        postText: postWithMedia.post.content || '',
        mediaIds: mediaIds,
        allMedia: allMedia,
      });
      
      setPreviewModalOpen(true);
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de charger la prévisualisation",
        variant: "destructive",
      });
    }
  };

  const getPostTypeIcon = (postType: string) => {
    if (postType === 'feed') {
      return <ImageIcon className="w-3.5 h-3.5" />;
    } else if (postType === 'story') {
      return <Smartphone className="w-3.5 h-3.5" />;
    } else if (postType === 'both') {
      return (
        <div className="flex gap-0.5">
          <ImageIcon className="w-3 h-3" />
          <Smartphone className="w-3 h-3" />
        </div>
      );
    }
    return null;
  };

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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePreviewPost(scheduledPost)}
                        className="h-8 w-8 p-0"
                        data-testid={`button-preview-post-${scheduledPost.id}`}
                        title="Prévisualiser"
                      >
                        <Eye className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                      </Button>
                      {scheduledPost.error ? (
                        <XCircle className="w-4 h-4 text-destructive" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 capitalize">
                      {getPostTypeIcon(scheduledPost.postType)}
                      {scheduledPost.postType === 'feed' ? 'Feed' : 
                       scheduledPost.postType === 'story' ? 'Story' : 'Feed & Story'}
                    </span>
                    <span>•</span>
                    <span>
                      {format(new Date(scheduledPost.scheduledAt!), "d MMM yyyy 'à' HH:mm", { locale: fr })}
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

      <PreviewModal
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        postText={previewData.postText}
        selectedMedia={previewData.mediaIds}
        mediaList={previewData.allMedia}
        onPublish={() => {}}
        isPublishing={false}
        readOnly={true}
      />
    </Card>
  );
}
