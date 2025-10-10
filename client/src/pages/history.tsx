import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, CheckCircle, XCircle, Calendar, History as HistoryIcon, Eye, Image as ImageIcon, Smartphone } from "lucide-react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ScheduledPost, SocialPage, Post, Media } from "@shared/schema";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { PreviewModal } from "@/components/preview-modal";
import { useToast } from "@/hooks/use-toast";

type ScheduledPostWithRelations = ScheduledPost & {
  post?: Post;
  page?: SocialPage;
};

export default function History() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ postText: string; mediaIds: string[]; allMedia: Media[] }>({ postText: '', mediaIds: [], allMedia: [] });
  const { toast } = useToast();

  const { data: scheduledPosts = [], isLoading } = useQuery<ScheduledPostWithRelations[]>({
    queryKey: ['/api/scheduled-posts'],
  });

  // Filter attempted posts (scheduled in the past)
  const now = new Date();
  const publishedPosts = scheduledPosts
    .filter(sp => sp.scheduledAt && new Date(sp.scheduledAt) <= now)
    .sort((a, b) => new Date(b.scheduledAt!).getTime() - new Date(a.scheduledAt!).getTime());

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
      return <ImageIcon className="w-4 h-4" />;
    } else if (postType === 'story') {
      return <Smartphone className="w-4 h-4" />;
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
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Historique</h1>
            <p className="text-muted-foreground mt-2">
              Consultez l'historique de vos publications
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 bg-card rounded-2xl border border-border/50 animate-pulse" />
              ))}
            </div>
          ) : publishedPosts.length === 0 ? (
            <Card className="rounded-2xl border-border/50 border-dashed shadow-lg">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center mb-6">
                  <HistoryIcon className="w-10 h-10 text-muted-foreground opacity-50" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Aucune publication</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  Vos publications apparaîtront ici une fois publiées
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {publishedPosts.map((scheduledPost) => {
                const isPending = !scheduledPost.publishedAt;
                const hasError = !!scheduledPost.error;
                
                return (
                  <Card key={scheduledPost.id} className="rounded-2xl border-border/50 shadow-lg overflow-hidden" data-testid={`card-post-${scheduledPost.id}`}>
                    <CardHeader className="border-b border-border/50 bg-gradient-to-r from-muted/20 to-muted/10 p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md ${
                              hasError ? 'bg-gradient-to-br from-destructive to-destructive/80' :
                              'bg-gradient-to-br from-green-500 to-green-600'
                            }`}>
                              {hasError ? (
                                <XCircle className="w-5 h-5 text-white" />
                              ) : (
                                <CheckCircle className="w-5 h-5 text-white fill-white" />
                              )}
                            </div>
                            <CardTitle className="text-lg">
                              {scheduledPost.page?.pageName || 'Page inconnue'}
                            </CardTitle>
                          </div>
                          <p className="text-sm text-foreground leading-relaxed line-clamp-3">
                            {scheduledPost.post?.content || 'Aucun texte'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePreviewPost(scheduledPost)}
                            className="h-9 w-9 p-0"
                            data-testid={`button-preview-post-${scheduledPost.id}`}
                            title="Prévisualiser"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Badge 
                            className={`${
                              hasError 
                                ? 'bg-destructive/20 text-destructive hover:bg-destructive/30' 
                                : 'bg-success/20 text-success hover:bg-success/30'
                            }`}
                          >
                            {hasError ? (
                              <>
                                <XCircle className="w-3 h-3 mr-1" />
                                Échoué
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Publié
                              </>
                            )}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="flex items-center gap-6 text-sm text-muted-foreground flex-wrap">
                        <div className="flex items-center gap-2">
                          {getPostTypeIcon(scheduledPost.postType)}
                          <span className="font-medium capitalize">
                            {scheduledPost.postType === 'feed' ? 'Feed' : 
                             scheduledPost.postType === 'story' ? 'Story' : 'Feed & Story'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span className="font-medium">
                            {scheduledPost.scheduledAt 
                              ? format(new Date(scheduledPost.scheduledAt), "d MMM yyyy 'à' HH:mm", { locale: fr })
                              : 'Date inconnue'
                            }
                          </span>
                        </div>
                        {scheduledPost.post?.aiGenerated && (
                          <Badge variant="outline" className="text-xs bg-gradient-to-r from-primary/5 to-secondary/5 border-primary/20">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Généré par IA
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

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
      </main>
    </div>
  );
}
