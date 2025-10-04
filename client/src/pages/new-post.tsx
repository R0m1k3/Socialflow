import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Send, Sparkles, Image as ImageIcon, Calendar } from "lucide-react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage, Media } from "@shared/schema";

export default function NewPost() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  const [productInfo, setProductInfo] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<string | null>(null);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState('');
  const [generatedVariants, setGeneratedVariants] = useState<any[]>([]);
  const [postText, setPostText] = useState('');

  const { data: pages = [] } = useQuery<SocialPage[]>({
    queryKey: ['/api/pages'],
  });

  const { data: mediaList = [] } = useQuery<Media[]>({
    queryKey: ['/api/media'],
  });

  const generateTextMutation = useMutation({
    mutationFn: async (productInfoText: string) => {
      const productInfo = {
        name: productInfoText.match(/Produit:\s*(.+?)(?:\n|$)/i)?.[1] || 
              productInfoText.match(/Nom:\s*(.+?)(?:\n|$)/i)?.[1] || 
              productInfoText,
        price: productInfoText.match(/Prix:\s*(.+?)(?:\n|$)/i)?.[1] || "",
        description: productInfoText.match(/Description:\s*(.+?)(?:\n|$)/i)?.[1] || "",
        features: productInfoText.match(/Caractéristiques:\s*(.+?)(?:\n|$)/i)?.[1]?.split(",") || [],
      };
      const response = await apiRequest('POST', '/api/ai/generate', productInfo);
      return response.json();
    },
    onSuccess: (data: any) => {
      const variants = data.variants || [];
      setGeneratedVariants(variants);
      toast({
        title: "Texte généré",
        description: `${variants.length} variations créées`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ai/generations'] });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de générer le texte",
        variant: "destructive",
      });
    },
  });

  const createPostMutation = useMutation({
    mutationFn: (data: any) => 
      apiRequest('POST', '/api/posts', data),
    onSuccess: () => {
      toast({
        title: "Publication créée",
        description: "La publication a été créée avec succès",
      });
      navigate('/');
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de créer la publication",
        variant: "destructive",
      });
    },
  });

  const handleGenerateText = () => {
    if (!productInfo.trim()) {
      toast({
        title: "Information manquante",
        description: "Veuillez saisir les informations du produit",
        variant: "destructive",
      });
      return;
    }
    generateTextMutation.mutate(productInfo);
  };

  const handleCreatePost = () => {
    if (!postText.trim()) {
      toast({
        title: "Contenu requis",
        description: "Veuillez saisir le contenu de la publication",
        variant: "destructive",
      });
      return;
    }

    if (selectedPages.length === 0) {
      toast({
        title: "Page requise",
        description: "Veuillez sélectionner au moins une page",
        variant: "destructive",
      });
      return;
    }

    createPostMutation.mutate({
      content: postText,
      scheduledFor: scheduledDate || undefined,
      mediaId: selectedMedia || undefined,
      pageIds: selectedPages,
      postType: 'feed', // Default to feed post
    });
  };

  const handleUseVariant = (text: string) => {
    setPostText(text);
    toast({
      title: "Texte sélectionné",
      description: "Le texte a été ajouté à votre publication",
    });
  };

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
        
        <div className="p-8 max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Nouvelle publication</h1>
            <p className="text-muted-foreground mt-2">
              Créez et planifiez une nouvelle publication
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="p-6">
                  <CardTitle>Contenu</CardTitle>
                  <CardDescription>Informations du produit ou message</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="productInfo">Informations du produit</Label>
                    <Textarea
                      id="productInfo"
                      value={productInfo}
                      onChange={(e) => setProductInfo(e.target.value)}
                      placeholder="Décrivez votre produit : nom, caractéristiques, prix, etc."
                      rows={6}
                      data-testid="input-product-info"
                    />
                  </div>
                  <Button 
                    onClick={handleGenerateText}
                    disabled={generateTextMutation.isPending}
                    className="w-full"
                    data-testid="button-generate-text"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {generateTextMutation.isPending ? 'Génération...' : 'Générer le texte IA'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="p-6">
                  <CardTitle>Texte de la publication</CardTitle>
                  <CardDescription>Écrivez ou générez le texte de votre publication</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={postText}
                    onChange={(e) => setPostText(e.target.value)}
                    placeholder="Écrivez votre texte ici ou générez-le avec l'IA..."
                    rows={8}
                    data-testid="textarea-post-text"
                  />
                </CardContent>
              </Card>

              {generatedVariants.length > 0 && (
                <Card className="rounded-2xl border-border/50 shadow-lg">
                  <CardHeader className="p-6">
                    <CardTitle>Variations générées par l'IA</CardTitle>
                    <CardDescription>Cliquez sur "Utiliser" pour remplir le texte ci-dessus</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {generatedVariants.map((variant, index) => (
                      <div 
                        key={index}
                        className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">
                              {variant.variant || `Version ${index + 1}`}
                            </div>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                              {variant.text}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleUseVariant(variant.text)}
                            data-testid={`button-use-variant-${index}`}
                          >
                            Utiliser
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="p-6">
                  <CardTitle>Média</CardTitle>
                  <CardDescription>Sélectionnez une image ou vidéo</CardDescription>
                </CardHeader>
                <CardContent>
                  {mediaList.length === 0 ? (
                    <div className="text-center py-8">
                      <ImageIcon className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                      <p className="text-muted-foreground">Aucun média disponible</p>
                      <Button 
                        variant="link" 
                        onClick={() => navigate('/media')}
                        data-testid="link-upload-media"
                      >
                        Télécharger des médias
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {mediaList.map((media) => (
                        <button
                          key={media.id}
                          onClick={() => setSelectedMedia(media.id)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            selectedMedia === media.id
                              ? 'border-primary ring-2 ring-primary'
                              : 'border-transparent hover:border-muted-foreground'
                          }`}
                          data-testid={`button-select-media-${media.id}`}
                        >
                          <img 
                            src={media.originalUrl} 
                            alt={media.fileName}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-8">
              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="p-6">
                  <CardTitle>Pages cibles</CardTitle>
                  <CardDescription>Sélectionnez les pages où publier</CardDescription>
                </CardHeader>
                <CardContent>
                  {pages.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground mb-2">Aucune page connectée</p>
                      <Button 
                        variant="link" 
                        onClick={() => navigate('/pages')}
                        data-testid="link-add-pages"
                      >
                        Ajouter des pages
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pages.map((page) => (
                        <div key={page.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`page-${page.id}`}
                            checked={selectedPages.includes(page.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedPages([...selectedPages, page.id]);
                              } else {
                                setSelectedPages(selectedPages.filter(id => id !== page.id));
                              }
                            }}
                            data-testid={`checkbox-page-${page.id}`}
                          />
                          <label
                            htmlFor={`page-${page.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1"
                          >
                            {page.pageName} ({page.platform})
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="p-6">
                  <CardTitle>Planification</CardTitle>
                  <CardDescription>Programmez la publication (optionnel)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="scheduledDate">Date et heure</Label>
                    <Input
                      id="scheduledDate"
                      type="datetime-local"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      data-testid="input-scheduled-date"
                    />
                    <p className="text-xs text-muted-foreground">
                      Laissez vide pour publier immédiatement
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Button 
                onClick={handleCreatePost}
                disabled={createPostMutation.isPending}
                className="w-full bg-gradient-to-r from-primary to-secondary hover:opacity-90 shadow-lg"
                size="lg"
                data-testid="button-create-post"
              >
                <Send className="w-4 h-4 mr-2" />
                {createPostMutation.isPending ? 'Création...' : 'Créer la publication'}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
