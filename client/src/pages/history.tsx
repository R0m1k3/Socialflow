import { useState } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, Calendar, History as HistoryIcon, Eye, Image as ImageIcon, Smartphone, Loader2, Clapperboard, Search, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { PlatformIcon } from "@/components/platform-icon";
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

/** Publication dont l'heure est passée mais que le scheduler n'a pas encore traitée. */
function isAwaitingPublication(scheduledPost: ScheduledPostWithRelations): boolean {
  return (
    !!scheduledPost.scheduledAt &&
    new Date(scheduledPost.scheduledAt) <= new Date() &&
    !scheduledPost.publishedAt
  );
}

type StatusFilter = "all" | "published" | "pending" | "failed";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "published", label: "Publiées" },
  { value: "pending", label: "En cours" },
  { value: "failed", label: "Échecs" },
];

const PAGE_SIZE = 20;

export default function History() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ postText: string; mediaIds: string[]; allMedia: Media[]; generationStatus?: string; generationProgress?: number }>({ postText: '', mediaIds: [], allMedia: [] });
  const { toast } = useToast();

  const { data: scheduledPosts = [], isLoading } = useQuery<ScheduledPostWithRelations[]>({
    queryKey: ['/api/scheduled-posts'],
    // Le scheduler publie en tâche de fond : on ne suit à la seconde que ce qui
    // est réellement en attente. Le reste du temps, une veille lente suffit —
    // sans quoi la page entière était rechargée 20 fois par minute pour rien.
    refetchInterval: (query) =>
      (query.state.data ?? []).some(isAwaitingPublication) ? 3000 : 30000,
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
      return <ImageIcon className="h-3.5 w-3.5" />;
    } else if (postType === 'story') {
      return <Smartphone className="h-3.5 w-3.5" />;
    } else if (postType === 'reel') {
      return <Clapperboard className="h-3.5 w-3.5" />;
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

  const statusOf = (sp: ScheduledPostWithRelations): StatusFilter =>
    sp.error ? "failed" : !sp.publishedAt ? "pending" : "published";

  const counts = publishedPosts.reduce(
    (acc, sp) => {
      acc[statusOf(sp)] += 1;
      return acc;
    },
    { all: publishedPosts.length, published: 0, pending: 0, failed: 0 } as Record<StatusFilter, number>,
  );

  const term = searchTerm.trim().toLowerCase();
  const filteredPosts = publishedPosts.filter(
    (sp) =>
      (statusFilter === "all" || statusOf(sp) === statusFilter) &&
      (!term ||
        sp.post?.content?.toLowerCase().includes(term) ||
        sp.page?.pageName?.toLowerCase().includes(term)),
  );
  const visiblePosts = filteredPosts.slice(0, visibleCount);

  return (
    <>
      <Page width="default">
        <PageHeader
          icon={HistoryIcon}
          title="Historique"
          description="Toutes les publications envoyées et leur résultat."
        />

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v as StatusFilter); setVisibleCount(PAGE_SIZE); }}>
            <TabsList className="w-full justify-start overflow-x-auto scrollbar-none sm:w-auto">
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="gap-1.5" data-testid={`tab-history-${t.value}`}>
                  {t.label}
                  <span className="rounded-full bg-muted-foreground/10 px-1.5 text-[11px] tabular-nums">{counts[t.value]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un texte ou une page…"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="pl-9"
              data-testid="input-history-search"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-24 rounded-xl" />
            ))}
          </div>
        ) : publishedPosts.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title="Aucune publication"
            description="Vos publications apparaîtront ici une fois envoyées."
            action={
              <Button asChild>
                <Link href="/new">Créer une publication</Link>
              </Button>
            }
          />
        ) : filteredPosts.length === 0 ? (
          <EmptyState icon={Search} title="Aucun résultat" description="Essayez un autre mot-clé ou un autre filtre." />
        ) : (
          <div className="space-y-3">
            {visiblePosts.map((scheduledPost) => {
              const status = statusOf(scheduledPost);
              return (
                <Card key={scheduledPost.id} className="p-4" data-testid={`card-post-${scheduledPost.id}`}>
                  <div className="flex items-start gap-3">
                    <PlatformIcon platform={scheduledPost.page?.platform ?? "facebook"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{scheduledPost.page?.pageName || "Page inconnue"}</p>
                        {status === "failed" ? (
                          <Badge variant="danger" className="gap-1"><XCircle className="h-3 w-3" /> Échec</Badge>
                        ) : status === "pending" ? (
                          <Badge variant="info" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> En cours</Badge>
                        ) : (
                          <Badge variant="success" className="gap-1"><CheckCircle className="h-3 w-3" /> Publié</Badge>
                        )}
                        {scheduledPost.post?.aiGenerated && (
                          <Badge variant="muted" className="gap-1"><Sparkles className="h-3 w-3" /> IA</Badge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {scheduledPost.post?.content || <span className="italic">Aucun texte</span>}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {getPostTypeIcon(scheduledPost.postType)}
                          {scheduledPost.postType === "feed"
                            ? "Feed"
                            : scheduledPost.postType === "story"
                              ? "Story"
                              : scheduledPost.postType === "reel"
                                ? "Reel"
                                : "Feed & Story"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {scheduledPost.scheduledAt
                            ? format(new Date(scheduledPost.scheduledAt), "d MMM yyyy 'à' HH:mm", { locale: fr })
                            : "Date inconnue"}
                        </span>
                      </div>
                      {scheduledPost.error && (
                        <p className="mt-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{scheduledPost.error}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handlePreviewPost(scheduledPost)}
                      className="shrink-0 text-muted-foreground"
                      data-testid={`button-preview-post-${scheduledPost.id}`}
                      title="Prévisualiser"
                      aria-label="Prévisualiser"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              );
            })}
            {filteredPosts.length > visibleCount && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)} data-testid="button-history-more">
                  Afficher plus ({filteredPosts.length - visibleCount} restantes)
                </Button>
              </div>
            )}
          </div>
        )}
      </Page>

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
    </>
  );
}
