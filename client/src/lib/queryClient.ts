import { QueryClient, QueryFunction } from "@tanstack/react-query";

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

    // Le navigateur ne journalise que « POST … 502 » : le motif renvoyé par le
    // serveur n'apparaît que dans un bandeau éphémère. On le trace donc dans la
    // console, seul endroit consultable sans accès aux logs du serveur.
    console.error(
      `[API] ${res.status} sur ${url} → ${getErrorMessage(new Error(`${res.status}: ${text}`), text)}`
    );

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

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, url);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
