import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Bell, Key, Shield, Cloud, Brain } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Settings() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  const [cloudName, setCloudName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [openrouterModel, setOpenrouterModel] = useState("anthropic/claude-3.5-sonnet");
  const [openrouterSystemPrompt, setOpenrouterSystemPrompt] = useState("Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l'engagement.");
  const { toast } = useToast();

  const { data: cloudinaryConfig } = useQuery({
    queryKey: ['/api/cloudinary/config'],
  });

  const { data: openrouterConfig } = useQuery({
    queryKey: ['/api/openrouter/config'],
  });

  const { data: openrouterModels } = useQuery({
    queryKey: ['/api/openrouter/models'],
  });

  useEffect(() => {
    if (cloudinaryConfig) {
      setCloudName((cloudinaryConfig as any).cloudName || "");
      setApiKey((cloudinaryConfig as any).apiKey || "");
    }
  }, [cloudinaryConfig]);

  useEffect(() => {
    if (openrouterConfig) {
      setOpenrouterModel((openrouterConfig as any).model || "anthropic/claude-3.5-sonnet");
      setOpenrouterSystemPrompt((openrouterConfig as any).systemPrompt || "Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l'engagement.");
    }
  }, [openrouterConfig]);

  const saveCloudinaryMutation = useMutation({
    mutationFn: () => 
      apiRequest('POST', '/api/cloudinary/config', {
        cloudName,
        apiKey,
        apiSecret,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cloudinary/config'] });
      toast({
        title: "Configuration sauvegardée",
        description: "Vos paramètres Cloudinary ont été enregistrés",
      });
      setApiSecret(""); // Clear the secret after saving
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de sauvegarder la configuration",
        variant: "destructive",
      });
    },
  });

  const saveOpenrouterMutation = useMutation({
    mutationFn: () => 
      apiRequest('POST', '/api/openrouter/config', {
        apiKey: openrouterApiKey,
        model: openrouterModel,
        systemPrompt: openrouterSystemPrompt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/openrouter/config'] });
      toast({
        title: "Configuration sauvegardée",
        description: "Vos paramètres OpenRouter ont été enregistrés",
      });
      setOpenrouterApiKey(""); // Clear the API key after saving
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de sauvegarder la configuration OpenRouter",
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
        
        <div className="p-6 max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Paramètres</h1>
            <p className="text-muted-foreground mt-2">
              Configurez votre application
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Notifications
                </CardTitle>
                <CardDescription>
                  Gérez vos préférences de notification
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="notifications">Notifications activées</Label>
                    <p className="text-sm text-muted-foreground">
                      Recevez des notifications pour les publications
                    </p>
                  </div>
                  <Switch
                    id="notifications"
                    checked={notifications}
                    onCheckedChange={setNotifications}
                    data-testid="switch-notifications"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="autoPublish">Publication automatique</Label>
                    <p className="text-sm text-muted-foreground">
                      Publier automatiquement à l'heure programmée
                    </p>
                  </div>
                  <Switch
                    id="autoPublish"
                    checked={autoPublish}
                    onCheckedChange={setAutoPublish}
                    data-testid="switch-auto-publish"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  Configuration OpenRouter (IA)
                </CardTitle>
                <CardDescription>
                  Configurez OpenRouter pour la génération de texte avec l'IA
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openrouterApiKey">Clé API OpenRouter</Label>
                  <Input
                    id="openrouterApiKey"
                    type="password"
                    value={openrouterApiKey}
                    onChange={(e) => setOpenrouterApiKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    data-testid="input-openrouter-api-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Obtenez votre clé API sur{" "}
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">
                      openrouter.ai
                    </a>
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openrouterModel">Modèle d'IA</Label>
                  <Select value={openrouterModel} onValueChange={setOpenrouterModel}>
                    <SelectTrigger id="openrouterModel" data-testid="select-openrouter-model">
                      <SelectValue placeholder="Sélectionner un modèle" />
                    </SelectTrigger>
                    <SelectContent>
                      {(openrouterModels as any)?.data?.map((model: any) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choisissez le modèle d'IA pour générer vos publications
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openrouterSystemPrompt">Prompt système</Label>
                  <Textarea
                    id="openrouterSystemPrompt"
                    value={openrouterSystemPrompt}
                    onChange={(e) => setOpenrouterSystemPrompt(e.target.value)}
                    placeholder="Instructions pour l'IA..."
                    rows={6}
                    data-testid="textarea-openrouter-system-prompt"
                  />
                  <p className="text-xs text-muted-foreground">
                    Définissez les instructions que l'IA doit suivre pour générer vos textes
                  </p>
                </div>
                <Button 
                  onClick={() => saveOpenrouterMutation.mutate()}
                  disabled={saveOpenrouterMutation.isPending || !openrouterApiKey || !openrouterModel || !openrouterSystemPrompt}
                  data-testid="button-save-openrouter"
                  className="w-full"
                >
                  {saveOpenrouterMutation.isPending ? "Enregistrement..." : "Enregistrer OpenRouter"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cloud className="w-5 h-5" />
                  Configuration Cloudinary
                </CardTitle>
                <CardDescription>
                  Configurez Cloudinary pour le stockage d'images dans le cloud
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cloudName">Cloud Name</Label>
                  <Input
                    id="cloudName"
                    type="text"
                    value={cloudName}
                    onChange={(e) => setCloudName(e.target.value)}
                    placeholder="mon-cloud-name"
                    data-testid="input-cloud-name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Trouvez-le dans votre tableau de bord Cloudinary
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <Input
                    id="apiKey"
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="123456789012345"
                    data-testid="input-api-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiSecret">API Secret</Label>
                  <Input
                    id="apiSecret"
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="••••••••••••••••"
                    data-testid="input-api-secret"
                  />
                  <p className="text-xs text-muted-foreground">
                    Votre API Secret restera sécurisé et ne sera jamais exposé
                  </p>
                </div>
                <Button 
                  onClick={() => saveCloudinaryMutation.mutate()}
                  disabled={saveCloudinaryMutation.isPending || !cloudName || !apiKey || !apiSecret}
                  data-testid="button-save-cloudinary"
                  className="w-full"
                >
                  {saveCloudinaryMutation.isPending ? "Enregistrement..." : "Enregistrer Cloudinary"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Sécurité
                </CardTitle>
                <CardDescription>
                  Paramètres de sécurité et confidentialité
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Les paramètres de sécurité avancés seront disponibles prochainement.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
