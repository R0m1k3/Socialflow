import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Send, Sparkles, Video, Music, Type, Calendar,
    Upload, Play, Pause, Volume2,
    ChevronRight, Loader2, Check, RefreshCw, ChevronLeft,
    Menu, Mic
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import Sidebar from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage, Media } from "@shared/schema";
import { DateTimePicker } from "@/components/datetime-picker";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MusicTrack {
    id: string;
    title: string;
    artist: string;
    albumName: string;
    duration: number;
    previewUrl: string;
    downloadUrl: string;
    imageUrl: string;
    license: string;
}

type Step = 'video' | 'music' | 'text' | 'publish';

export default function MobileNewReel() {
    const [, navigate] = useLocation();
    const { toast } = useToast();
    const audioRef = useRef<HTMLAudioElement>(null);

    // État du workflow
    const [currentStep, setCurrentStep] = useState<Step>('video');

    // État des données
    const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
    const [selectedVideo, setSelectedVideo] = useState<Media | null>(null);
    const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);
    const [overlayText, setOverlayText] = useState('');
    const [productInfo, setProductInfo] = useState('');
    const [generatedVariants, setGeneratedVariants] = useState<any[]>([]);
    const [selectedPages, setSelectedPages] = useState<string[]>([]);
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
    const [musicVolume, setMusicVolume] = useState([25]);

    // État TTS
    const [ttsEnabled, setTtsEnabled] = useState(false);
    const [ttsVoice, setTtsVoice] = useState("fr-FR-VivienneMultilingualNeural");

    // État audio preview
    const [isPlaying, setIsPlaying] = useState<string | null>(null);
    const [musicOffset, setMusicOffset] = useState(0);
    const [stabilize, setStabilize] = useState(true); // Activé par défaut pour les Reels


    const { data: pages = [] } = useQuery<SocialPage[]>({
        queryKey: ['/api/pages'],
    });

    const { data: allMedia = [] } = useQuery<Media[]>({
        queryKey: ['/api/media'],
    });

    const videoList = allMedia.filter(m => m.type === 'video').slice(0, 12);
    const [loadedTracks, setLoadedTracks] = useState<MusicTrack[]>([]);

    const { data: musicData, isLoading: musicLoading, refetch: refetchMusic } = useQuery<{ tracks: MusicTrack[] }>({
        queryKey: ['/api/music/search', selectedVideo?.id, musicOffset],
        queryFn: async () => {
            const minDuration = 10;
            const maxDuration = 120;
            const response = await fetch(
                `/api/music/search?minDuration=${minDuration}&maxDuration=${maxDuration}&limit=10&offset=${musicOffset}`
            );
            const data = await response.json();
            setLoadedTracks(data.tracks || []);
            return data;
        },
        enabled: currentStep === 'music' && !!selectedVideo,
    });

    const handleLoadNewMusic = () => {
        setMusicOffset(prev => prev + 10);
        refetchMusic();
    };

    const uploadMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/media/upload", {
                method: "POST",
                body: formData,
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText.substring(0, 100)}`);
            }
            return response.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["/api/media"] });
            setSelectedVideoId(data.id);
            setSelectedVideo(data);
            toast({ title: "Succès", description: "Vidéo téléchargée" });
        },
        onError: (error) => {
            console.error("Upload error details:", error);
            toast({
                title: "Erreur Upload",
                description: error.message || "Échec inattendu",
                variant: "destructive",
                duration: 5000
            });
        },
    });

    const generateTextMutation = useMutation({
        mutationFn: async (productInfoText: string) => {
            const response = await apiRequest('POST', '/api/reels/generate-text', {
                productInfo: productInfoText,
            });
            return response.json();
        },
        onSuccess: (data: any) => {
            setGeneratedVariants(data.variants || []);
            toast({ title: "Généré", description: "Variations créées" });
        },
    });

    const createReelMutation = useMutation({
        mutationFn: async (data: any) => {
            const response = await apiRequest('POST', '/api/reels', data);
            return response.json();
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'], refetchType: 'all' });
            toast({
                title: data.success ? "Reel créé !" : "Attention",
                description: data.success ? "Publication réussie" : "Certaines erreurs",
            });
            navigate('/');
        },
        onError: (error: any) => {
            toast({ title: "Erreur", description: error.message, variant: "destructive" });
        },
    });

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0 && acceptedFiles[0].type.startsWith('video/')) {
            uploadMutation.mutate(acceptedFiles[0]);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
        onDrop,
        accept: { "video/*": [".mp4", ".mov", ".webm"] },
        noClick: true,
        noKeyboard: true,
    });



    const togglePlayPreview = async (track: MusicTrack) => {
        if (isPlaying === track.id) {
            audioRef.current?.pause();
            setIsPlaying(null);
        } else {
            if (audioRef.current) {
                audioRef.current.src = track.previewUrl;
                try {
                    await audioRef.current.play();
                    setIsPlaying(track.id);
                } catch {
                    setIsPlaying(null);
                }
            }
        }
    };

    const handleCreateReel = () => {
        if (!selectedVideoId || selectedPages.length === 0) {
            toast({ title: "Erreur", description: "Vidéo et page requises", variant: "destructive" });
            return;
        }
        createReelMutation.mutate({
            videoMediaId: selectedVideoId,
            musicTrackId: selectedTrack?.id,
            overlayText: overlayText,
            description: overlayText,
            pageIds: selectedPages,
            scheduledFor: scheduledDate?.toISOString(),
            musicVolume: musicVolume[0] / 100,
            stabilize: stabilize,
            drawText: true,
            ttsEnabled,
            ttsVoice,
        });
    };

    const steps: Step[] = ['video', 'music', 'text', 'publish'];
    const currentStepIndex = steps.indexOf(currentStep);

    const goNext = () => {
        if (currentStepIndex < steps.length - 1) setCurrentStep(steps[currentStepIndex + 1]);
    };

    const goBack = () => {
        if (currentStepIndex > 0) setCurrentStep(steps[currentStepIndex - 1]);
    };

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* Header Mobile */}
            <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="-ml-2">
                                <Menu className="h-6 w-6" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-0 w-[80%]">
                            <Sidebar />
                        </SheetContent>
                    </Sheet>
                    <h1 className="font-semibold text-lg">Nouveau Reel</h1>
                </div>
                <div className="text-sm text-muted-foreground font-medium">
                    {currentStepIndex + 1}/{steps.length}
                </div>
            </div>

            <main className="p-4 space-y-6">
                {/* VIDEO STEP */}
                {currentStep === 'video' && (
                    <div className="space-y-4">

                        <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-6 text-center ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted'}`}>
                            <input {...getInputProps()} />

                            <div className="flex justify-center mb-6">
                                <Button onClick={open} variant="outline" size="lg" className="h-12">
                                    <Upload className="mr-2 h-5 w-5" /> Galerie
                                </Button>
                            </div>


                            {selectedVideo ? (
                                <div className="relative rounded-lg overflow-hidden aspect-[9/16] bg-black max-h-[50vh] mx-auto shadow-lg">
                                    <video src={selectedVideo.originalUrl} className="w-full h-full object-contain" controls />
                                    <div className="absolute top-2 right-2 bg-primary text-white text-xs px-2 py-1 rounded-full flex items-center shadow-sm">
                                        <Check className="w-3 h-3 mr-1" /> Sélectionné
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3 mt-4">
                                    {videoList.map((media) => (
                                        <div key={media.id} onClick={() => setSelectedVideoId(media.id) || setSelectedVideo(media)} className={`relative aspect-[9/16] bg-black rounded-lg overflow-hidden border-2 transition-all ${selectedVideoId === media.id ? 'border-primary' : 'border-transparent'}`}>
                                            <video src={media.originalUrl} className="w-full h-full object-cover" muted />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <Card className="bg-primary/5 border-primary/20">
                            <CardContent className="p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-medium flex items-center gap-2">
                                            <Sparkles className="w-4 h-4 text-primary" /> Stabilisation Vidéo (Anti-tremblements)
                                        </div>
                                        <div className="text-xs text-muted-foreground">Corrige les secousses (Recommandé main levée). Désactiver sur trépied.</div>
                                    </div>
                                    <Switch
                                        checked={stabilize}
                                        onCheckedChange={(checked) => setStabilize(!!checked)}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {selectedVideo && (
                            <Button className="w-full h-12 text-lg sticky bottom-4 shadow-xl" onClick={goNext}>
                                Suivant <ChevronRight className="ml-2 w-5 h-5" />
                            </Button>
                        )}
                    </div>
                )}

                {/* MUSIC STEP */}
                {currentStep === 'music' && (
                    <div className="space-y-4">
                        <audio ref={audioRef} onEnded={() => setIsPlaying(null)} />

                        {selectedVideo && (
                            <div className="aspect-video bg-black rounded-lg overflow-hidden h-32 mx-auto">
                                <video src={selectedVideo.originalUrl} className="w-full h-full object-cover opacity-50" muted />
                            </div>
                        )}

                        <div className="space-y-2">
                            {musicData?.tracks?.map((track) => (
                                <div key={track.id} onClick={() => setSelectedTrack(track)} className={`flex items-center gap-3 p-3 rounded-xl border ${selectedTrack?.id === track.id ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
                                    <Button size="icon" variant="ghost" className="h-10 w-10 rounded-full bg-primary/10" onClick={(e) => { e.stopPropagation(); togglePlayPreview(track); }}>
                                        {isPlaying === track.id ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                                    </Button>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{track.title}</p>
                                        <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                                    </div>
                                    {selectedTrack?.id === track.id && <Check className="h-5 w-5 text-primary" />}
                                </div>
                            ))}
                        </div>

                        {selectedTrack && (
                            <div className="bg-card p-4 rounded-xl border mt-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Volume2 className="w-4 h-4 text-primary" />
                                    <span className="text-sm font-medium">Volume: {musicVolume[0]}%</span>
                                </div>
                                <Slider value={musicVolume} onValueChange={setMusicVolume} max={100} step={5} />
                            </div>
                        )}

                        <div className="flex gap-3 sticky bottom-4">
                            <Button variant="outline" onClick={goBack} className="flex-1 h-12">Retour</Button>
                            <Button onClick={goNext} className="flex-1 h-12">Suivant</Button>
                        </div>
                    </div>
                )}

                {/* TEXT STEP */}
                {currentStep === 'text' && (
                    <div className="space-y-6">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center"><Sparkles className="w-4 h-4 mr-2 text-primary" /> Assistant IA</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    placeholder="Décrivez le produit..."
                                    value={productInfo}
                                    onChange={(e) => setProductInfo(e.target.value)}
                                    className="mb-3"
                                />
                                <Button onClick={() => generateTextMutation.mutate(productInfo)} disabled={generateTextMutation.isPending} className="w-full" variant="secondary">
                                    {generateTextMutation.isPending ? <Loader2 className="animate-spin mr-2" /> : <Sparkles className="mr-2 w-4 h-4" />}
                                    Générer
                                </Button>
                            </CardContent>
                        </Card>

                        {generatedVariants.length > 0 && (
                            <div className="space-y-3">
                                {generatedVariants.map((v, i) => (
                                    <div key={i} className="bg-card p-3 rounded-lg border text-sm" onClick={() => { setOverlayText(v.text); toast({ title: "Texte appliqué" }); }}>
                                        {v.text}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Texte Overlay</label>
                            <Textarea
                                value={overlayText}
                                onChange={(e) => setOverlayText(e.target.value)}
                                placeholder="Texte sur la vidéo..."
                                className="text-lg"
                                rows={3}
                            />
                            <div className="flex items-center space-x-2 mt-4">
                                <Switch
                                    id="tts-mode"
                                    checked={ttsEnabled}
                                    onCheckedChange={setTtsEnabled}
                                />
                                <Label htmlFor="tts-mode" className="font-medium cursor-pointer">
                                    Activer la lecture voix (TTS)
                                </Label>
                            </div>

                            {ttsEnabled && (
                                <div className="mt-4 space-y-2 ml-1 p-3 bg-muted/30 rounded-lg border border-border/50">
                                    <Label className="flex items-center gap-2 mb-2">
                                        <Mic className="w-4 h-4" />
                                        Voix du narrateur
                                    </Label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne", type: "Femme", style: "bg-pink-500/10 border-pink-500/50" },
                                            { id: "fr-FR-RemyMultilingualNeural", label: "Rémy", type: "Homme", style: "bg-blue-500/10 border-blue-500/50" },
                                            { id: "fr-FR-DeniseNeural", label: "Denise", type: "Femme", style: "bg-purple-500/10 border-purple-500/50" },
                                            { id: "fr-FR-HenriNeural", label: "Henri", type: "Homme", style: "bg-slate-500/10 border-slate-500/50" },
                                            { id: "fr-FR-EloiseNeural", label: "Éloïse", type: "Enfant", style: "bg-orange-500/10 border-orange-500/50" }
                                        ].map((voice) => (
                                            <div
                                                key={voice.id}
                                                onClick={() => setTtsVoice(voice.id)}
                                                className={`cursor-pointer p-3 rounded-md border-2 transition-all hover:bg-accent ${ttsVoice === voice.id || (ttsVoice === 'female' && voice.id === 'fr-FR-VivienneMultilingualNeural')
                                                    ? `border-primary ${voice.style}`
                                                    : 'border-transparent bg-muted/30'
                                                    }`}
                                            >
                                                <div className="font-semibold flex items-center justify-between text-sm">
                                                    {voice.label}
                                                    {(ttsVoice === voice.id || (ttsVoice === 'female' && voice.id === 'fr-FR-VivienneMultilingualNeural')) && <Check className="w-3 h-3 text-primary" />}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground">{voice.type}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-3">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className="w-full h-8 text-xs"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                const textToTest = overlayText || "Ceci est un test de voix.";
                                                try {
                                                    const response = await apiRequest('POST', '/api/reels/tts-preview', {
                                                        text: textToTest,
                                                        voice: ttsVoice
                                                    });
                                                    const data = await response.json();
                                                    if (data.success && data.audioBase64) {
                                                        const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`);
                                                        audio.play();
                                                    }
                                                } catch (err) {
                                                    toast({ title: "Erreur", description: "Impossible de lire la voix", variant: "destructive" });
                                                }
                                            }}
                                        >
                                            <Play className="w-3 h-3 mr-1" /> Tester la voix
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 sticky bottom-4">
                            <Button variant="outline" onClick={goBack} className="flex-1 h-12">Retour</Button>
                            <Button onClick={goNext} className="flex-1 h-12">Suivant</Button>
                        </div>
                    </div>
                )}

                {/* PUBLISH STEP */}
                {currentStep === 'publish' && (
                    <div className="space-y-6">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Diffusion</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {pages.filter(p => p.platform === 'facebook').map((page) => (
                                    <div key={page.id} className="flex items-center space-x-3 bg-secondary/20 p-3 rounded-lg">
                                        <Checkbox
                                            id={page.id}
                                            checked={selectedPages.includes(page.id)}
                                            onCheckedChange={(checked) => {
                                                if (checked) setSelectedPages([...selectedPages, page.id]);
                                                else setSelectedPages(selectedPages.filter(id => id !== page.id));
                                            }}
                                        />
                                        <label htmlFor={page.id} className="font-medium flex-1">{page.pageName}</label>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center"><Calendar className="mr-2 w-4 h-4" /> Planification</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <DateTimePicker value={scheduledDate} onChange={setScheduledDate} placeholder="Maintenant" />
                            </CardContent>
                        </Card>

                        <div className="flex gap-3 sticky bottom-4 pb-4 bg-background">
                            <Button variant="outline" onClick={goBack} className="flex-1 h-12">Retour</Button>
                            <Button
                                onClick={handleCreateReel}
                                disabled={createReelMutation.isPending}
                                className="flex-[2] h-12 bg-primary text-primary-foreground font-bold shadow-lg"
                            >
                                {createReelMutation.isPending ? <Loader2 className="animate-spin mr-2" /> : <Send className="mr-2 w-5 h-5" />}
                                {scheduledDate ? 'Programmer' : 'Publier'}
                            </Button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
