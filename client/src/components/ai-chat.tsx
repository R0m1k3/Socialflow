import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bot, User, Sparkles, Loader2, Copy, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ModelCombobox } from "@/components/model-combobox";

interface Message {
  role: "user" | "assistant";
  content: string;
  variants?: Array<{ variant: string; text: string; characterCount: number }>;
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt: string;
    completion: string;
  };
}

export default function AiChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Bonjour ! Je suis votre assistant IA. Fournissez-moi les informations sur votre produit (nom, description, caractéristiques, prix) et je générerai automatiquement du contenu optimisé pour vos publications Facebook et Instagram.",
    },
  ]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("anthropic/claude-sonnet-4.5");
  const { toast } = useToast();

  // Fetch available models from OpenRouter
  const { data: modelsData, isLoading: modelsLoading } = useQuery<{ data: OpenRouterModel[] }>({
    queryKey: ['/api/openrouter/models'],
    // Liste servie par un appel sortant vers OpenRouter : elle ne bouge pas d'une
    // heure à l'autre, inutile de la redemander à chaque retour sur l'onglet.
    staleTime: 60 * 60 * 1000,
  });

  const availableModels = modelsData?.data || [];

  const generateMutation = useMutation({
    mutationFn: async (productInfo: any) => {
      const response = await apiRequest("POST", "/api/ai/generate", {
        ...productInfo,
        model: selectedModel,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Parfait ! J'ai généré 3 variantes de texte pour votre produit. Choisissez celle qui vous convient :",
          variants: data.variants,
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/generations"] });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de générer le texte. Vérifiez votre clé API OpenRouter.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!input.trim()) return;

    const userMessage = input;
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    const productInfo = {
      name: userMessage.match(/Produit:\s*(.+?)(?:\n|$)/i)?.[1] || userMessage,
      price: userMessage.match(/Prix:\s*(.+?)(?:\n|$)/i)?.[1] || "",
      description: userMessage.match(/Description:\s*(.+?)(?:\n|$)/i)?.[1] || "",
      features: userMessage.match(/Caractéristiques:\s*(.+?)(?:\n|$)/i)?.[1]?.split(",") || [],
    };

    generateMutation.mutate(productInfo);
    setInput("");
  };

  const copyVariant = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Texte copié", description: "Collez-le dans votre publication." });
    } catch {
      toast({ title: "Copie impossible", description: "Sélectionnez le texte manuellement.", variant: "destructive" });
    }
  };

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border bg-card shadow-soft lg:h-[calc(100vh-13rem)]">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm text-muted-foreground">Modèle</span>
          <ModelCombobox
            models={availableModels}
            value={selectedModel}
            onValueChange={setSelectedModel}
            placeholder="Sélectionner un modèle"
            isLoading={modelsLoading}
            disabled={modelsLoading}
            className="w-full sm:w-[300px]"
            testId="select-ai-model"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMessages([messages[0]])}
          data-testid="button-new-chat"
        >
          <RotateCcw className="h-4 w-4" />
          Nouvelle conversation
        </Button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto bg-muted/30 p-4 sm:p-6">
        {messages.map((message, index) => (
          <div key={index} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}>
            {message.role === "assistant" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot className="h-4 w-4" />
              </div>
            )}

            <div className={message.role === "user" ? "max-w-[85%] sm:max-w-md" : "max-w-full flex-1 sm:max-w-2xl"}>
              <div
                className={
                  message.role === "user"
                    ? "rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground"
                    : "rounded-2xl rounded-tl-sm border bg-card px-4 py-3"
                }
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>

                {message.variants && (
                  <div className="mt-4 space-y-3">
                    {message.variants.map((variant, vIndex) => (
                      <button
                        type="button"
                        key={vIndex}
                        onClick={() => copyVariant(variant.text)}
                        className="group block w-full rounded-lg border bg-muted/40 p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                        data-testid={`variant-${vIndex}`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <Badge variant={vIndex === 0 ? "default" : "muted"}>{variant.variant}</Badge>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {variant.characterCount} caractères
                            <Copy className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground">{variant.text}</p>
                      </button>
                    ))}
                    <p className="text-xs text-muted-foreground">Cliquez sur une proposition pour la copier.</p>
                  </div>
                )}
              </div>
            </div>

            {message.role === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        {generateMutation.isPending && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
            L'IA rédige vos propositions…
          </div>
        )}
      </div>

      <div className="border-t bg-card p-3 sm:p-4">
        <div className="flex items-end gap-2">
          <Textarea
            placeholder="Décrivez votre produit (nom, prix, caractéristiques)…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="max-h-40 min-h-[48px] flex-1 resize-none"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            data-testid="input-product-info"
          />
          <Button
            onClick={handleSubmit}
            disabled={generateMutation.isPending || !input.trim()}
            variant="brand"
            className="h-12"
            data-testid="button-generate"
          >
            {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="hidden sm:inline">Générer</span>
          </Button>
        </div>
        <p className="mt-2 hidden text-xs text-muted-foreground sm:block">
          Entrée pour envoyer · Maj + Entrée pour aller à la ligne
        </p>
      </div>
    </div>
  );
}
