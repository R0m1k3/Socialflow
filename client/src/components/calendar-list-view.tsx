import { format, isSameDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Edit, Trash2, ChevronDown, ChevronUp, Eye, Image, Smartphone } from "lucide-react";
import { SiFacebook, SiInstagram } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface CalendarListViewProps {
  scheduledPosts: any[];
  onEditPost: (post: any) => void;
  onDeletePost: (postId: string) => void;
  onPreviewPost: (post: any) => void;
}

export default function CalendarListView({ scheduledPosts, onEditPost, onDeletePost, onPreviewPost }: CalendarListViewProps) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const getPostTypeIcon = (postType: string) => {
    if (postType === 'feed') {
      return <Image className="w-4 h-4" />;
    } else if (postType === 'story') {
      return <Smartphone className="w-4 h-4" />;
    } else if (postType === 'both') {
      return (
        <div className="flex gap-0.5">
          <Image className="w-3 h-3" />
          <Smartphone className="w-3 h-3" />
        </div>
      );
    }
    return null;
  };

  // Group posts by date
  const groupedPosts = scheduledPosts.reduce((acc: { [key: string]: any[] }, post) => {
    if (!post.scheduledAt) return acc;
    const date = format(parseISO(post.scheduledAt), "yyyy-MM-dd");
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(post);
    return acc;
  }, {});

  // Sort dates - put today first, then future dates in ascending order, then past dates
  const today = format(new Date(), "yyyy-MM-dd");
  const sortedDates = Object.keys(groupedPosts).sort((a, b) => {
    // Today always comes first
    if (a === today && b !== today) return -1;
    if (b === today && a !== today) return 1;
    
    // Both are not today - separate future and past dates
    const aIsFuture = a > today;
    const bIsFuture = b > today;
    
    // Both are future: ascending chronological order (soonest first)
    if (aIsFuture && bIsFuture) {
      return a.localeCompare(b);
    }
    
    // Both are past: ascending chronological order (most recent past first)
    if (!aIsFuture && !bIsFuture) {
      return b.localeCompare(a);
    }
    
    // One is future, one is past: future comes first
    return aIsFuture ? -1 : 1;
  });

  const toggleDate = (date: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(date)) {
      newExpanded.delete(date);
    } else {
      newExpanded.add(date);
    }
    setExpandedDates(newExpanded);
  };

  const isToday = (dateStr: string) => {
    return isSameDay(parseISO(dateStr), new Date());
  };

  return (
    <div className="space-y-3 px-4 pb-4">
      {sortedDates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Aucune publication programmée
        </div>
      ) : (
        sortedDates.map((dateStr) => {
          const posts = groupedPosts[dateStr];
          const isExpanded = expandedDates.has(dateStr);
          const dateObj = parseISO(dateStr);
          const isDateToday = isToday(dateStr);

          return (
            <div
              key={dateStr}
              className={`rounded-xl border ${isDateToday ? 'border-primary/50 bg-primary/5' : 'border-border/50 bg-card'} overflow-hidden`}
              data-testid={`calendar-list-date-${dateStr}`}
            >
              <button
                onClick={() => toggleDate(dateStr)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                data-testid={`button-toggle-date-${dateStr}`}
              >
                <div className="flex items-center gap-3">
                  <div className="text-left">
                    <div className="font-semibold text-foreground">
                      {format(dateObj, "EEEE d MMMM yyyy", { locale: fr })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {posts.length} publication{posts.length > 1 ? 's' : ''}
                    </div>
                  </div>
                  {isDateToday && (
                    <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded-full font-semibold">
                      Aujourd'hui
                    </span>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-border/50">
                  {posts.map((post: any) => {
                    const time = post.scheduledAt
                      ? new Date(post.scheduledAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '';
                    const isPending = !post.publishedAt;
                    const isPublished = !!post.publishedAt;
                    const pageName = post.page?.pageName || 'Page inconnue';
                    const platform = post.page?.platform || 'facebook';
                    const PlatformIcon = platform === 'instagram' ? SiInstagram : SiFacebook;

                    return (
                      <div
                        key={post.id}
                        className={`px-4 py-3 border-b border-border/30 last:border-b-0 ${
                          isPending ? 'bg-blue-500/5' : 'bg-green-500/5'
                        }`}
                        data-testid={`calendar-list-post-${post.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {getPostTypeIcon(post.postType)}
                              <span className="font-semibold text-lg text-foreground">{time}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                isPending 
                                  ? 'bg-blue-500/20 text-blue-600' 
                                  : 'bg-green-500/20 text-green-600'
                              }`}>
                                {isPending ? 'Programmé' : 'Publié'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <PlatformIcon className="w-4 h-4 flex-shrink-0" />
                              <span className="truncate">{pageName}</span>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onPreviewPost(post)}
                              className="h-11 w-11 p-0"
                              data-testid={`button-preview-post-${post.id}`}
                              title="Prévisualiser"
                            >
                              <Eye className={`w-5 h-5 ${isPending ? 'text-blue-500' : 'text-green-500'}`} />
                            </Button>
                            {isPending && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onEditPost(post)}
                                  className="h-11 w-11 p-0"
                                  data-testid={`button-edit-post-${post.id}`}
                                  title="Modifier"
                                >
                                  <Edit className="w-5 h-5 text-blue-500" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onDeletePost(post.id)}
                                  className="h-11 w-11 p-0"
                                  data-testid={`button-delete-post-${post.id}`}
                                  title="Supprimer"
                                >
                                  <Trash2 className="w-5 h-5 text-red-500" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
