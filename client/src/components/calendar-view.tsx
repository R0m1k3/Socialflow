import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Trash2, Edit, MoreHorizontal, Eye } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScheduledPost } from "@shared/schema";
import { SiFacebook, SiInstagram } from "react-icons/si";
import EditScheduledPostDialog from "./edit-scheduled-post-dialog";
import CalendarListView from "./calendar-list-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PreviewModal } from "@/components/preview-modal";
import type { Media } from "@shared/schema";

export default function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ postText: string; mediaIds: string[]; allMedia: Media[] }>({ postText: '', mediaIds: [], allMedia: [] });
  const { toast } = useToast();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const { data: scheduledPosts = [] } = useQuery<ScheduledPost[]>({
    queryKey: ["/api/scheduled-posts"],
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
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-lg">
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-primary/5 to-secondary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
              <CalendarIcon className="text-white w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Calendrier</h3>
              <p className="text-sm text-muted-foreground">Visualisez vos publications planifiées</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={goToPreviousMonth}
              className="rounded-xl"
              data-testid="button-prev-month"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Précédent
            </Button>
            <span className="text-sm font-semibold text-foreground min-w-[140px] text-center px-4 py-2 bg-muted/30 rounded-xl">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={goToNextMonth}
              className="rounded-xl"
              data-testid="button-next-month"
            >
              Suivant
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>

      {isDesktop ? (
        <div className="p-8">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {daysOfWeek.map((day) => (
              <div key={day} className="bg-muted/30 py-3 rounded-lg text-center">
                <span className="text-sm font-semibold text-muted-foreground">{day}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
          {days.map((day, index) => (
            <div
              key={index}
              className={`
                bg-card border border-border/50 rounded-xl p-4 min-h-[140px] transition-all hover:shadow-md
                ${isToday(day.date) ? "ring-2 ring-primary shadow-lg" : ""}
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
                  <span className="text-[10px] bg-gradient-to-r from-primary to-secondary text-white px-2 py-0.5 rounded-full font-semibold">
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
                      const PlatformIcon = platform === 'instagram' ? SiInstagram : SiFacebook;
                      
                      return (
                        <div 
                          key={idx}
                          className={`
                            px-3 py-2 rounded-lg text-xs transition-all font-medium shadow-sm group relative
                            ${isPending ? 'bg-blue-500/20 text-blue-600 hover:bg-blue-500/30' : ''}
                            ${isPublished ? 'bg-green-500/20 text-green-600 hover:bg-green-500/30' : ''}
                          `}
                          data-testid={`calendar-post-${post.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold">{time}</div>
                              <div className="flex items-center gap-1 truncate opacity-90">
                                <PlatformIcon className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{pageName}</span>
                              </div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => handlePreviewPost(post, e)}
                                className={`p-1 rounded ${isPending ? 'hover:bg-blue-500/20' : 'hover:bg-green-500/20'}`}
                                data-testid={`button-preview-post-${post.id}`}
                                title="Prévisualiser"
                              >
                                <Eye className={`w-3 h-3 ${isPending ? 'text-blue-500' : 'text-green-500'}`} />
                              </button>
                              {isPending && (
                                <>
                                  <button
                                    onClick={(e) => handleEditPost(post, e)}
                                    className="p-1 hover:bg-blue-500/20 rounded"
                                    data-testid={`button-edit-post-${post.id}`}
                                    title="Modifier"
                                  >
                                    <Edit className="w-3 h-3 text-blue-500" />
                                  </button>
                                  <button
                                    onClick={(e) => handleDeletePost(post.id, e)}
                                    className="p-1 hover:bg-red-500/20 rounded"
                                    data-testid={`button-delete-post-${post.id}`}
                                    title="Supprimer"
                                  >
                                    <Trash2 className="w-3 h-3 text-red-500" />
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
                              const PlatformIcon = platform === 'instagram' ? SiInstagram : SiFacebook;
                              
                              return (
                                <div 
                                  key={idx}
                                  className={`
                                    px-3 py-2 rounded-lg text-xs transition-all font-medium shadow-sm group relative
                                    ${isPending ? 'bg-blue-500/20 text-blue-600 hover:bg-blue-500/30' : ''}
                                    ${isPublished ? 'bg-green-500/20 text-green-600 hover:bg-green-500/30' : ''}
                                  `}
                                  data-testid={`popover-post-${post.id}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-semibold">{time}</div>
                                      <div className="flex items-center gap-1 truncate opacity-90">
                                        <PlatformIcon className="w-3 h-3 flex-shrink-0" />
                                        <span className="truncate">{pageName}</span>
                                      </div>
                                    </div>
                                    <div className="flex gap-1">
                                      <button
                                        onClick={(e) => handlePreviewPost(post, e)}
                                        className={`p-1 rounded ${isPending ? 'hover:bg-blue-500/20' : 'hover:bg-green-500/20'}`}
                                        data-testid={`button-preview-popover-post-${post.id}`}
                                        title="Prévisualiser"
                                      >
                                        <Eye className={`w-3 h-3 ${isPending ? 'text-blue-500' : 'text-green-500'}`} />
                                      </button>
                                      {isPending && (
                                        <>
                                          <button
                                            onClick={(e) => handleEditPost(post, e)}
                                            className="p-1 hover:bg-blue-500/20 rounded"
                                            data-testid={`button-edit-popover-post-${post.id}`}
                                            title="Modifier"
                                          >
                                            <Edit className="w-3 h-3 text-blue-500" />
                                          </button>
                                          <button
                                            onClick={(e) => handleDeletePost(post.id, e)}
                                            className="p-1 hover:bg-red-500/20 rounded"
                                            data-testid={`button-delete-popover-post-${post.id}`}
                                            title="Supprimer"
                                          >
                                            <Trash2 className="w-3 h-3 text-red-500" />
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

          <div className="mt-8 flex items-center justify-center gap-8 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-md bg-blue-500/20 border-2 border-blue-500"></div>
              <span className="text-sm text-muted-foreground font-medium">Programmé</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-md bg-green-500/20 border-2 border-green-500"></div>
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
        onPublish={() => {}}
        isPublishing={false}
      />
    </div>
  );
}
