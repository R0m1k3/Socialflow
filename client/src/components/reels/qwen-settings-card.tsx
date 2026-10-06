import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Cpu, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getErrorMessage, queryClient } from "@/lib/queryClient";

interface QwenConfig {
  url: string;
  hasApiKey: boolean;
}

interface QwenTestResult {
  ok: boolean;
  error?: string;
  model?: string;
  device?: string;
  voices?: number;
}

/**
 * Réglages du service Qwen3-TTS : voix locale gratuite, idéalement sur un
 * serveur avec carte graphique (ex. Unraid). C'est le service FFmpeg qui
 * l'appelle : le test vérifie donc la connexion depuis celui-ci.
 */
export function QwenSettingsCard() {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<QwenTestResult | null>(null);

  const { data: config } = useQuery<QwenConfig>({ queryKey: ["/api/settings/qwen"] });

  useEffect(() => {
    if (config) setUrl(config.url);
  }, [config]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/settings/qwen"] });
    // Le choix du moteur « Qwen » dépend de la disponibilité du service
    queryClient.invalidateQueries({ queryKey: ["/api/reels/voices"] });
  };

  const save = useMutation({
    mutationFn: () => apiRequest("POST", "/api/settings/qwen", { url, apiKey }),
    onSuccess: () => {
      refresh();
      setApiKey("");
      toast({ title: "Configuration sauvegardée", description: "Service Qwen TTS enregistré" });
    },
    onError: (error) =>
      toast({
        title: "Erreur",
        description: getErrorMessage(error, "Impossible de sauvegarder la configuration Qwen"),
        variant: "destructive",
      }),
  });

  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/settings/qwen"),
    onSuccess: () => {
      refresh();
      setUrl("");
      setApiKey("");
      setTest(null);
      toast({ title: "Configuration supprimée", description: "Service Qwen TTS retiré" });
    },
  });

  const runTest = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/settings/qwen/test", { url, apiKey });
      return (await response.json()) as QwenTestResult;
    },
    onSuccess: setTest,
    onError: (error) => setTest({ ok: false, error: getErrorMessage(error, "Test impossible") }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="w-5 h-5" />
          Qwen TTS (voix locale)
        </CardTitle>
        <CardDescription>
          Voix française gratuite et expressive, générée par votre propre serveur (idéalement avec carte
          graphique NVIDIA, ex. Unraid). Voir qwen-tts/docker-compose.gpu.yml.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="qwenTtsUrl">Adresse du service</Label>
          <Input
            id="qwenTtsUrl"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.20:8001"
            data-testid="input-qwen-url"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qwenTtsApiKey">Clé d'accès (API_KEY du service)</Label>
          <Input
            id="qwenTtsApiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.hasApiKey ? "••••••••••••••••" : "Clé définie sur le serveur Qwen"}
            data-testid="input-qwen-api-key"
          />
          {config?.hasApiKey && (
            <p className="text-xs text-success">✓ Clé enregistrée (laisser vide pour la garder)</p>
          )}
        </div>

        {test && (
          <p className={`text-sm ${test.ok ? "text-success" : "text-destructive"}`}>
            {test.ok
              ? `✓ Connecté : ${test.device ?? "?"} — ${test.model ?? ""} (${test.voices ?? 0} voix)`
              : `✗ ${test.error}`}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => runTest.mutate()}
            disabled={runTest.isPending || (!url && !config?.url)}
            data-testid="button-test-qwen"
          >
            {runTest.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Tester la connexion
          </Button>
          <Button
            className="flex-1"
            onClick={() => save.mutate()}
            disabled={save.isPending || !url}
            data-testid="button-save-qwen"
          >
            {save.isPending ? "Enregistrement..." : "Enregistrer Qwen TTS"}
          </Button>
          {config?.url && (
            <Button variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Retirer
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
