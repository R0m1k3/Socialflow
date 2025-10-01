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

import { storage } from '../storage';

export class OpenRouterService {
  private baseUrl = "https://openrouter.ai/api/v1/chat/completions";

  async generatePostText(productInfo: ProductInfo, userId: string): Promise<GeneratedText[]> {
    // Get user's OpenRouter configuration
    const config = await storage.getOpenrouterConfig(userId);
    
    if (!config) {
      throw new Error('Configuration OpenRouter non trouvée. Veuillez configurer OpenRouter dans les paramètres.');
    }

    const prompt = this.buildPrompt(productInfo, config.systemPrompt);

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "http://localhost:5555",
          "X-Title": "Social Flow"
        },
        body: JSON.stringify({
          model: config.model,
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

  private buildPrompt(productInfo: ProductInfo, systemPrompt: string): string {
    const features = productInfo.features?.join(", ") || "";
    
    const productDetails = `Nom: ${productInfo.name}
${productInfo.description ? `Description: ${productInfo.description}` : ''}
${productInfo.price ? `Prix: ${productInfo.price}` : ''}
${features ? `Caractéristiques: ${features}` : ''}`;

    return `${systemPrompt}

Informations produit:
${productDetails}

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
