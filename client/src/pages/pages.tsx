import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Facebook, Instagram, Trash2, RefreshCw } from "lucide-react";
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

export default function PagesManagement() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
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
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Pages gérées</h1>
              <p className="text-muted-foreground mt-2">
                Connectez et gérez vos pages Facebook et Instagram
              </p>
            </div>
            <AddPageDialog open={dialogOpen} onOpenChange={setDialogOpen} />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader className="h-32 bg-muted"></CardHeader>
                </Card>
              ))}
            </div>
          ) : pages.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <Plus className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Aucune page connectée</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Commencez par connecter vos pages Facebook et Instagram
                </p>
                <Button onClick={() => setDialogOpen(true)} data-testid="button-add-first-page">
                  <Plus className="w-4 h-4 mr-2" />
                  Ajouter une page
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pages.map((page) => (
                <Card key={page.id} data-testid={`card-page-${page.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {page.platform === 'facebook' ? (
                          <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center">
                            <Facebook className="w-6 h-6 text-white" />
                          </div>
                        ) : (
                          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                            <Instagram className="w-6 h-6 text-white" />
                          </div>
                        )}
                        <div>
                          <CardTitle className="text-lg">{page.pageName}</CardTitle>
                          <CardDescription className="capitalize">
                            {page.platform}
                          </CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        ID: {page.pageId}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(page.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-page-${page.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
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
      <DialogTrigger asChild>
        <Button data-testid="button-add-page">
          <Plus className="w-4 h-4 mr-2" />
          Ajouter une page
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajouter une page</DialogTitle>
          <DialogDescription>
            Connectez une page Facebook ou Instagram pour commencer à publier
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
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
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
