import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Clapperboard, Loader2, CheckCircle2, XCircle } from "lucide-react";
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

interface OngoingReelsProps {
    /** Compact layout for mobile */
    compact?: boolean;
}

export default function OngoingReels({ compact = false }: OngoingReelsProps) {
    const { data: ongoingPosts = [] } = useQuery<OngoingReel[]>({
        queryKey: ["/api/reels/ongoing"],
        // Cette route ne renvoie que les générations en cours : tant qu'elle est
        // vide il n'y a pas de barre de progression à animer. On garde une veille
        // lente, qui suffit à détecter une génération lancée depuis un autre écran.
        refetchInterval: (query) =>
            (query.state.data ?? []).some((p) => p.generationStatus !== "failed") ? 3000 : 30000,
    });

    // Nothing to show — render nothing (not even a card)
    if (ongoingPosts.length === 0) {
        return null;
    }

    return (
        <Card
            className={`rounded-2xl border-border/50 shadow-lg ${compact ? "" : ""
                }`}
            data-testid="card-ongoing-reels"
        >
            <CardHeader className={compact ? "pb-2 px-4 pt-4" : ""}>
                <CardTitle className={`flex items-center gap-2 ${compact ? "text-base" : ""}`}>
                    {ongoingPosts.some((p) => p.generationStatus !== "failed") ? (
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    ) : (
                        <XCircle className="w-5 h-5 text-destructive" />
                    )}
                    Reels en cours
                </CardTitle>
            </CardHeader>
            <CardContent className={compact ? "px-4 pb-4 pt-0" : ""}>
                <div className={`space-y-${compact ? "3" : "4"}`}>
                    {ongoingPosts.map((post) => {
                        const progress = post.generationProgress ?? 0;
                        const isFailed = post.generationStatus === "failed";

                        return (
                            <div
                                key={post.id}
                                className={`flex items-start gap-3 p-${compact ? "3" : "4"} rounded-lg border border-border/50 bg-muted/30`}
                                data-testid={`ongoing-reel-${post.id}`}
                            >
                                {/* Icon */}
                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                                    <Clapperboard className="w-4 h-4 text-white" />
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <p className={`font-medium truncate ${compact ? "text-sm" : "text-sm"}`}>
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
                                        <div className="flex items-center gap-1.5 mt-2 text-green-500">
                                            <CheckCircle2 className="w-4 h-4" />
                                            <span className="text-xs font-medium">Terminé</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
