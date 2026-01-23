import { useState, useCallback, useRef, useMemo } from "react";
import { CameraRecorder } from "@/components/camera-recorder";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Send, Sparkles, Video, Music, Type, Calendar,
    Upload, Camera, Play, Pause, Volume2,
    ChevronRight, Loader2, Check, RefreshCw, ChevronLeft,
    Menu
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import Sidebar from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage, Media } from "@shared/schema";
import { DateTimePicker } from "@/components/datetime-picker";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

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
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    const [showCamera, setShowCamera] = useState(false);

    // Détection iOS pour utiliser la caméra native (meilleure qualité + stabilisation)
    const isIOS = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }, []);

    // Handler pour le bouton caméra - iOS utilise l'input natif, Android utilise WebRTC
    const handleCameraButtonClick = useCallback(() => {
        if (isIOS) {
            cameraInputRef.current?.click();
        } else {
            setShowCamera(true);
        }
    }, [isIOS]);

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

    // État audio preview
    const [isPlaying, setIsPlaying] = useState<string | null>(null);
    const [musicOffset, setMusicOffset] = useState(0);
    const [stabilize, setStabilize] = useState(true); // Activé par défaut pour les Reels
    const [force1080p, setForce1080p] = useState(true); // Activé par défaut


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

    const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) uploadMutation.mutate(file);
    };

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
                        <Card className="bg-primary/5 border-primary/20">
                            <CardContent className="p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-medium flex items-center gap-2">
                                            <Sparkles className="w-4 h-4 text-primary" /> Stabilisation & Qualité 1080p
                                        </div>
                                        <div className="text-xs text-muted-foreground">Application automatique après capture</div>
                                    </div>
                                    <Switch
                                        checked={stabilize}
                                        onCheckedChange={(checked) => setStabilize(!!checked)}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-6 text-center ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted'}`}>
                            <input {...getInputProps()} />
                            <input ref={cameraInputRef} type="file" accept="video/*" capture="environment" onChange={handleCameraCapture} className="hidden" />

                            <div className="flex gap-2 justify-center mb-6">
                                <Button onClick={handleCameraButtonClick} variant="outline" size="lg" className="h-12">
                                    <Camera className="mr-2 h-5 w-5" /> {isIOS ? 'Filmer (Haute Qualité)' : 'Capturer'}
                                </Button>
                                <Button onClick={open} variant="outline" size="lg" className="h-12">
                                    <Upload className="mr-2 h-5 w-5" /> Galerie
                                </Button>
                            </div>

                            {/* CameraRecorder pour Android uniquement */}
                            {showCamera && !isIOS && (
                                <CameraRecorder
                                    onCapture={(file) => {
                                        uploadMutation.mutate(file);
                                        setShowCamera(false);
                                    }}
                                    onCancel={() => setShowCamera(false)}
                                />
                            )}


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
