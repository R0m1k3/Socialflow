import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Music, Upload, Loader2, Play, Pause } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface AudioTrack {
    id: number;
    userId: number;
    title: string;
    url: string;
    duration: number | null;
    createdAt: string;
}

export default function AudioAdmin() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [playingTrackId, setPlayingTrackId] = useState<number | null>(null);
    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

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
            });

            if (!res.ok) {
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
                title: "Upload terminé",
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
            });

            if (!res.ok) {
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
        <div className="flex h-screen overflow-hidden bg-background">
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <div className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
                <Sidebar onLinkClick={() => setSidebarOpen(false)} />
            </div>

            <main className="flex-1 overflow-y-auto w-full">
                <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

                <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <h1 className="text-3xl font-bold flex items-center gap-3">
                                <Music className="w-8 h-8 text-primary" />
                                Bibliothèque Audio
                            </h1>
                            <p className="text-muted-foreground mt-2">
                                Gérez les musiques disponibles pour la création de Reels
                            </p>
                        </div>

                        <div>
                            <input
                                type="file"
                                id="audio-upload"
                                className="hidden"
                                accept="audio/*"
                                multiple
                                onChange={handleFileUpload}
                                disabled={isUploading}
                            />
                            <label htmlFor="audio-upload">
                                <Button
                                    asChild
                                    disabled={isUploading}
                                    className="cursor-pointer"
                                >
                                    <span>
                                        {isUploading ? (
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        ) : (
                                            <Upload className="w-4 h-4 mr-2" />
                                        )}
                                        {isUploading ? "Upload en cours..." : "Ajouter un fichier audio"}
                                    </span>
                                </Button>
                            </label>
                        </div>
                    </div>

                    <Card className="border-border/50 shadow-sm">
                        <CardHeader>
                            <CardTitle>Musiques ({tracks.length})</CardTitle>
                            <CardDescription>
                                Ces pistes pourront être sélectionnées par les utilisateurs lors de la création d'un nouveau Reel.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="flex justify-center p-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                </div>
                            ) : tracks.length === 0 ? (
                                <div className="text-center p-12 border-2 border-dashed border-border rounded-xl">
                                    <Music className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                                    <h3 className="text-lg font-medium mb-1">Aucune musique</h3>
                                    <p className="text-muted-foreground">
                                        Vous n'avez pas encore ajouté de piste audio. Les musiques ajoutées ici seront utilisables pour les Reels.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {tracks.map((track) => (
                                        <div
                                            key={track.id}
                                            className="bg-card border border-border/50 rounded-xl p-4 flex flex-col gap-4 hover:border-primary/30 transition-colors shadow-sm"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="p-3 bg-primary/10 rounded-lg shrink-0">
                                                    <Music className="w-6 h-6 text-primary" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-sm truncate" title={track.title}>{track.title}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        {format(new Date(track.createdAt), "dd MMM yyyy", { locale: fr })}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between pt-2 border-t border-border/50">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className={playingTrackId === track.id ? "text-primary bg-primary/10" : ""}
                                                    onClick={() => togglePlay(track)}
                                                >
                                                    {playingTrackId === track.id ? (
                                                        <><Pause className="w-4 h-4 mr-2" /> Pause</>
                                                    ) : (
                                                        <><Play className="w-4 h-4 mr-2" /> Écouter</>
                                                    )}
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => {
                                                        if (confirm("Voulez-vous vraiment supprimer cette musique ?")) {
                                                            deleteMutation.mutate(track.id);
                                                        }
                                                    }}
                                                    disabled={deleteMutation.isPending}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
