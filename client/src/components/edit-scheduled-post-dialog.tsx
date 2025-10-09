import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage } from "@shared/schema";
import { format } from "date-fns";

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

  const { data: pages = [] } = useQuery<SocialPage[]>({
    queryKey: ["/api/pages"],
  });

  useEffect(() => {
    if (scheduledPost && open) {
      const scheduledAt = new Date(scheduledPost.scheduledAt);
      setDate(format(scheduledAt, "yyyy-MM-dd"));
      setTime(format(scheduledAt, "HH:mm"));
      setPageId(scheduledPost.pageId);
    }
  }, [scheduledPost, open]);

  const updateMutation = useMutation({
    mutationFn: (data: { scheduledAt: string; pageId: string }) =>
      apiRequest('PATCH', `/api/scheduled-posts/${scheduledPost.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'] });
      toast({
        title: "Programmation modifiée",
        description: "La date et l'heure ont été mises à jour avec succès",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de modifier la programmation",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!date || !time || !pageId) {
      toast({
        title: "Erreur",
        description: "Veuillez remplir tous les champs",
        variant: "destructive",
      });
      return;
    }

    const scheduledAt = new Date(`${date}T${time}`);
    updateMutation.mutate({ scheduledAt: scheduledAt.toISOString(), pageId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-edit-scheduled-post">
        <DialogHeader>
          <DialogTitle>Modifier la programmation</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
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
            disabled={updateMutation.isPending}
            data-testid="button-save-edit"
          >
            {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
