import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage, Media, Post } from "@shared/schema";
import { format } from "date-fns";
import { Image as ImageIcon, CheckCircle } from "lucide-react";

interface EditScheduledPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduledPost: any;
}

export default function EditScheduledPostDialog({ open, onOpenChange, scheduledPost }: EditScheduledPostDialogProps) {
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [pageId, setPageId] = useState("");
  const [postText, setPostText] = useState("");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);

  const { data: pages = [] } = useQuery<SocialPage[]>({
    queryKey: ["/api/pages"],
  });

  const { data: postData } = useQuery<{ post: Post; media: Media[] }>({
    queryKey: ["/api/posts", scheduledPost?.postId],
    enabled: !!scheduledPost?.postId && open,
  });

  const { data: allMedia = [] } = useQuery<Media[]>({
    queryKey: ["/api/media"],
    enabled: open,
  });

  useEffect(() => {
    if (scheduledPost && open) {
      const scheduledAt = new Date(scheduledPost.scheduledAt);
      setDate(format(scheduledAt, "yyyy-MM-dd"));
      setTime(format(scheduledAt, "HH:mm"));
      setPageId(scheduledPost.pageId);
    }
  }, [scheduledPost, open]);

  useEffect(() => {
    if (postData && open) {
      setPostText(postData.post.content);
      setSelectedMediaIds(postData.media.map(m => m.id));
    }
  }, [postData, open]);

  const updateScheduledMutation = useMutation({
    mutationFn: (data: { scheduledAt: string; pageId: string }) =>
      apiRequest('PATCH', `/api/scheduled-posts/${scheduledPost.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'] });
    },
  });

  const updatePostTextMutation = useMutation({
    mutationFn: (data: { content: string }) =>
      apiRequest('PATCH', `/api/posts/${scheduledPost?.postId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/posts', scheduledPost?.postId] });
    },
  });

  const updatePostMediaMutation = useMutation({
    mutationFn: (data: { mediaIds: string[] }) =>
      apiRequest('PATCH', `/api/posts/${scheduledPost?.postId}/media`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/posts', scheduledPost?.postId] });
    },
  });

  const handleSave = async () => {
    if (!date || !time || !pageId) {
      toast({
        title: "Erreur",
        description: "Veuillez remplir tous les champs",
        variant: "destructive",
      });
      return;
    }

    try {
      const scheduledAt = new Date(`${date}T${time}`);
      
      await updateScheduledMutation.mutateAsync({ scheduledAt: scheduledAt.toISOString(), pageId });
      
      if (postData && postText !== postData.post.content) {
        await updatePostTextMutation.mutateAsync({ content: postText });
      }
      
      const currentMediaIds = postData?.media.map(m => m.id) || [];
      if (JSON.stringify(selectedMediaIds) !== JSON.stringify(currentMediaIds)) {
        await updatePostMediaMutation.mutateAsync({ mediaIds: selectedMediaIds });
      }

      toast({
        title: "Modifications enregistrées",
        description: "Le post a été mis à jour avec succès",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de modifier le post",
        variant: "destructive",
      });
    }
  };

  const toggleMediaSelection = (mediaId: string) => {
    setSelectedMediaIds(prev => {
      if (prev.includes(mediaId)) {
        return prev.filter(id => id !== mediaId);
      } else {
        if (prev.length >= 10) {
          toast({
            title: "Limite atteinte",
            description: "Maximum 10 photos par publication",
            variant: "destructive",
          });
          return prev;
        }
        return [...prev, mediaId];
      }
    });
  };

  const isPending = updateScheduledMutation.isPending || updatePostTextMutation.isPending || updatePostMediaMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-scheduled-post">
        <DialogHeader>
          <DialogTitle>Modifier le post</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="post-text">Texte du post</Label>
            <Textarea
              id="post-text"
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder="Écrivez votre texte..."
              className="min-h-[100px]"
              data-testid="textarea-post-text"
            />
          </div>

          <div className="space-y-2">
            <Label>Photos sélectionnées ({selectedMediaIds.length}/10)</Label>
            <div className="grid grid-cols-3 gap-3">
              {selectedMediaIds.map((mediaId, index) => {
                const media = allMedia.find(m => m.id === mediaId);
                if (!media) return null;
                return (
                  <div key={mediaId} className="relative group">
                    <img
                      src={media.instagramFeedUrl || media.originalUrl}
                      alt="Selected"
                      className="w-full h-24 object-cover rounded-lg border-2 border-primary"
                    />
                    <div className="absolute top-1 left-1 bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </div>
                    <button
                      onClick={() => toggleMediaSelection(mediaId)}
                      className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      data-testid={`button-remove-media-${index}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Toutes les photos</Label>
            <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-2 border rounded-lg">
              {allMedia.map((media) => {
                const isSelected = selectedMediaIds.includes(media.id);
                return (
                  <button
                    key={media.id}
                    onClick={() => toggleMediaSelection(media.id)}
                    className="relative group"
                    data-testid={`button-select-media-${media.id}`}
                  >
                    <img
                      src={media.instagramFeedUrl || media.originalUrl}
                      alt={media.fileName}
                      className={`w-full h-20 object-cover rounded-lg border-2 transition-all ${
                        isSelected ? 'border-primary' : 'border-border hover:border-primary/50'
                      }`}
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 rounded-lg flex items-center justify-center">
                        <CheckCircle className="w-6 h-6 text-primary" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="input-scheduled-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="time">Heure</Label>
              <input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="input-scheduled-time"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="page">Page</Label>
            <Select value={pageId} onValueChange={setPageId}>
              <SelectTrigger data-testid="select-page">
                <SelectValue placeholder="Sélectionnez une page" />
              </SelectTrigger>
              <SelectContent>
                {pages.map((page) => (
                  <SelectItem key={page.id} value={page.id}>
                    {page.pageName} ({page.platform})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-edit"
          >
            Annuler
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            data-testid="button-save-edit"
          >
            {isPending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
