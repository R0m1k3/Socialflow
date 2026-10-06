import { useEffect, useState } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, RefreshCw, Bug, Code, ChevronDown, HelpCircle, KeyRound, Link2, MoreVertical } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { EmptyState } from "@/components/empty-state";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ClientSocialPage } from "@shared/schema";
import {
  useConnectFacebook,
  RefreshTokenButton,
  TokenAlertBanner,
  TokenHealthPanel,
} from "@/components/facebook-token-status";

export default function PagesManagement() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<ClientSocialPage | null>(null);
  const [pageToDelete, setPageToDelete] = useState<ClientSocialPage | null>(null);
  const { toast } = useToast();

  // Retour des flux d'autorisation (/api/tiktok/callback et /api/facebook/callback
  // redirigent ici avec le résultat en paramètre)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const network = params.get('tiktok') ? 'tiktok' : params.get('facebook') ? 'facebook' : null;
    if (!network) return;

    const result = params.get(network);
    const label = network === 'tiktok' ? 'TikTok' : 'Facebook';

    toast({
      title: result === 'success' ? `${label} connecté` : `Connexion ${label} impossible`,
      description: params.get('message') || undefined,
      variant: result === 'success' ? undefined : 'destructive',
    });

    queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
    window.history.replaceState({}, '', window.location.pathname);
  }, [toast]);

  const { data: pages = [], isLoading } = useQuery<ClientSocialPage[]>({
    queryKey: ['/api/pages'],
  });

  const deleteMutation = useMutation({
    mutationFn: (pageId: string) => 
      apiRequest('DELETE', `/api/pages/${pageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
      toast({
        title: "Compte déconnecté",
        description: "Le compte a été retiré de Social Flow",
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

  const connectFacebook = useConnectFacebook();
  const connectTiktok = useConnectTiktok();

  return (
    <Page width="default">
      <PageHeader
        icon={Link2}
        title="Comptes connectés"
        description="Les pages Facebook, Instagram et comptes TikTok sur lesquels Social Flow publie."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="button-connect-account">
                <Plus className="h-4 w-4" /> Connecter un compte <ChevronDown className="h-4 w-4 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={connectFacebook} className="items-start gap-3 py-2.5" data-testid="button-connect-facebook">
                <PlatformIcon platform="facebook" size="sm" />
                <div>
                  <p className="font-medium">Facebook & Instagram</p>
                  <p className="text-xs text-muted-foreground">Recommandé · connexion permanente</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={connectTiktok} className="items-start gap-3 py-2.5" data-testid="button-connect-tiktok">
                <PlatformIcon platform="tiktok" size="sm" />
                <div>
                  <p className="font-medium">TikTok</p>
                  <p className="text-xs text-muted-foreground">Autorisation via TikTok</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialogOpen(true)} className="items-start gap-3 py-2.5" data-testid="button-add-page">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="font-medium">Ajout manuel</p>
                  <p className="text-xs text-muted-foreground">Avec un jeton d'accès (expire après 60 jours)</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <AddPageDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <EditPageDialog page={editingPage} onOpenChange={(open) => !open && setEditingPage(null)} />

      <TokenAlertBanner pages={pages} />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton h-52 rounded-xl" />
          ))}
        </div>
      ) : pages.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Aucun compte connecté"
          description="Connectez vos pages Facebook (et les comptes Instagram associés) ou un compte TikTok pour commencer à publier."
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={connectFacebook} data-testid="button-add-first-page">
                <PlatformIcon platform="facebook" size="sm" className="h-5 w-5 bg-transparent text-current" />
                Connecter Facebook
              </Button>
              <Button variant="outline" onClick={connectTiktok}>
                <PlatformIcon platform="tiktok" size="sm" className="h-5 w-5 bg-transparent" />
                Connecter TikTok
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {pages.map((page) => (
            <Card key={page.id} className="flex flex-col" data-testid={`card-page-${page.id}`}>
              <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-4">
                <PlatformIcon platform={page.platform} size="lg" />
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate">{page.pageName}</CardTitle>
                  <CardDescription className="truncate">
                    {platformLabel(page.platform)} · <span className="font-mono text-xs">{page.pageId}</span>
                  </CardDescription>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label="Plus d'actions" data-testid={`button-page-menu-${page.id}`}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {page.platform === "tiktok" ? (
                      <DropdownMenuItem onClick={() => { window.location.href = "/api/tiktok/connect"; }} data-testid={`button-reconnect-page-${page.id}`}>
                        <RefreshCw className="h-4 w-4" /> Reconnecter
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem onClick={() => setEditingPage(page)} data-testid={`button-edit-page-${page.id}`}>
                          <KeyRound className="h-4 w-4" /> Remplacer le jeton
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(`https://developers.facebook.com/tools/debug/accesstoken/`, "_blank")} data-testid="button-debug-token">
                          <Bug className="h-4 w-4" /> Déboguer le jeton
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setPageToDelete(page)}
                      className="text-destructive focus:text-destructive"
                      data-testid={`button-delete-page-${page.id}`}
                    >
                      <Trash2 className="h-4 w-4" /> Déconnecter
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                {/* État du jeton, tel que constaté par le dernier contrôle serveur */}
                <TokenHealthPanel page={page} />
                {page.platform !== "tiktok" && (
                  <div className="mt-auto flex justify-end">
                    <RefreshTokenButton page={page} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Collapsible className="mt-8 rounded-xl border bg-card">
        <CollapsibleTrigger className="group flex w-full items-center gap-3 p-4 text-left text-sm font-medium">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">Besoin d'aide pour connecter un compte ?</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t px-4 pb-4 pt-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Préférez « Facebook & Instagram »</strong> plutôt que l'ajout manuel :
            les jetons obtenus ainsi n'expirent pas et Social Flow les régénère seul en cas de révocation. Un jeton
            collé à la main expire au bout de 60 jours et devra être remplacé.
          </p>
          <p className="text-xs">
            Permissions nécessaires : <code className="rounded bg-muted px-1">pages_manage_posts</code>{" "}
            <code className="rounded bg-muted px-1">pages_read_engagement</code>{" "}
            <code className="rounded bg-muted px-1">publish_video</code>
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => window.open("https://developers.facebook.com/tools/debug/accesstoken/", "_blank")}>
              <Bug className="h-4 w-4" /> Débogueur de jeton
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open("https://developers.facebook.com/tools/explorer", "_blank")} data-testid="button-graph-explorer">
              <Code className="h-4 w-4" /> Graph Explorer
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={!!pageToDelete} onOpenChange={(open) => !open && setPageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Déconnecter « {pageToDelete?.pageName} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Social Flow ne pourra plus publier sur ce compte. Vous pourrez le reconnecter à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pageToDelete) deleteMutation.mutate(pageToDelete.id);
                setPageToDelete(null);
              }}
            >
              Déconnecter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

