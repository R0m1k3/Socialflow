import { MutationCache, QueryClient, QueryFunction } from "@tanstack/react-query";

// Les routes d'authentification elles-mêmes ne doivent jamais déclencher
// de redirection automatique (ex: mauvais mot de passe sur /login).
function isAuthRoute(url: string): boolean {
  return url.startsWith("/api/auth/");
}

// Si la session serveur a expiré (ex: redémarrage du serveur, expiration du
// cookie) alors que la SPA pense toujours l'utilisateur connecté (le check
// de session initial est mis en cache indéfiniment par react-query), toutes
// les requêtes suivantes échouent silencieusement en 401 sans jamais
// renvoyer l'utilisateur vers l'écran de connexion. On force donc un
// rechargement vers /login dès qu'une requête API (hors routes d'auth)
// renvoie 401, ce qui réinitialise aussi le cache react-query.
export function handleUnauthorized(url: string) {
  if (isAuthRoute(url) || window.location.pathname === "/login") {
    return;
  }
  window.location.href = "/login";
}

/**
 * Extrait un message lisible d'une erreur d'API.
 * apiRequest lève des erreurs de la forme `500: {"error":"…"}` : sans ce
 * décodage, l'interface ne peut afficher qu'un message générique alors que le
 * serveur a renvoyé la cause exacte.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;

  const withoutStatus = error.message.replace(/^\d{3}:\s*/, '').trim();
  if (!withoutStatus) return fallback;

  try {
    const parsed = JSON.parse(withoutStatus);
    const message = parsed?.error || parsed?.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // Corps non-JSON : on affiche le texte tel quel
  }

  return withoutStatus.startsWith('<') ? fallback : withoutStatus;
}

async function throwIfResNotOk(res: Response, url: string) {
  if (!res.ok) {
    if (res.status === 401) {
      handleUnauthorized(url);
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res, url);
  return res;
}

/**
 * Construit l'URL d'une requête à partir de sa clé.
 *
 * Les segments texte forment le chemin (`['/api/posts', id]`). Un objet en
 * dernière position porte les paramètres de requête : c'est ce qui permet de
 * demander une fenêtre de dates plutôt que tout l'historique
 * (`['/api/scheduled-posts', { startDate, endDate }]`).
 */
export function urlFromQueryKey(queryKey: readonly unknown[]): string {
  const segments = [...queryKey];
  const last = segments[segments.length - 1];

  if (last !== null && typeof last === "object") {
    segments.pop();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(last as Record<string, unknown>)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    }
    const query = params.toString();
    return query ? `${segments.join("/")}?${query}` : segments.join("/");
  }

  return segments.join("/");
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = urlFromQueryKey(queryKey);
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, url);
    return await res.json();
  };

/**
 * Marque les mutations d'authentification, exclues de l'invalidation globale
 * ci-dessous. À passer en `mutationKey` : `[AUTH_MUTATION, 'logout']`.
 */
export const AUTH_MUTATION = "auth";

export const queryClient = new QueryClient({
  // Les compteurs du tableau de bord et la liste des posts dérivent de tout le
  // reste : publier, supprimer un média, générer un texte… Aucune mutation ne
  // peut raisonnablement se souvenir de les invalider, et aucune ne le faisait :
  // ils restaient figés jusqu'au rechargement de la page. On les invalide donc
  // ici, une bonne fois, après chaque mutation réussie.
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      // Sauf pour l'authentification : au moment où la déconnexion réussit, la
      // session est déjà détruite. Relancer des requêtes ici ne produirait que
      // des 401 et une redirection brutale, avant même que le cache soit vidé.
      if (mutation.options.mutationKey?.[0] === AUTH_MUTATION) return;

      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // Le serveur agit de son côté — le scheduler publie toutes les minutes, le
      // renouvellement des jetons tourne en tâche de fond — sans que le
      // navigateur en soit averti. Avec `staleTime: Infinity`, un écran restait
      // sur le cache de sa première visite pour toute la session : d'où la
      // nécessité de recharger la page pour voir quoi que ce soit. Une
      // péremption courte, plus un rafraîchissement au retour sur l'onglet,
      // suffit à garder l'affichage juste sans marteler l'API.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
