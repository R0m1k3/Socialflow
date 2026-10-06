import { useState, useCallback } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CalendarClock, Upload, Loader2, Check, Video } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { StoryToggle } from "@/components/reels/story-toggle";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, handleUnauthorized, getErrorMessage } from "@/lib/queryClient";
import type { SocialPage, Media } from "@shared/schema";
import { SiFacebook, SiTiktok } from "react-icons/si";
import { MediaThumbnail } from "@/components/media-thumbnail";
import { DateTimePicker } from "@/components/datetime-picker";

/**
 * Programmation d'un Reel déjà monté : pas de rendu, la vidéo envoyée est
 * publiée telle quelle par le planificateur à la date choisie.
 */
export default function ScheduleReel() {
    const [, navigate] = useLocation();
    const { toast } = useToast();

    const [selectedVideo, setSelectedVideo] = useState<Media | null>(null);
    const [description, setDescription] = useState("");
    const [selectedPages, setSelectedPages] = useState<string[]>([]);
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
    const [alsoStory, setAlsoStory] = useState(false);

    const { data: pages = [] } = useQuery<SocialPage[]>({ queryKey: ["/api/pages"] });
    const { data: allMedia = [] } = useQuery<Media[]>({ queryKey: ["/api/media"] });

    // Destinations acceptant un Reel
    const facebookPages = pages.filter((p) => p.platform === "facebook");
    const tiktokAccounts = pages.filter((p) => p.platform === "tiktok");
    const videoList = allMedia.filter((m) => m.type === "video").slice(0, 12);

    const uploadMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/media/upload", {
                method: "POST",
                body: formData,
                credentials: "include",
            });
            if (!response.ok) {
                if (response.status === 401) handleUnauthorized("/api/media/upload");
                throw new Error("Upload failed");
            }
            return response.json() as Promise<Media>;
        },
        onSuccess: (media) => {
            queryClient.invalidateQueries({ queryKey: ["/api/media"] });
            setSelectedVideo(media);
            toast({ title: "Vidéo envoyée", description: media.fileName });
        },
        onError: () => {
            toast({ title: "Erreur", description: "Impossible d'envoyer la vidéo", variant: "destructive" });
        },
    });

    const onDrop = useCallback((files: File[]) => {
        if (files[0]) uploadMutation.mutate(files[0]);
    }, [uploadMutation]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { "video/*": [".mp4", ".mov", ".webm"] },
        maxFiles: 1,
        disabled: uploadMutation.isPending,
    });

    const scheduleMutation = useMutation({
        mutationFn: async () => {
            const response = await apiRequest("POST", "/api/posts", {
                content: description,
                postType: "reel",
                mediaIds: [selectedVideo!.id],
                pageIds: selectedPages,
                scheduledFor: scheduledDate!.toISOString(),
                alsoStory,
            });
            return response.json();
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["/api/scheduled-posts"], refetchType: "all" });
            await queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
            toast({ title: "Reel programmé", description: "Il sera publié à la date choisie." });
            navigate("/calendar");
        },
        onError: (error: unknown) => {
            toast({
                title: "Erreur",
                description: getErrorMessage(error, "Impossible de programmer le Reel"),
                variant: "destructive",
            });
        },
    });

    const isPast = !!scheduledDate && scheduledDate.getTime() <= Date.now();
    const canSchedule = !!selectedVideo && selectedPages.length > 0 && !!scheduledDate && !isPast;

    const togglePage = (id: string, checked: boolean) => {
        setSelectedPages((prev) => (checked ? [...prev, id] : prev.filter((p) => p !== id)));
    };

    const renderTargetCheckbox = (page: SocialPage) => (
        <div key={page.id} className="flex items-center space-x-2">
            <Checkbox
                id={`schedule-reel-page-${page.id}`}
                checked={selectedPages.includes(page.id)}
                onCheckedChange={(checked) => togglePage(page.id, checked === true)}
            />
            <label htmlFor={`schedule-reel-page-${page.id}`} className="text-sm font-medium leading-none flex-1">
                {page.pageName}
            </label>
        </div>
    );

    return (
        <Page width="narrow" className="space-y-6">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
                            <CalendarClock className="w-8 h-8 text-primary" />
                            Programmer un Reel
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Publiez une vidéo déjà montée, telle quelle, à la date et l'heure choisies
                        </p>
                    </div>

                    {/* 1. Vidéo */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Video className="w-5 h-5" /> Vidéo
                            </CardTitle>
                            <CardDescription>Format vertical 9:16 recommandé</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div
                                {...getRootProps()}
                                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                                    isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                                }`}
                                data-testid="dropzone-schedule-reel"
                            >
                                <input {...getInputProps()} />
                                {uploadMutation.isPending ? (
                                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                        <Loader2 className="w-5 h-5 animate-spin" /> Envoi en cours...
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                                        <p className="font-medium">Déposez votre Reel ici ou cliquez pour choisir</p>
                                        <p className="text-xs text-muted-foreground">MP4, MOV ou WebM</p>
                                    </div>
                                )}
                            </div>

                            {videoList.length > 0 && (
                                <div className="space-y-2">
                                    <Label>Ou choisissez une vidéo de la médiathèque</Label>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                                        {videoList.map((media) => {
                                            const selected = selectedVideo?.id === media.id;
                                            return (
                                                <button
                                                    key={media.id}
                                                    type="button"
                                                    onClick={() => setSelectedVideo(media)}
                                                    className={`relative aspect-[9/16] rounded-lg overflow-hidden border-2 ${
                                                        selected ? "border-primary" : "border-transparent"
                                                    }`}
                                                >
                                                    <MediaThumbnail
                                                        src={media.originalUrl}
                                                        alt={media.fileName}
                                                        thumbnailUrl={media.thumbnailUrl ?? undefined}
                                                        type="video"
                                                    />
                                                    {selected && (
                                                        <div className="absolute inset-0 bg-primary/30 flex items-center justify-center">
                                                            <Check className="w-6 h-6 text-white" />
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {selectedVideo && (
                                <p className="text-sm text-muted-foreground">
                                    Sélectionnée : <span className="font-medium text-foreground">{selectedVideo.fileName}</span>
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* 2. Description */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Description</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Texte publié avec le Reel (optionnel)"
                                rows={4}
                                data-testid="textarea-schedule-reel-description"
                            />
                        </CardContent>
                    </Card>

                    {/* 3. Destinations et date */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Publication</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {facebookPages.length === 0 && tiktokAccounts.length === 0 && (
                                <p className="text-sm text-muted-foreground">Aucune page Facebook ou compte TikTok connecté.</p>
                            )}
                            {facebookPages.length > 0 && (
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2">
                                        <SiFacebook className="w-4 h-4 text-[#1877F2]" /> Pages Facebook
                                    </Label>
                                    {facebookPages.map(renderTargetCheckbox)}
                                    <StoryToggle checked={alsoStory} onCheckedChange={setAlsoStory} />
                                </div>
                            )}
                            {tiktokAccounts.length > 0 && (
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2">
                                        <SiTiktok className="w-4 h-4" /> Comptes TikTok
                                    </Label>
                                    {tiktokAccounts.map(renderTargetCheckbox)}
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label>Date et heure de parution</Label>
                                <DateTimePicker
                                    value={scheduledDate}
                                    onChange={setScheduledDate}
                                    placeholder="Choisir la date et l'heure"
                                />
                                {isPast && (
                                    <p className="text-sm text-destructive">La date doit être dans le futur.</p>
                                )}
                            </div>

                            <Button
                                className="w-full"
                                size="lg"
                                disabled={!canSchedule || scheduleMutation.isPending}
                                onClick={() => scheduleMutation.mutate()}
                                data-testid="button-schedule-reel"
                            >
                                {scheduleMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                    <CalendarClock className="w-4 h-4 mr-2" />
                                )}
                                Programmer le Reel
                            </Button>
                        </CardContent>
                    </Card>
                </Page>
    );
}
