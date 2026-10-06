import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Trash2, Edit, MoreHorizontal, Eye, Image, Smartphone } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScheduledPost } from "@shared/schema";
import { SiFacebook, SiInstagram, SiTiktok } from "react-icons/si";
import EditScheduledPostDialog from "./edit-scheduled-post-dialog";
import CalendarListView from "./calendar-list-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PreviewModal } from "@/components/preview-modal";
import type { Media } from "@shared/schema";

/**
 * Bornes de la grille affichée : 42 cases à partir du lundi qui précède le 1er
 * du mois. Demander cette fenêtre plutôt que tout l'historique évite de charger
 * des années de publications pour en afficher six semaines.
 */
function visibleRange(currentDate: Date): { startDate: string; endDate: string } {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startingDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

  const start = new Date(year, month, 1 - startingDayOfWeek);
  const end = new Date(year, month, 1 - startingDayOfWeek + 42);
  end.setMilliseconds(-1); // fin de la 42e journée

  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export default function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ postText: string; mediaIds: string[]; allMedia: Media[]; generationStatus?: string; generationProgress?: number }>({ postText: '', mediaIds: [], allMedia: [] });
  const { toast } = useToast();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // La fenêtre fait partie de la clé : changer de mois redéclenche la requête.
  const range = visibleRange(currentDate);

  const { data: scheduledPosts = [] } = useQuery<ScheduledPost[]>({
    queryKey: ["/api/scheduled-posts", range],
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const deletePostMutation = useMutation({
    mutationFn: (postId: string) =>
      apiRequest('DELETE', `/api/scheduled-posts/${postId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'] });
      toast({
        title: "Publication supprimée",
        description: "La publication programmée a été supprimée avec succès",
      });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer la publication",
        variant: "destructive",
      });
    },
  });

  const handleDeletePost = (postId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (confirm("Êtes-vous sûr de vouloir supprimer cette publication programmée ?")) {
      deletePostMutation.mutate(postId);
    }
  };

  const handleEditPost = (post: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedPost(post);
    setEditDialogOpen(true);
  };

  const handlePreviewPost = async (scheduledPost: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

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
        generationStatus: postWithMedia.post.generationStatus,
        generationProgress: postWithMedia.post.generationProgress,
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
      return <Image className="w-3 h-3" />;
    } else if (postType === 'story') {
      return <Smartphone className="w-3 h-3" />;
    } else if (postType === 'both') {
      return (
        <div className="flex gap-0.5">
          <Image className="w-2.5 h-2.5" />
          <Smartphone className="w-2.5 h-2.5" />
        </div>
      );
    }
    return null;
  };

  const getPostsForDate = (date: Date) => {
    return (scheduledPosts || []).filter(post => {
      if (!post.scheduledAt) return false;
      const postDate = new Date(post.scheduledAt);

      // Compare using local date components to avoid timezone issues
      return postDate.getFullYear() === date.getFullYear() &&
        postDate.getMonth() === date.getMonth() &&
        postDate.getDate() === date.getDate();
    });
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
  ];

  const daysOfWeek = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    const days = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonthDay = new Date(year, month, -startingDayOfWeek + i + 1);
      days.push({ date: prevMonthDay, isCurrentMonth: false });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }

    return days;
  };

  const days = getDaysInMonth(currentDate);
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h2 className="text-lg font-semibold capitalize text-foreground">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            data-testid="button-today"
          >
            Aujourd'hui
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPreviousMonth}
            aria-label="Mois précédent"
            data-testid="button-prev-month"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNextMonth}
            aria-label="Mois suivant"
            data-testid="button-next-month"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isDesktop ? (
        <div className="p-4 lg:p-6">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {daysOfWeek.map((day) => (
              <div key={day} className="py-1 text-center">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {days.map((day, index) => (
              <div
                key={index}
                className={`
                bg-card border rounded-lg p-2.5 min-h-[120px] transition-colors hover:border-primary/30
                ${isToday(day.date) ? "border-primary/60 bg-primary/[0.03]" : ""}
                ${!day.isCurrentMonth ? "opacity-40" : ""}
              `}
                data-testid={`calendar-day-${index}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={`
                    text-sm font-semibold
                    ${!day.isCurrentMonth ? "text-muted-foreground" : "text-foreground"}
                    ${isToday(day.date) ? "text-primary" : ""}
                  `}
                  >
                    {day.date.getDate()}
                  </span>
                  {isToday(day.date) && (
                    <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
                      Aujourd'hui
                    </span>
                  )}
                </div>

                {(() => {
                  if (!day.isCurrentMonth) return null;
                  const postsForDay = getPostsForDate(day.date);
                  if (postsForDay.length === 0) return null;

                  return (
                    <div className="space-y-2">
                      {postsForDay.slice(0, 2).map((post: any, idx) => {
                        const time = post.scheduledAt ? new Date(post.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
                        const isPending = !post.publishedAt;
                        const isPublished = !!post.publishedAt;
                        const pageName = post.page?.pageName || 'Page inconnue';
                        const platform = post.page?.platform || 'facebook';
                        const PlatformIcon = platform === 'instagram' ? SiInstagram : platform === 'tiktok' ? SiTiktok : SiFacebook;

                        return (
                          <div
                            key={idx}
                            className={`
                            px-3 py-2 rounded-lg text-xs transition-all font-medium shadow-sm group relative
                            ${isPending ? 'bg-primary/10 text-primary hover:bg-primary/20' : ''}
                            ${isPublished ? 'bg-success/15 text-success hover:bg-success/25' : ''}
                          `}
                            data-testid={`calendar-post-${post.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1 font-semibold">
                                  {getPostTypeIcon(post.postType)}
                                  <span>{time}</span>
                                </div>
                                <div className="flex items-center gap-1 truncate opacity-90">
                                  <PlatformIcon className="w-3 h-3 flex-shrink-0" />
                                  <span className="truncate">{pageName}</span>
                                </div>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => handlePreviewPost(post, e)}
                                  className={`p-1 rounded ${isPending ? 'hover:bg-primary/15' : 'hover:bg-success/20'}`}
                                  data-testid={`button-preview-post-${post.id}`}
                                  title="Prévisualiser"
                                >
                                  <Eye className={`w-3 h-3 ${isPending ? 'text-primary' : 'text-success'}`} />
                                </button>
                                {isPending && (
                                  <>
                                    <button
                                      onClick={(e) => handleEditPost(post, e)}
                                      className="p-1 hover:bg-primary/15 rounded"
                                      data-testid={`button-edit-post-${post.id}`}
                                      title="Modifier"
                                    >
                                      <Edit className="w-3 h-3 text-primary" />
                                    </button>
                                    <button
                                      onClick={(e) => handleDeletePost(post.id, e)}
                                      className="p-1 hover:bg-destructive/15 rounded"
                                      data-testid={`button-delete-post-${post.id}`}
                                      title="Supprimer"
                                    >
                                      <Trash2 className="w-3 h-3 text-destructive" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {postsForDay.length > 2 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className="w-full text-left text-[11px] text-primary hover:text-primary/80 pl-2 font-medium transition-colors flex items-center gap-1"
                              data-testid="button-show-more-posts"
                            >
                              <MoreHorizontal className="w-3 h-3" />
                              +{postsForDay.length - 2} autre(s)
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-3" align="start">
                            <div className="space-y-2">
                              <h4 className="font-semibold text-sm mb-3">
                                Tous les posts du {day.date.getDate()} {monthNames[day.date.getMonth()]}
                              </h4>
                              {postsForDay.slice(2).map((post: any, idx) => {
                                const time = post.scheduledAt ? new Date(post.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
                                const isPending = !post.publishedAt;
                                const isPublished = !!post.publishedAt;
                                const pageName = post.page?.pageName || 'Page inconnue';
                                const platform = post.page?.platform || 'facebook';
                                const PlatformIcon = platform === 'instagram' ? SiInstagram : platform === 'tiktok' ? SiTiktok : SiFacebook;

                                return (
                                  <div
                                    key={idx}
                                    className={`
                                    px-3 py-2 rounded-lg text-xs transition-all font-medium shadow-sm group relative
                                    ${isPending ? 'bg-primary/10 text-primary hover:bg-primary/20' : ''}
                                    ${isPublished ? 'bg-success/15 text-success hover:bg-success/25' : ''}
                                  `}
                                    data-testid={`popover-post-${post.id}`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1 font-semibold">
                                          {getPostTypeIcon(post.postType)}
                                          <span>{time}</span>
                                        </div>
                                        <div className="flex items-center gap-1 truncate opacity-90">
                                          <PlatformIcon className="w-3 h-3 flex-shrink-0" />
                                          <span className="truncate">{pageName}</span>
                                        </div>
                                      </div>
                                      <div className="flex gap-1">
                                        <button
                                          onClick={(e) => handlePreviewPost(post, e)}
                                          className={`p-1 rounded ${isPending ? 'hover:bg-primary/15' : 'hover:bg-success/20'}`}
                                          data-testid={`button-preview-popover-post-${post.id}`}
                                          title="Prévisualiser"
                                        >
                                          <Eye className={`w-3 h-3 ${isPending ? 'text-primary' : 'text-success'}`} />
                                        </button>
                                        {isPending && (
                                          <>
                                            <button
                                              onClick={(e) => handleEditPost(post, e)}
                                              className="p-1 hover:bg-primary/15 rounded"
                                              data-testid={`button-edit-popover-post-${post.id}`}
                                              title="Modifier"
                                            >
                                              <Edit className="w-3 h-3 text-primary" />
                                            </button>
                                            <button
                                              onClick={(e) => handleDeletePost(post.id, e)}
                                              className="p-1 hover:bg-destructive/15 rounded"
                                              data-testid={`button-delete-popover-post-${post.id}`}
                                              title="Supprimer"
                                            >
                                              <Trash2 className="w-3 h-3 text-destructive" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded bg-primary/15 border-2 border-primary"></div>
              <span className="text-sm text-muted-foreground font-medium">Programmé</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded bg-success/15 border-2 border-success"></div>
              <span className="text-sm text-muted-foreground font-medium">Publié</span>
            </div>
          </div>
        </div>
      ) : (
        <CalendarListView
          scheduledPosts={scheduledPosts}
          onEditPost={handleEditPost}
          onDeletePost={handleDeletePost}
          onPreviewPost={handlePreviewPost}
        />
      )}

      <EditScheduledPostDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        scheduledPost={selectedPost || {}}
      />

      <PreviewModal
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        postText={previewData.postText}
        selectedMedia={previewData.mediaIds}
        mediaList={previewData.allMedia}
        onPublish={() => { }}
        isPublishing={false}
        readOnly={true}
        generationStatus={previewData.generationStatus}
        generationProgress={previewData.generationProgress}
      />
    </div>
  );
}
