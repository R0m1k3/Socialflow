/**
 * Suivi et renouvellement des jetons d'accès.
 *
 * Un jeton de page Facebook n'affiche pas toujours de date d'expiration : celui
 * qui dérive d'une connexion OAuth est permanent, et c'est sa révocation — pas
 * son échéance — qui casse la publication. L'UI montre donc l'état réel remonté
 * par le contrôle serveur, pas seulement un décompte de jours.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Calendar, CheckCircle2, Facebook, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getErrorMessage, queryClient } from "@/lib/queryClient";
import type { ClientSocialPage } from "@shared/schema";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

type TokenStatus = 'valid' | 'expiring' | 'expired' | 'error';

const STATUS_STYLES: Record<TokenStatus, { label: string; color: string; bgColor: string }> = {
  valid: { label: 'Jeton valide', color: 'text-green-600', bgColor: 'bg-green-100' },
  expiring: { label: 'Jeton bientôt expiré', color: 'text-orange-600', bgColor: 'bg-orange-100' },
  expired: { label: 'Jeton expiré', color: 'text-red-600', bgColor: 'bg-red-100' },
  error: { label: 'Contrôle en échec', color: 'text-red-600', bgColor: 'bg-red-100' },
};

function statusOf(page: ClientSocialPage): TokenStatus {
  return (page.tokenStatus as TokenStatus | null) ?? 'valid';
}

/**
 * Lance l'autorisation Facebook. La connexion se fait par navigation complète
 * du navigateur (et non en fetch) puisqu'elle passe par le site de Facebook.
 */
export function ConnectFacebookButton({ className }: { className?: string }) {
  const { toast } = useToast();

  const { data: config } = useQuery<{ configured: boolean }>({
    queryKey: ['/api/facebook/config'],
  });

  const handleClick = () => {
    if (config && !config.configured) {
      toast({
        title: "Facebook n'est pas configuré",
        description:
          "Renseignez l'App ID et l'App Secret de votre application Facebook dans les paramètres.",
        variant: 'destructive',
      });
      return;
    }
    window.location.href = '/api/facebook/connect';
  };

  return (
    <Button
      variant="outline"
      className={className}
      onClick={handleClick}
      data-testid="button-connect-facebook"
    >
      <Facebook className="w-4 h-4 mr-2" />
      Connecter des pages Facebook
    </Button>
  );
}

/** Relance le contrôle serveur, qui renouvelle le jeton s'il le peut. */
export function RefreshTokenButton({ page }: { page: ClientSocialPage }) {
  const { toast } = useToast();

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/facebook/pages/${page.id}/refresh`);
      return (await response.json()) as { status: TokenStatus; renewed: boolean; error?: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
      toast({
        title: result.renewed
          ? 'Jeton renouvelé'
          : result.status === 'valid'
            ? 'Jeton valide'
            : STATUS_STYLES[result.status].label,
        description:
          result.error ||
          (result.renewed
            ? `Un nouveau jeton a été généré pour ${page.pageName}.`
            : `Aucun renouvellement nécessaire pour ${page.pageName}.`),
        variant: result.status === 'valid' ? undefined : 'destructive',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Contrôle impossible',
        description: getErrorMessage(error, 'Facebook est injoignable, réessayez plus tard.'),
        variant: 'destructive',
      });
    },
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => refreshMutation.mutate()}
      disabled={refreshMutation.isPending}
      data-testid={`button-refresh-token-${page.id}`}
    >
      <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
      {refreshMutation.isPending ? 'Contrôle…' : 'Vérifier le jeton'}
    </Button>
  );
}

/**
 * Bloc d'état du jeton : ce que le dernier contrôle a constaté, l'échéance
 * quand il y en a une, et l'erreur à corriger le cas échéant.
 */
export function TokenHealthPanel({ page }: { page: ClientSocialPage }) {
  const status = statusOf(page);
  const style = STATUS_STYLES[status];
  const isTiktok = page.platform === 'tiktok';

  // Pour TikTok, c'est l'autorisation (refresh token) qui porte l'échéance.
  const expiresAt = isTiktok ? page.refreshTokenExpiresAt : page.tokenExpiresAt;

  return (
    <div className={`text-xs px-3 py-2 rounded-lg space-y-1 ${style.bgColor}`}>
      <div className="flex items-center gap-2">
        {status === 'valid' ? (
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
        )}
        <span className={`font-semibold ${style.color}`}>{style.label}</span>
      </div>

      <div className="flex items-center gap-2 text-muted-foreground">
        <Calendar className="w-3.5 h-3.5 shrink-0" />
        {expiresAt ? (
          <span>
            {isTiktok ? 'Connexion valable jusqu\'au' : 'Expire le'}{' '}
            {format(new Date(expiresAt), 'd MMMM yyyy', { locale: fr })}
          </span>
        ) : page.autoRenew ? (
          <span>Sans expiration</span>
        ) : (
          <span>Échéance inconnue</span>
        )}
      </div>

      {page.autoRenew && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>Renouvellement automatique actif</span>
        </div>
      )}

      {page.tokenError && (
        <p className={`${style.color} leading-relaxed`} data-testid={`text-token-error-${page.id}`}>
          {page.tokenError}
        </p>
      )}

      {page.lastTokenCheck && (
        <p className="text-muted-foreground">
          Dernier contrôle : {format(new Date(page.lastTokenCheck), 'd MMM yyyy à HH:mm', { locale: fr })}
        </p>
      )}
    </div>
  );
}

/** Bandeau global : les pages qui réclament une reconnexion manuelle. */
export function TokenAlertBanner({ pages }: { pages: ClientSocialPage[] }) {
  const failing = pages.filter((page) => {
    const status = statusOf(page);
    return status === 'expired' || status === 'error' || status === 'expiring';
  });

  if (failing.length === 0) return null;

  return (
    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex gap-3">
      <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="text-sm space-y-1">
        <p className="font-semibold text-red-600 dark:text-red-400">
          {failing.length === 1
            ? 'Une page nécessite votre attention'
            : `${failing.length} pages nécessitent votre attention`}
        </p>
        {failing.map((page) => (
          <p key={page.id} className="text-muted-foreground">
            <strong>{page.pageName}</strong> — {STATUS_STYLES[statusOf(page)].label.toLowerCase()}
            {page.tokenError ? ` : ${page.tokenError}` : '.'}
          </p>
        ))}
      </div>
    </div>
  );
}
