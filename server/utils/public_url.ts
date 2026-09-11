/**
 * URL publique de l'application.
 *
 * Les flux OAuth (Facebook, TikTok) exigent une URI de redirection *exacte* :
 * celle envoyée au moment de l'autorisation doit être identique à celle
 * envoyée lors de l'échange du code, et déclarée telle quelle chez le
 * fournisseur. Se rabattre en silence sur `http://localhost:5555` quand
 * `APP_URL` n'est pas défini produit une URI que Facebook refuse — et
 * l'erreur n'apparaît qu'au moment de connecter une page.
 *
 * On préfère donc, à défaut d'`APP_URL`, reconstruire l'URL à partir de la
 * requête entrante : derrière Nginx, les en-têtes `X-Forwarded-Proto` et
 * `X-Forwarded-Host` portent le domaine public réel (`trust proxy` est activé
 * dans `server/index.ts`). Le repli localhost ne sert plus qu'au développement
 * local, hors requête HTTP.
 */

import type { Request } from 'express';

const DEV_FALLBACK = 'http://localhost:5555';

/** Premier élément d'un en-tête potentiellement chaîné (« a, b, c »). */
function firstHeaderValue(value: string | undefined): string | undefined {
  const first = value?.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * Base publique sans slash final (« https://exemple.fr »).
 * `APP_URL` prime toujours ; sinon la requête fait foi.
 */
export function resolvePublicBaseUrl(req?: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (req) {
    const host = firstHeaderValue(req.get('x-forwarded-host')) || req.get('host');
    if (host) {
      const protocol = firstHeaderValue(req.get('x-forwarded-proto')) || req.protocol || 'http';
      return `${protocol}://${host}`;
    }
  }

  return DEV_FALLBACK;
}