/**
 * Lance l'autorisation TikTok. La connexion se fait par navigation complète du
 * navigateur (et non en fetch) puisqu'elle passe par le site de TikTok.
 */
function useConnectTiktok() {
  const { toast } = useToast();

  const { data: config } = useQuery<{ configured: boolean }>({
    queryKey: ['/api/tiktok/config'],
  });

  const handleClick = () => {
    if (config && !config.configured) {
      toast({
        title: "TikTok n'est pas configuré",
        description: "Renseignez le client key et le client secret de votre application TikTok dans les paramètres.",
        variant: "destructive",
      });
      return;
    }
    window.location.href = '/api/tiktok/connect';
  };

  return handleClick;
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajouter un compte manuellement</DialogTitle>
          <DialogDescription>
            Renseignez l'identifiant de la page et un jeton d'accès. Ce jeton expirera au bout de 60 jours.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="platform">Plateforme</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as any)}>
              <SelectTrigger data-testid="select-platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pageName">Nom de la page</Label>
            <Input
              id="pageName"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              placeholder="Mon entreprise"
              required
              data-testid="input-page-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pageId">ID de la page</Label>
            <Input
              id="pageId"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="123456789"
              required
              data-testid="input-page-id"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="accessToken">Jeton d'accès</Label>
            <Input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxx"
              required
              data-testid="input-access-token"
            />
            <p className="text-xs text-muted-foreground">
              Obtenez votre jeton d'accès depuis{' '}
              <a 
                href="https://developers.facebook.com/tools/explorer" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Facebook Graph API Explorer
              </a>
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel"
            >
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={addMutation.isPending}
              data-testid="button-submit-page"
            >
              {addMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Ajout...
                </>
              ) : (
                'Ajouter'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditPageDialog({ page, onOpenChange }: { page: ClientSocialPage | null; onOpenChange: (open: boolean) => void }) {
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Modifier le jeton d'accès</DialogTitle>
          <DialogDescription>
            Mettez à jour le jeton d'accès pour {page.pageName}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="editAccessToken">Nouveau jeton d'accès</Label>
            <Input
              id="editAccessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxx"
              required
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
                Facebook Graph API Explorer
              </a>
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-edit"
            >
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={editMutation.isPending}
              data-testid="button-submit-edit"
            >
              {editMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Modification...
                </>
              ) : (
                'Modifier'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
