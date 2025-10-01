interface ProductInfo {
  name: string;
  description?: string;
  price?: string;
  features?: string[];
  [key: string]: any;
}

interface GeneratedText {
  variant: string;
  text: string;
  characterCount: number;
}

export class OpenRouterService {
  private apiKey: string;
  private baseUrl = "https://openrouter.ai/api/v1/chat/completions";

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || "";
    if (!this.apiKey) {
      console.warn("OPENROUTER_API_KEY not set. AI text generation will not work.");
    }
  }

  async generatePostText(productInfo: ProductInfo): Promise<GeneratedText[]> {
    if (!this.apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const prompt = this.buildPrompt(productInfo);

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "http://localhost:5000",
          "X-Title": "Social Flow"
        },
        body: JSON.stringify({
          model: "anthropic/claude-3.5-sonnet",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.8,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || "";

      return this.parseGeneratedText(content);
    } catch (error) {
      console.error("Error generating text with OpenRouter:", error);
      throw error;
    }
  }

  private buildPrompt(productInfo: ProductInfo): string {
    const features = productInfo.features?.join(", ") || "";
    
    return `Tu es un expert en marketing sur les réseaux sociaux. Génère 3 variantes de texte pour une publication Facebook/Instagram pour ce produit:

Nom: ${productInfo.name}
${productInfo.description ? `Description: ${productInfo.description}` : ''}
${productInfo.price ? `Prix: ${productInfo.price}` : ''}
${features ? `Caractéristiques: ${features}` : ''}

Crée 3 versions différentes:
1. Version Dynamique - Énergique et engageante avec des emojis
2. Version Informative - Factuelle et professionnelle
3. Version Émotionnelle - Axée sur les bénéfices émotionnels

Chaque version doit:
- Être en français
- Faire entre 150-250 caractères
- Être optimisée pour les réseaux sociaux
- Inclure des emojis pertinents (sauf la version informative)

Format de réponse:
VERSION 1 - DYNAMIQUE:
[texte]

VERSION 2 - INFORMATIVE:
[texte]

VERSION 3 - ÉMOTIONNELLE:
[texte]`;
  }

  private parseGeneratedText(content: string): GeneratedText[] {
    const variants: GeneratedText[] = [];
    
    const version1Match = content.match(/VERSION 1 - DYNAMIQUE:\s*\n([\s\S]*?)(?=VERSION 2|$)/i);
    const version2Match = content.match(/VERSION 2 - INFORMATIVE:\s*\n([\s\S]*?)(?=VERSION 3|$)/i);
    const version3Match = content.match(/VERSION 3 - ÉMOTIONNELLE:\s*\n([\s\S]*?)$/i);

    if (version1Match) {
      const text = version1Match[1].trim();
      variants.push({
        variant: "Version 1 - Dynamique",
        text,
        characterCount: text.length
      });
    }

    if (version2Match) {
      const text = version2Match[1].trim();
      variants.push({
        variant: "Version 2 - Informative",
        text,
        characterCount: text.length
      });
    }

    if (version3Match) {
      const text = version3Match[1].trim();
      variants.push({
        variant: "Version 3 - Émotionnelle",
        text,
        characterCount: text.length
      });
    }

    // Fallback if parsing fails
    if (variants.length === 0) {
      variants.push({
        variant: "Généré par IA",
        text: content.trim(),
        characterCount: content.trim().length
      });
    }

    return variants;
  }
}

export const openRouterService = new OpenRouterService();
