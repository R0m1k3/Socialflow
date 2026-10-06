import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Clock, CheckCircle2, XCircle, Eye, Image as ImageIcon, Smartphone, Clapperboard } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { PlatformIcon } from "@/components/platform-icon";
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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/** Profondeur d'historique du bloc « Publications récentes ». */
const RECENT_WINDOW_DAYS = 90;

/** Minuit, pour que la clé de requête reste stable d'un rendu à l'autre. */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export default function RecentPublications() {
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ postText: string; mediaIds: string[]; allMedia: Media[] }>({ postText: '', mediaIds: [], allMedia: [] });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [postToDelete, setPostToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Ce bloc n'affiche que les dix dernières publications : inutile de faire
  // remonter tout l'historique pour cela.
  const since = new Date();
  since.setDate(since.getDate() - RECENT_WINDOW_DAYS);

  const { data: scheduledPosts = [], isLoading } = useQuery<ScheduledPostWithRelations[]>({
    queryKey: ['/api/scheduled-posts', { startDate: startOfDay(since).toISOString() }],
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

  const deleteReelMutation = useMutation({
    mutationFn: async (postId: string) => {
      // Pour les Reels/Posts, l'ID est le même. La route DELETE /api/reels/:id
      // gère la suppression du Post sous-jacent.
      const res = await apiRequest("DELETE", `/api/reels/${postId}`);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Succès",
        description: "Publication supprimée avec succès",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'] });
      setDeleteDialogOpen(false);
      setPostToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible de supprimer la publication",
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (postId: string) => {
    setPostToDelete(postId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (postToDelete) {
      deleteReelMutation.mutate(postToDelete);
    }
  };

  const getPostTypeIcon = (postType: string) => {
    if (postType === 'feed') {
      return <ImageIcon className="w-3.5 h-3.5" />;
    } else if (postType === 'story') {
      return <Smartphone className="w-3.5 h-3.5" />;
    } else if (postType === 'reel') {
      return <Clapperboard className="w-3.5 h-3.5" />;
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
    <Card data-testid="card-recent-publications">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Dernières publications</CardTitle>
          <CardDescription>Les 10 publications les plus récentes</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="text-primary">
          <Link href="/history">
            Tout voir <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-16 rounded-lg" />
            ))}
          </div>
        ) : recentPublished.length === 0 ? (
          <EmptyState
            compact
            icon={Clock}
            title="Aucune publication pour le moment"
            description="Vos publications apparaîtront ici dès qu'elles seront envoyées."
            action={
              <Button asChild size="sm">
                <Link href="/new">Créer une publication</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {recentPublished.map((scheduledPost) => (
              <li
                key={scheduledPost.id}
                className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                data-testid={`publication-${scheduledPost.id}`}
              >
                <PlatformIcon platform={scheduledPost.page?.platform ?? "facebook"} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium" data-testid={`text-page-name-${scheduledPost.id}`}>
                      {scheduledPost.page?.pageName || "Page inconnue"}
                    </p>
                    {scheduledPost.error ? (
                      <Badge variant="danger" className="gap-1">
                        <XCircle className="h-3 w-3" /> Échec
                      </Badge>
                    ) : (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Publié
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {scheduledPost.post?.content || <span className="italic">Aucun texte</span>}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {getPostTypeIcon(scheduledPost.postType)}
                    {scheduledPost.postType === "feed"
                      ? "Feed"
                      : scheduledPost.postType === "story"
                        ? "Story"
                        : scheduledPost.postType === "reel"
                          ? "Reel"
                          : "Feed & Story"}
                    <span>·</span>
                    {format(new Date(scheduledPost.scheduledAt!), "d MMM yyyy 'à' HH:mm", { locale: fr })}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handlePreviewPost(scheduledPost)}
                    className="h-8 w-8 text-muted-foreground"
                    data-testid={`button-preview-post-${scheduledPost.id}`}
                    title="Prévisualiser"
                    aria-label="Prévisualiser"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteClick(scheduledPost.postId)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    data-testid={`button-delete-post-${scheduledPost.id}`}
                    title="Supprimer"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <PreviewModal
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        postText={previewData.postText}
        selectedMedia={previewData.mediaIds}
        mediaList={previewData.allMedia}
        onPublish={() => { }}
        isPublishing={false}
        readOnly={true}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette publication ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Cela supprimera définitivement cette publication de votre historique et des statistiques associées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteReelMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleteReelMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteReelMutation.isPending ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
