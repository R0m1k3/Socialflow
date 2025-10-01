import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bot, User, Lightbulb, History, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
  variants?: Array<{ variant: string; text: string; characterCount: number }>;
}

export default function AiChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Bonjour ! Je suis votre assistant IA. Fournissez-moi les informations sur votre produit (nom, description, caractéristiques, prix) et je générerai automatiquement du contenu optimisé pour vos publications Facebook et Instagram.",
    },
  ]);
  const [input, setInput] = useState("");
  const { toast } = useToast();

  const generateMutation = useMutation({
    mutationFn: async (productInfo: any) => {
      const response = await apiRequest("POST", "/api/ai/generate", productInfo);
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

    // Add user message
    const userMessage = input;
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    // Parse product info from input (simple parsing)
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
    <div className="bg-card rounded-lg border border-border overflow-hidden h-full">
      <div className="border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="text-primary w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Assistant IA - Génération de contenu</h3>
            <p className="text-xs text-muted-foreground">Décrivez votre produit pour générer du texte</p>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => setMessages([messages[0]])}
          data-testid="button-new-chat"
        >
          <i className="fas fa-plus mr-2"></i>Nouveau chat
        </Button>
      </div>

      <div className="h-96 overflow-y-auto p-6 space-y-4 bg-muted/20">
        {messages.map((message, index) => (
          <div 
            key={index} 
            className={`flex gap-3 chat-message ${message.role === "user" ? "justify-end" : ""}`}
          >
            {message.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary flex-shrink-0 flex items-center justify-center">
                <Bot className="text-primary-foreground w-4 h-4" />
              </div>
            )}
            
            <div className={`flex-1 ${message.role === "user" ? "max-w-md ml-auto" : ""}`}>
              <div className={`
                rounded-lg p-4
                ${message.role === "user" 
                  ? "bg-primary text-primary-foreground ml-auto" 
                  : "bg-card border border-border"
                }
              `}>
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                
                {message.variants && (
                  <div className="space-y-3 mt-3">
                    {message.variants.map((variant, vIndex) => (
                      <div 
                        key={vIndex}
                        className="p-3 rounded-lg bg-accent/50 border border-border cursor-pointer hover:bg-accent transition-all"
                        data-testid={`variant-${vIndex}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`
                            inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                            ${vIndex === 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}
                          `}>
                            {variant.variant}
                          </span>
                          <span className="text-xs text-muted-foreground">{variant.characterCount} caractères</span>
                        </div>
                        <p className="text-sm text-foreground">{variant.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-xs text-muted-foreground mt-1 inline-block">
                {message.role === "user" ? "Maintenant" : "Il y a quelques secondes"}
              </span>
            </div>

            {message.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-secondary flex-shrink-0 flex items-center justify-center">
                <User className="text-secondary-foreground w-4 h-4" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-border bg-card">
        <div className="flex gap-3">
          <Textarea
            placeholder="Décrivez votre produit (nom, prix, caractéristiques)..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 min-h-[60px]"
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
            data-testid="button-generate"
          >
            <i className="fas fa-paper-plane mr-2"></i>
            {generateMutation.isPending ? "Génération..." : "Générer"}
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" data-testid="button-suggestions">
            <Lightbulb className="w-4 h-4 mr-1" />
            Suggestions
          </Button>
          <Button variant="outline" size="sm" data-testid="button-history">
            <History className="w-4 h-4 mr-1" />
            Historique
          </Button>
          <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <Zap className="w-3 h-3 text-chart-3" />
            Propulsé par OpenRouter
          </div>
        </div>
      </div>
    </div>
  );
}
