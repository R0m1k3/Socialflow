import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Clapperboard, Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getErrorMessage } from "@/lib/queryClient";
import type { Post } from "@shared/schema";

type OngoingReel = Post & { generationStep?: string | null };

/** Libellé de l'étape en cours, telle que rapportée par la file de rendu. */
const STEP_LABELS: Record<string, string> = {
    prepare: "Préparation…",
    voice: "Voix et préparation de la vidéo…",
    render: "Montage : sous-titres, logo, effets…",
    store: "Enregistrement dans la médiathèque…",
    publish: "Publication…",
};

function getStageLabel(post: OngoingReel): string {
    if (post.generationStatus === "pending") return "En attente : un autre Reel est en cours…";
    return (post.generationStep && STEP_LABELS[post.generationStep]) || "Démarrage du traitement…";
}

export default function OngoingReels() {
    const { data: ongoingPosts = [] } = useQuery<OngoingReel[]>({
        queryKey: ["/api/reels/ongoing"],
        // Cette route ne renvoie que les générations en cours : tant qu'elle est
        // vide il n'y a pas de barre de progression à animer. On garde une veille
        // lente, qui suffit à détecter une génération lancée depuis un autre écran.
        refetchInterval: (query) =>
            (query.state.data ?? []).some((p) => p.generationStatus !== "failed") ? 3000 : 30000,
    });

    const { toast } = useToast();

    // Un Reel en échec n'a rien à publier : le supprimer retire aussi la notification
    const dismissMutation = useMutation({
        mutationFn: async (postId: string) => (await apiRequest("DELETE", `/api/reels/${postId}`)).json(),
        onSuccess: (_data, postId) => {
            queryClient.setQueryData<OngoingReel[]>(["/api/reels/ongoing"], (posts) =>
                posts?.filter((p) => p.id !== postId),
            );
            queryClient.invalidateQueries({ queryKey: ["/api/reels/ongoing"] });
            queryClient.invalidateQueries({ queryKey: ["/api/scheduled-posts"] });
        },
        onError: (error: unknown) => {
            toast({
                title: "Erreur",
                description: getErrorMessage(error, "Impossible de supprimer la notification"),
                variant: "destructive",
            });
        },
    });

    // Nothing to show — render nothing (not even a card)
    if (ongoingPosts.length === 0) {
        return null;
    }

    return (
        <Card data-testid="card-ongoing-reels">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                    {ongoingPosts.some((p) => p.generationStatus !== "failed") ? (
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    ) : (
                        <XCircle className="w-5 h-5 text-destructive" />
                    )}
                    Reels en cours
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {ongoingPosts.map((post) => {
                        const progress = post.generationProgress ?? 0;
                        const isFailed = post.generationStatus === "failed";

                        return (
                            <div
                                key={post.id}
                                className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3"
                                data-testid={`ongoing-reel-${post.id}`}
                            >
                                {/* Icon */}
                                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                                    <Clapperboard className="w-4 h-4" />
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate text-sm">
                                        {post.content || "Reel sans texte"}
                                    </p>

                                    {isFailed ? (
                                        <div className="flex items-center gap-1.5 mt-2 text-destructive">
                                            <XCircle className="w-4 h-4" />
                                            <span className="text-xs break-words">
                                                Échec : {post.generationError || "erreur lors du traitement"}
                                            </span>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="mt-2">
                                                <Progress
                                                    value={progress}
                                                    className="h-2"
                                                />
                                            </div>
                                            <div className="flex items-center justify-between mt-1.5">
                                                <span className="text-xs text-muted-foreground">
                                                    {getStageLabel(post)}
                                                </span>
                                                <span className="text-xs font-medium text-primary">
                                                    {progress}%
                                                </span>
                                            </div>
                                        </>
                                    )}

                                    {progress >= 100 && !isFailed && (
                                        <div className="flex items-center gap-1.5 mt-2 text-success">
                                            <CheckCircle2 className="w-4 h-4" />
                                            <span className="text-xs font-medium">Terminé</span>
                                        </div>
                                    )}
                                </div>

                                {isFailed && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
                                        onClick={() => dismissMutation.mutate(post.id)}
                                        disabled={dismissMutation.isPending && dismissMutation.variables === post.id}
                                        title="Supprimer"
                                        aria-label="Supprimer ce Reel en échec"
                                        data-testid={`button-dismiss-reel-${post.id}`}
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
