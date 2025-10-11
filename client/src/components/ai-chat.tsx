import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bot, User, Lightbulb, History, Zap, Sparkles, Loader2 } from "lucide-react";
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
  const [selectedModel, setSelectedModel] = useState("anthropic/claude-3.5-sonnet");
  const { toast } = useToast();

  // Fetch available models from OpenRouter
  const { data: modelsData, isLoading: modelsLoading } = useQuery<{ models: OpenRouterModel[] }>({
    queryKey: ['/api/ai/models'],
  });

  const availableModels = modelsData?.models || [];

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

  return (
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-lg h-full flex flex-col">
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-primary/5 to-secondary/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
              <Sparkles className="text-white w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Assistant IA</h3>
              <p className="text-sm text-muted-foreground">Génération de contenu intelligent</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setMessages([messages[0]])}
            className="rounded-xl"
            data-testid="button-new-chat"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Nouveau chat
          </Button>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-foreground">Modèle IA:</label>
          <ModelCombobox
            models={availableModels}
            value={selectedModel}
            onValueChange={setSelectedModel}
            placeholder="Sélectionner un modèle"
            isLoading={modelsLoading}
            disabled={modelsLoading}
            className="w-[300px] rounded-xl"
            testId="select-ai-model"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-muted/20">
        {messages.map((message, index) => (
          <div 
            key={index} 
            className={`flex gap-4 chat-message ${message.role === "user" ? "justify-end" : ""}`}
          >
            {message.role === "assistant" && (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex-shrink-0 flex items-center justify-center shadow-md">
                <Bot className="text-white w-5 h-5" />
              </div>
            )}
            
            <div className={`flex-1 ${message.role === "user" ? "max-w-md ml-auto" : "max-w-2xl"}`}>
              <div className={`
                rounded-2xl p-6 shadow-md
                ${message.role === "user" 
                  ? "bg-gradient-to-br from-primary to-secondary text-white ml-auto" 
                  : "bg-card border border-border/50"
                }
              `}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                
                {message.variants && (
                  <div className="space-y-4 mt-6">
                    {message.variants.map((variant, vIndex) => (
                      <div 
                        key={vIndex}
                        className="p-5 rounded-xl bg-muted/50 border border-border/50 cursor-pointer hover:bg-muted hover:shadow-md transition-all"
                        data-testid={`variant-${vIndex}`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className={`
                            inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold
                            ${vIndex === 0 ? "bg-gradient-to-r from-primary to-secondary text-white" : "bg-secondary/20 text-secondary"}
                          `}>
                            {variant.variant}
                          </span>
                          <span className="text-xs text-muted-foreground font-medium">{variant.characterCount} caractères</span>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">{variant.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-xs text-muted-foreground mt-2 inline-block">
                {message.role === "user" ? "Maintenant" : "Il y a quelques secondes"}
              </span>
            </div>

            {message.role === "user" && (
              <div className="w-10 h-10 rounded-xl bg-secondary/20 flex-shrink-0 flex items-center justify-center">
                <User className="text-secondary w-5 h-5" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-6 border-t border-border/50 bg-card space-y-4">
        <div className="flex gap-4">
          <Textarea
            placeholder="Décrivez votre produit (nom, prix, caractéristiques)..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 min-h-[80px] rounded-xl bg-muted/30 border-border/50 focus:border-primary/50"
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
            className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 rounded-xl px-6"
            data-testid="button-generate"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {generateMutation.isPending ? "Génération..." : "Générer"}
          </Button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button 
            variant="outline" 
            size="sm" 
            className="rounded-xl"
            onClick={() => toast({ title: "Bientôt disponible", description: "Les suggestions de produits seront disponibles prochainement" })}
            data-testid="button-suggestions"
          >
            <Lightbulb className="w-4 h-4 mr-2" />
            Suggestions
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="rounded-xl"
            onClick={() => toast({ title: "Bientôt disponible", description: "L'historique des générations sera disponible prochainement" })}
            data-testid="button-history"
          >
            <History className="w-4 h-4 mr-2" />
            Historique
          </Button>
          <div className="ml-auto text-xs text-muted-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-success" />
            <span>Propulsé par OpenRouter</span>
          </div>
        </div>
      </div>
    </div>
  );
}
