import { useState } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/empty-state";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Music, Upload, Loader2, Play, Pause } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { handleUnauthorized } from "@/lib/queryClient";

interface AudioTrack {
    id: number;
    userId: number;
    title: string;
    url: string;
    duration: number | null;
    createdAt: string;
}

export default function AudioAdmin() {
    const [isUploading, setIsUploading] = useState(false);
    const [playingTrackId, setPlayingTrackId] = useState<number | null>(null);
    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
    const [trackToDelete, setTrackToDelete] = useState<AudioTrack | null>(null);

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: tracks = [], isLoading } = useQuery<AudioTrack[]>({
        queryKey: ["/api/audio-tracks"],
    });

    const uploadMutation = useMutation({
        mutationFn: async (files: File[]) => {
            const formData = new FormData();
            for (const file of files) {
                formData.append("files", file);
            }

            const res = await fetch("/api/audio-tracks", {
                method: "POST",
                body: formData,
                credentials: "include",
            });

            if (!res.ok) {
                if (res.status === 401) handleUnauthorized("/api/audio-tracks");
                const error = await res.json();
                throw new Error(error.error || "Erreur lors de l'upload");
            }

            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["/api/audio-tracks"] });
            const successCount = data.results?.filter((r: any) => r.success).length ?? 0;
            const failCount = data.results?.filter((r: any) => !r.success).length ?? 0;
            toast({
                title: "Import terminé",
                description: failCount > 0
                    ? `${successCount} fichier(s) ajouté(s), ${failCount} échec(s)`
                    : `${successCount} fichier(s) ajouté(s) à la bibliothèque`,
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Erreur",
                description: error.message,
                variant: "destructive",
            });
        },
        onSettled: () => {
            setIsUploading(false);
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/audio-tracks/${id}`, {
                method: "DELETE",
                credentials: "include",
            });

            if (!res.ok) {
                if (res.status === 401) handleUnauthorized(`/api/audio-tracks/${id}`);
                throw new Error("Erreur lors de la suppression");
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/audio-tracks"] });
            toast({
                title: "Succès",
                description: "La piste audio a été supprimée",
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Erreur",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const invalidFiles = files.filter(f => !f.type.startsWith("audio/"));
        if (invalidFiles.length > 0) {
            toast({
                title: "Format invalide",
                description: "Certains fichiers ne sont pas des fichiers audio (MP3, WAV, etc.)",
                variant: "destructive",
            });
            return;
        }

        setIsUploading(true);
        uploadMutation.mutate(files);

        // Reset input
        if (e.target) {
            e.target.value = "";
        }
    };

    const togglePlay = (track: AudioTrack) => {
        if (playingTrackId === track.id) {
            audioElement?.pause();
            setPlayingTrackId(null);
        } else {
            if (audioElement) {
                audioElement.pause();
            }

            const newAudio = new Audio(track.url);
            newAudio.play();

            newAudio.onended = () => {
                setPlayingTrackId(null);
            };

            setAudioElement(newAudio);
            setPlayingTrackId(track.id);
        }
    };

    return (
        <Page width="default">
            <input
                type="file"
                id="audio-upload"
                className="hidden"
                accept="audio/*"
                multiple
                onChange={handleFileUpload}
                disabled={isUploading}
            />
            <PageHeader
                icon={Music}
                title="Musiques"
                description="Les pistes proposées lors de la création d'un Reel."
                actions={
                    <Button asChild disabled={isUploading} className="cursor-pointer">
                        <label htmlFor="audio-upload">
                            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            {isUploading ? "Import en cours…" : "Importer des musiques"}
                        </label>
                    </Button>
                }
            />

            {isLoading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="skeleton h-[76px] rounded-xl" />
                    ))}
                </div>
            ) : tracks.length === 0 ? (
                <EmptyState
                    icon={Music}
                    title="Aucune musique"
                    description="Importez des fichiers audio (MP3, WAV…) pour les proposer dans vos Reels."
                    action={
                        <Button asChild className="cursor-pointer">
                            <label htmlFor="audio-upload">
                                <Upload className="h-4 w-4" /> Importer des musiques
                            </label>
                        </Button>
                    }
                />
            ) : (
                <>
                    <p className="mb-3 text-sm text-muted-foreground">{tracks.length} piste(s)</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {tracks.map((track) => {
                            const playing = playingTrackId === track.id;
                            return (
                                <div
                                    key={track.id}
                                    className={`flex items-center gap-3 rounded-xl border bg-card p-3 shadow-soft transition-colors ${playing ? "border-primary/50" : ""}`}
                                    data-testid={`track-${track.id}`}
                                >
                                    <Button
                                        variant={playing ? "default" : "secondary"}
                                        size="icon"
                                        className="h-11 w-11 shrink-0 rounded-full"
                                        onClick={() => togglePlay(track)}
                                        aria-label={playing ? "Pause" : "Écouter"}
                                    >
                                        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                    </Button>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium" title={track.title}>{track.title}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Ajoutée le {format(new Date(track.createdAt), "d MMM yyyy", { locale: fr })}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => setTrackToDelete(track)}
                                        disabled={deleteMutation.isPending}
                                        aria-label="Supprimer"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <AlertDialog open={!!trackToDelete} onOpenChange={(open) => !open && setTrackToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer cette musique ?</AlertDialogTitle>
                        <AlertDialogDescription>
                            « {trackToDelete?.title} » ne sera plus proposée dans les nouveaux Reels.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (trackToDelete) deleteMutation.mutate(trackToDelete.id);
                                setTrackToDelete(null);
                            }}
                        >
                            Supprimer
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Page>
    );
}
