import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const provided = req.headers["x-api-key"];

  if (!provided) {
    return res.status(401).json({ error: "Clé API manquante (header X-API-Key requis)" });
  }

  try {
    const config = await storage.getAppConfig();
    const key = config?.externalApiKey || process.env.EXTERNAL_API_KEY;

    if (!key) {
      return res.status(503).json({ error: "API externe non configurée" });
    }

    if (provided !== key) {
      return res.status(401).json({ error: "Clé API invalide" });
    }

    next();
  } catch (error) {
    console.error("[apiKey middleware] Error:", error);
    return res.status(500).json({ error: "Erreur interne lors de la vérification de la clé API" });
  }
}
