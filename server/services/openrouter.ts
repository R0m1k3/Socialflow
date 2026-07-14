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

import crypto from 'crypto';
import { storage } from '../storage';

export class OpenRouterService {
  private baseUrl = "https://openrouter.ai/api/v1/chat/completions";

  async generatePostText(productInfo: ProductInfo, userId: string, modelOverride?: string): Promise<GeneratedText[]> {
    // Prefer the requesting user's own configuration; fall back to the most
    // recently saved shared configuration if this user hasn't set one up.
    const config = (await storage.getOpenrouterConfig(userId)) || (await storage.getAnyOpenrouterConfig());
    
    if (!config) {
      throw new Error('Configuration OpenRouter non trouvée. Veuillez demander à un administrateur de configurer OpenRouter dans les Paramètres.');
    }

    if (!config.apiKey || !config.apiKey.trim()) {
      throw new Error('Clé API OpenRouter manquante ou vide en base de données. Veuillez la ressaisir dans les Paramètres.');
    }

    const prompt = this.buildPrompt(productInfo, config.systemPrompt);

    // Use provided model or fall back to config model
    const modelToUse = modelOverride || config.model;

    const keyFingerprint = crypto.createHash('sha256').update(config.apiKey).digest('hex').slice(0, 8);
    console.log(`[OpenRouter] Generating with model="${modelToUse}" keyFingerprint=${keyFingerprint} keyLength=${config.apiKey.length} configUserId=${config.userId}`);

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "http://localhost:5555",
          "X-Title": "Social Flow"
        },
        body: JSON.stringify({
          model: modelToUse,
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
        const errorText = await response.text();
        console.error('OpenRouter API Error Response:', errorText);
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0]) {
        console.error('Invalid OpenRouter response - no choices:', { hasChoices: !!data.choices, model: modelToUse });
        throw new Error('Réponse invalide de l\'API OpenRouter. Vérifiez votre clé API et votre modèle.');
      }
      
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
    // Normaliser les retours à la ligne
    const normalizedContent = content.replace(/\r\n/g, '\n').trim();
    
    console.log('🔍 Parsing AI response (length:', normalizedContent.length, ')');
    
    // Stratégie 1: Détection des headers VERSION avec parsing intelligent
    const variants = this.tryMultipleParsingStrategies(normalizedContent);
    
    if (variants.length > 0) {
      console.log('✅ Parsed successfully:', variants.length, 'variants');
      return variants;
    }
    
    // Fallback: retourner le texte complet
    console.log('⚠️ Parsing failed, using fallback');
    return [{
      variant: "Généré par IA",
      text: normalizedContent,
      characterCount: normalizedContent.length
    }];
  }

  private tryMultipleParsingStrategies(content: string): GeneratedText[] {
    // Stratégie 1: Split par headers de VERSION (le plus flexible)
    const strategy1 = this.parseByVersionHeaders(content);
    if (strategy1.length >= 3) return strategy1;
    
    // Stratégie 2: Regex avec markdown **VERSION N:**
    const strategy2 = this.parseWithMarkdownHeaders(content);
    if (strategy2.length >= 3) return strategy2;
    
    // Stratégie 3: Regex simple sans markdown
    const strategy3 = this.parseWithSimpleHeaders(content);
    if (strategy3.length >= 3) return strategy3;
    
    // Retourner le meilleur résultat obtenu
    return strategy1.length > 0 ? strategy1 : (strategy2.length > 0 ? strategy2 : strategy3);
  }

  private parseByVersionHeaders(content: string): GeneratedText[] {
    const variants: GeneratedText[] = [];
    
    // Chercher tous les patterns VERSION N (très flexible)
    const versionPattern = /(?:\*{2})?VERSION\s+(\d+)\s*[-–—]\s*([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜ]+)(?:\*{2})?:?/gi;
    const matches = Array.from(content.matchAll(versionPattern));
    
    if (matches.length < 3) return variants;
    
    // Extraire le texte entre chaque header
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const versionNum = match[1];
      const style = match[2];
      const startPos = match.index! + match[0].length;
      const endPos = i < matches.length - 1 ? matches[i + 1].index! : content.length;
      
      let text = content.substring(startPos, endPos).trim();
      
      // Nettoyer le texte (enlever les séparateurs, notes entre parenthèses au début, etc.)
      text = text.replace(/^[-*]{3,}\s*/gm, ''); // Enlever les séparateurs
      text = text.replace(/^\([^)]+\)\s*/gm, ''); // Enlever les notes entre parenthèses
      text = text.trim();
      
      if (text.length > 0) {
        variants.push({
          variant: `Version ${versionNum} - ${this.capitalizeFirst(style.toLowerCase())}`,
          text,
          characterCount: text.length
        });
      }
    }
    
    return variants;
  }

  private parseWithMarkdownHeaders(content: string): GeneratedText[] {
    const variants: GeneratedText[] = [];
    
    const v1 = content.match(/\*{2}VERSION\s+1\s*[-–—]\s*DYNAMIQUE:?\*{2}\s*\n([\s\S]*?)(?=\*{2}VERSION\s+2|$)/i);
    const v2 = content.match(/\*{2}VERSION\s+2\s*[-–—]\s*INFORMATIVE?:?\*{2}\s*\n([\s\S]*?)(?=\*{2}VERSION\s+3|$)/i);
    const v3 = content.match(/\*{2}VERSION\s+3\s*[-–—]\s*[ÉE]MOTIONNELLE?:?\*{2}\s*\n([\s\S]*?)$/i);
    
    if (v1) variants.push({ variant: "Version 1 - Dynamique", text: v1[1].trim(), characterCount: v1[1].trim().length });
    if (v2) variants.push({ variant: "Version 2 - Informative", text: v2[1].trim(), characterCount: v2[1].trim().length });
    if (v3) variants.push({ variant: "Version 3 - Émotionnelle", text: v3[1].trim(), characterCount: v3[1].trim().length });
    
    return variants;
  }

  private parseWithSimpleHeaders(content: string): GeneratedText[] {
    const variants: GeneratedText[] = [];
    
    const v1 = content.match(/VERSION\s+1\s*[-–—]\s*DYNAMIQUE:?\s*\n([\s\S]*?)(?=VERSION\s+2|$)/i);
    const v2 = content.match(/VERSION\s+2\s*[-–—]\s*INFORMATIVE?:?\s*\n([\s\S]*?)(?=VERSION\s+3|$)/i);
    const v3 = content.match(/VERSION\s+3\s*[-–—]\s*[ÉE]MOTIONNELLE?:?\s*\n([\s\S]*?)$/i);
    
    if (v1) variants.push({ variant: "Version 1 - Dynamique", text: v1[1].trim(), characterCount: v1[1].trim().length });
    if (v2) variants.push({ variant: "Version 2 - Informative", text: v2[1].trim(), characterCount: v2[1].trim().length });
    if (v3) variants.push({ variant: "Version 3 - Émotionnelle", text: v3[1].trim(), characterCount: v3[1].trim().length });
    
    return variants;
  }

  private capitalizeFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  async getAvailableModels(): Promise<any[]> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Error fetching OpenRouter models:", error);
      throw error;
    }
  }
}

export const openRouterService = new OpenRouterService();
