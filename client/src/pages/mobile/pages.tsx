import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Facebook, Instagram, Trash2, RefreshCw, Edit, Bug, Code, Calendar, AlertTriangle } from "lucide-react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage } from "@shared/schema";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

function getTokenExpirationStatus(expiresAt: string | null | undefined) {
  if (!expiresAt) {
    return {
      status: 'unknown' as const,
      color: 'text-gray-500',
      bgColor: 'bg-gray-100',
      daysLeft: null,
      message: 'Date inconnue'
    };
  }

  const now = new Date();
  const expiration = new Date(expiresAt);
  const diffTime = expiration.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return {
      status: 'expired' as const,
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      daysLeft,
      message: 'Expiré'
    };
  } else if (daysLeft <= 7) {
    return {
      status: 'urgent' as const,
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      daysLeft,
      message: `${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''}`
    };
  } else if (daysLeft <= 15) {
    return {
      status: 'warning' as const,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100',
      daysLeft,
      message: `${daysLeft} jours restants`
    };
  } else {
    return {
      status: 'good' as const,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      daysLeft,
      message: `${daysLeft} jours restants`
    };
  }
}

export default function PagesManagementMobile() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<SocialPage | null>(null);
  const { toast } = useToast();

  const { data: pages = [], isLoading } = useQuery<SocialPage[]>({
    queryKey: ['/api/pages'],
  });

  const deleteMutation = useMutation({
    mutationFn: (pageId: string) =>
      apiRequest('DELETE', `/api/pages/${pageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
      toast({
        title: "Page supprimée",
        description: "La page a été retirée avec succès",
      });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer la page",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        {/* MOBILE: Compact layout with single column */}
        <div className="p-4 space-y-6 pb-24">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Pages gérées</h1>
            <p className="text-sm text-muted-foreground">
              Connectez et gérez vos pages Facebook et Instagram
            </p>
          </div>

          <AddPageDialog open={dialogOpen} onOpenChange={setDialogOpen} />
          <EditPageDialog page={editingPage} onOpenChange={(open) => !open && setEditingPage(null)} />

          {/* MOBILE: Stack buttons vertically */}
          <div className="flex flex-col gap-3">
            <Button
              variant="outline"
              onClick={() => window.open('https://developers.facebook.com/tools/debug/accesstoken/', '_blank')}
              className="w-full min-h-[48px]"
              data-testid="button-debug-token"
            >
              <Bug className="w-5 h-5 mr-2" />
              Débogueur de jeton
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open('https://developers.facebook.com/tools/explorer', '_blank')}
              className="w-full min-h-[48px]"
              data-testid="button-graph-explorer"
            >
              <Code className="w-5 h-5 mr-2" />
              Graph Explorer
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-48 bg-card rounded-2xl border border-border/50 animate-pulse" />
              ))}
            </div>
          ) : pages.length === 0 ? (
            <Card className="border-dashed rounded-2xl border-border/50 shadow-lg">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <Plus className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-center">Aucune page connectée</h3>
                <p className="text-muted-foreground text-center mb-4 text-sm px-4">
                  Commencez par connecter vos pages Facebook et Instagram
                </p>
                <Button onClick={() => setDialogOpen(true)} className="min-h-[48px]" data-testid="button-add-first-page">
                  <Plus className="w-5 h-5 mr-2" />
                  Ajouter une page
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pages.map((page) => (
                <Card key={page.id} className="rounded-2xl border-border/50 shadow-lg" data-testid={`card-page-${page.id}`}>
                  <CardHeader className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1">
                        {page.platform === 'facebook' ? (
                          <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Facebook className="w-6 h-6 text-white" />
                          </div>
                        ) : (
                          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Instagram className="w-6 h-6 text-white" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{page.pageName}</CardTitle>
                          <CardDescription className="capitalize text-xs">
                            {page.platform}
                          </CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-5 pt-0">
                    <div className="text-xs text-muted-foreground break-all">
                      ID: {page.pageId}
                    </div>

                    {/* Token expiration status */}
                    {(() => {
                      const expirationStatus = getTokenExpirationStatus(
                        page.tokenExpiresAt ? new Date(page.tokenExpiresAt).toISOString() : null
                      );
                      return (
                        <div className={`flex items-center gap-2 text-xs px-3 py-3 rounded-lg ${expirationStatus.bgColor}`}>
                          <Calendar className="w-4 h-4 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">Expiration du token</div>
                            <div className={`${expirationStatus.color} font-semibold`}>
                              {expirationStatus.message}
                            </div>
                            {page.tokenExpiresAt && (
                              <div className="text-muted-foreground mt-0.5">
                                {format(new Date(page.tokenExpiresAt), "d MMMM yyyy", { locale: fr })}
                              </div>
                            )}
                          </div>
                          {(expirationStatus.status === 'expired' || expirationStatus.status === 'urgent') && (
                            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                          )}
                        </div>
                      );
                    })()}

                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        variant="outline"
                        className="flex-1 min-h-[44px]"
                        onClick={() => setEditingPage(page)}
                        data-testid={`button-edit-page-${page.id}`}
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Modifier
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1 min-h-[44px]"
                        onClick={() => deleteMutation.mutate(page.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-page-${page.id}`}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Supprimer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Fixed Add Button */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border shadow-lg">
            <Button
              onClick={() => setDialogOpen(true)}
              className="w-full min-h-[52px]"
              data-testid="button-add-page"
            >
              <Plus className="w-5 h-5 mr-2" />
              Ajouter une page
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function AddPageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [platform, setPlatform] = useState<'facebook' | 'instagram'>('facebook');
  const [pageName, setPageName] = useState('');
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const { toast } = useToast();

  const addMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest('POST', '/api/pages', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
      toast({
        title: "Page ajoutée",
        description: "La page a été connectée avec succès",
      });
      onOpenChange(false);
      setPlatform('facebook');
      setPageName('');
      setPageId('');
      setAccessToken('');
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible d'ajouter la page",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({
      platform,
      pageName,
      pageId,
      accessToken,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md mx-auto">
        <DialogHeader>
          <DialogTitle>Ajouter une page</DialogTitle>
          <DialogDescription className="text-xs">
            Connectez une page Facebook ou Instagram pour commencer à publier
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="platform" className="text-sm">Plateforme</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as any)}>
              <SelectTrigger className="min-h-[48px]" data-testid="select-platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pageName" className="text-sm">Nom de la page</Label>
            <Input
              id="pageName"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              placeholder="Mon entreprise"
              required
              className="min-h-[48px]"
              data-testid="input-page-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pageId" className="text-sm">ID de la page</Label>
            <Input
              id="pageId"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="123456789"
              required
              className="min-h-[48px]"
              data-testid="input-page-id"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="accessToken" className="text-sm">Jeton d'accès</Label>
            <Input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxx"
              required
              className="min-h-[48px]"
              data-testid="input-access-token"
            />
            <p className="text-xs text-muted-foreground">
              Obtenez votre jeton depuis{' '}
              <a
                href="https://developers.facebook.com/tools/explorer"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Graph API Explorer
              </a>
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <Button
              type="submit"
              disabled={addMutation.isPending}
              className="w-full min-h-[48px]"
              data-testid="button-submit-page"
            >
              {addMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Ajout...
                </>
              ) : (
                'Ajouter'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full min-h-[48px]"
              data-testid="button-cancel"
            >
              Annuler
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditPageDialog({ page, onOpenChange }: { page: SocialPage | null; onOpenChange: (open: boolean) => void }) {
  const [accessToken, setAccessToken] = useState('');
  const { toast } = useToast();

  const editMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest('PUT', `/api/pages/${page?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
      toast({
        title: "Page modifiée",
        description: "Le jeton d'accès a été mis à jour avec succès",
      });
      onOpenChange(false);
      setAccessToken('');
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de modifier la page",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!page) return;
    editMutation.mutate({
      accessToken,
    });
  };

  if (!page) return null;

  return (
    <Dialog open={!!page} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md mx-auto">
        <DialogHeader>
          <DialogTitle>Modifier le jeton d'accès</DialogTitle>
          <DialogDescription className="text-xs">
            Mettez à jour le jeton d'accès pour {page.pageName}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="editAccessToken" className="text-sm">Nouveau jeton d'accès</Label>
            <Input
              id="editAccessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxx"
              required
              className="min-h-[48px]"
              data-testid="input-edit-access-token"
            />
            <p className="text-xs text-muted-foreground">
              Obtenez un nouveau jeton depuis{' '}
              <a
                href="https://developers.facebook.com/tools/explorer"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Graph API Explorer
              </a>
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <Button
              type="submit"
              disabled={editMutation.isPending}
              className="w-full min-h-[48px]"
              data-testid="button-submit-edit"
            >
              {editMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Modification...
                </>
              ) : (
                'Modifier'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full min-h-[48px]"
              data-testid="button-cancel-edit"
            >
              Annuler
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
