import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Bell, Brain, Cloud, Image, Upload, X } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ModelCombobox } from "@/components/model-combobox";

export default function SettingsMobile() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  const [cloudName, setCloudName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [openrouterModel, setOpenrouterModel] = useState("anthropic/claude-3.5-sonnet");
  const [openrouterSystemPrompt, setOpenrouterSystemPrompt] = useState("Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l'engagement.");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: cloudinaryConfig } = useQuery({
    queryKey: ['/api/cloudinary/config'],
  });

  const { data: openrouterConfig } = useQuery({
    queryKey: ['/api/openrouter/config'],
  });

  const { data: openrouterModels, isLoading: modelsLoading } = useQuery({
    queryKey: ['/api/openrouter/models'],
  });

  useEffect(() => {
    if (cloudinaryConfig) {
      setCloudName((cloudinaryConfig as any).cloudName || "");
      setApiKey((cloudinaryConfig as any).apiKey || "");

      if ((cloudinaryConfig as any).logoPublicId) {
        const cloudName = (cloudinaryConfig as any).cloudName;
        const logoPublicId = (cloudinaryConfig as any).logoPublicId;
        setLogoPreview(`https://res.cloudinary.com/${cloudName}/image/upload/${logoPublicId}`);
      }
    }
  }, [cloudinaryConfig]);

  useEffect(() => {
    if (openrouterConfig) {
      setOpenrouterModel((openrouterConfig as any).model || "anthropic/claude-3.5-sonnet");
      setOpenrouterSystemPrompt((openrouterConfig as any).systemPrompt || "Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l'engagement.");
    }
  }, [openrouterConfig]);

  const hasExistingConfig = !!openrouterConfig;

  const saveCloudinaryMutation = useMutation({
    mutationFn: () => {
      const payload: any = {
        cloudName,
      };

      if (apiKey && apiKey.trim() !== "") {
        payload.apiKey = apiKey;
      }
      if (apiSecret && apiSecret.trim() !== "") {
        payload.apiSecret = apiSecret;
      }

      return apiRequest('POST', '/api/cloudinary/config', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cloudinary/config'] });
      toast({
        title: "Configuration sauvegardée",
        description: "Vos paramètres Cloudinary ont été enregistrés",
      });
      setApiKey("");
      setApiSecret("");
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
    mutationFn: () => {
      const payload: any = {
        model: openrouterModel,
        systemPrompt: openrouterSystemPrompt,
      };

      if (openrouterApiKey && openrouterApiKey.trim() !== "") {
        payload.apiKey = openrouterApiKey;
      }

      return apiRequest('POST', '/api/openrouter/config', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/openrouter/config'] });
      toast({
        title: "Configuration sauvegardée",
        description: "Vos paramètres OpenRouter ont été enregistrés",
      });
      setOpenrouterApiKey("");
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de sauvegarder la configuration OpenRouter",
        variant: "destructive",
      });
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);

      const response = await fetch('/api/cloudinary/logo', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload logo');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cloudinary/config'] });
      toast({
        title: "Logo uploadé",
        description: "Votre logo a été enregistré avec succès",
      });
      setLogoFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible d'uploader le logo",
        variant: "destructive",
      });
    },
  });

  const deleteLogoMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/cloudinary/logo', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cloudinary/config'] });
      setLogoPreview(null);
      setLogoFile(null);
      toast({
        title: "Logo supprimé",
        description: "Votre logo a été supprimé avec succès",
      });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer le logo",
        variant: "destructive",
      });
    },
  });

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Erreur",
          description: "Veuillez sélectionner une image",
          variant: "destructive",
        });
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

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

        {/* MOBILE: Single column layout */}
        <div className="p-4 space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Paramètres</h1>
            <p className="text-sm text-muted-foreground">
              Configurez votre application
            </p>
          </div>

          {/* Notifications */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="w-5 h-5" />
                Notifications
              </CardTitle>
              <CardDescription className="text-xs">
                Gérez vos préférences de notification
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5 flex-1 pr-3">
                  <Label htmlFor="notifications" className="text-sm">Notifications activées</Label>
                  <p className="text-xs text-muted-foreground">
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
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5 flex-1 pr-3">
                  <Label htmlFor="autoPublish" className="text-sm">Publication automatique</Label>
                  <p className="text-xs text-muted-foreground">
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

          {/* OpenRouter */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="w-5 h-5" />
                Configuration OpenRouter (IA)
              </CardTitle>
              <CardDescription className="text-xs">
                Configurez OpenRouter pour la génération de texte avec l'IA
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <div className="space-y-2">
                <Label htmlFor="openrouterApiKey" className="text-sm">Clé API OpenRouter</Label>
                <Input
                  id="openrouterApiKey"
                  type="password"
                  value={openrouterApiKey}
                  onChange={(e) => setOpenrouterApiKey(e.target.value)}
                  placeholder={hasExistingConfig ? "••••••••••••••••" : "sk-or-v1-..."}
                  className="min-h-[48px]"
                  data-testid="input-openrouter-api-key"
                />
                <p className="text-xs text-muted-foreground">
                  {hasExistingConfig ? (
                    <>
                      <span className="text-green-600 dark:text-green-400">✓ Clé API configurée</span> - Laissez vide pour garder la clé actuelle
                    </>
                  ) : (
                    <>
                      Obtenez votre clé API sur{" "}
                      <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">
                        openrouter.ai
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openrouterModel" className="text-sm">Modèle d'IA</Label>
                <ModelCombobox
                  models={(openrouterModels as any)?.data || []}
                  value={openrouterModel}
                  onValueChange={setOpenrouterModel}
                  placeholder="Sélectionner un modèle"
                  isLoading={modelsLoading}
                  className="w-full"
                  testId="select-openrouter-model"
                />
                <p className="text-xs text-muted-foreground">
                  Choisissez le modèle d'IA pour générer vos publications
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openrouterSystemPrompt" className="text-sm">Prompt système</Label>
                <Textarea
                  id="openrouterSystemPrompt"
                  value={openrouterSystemPrompt}
                  onChange={(e) => setOpenrouterSystemPrompt(e.target.value)}
                  placeholder="Instructions pour l'IA..."
                  rows={5}
                  data-testid="textarea-openrouter-system-prompt"
                />
                <p className="text-xs text-muted-foreground">
                  Définissez les instructions que l'IA doit suivre pour générer vos textes
                </p>
              </div>
              <Button
                onClick={() => saveOpenrouterMutation.mutate()}
                disabled={
                  saveOpenrouterMutation.isPending ||
                  !openrouterModel ||
                  !openrouterSystemPrompt ||
                  (!hasExistingConfig && !openrouterApiKey)
                }
                data-testid="button-save-openrouter"
                className="w-full min-h-[48px]"
              >
                {saveOpenrouterMutation.isPending ? "Enregistrement..." : "Enregistrer OpenRouter"}
              </Button>
            </CardContent>
          </Card>

          {/* Cloudinary */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cloud className="w-5 h-5" />
                Configuration Cloudinary
              </CardTitle>
              <CardDescription className="text-xs">
                Configurez Cloudinary pour le stockage d'images dans le cloud
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <div className="space-y-2">
                <Label htmlFor="cloudName" className="text-sm">Cloud Name</Label>
                <Input
                  id="cloudName"
                  type="text"
                  value={cloudName}
                  onChange={(e) => setCloudName(e.target.value)}
                  placeholder="mon-cloud-name"
                  className="min-h-[48px]"
                  data-testid="input-cloud-name"
                />
                <p className="text-xs text-muted-foreground">
                  Trouvez-le dans votre tableau de bord Cloudinary
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiKey" className="text-sm">API Key</Label>
                <Input
                  id="apiKey"
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="123456789012345"
                  className="min-h-[48px]"
                  data-testid="input-api-key"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiSecret" className="text-sm">API Secret</Label>
                <Input
                  id="apiSecret"
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="min-h-[48px]"
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
                className="w-full min-h-[48px]"
              >
                {saveCloudinaryMutation.isPending ? "Enregistrement..." : "Enregistrer Cloudinary"}
              </Button>
            </CardContent>
          </Card>

          {/* Logo */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Image className="w-5 h-5" />
                Logo de l'entreprise
              </CardTitle>
              <CardDescription className="text-xs">
                Uploadez votre logo pour l'ajouter aux images éditées
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              {logoPreview ? (
                <div className="space-y-4">
                  <div className="relative w-full max-w-xs mx-auto">
                    <img
                      src={logoPreview}
                      alt="Logo"
                      className="w-full h-auto max-h-48 object-contain rounded-lg border-2 border-border"
                    />
                    <Button
                      size="icon"
                      variant="destructive"
                      className="absolute top-2 right-2 h-10 w-10"
                      onClick={() => deleteLogoMutation.mutate()}
                      disabled={deleteLogoMutation.isPending}
                      data-testid="button-delete-logo"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                  <div>
                    <Label htmlFor="logo-upload-replace" className="cursor-pointer">
                      <Button
                        variant="outline"
                        className="w-full min-h-[48px]"
                        disabled={uploadLogoMutation.isPending}
                        data-testid="button-replace-logo"
                        onClick={() => document.getElementById('logo-upload-replace')?.click()}
                      >
                        <Upload className="w-5 h-5 mr-2" />
                        {uploadLogoMutation.isPending ? "Upload en cours..." : "Remplacer le logo"}
                      </Button>
                    </Label>
                    <input
                      id="logo-upload-replace"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        handleLogoChange(e);
                        if (e.target.files?.[0]) {
                          uploadLogoMutation.mutate(e.target.files[0]);
                        }
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                    <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-4">
                      Aucun logo uploadé. Choisissez une image PNG ou JPG.
                    </p>
                    <Label htmlFor="logo-upload" className="cursor-pointer">
                      <Button
                        variant="outline"
                        disabled={uploadLogoMutation.isPending || !cloudinaryConfig}
                        className="min-h-[48px]"
                        data-testid="button-upload-logo"
                        onClick={() => document.getElementById('logo-upload')?.click()}
                      >
                        <Upload className="w-5 h-5 mr-2" />
                        {uploadLogoMutation.isPending ? "Upload en cours..." : "Uploader un logo"}
                      </Button>
                    </Label>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        handleLogoChange(e);
                        if (e.target.files?.[0]) {
                          uploadLogoMutation.mutate(e.target.files[0]);
                        }
                      }}
                    />
                  </div>
                  {!cloudinaryConfig && (
                    <p className="text-xs text-orange-600 dark:text-orange-400 text-center">
                      Veuillez d'abord configurer Cloudinary ci-dessus
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
