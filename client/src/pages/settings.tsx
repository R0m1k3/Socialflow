import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Bell, Key, Shield, Cloud } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
  const { toast } = useToast();

  const { data: cloudinaryConfig } = useQuery({
    queryKey: ['/api/cloudinary/config'],
  });

  useEffect(() => {
    if (cloudinaryConfig) {
      setCloudName((cloudinaryConfig as any).cloudName || "");
      setApiKey((cloudinaryConfig as any).apiKey || "");
    }
  }, [cloudinaryConfig]);

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
                  <Key className="w-5 h-5" />
                  Clés API
                </CardTitle>
                <CardDescription>
                  Configurez vos clés API pour les intégrations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openrouterKey">Clé API OpenRouter</Label>
                  <Input
                    id="openrouterKey"
                    type="password"
                    placeholder="sk-or-v1-..."
                    data-testid="input-openrouter-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Utilisée pour la génération de texte IA
                  </p>
                </div>
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
