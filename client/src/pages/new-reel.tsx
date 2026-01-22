import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Send, Sparkles, Video, Music, Type, Calendar,
    Upload, Camera, Play, Pause, Volume2, VolumeX,
    ChevronRight, Loader2, Check
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage, Media } from "@shared/schema";
import { DateTimePicker } from "@/components/datetime-picker";

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

// Étapes du workflow
type Step = 'video' | 'music' | 'text' | 'publish';

export default function NewReel() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [, navigate] = useLocation();
    const { toast } = useToast();
    const cameraInputRef = useRef<HTMLInputElement>(null);
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

    // État audio preview
    const [isPlaying, setIsPlaying] = useState<string | null>(null);
    const [musicOffset, setMusicOffset] = useState(0);

    // Récupérer les pages disponibles
    const { data: pages = [] } = useQuery<SocialPage[]>({
        queryKey: ['/api/pages'],
    });

    // Récupérer les vidéos disponibles
    const { data: allMedia = [] } = useQuery<Media[]>({
        queryKey: ['/api/media'],
    });

    const videoList = allMedia.filter(m => m.type === 'video').slice(0, 12);

    // Recherche de musiques par durée
    const { data: musicData, isLoading: musicLoading } = useQuery<{ tracks: MusicTrack[] }>({
        queryKey: ['/api/music/search', selectedVideo?.id],
        queryFn: async () => {
            // Estimer la durée vidéo (on prend une marge de ±10 secondes)
            const minDuration = 10;
            const maxDuration = 120; // On prend toutes les musiques courtes
            const response = await fetch(
                `/api/music/search?minDuration=${minDuration}&maxDuration=${maxDuration}&limit=10`
            );
            return response.json();
        },
        enabled: currentStep === 'music' && !!selectedVideo,
    });

    // Mutation pour voir plus de musiques
    const loadMoreMusicMutation = useMutation({
        mutationFn: async (offset: number) => {
            const response = await fetch(
                `/api/music/more?minDuration=10&maxDuration=120&limit=10&offset=${offset}`
            );
            return response.json();
        },
        onSuccess: (data) => {
            setMusicOffset(prev => prev + 10);
            // Vous pourriez ajouter les nouveaux tracks à une liste
        },
    });

    // Upload vidéo
    const uploadMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/media/upload", {
                method: "POST",
                body: formData,
            });
            if (!response.ok) throw new Error("Upload failed");
            return response.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["/api/media"] });
            setSelectedVideoId(data.id);
            setSelectedVideo(data);
            toast({
                title: "Succès",
                description: "Vidéo téléchargée avec succès",
            });
        },
        onError: () => {
            toast({
                title: "Erreur",
                description: "Impossible de télécharger la vidéo",
                variant: "destructive",
            });
        },
    });

    // Génération de texte IA
    const generateTextMutation = useMutation({
        mutationFn: async (productInfoText: string) => {
            const response = await apiRequest('POST', '/api/reels/generate-text', {
                productInfo: productInfoText,
            });
            return response.json();
        },
        onSuccess: (data: any) => {
            const variants = data.variants || [];
            setGeneratedVariants(variants);
            toast({
                title: "Texte généré",
                description: `${variants.length} variations créées`,
            });
        },
        onError: () => {
            toast({
                title: "Erreur",
                description: "Impossible de générer le texte",
                variant: "destructive",
            });
        },
    });

    // Création du Reel
    const createReelMutation = useMutation({
        mutationFn: async (data: any) => {
            const response = await apiRequest('POST', '/api/reels', data);
            return response.json();
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'], refetchType: 'all' });
            toast({
                title: data.success ? "Reel créé !" : "Reel créé avec avertissements",
                description: data.success
                    ? "Votre Reel a été publié avec succès"
                    : "Certaines pages ont échoué",
            });
            navigate('/');
        },
        onError: (error: any) => {
            toast({
                title: "Erreur",
                description: error.message || "Impossible de créer le Reel",
                variant: "destructive",
            });
        },
    });

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            if (file.type.startsWith('video/')) {
                uploadMutation.mutate(file);
            } else {
                toast({
                    title: "Format invalide",
                    description: "Veuillez sélectionner un fichier vidéo",
                    variant: "destructive",
                });
            }
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
        onDrop,
        accept: {
            "video/*": [".mp4", ".mov", ".webm", ".3gp", ".3gpp", ".mkv", ".avi"],
        },
        maxSize: 52428800,
        noClick: true,
        noKeyboard: true,
    });

    const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            uploadMutation.mutate(file);
            e.target.value = '';
        }
    };

    const handleSelectVideo = (media: Media) => {
        setSelectedVideoId(media.id);
        setSelectedVideo(media);
        setCurrentStep('music');
    };

    const handleSelectTrack = (track: MusicTrack) => {
        setSelectedTrack(track);
        // Arrêter la preview si en cours
        if (audioRef.current) {
            audioRef.current.pause();
        }
        setIsPlaying(null);
    };

    const togglePlayPreview = (track: MusicTrack) => {
        if (isPlaying === track.id) {
            audioRef.current?.pause();
            setIsPlaying(null);
        } else {
            if (audioRef.current) {
                audioRef.current.src = track.previewUrl;
                audioRef.current.play();
                setIsPlaying(track.id);
            }
        }
    };

    const handleGenerateText = () => {
        if (!productInfo.trim()) {
            toast({
                title: "Information manquante",
                description: "Veuillez saisir les informations du produit",
                variant: "destructive",
            });
            return;
        }
        generateTextMutation.mutate(productInfo);
    };

    const handleUseVariant = (text: string) => {
        setOverlayText(text);
        toast({
            title: "Texte sélectionné",
            description: "Le texte a été ajouté à votre Reel",
        });
    };

    const handleCreateReel = () => {
        if (!selectedVideoId) {
            toast({
                title: "Vidéo requise",
                description: "Veuillez sélectionner une vidéo",
                variant: "destructive",
            });
            return;
        }

        if (selectedPages.length === 0) {
            toast({
                title: "Page requise",
                description: "Veuillez sélectionner au moins une page",
                variant: "destructive",
            });
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
        });
    };

    const canProceedToMusic = !!selectedVideo;
    const canProceedToText = canProceedToMusic; // Musique optionnelle
    const canProceedToPublish = canProceedToText;
    const canPublish = selectedPages.length > 0 && !!selectedVideo;

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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

            <main className="flex-1 overflow-y-auto">
                <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

                <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                            <Video className="w-8 h-8 text-primary" />
                            Créer un Reel
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Créez un Reel Facebook avec musique et texte overlay
                        </p>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center justify-between mb-8 px-4">
                        {(['video', 'music', 'text', 'publish'] as Step[]).map((step, index) => (
                            <div key={step} className="flex items-center">
                                <button
                                    onClick={() => {
                                        if (step === 'video') setCurrentStep(step);
                                        else if (step === 'music' && canProceedToMusic) setCurrentStep(step);
                                        else if (step === 'text' && canProceedToText) setCurrentStep(step);
                                        else if (step === 'publish' && canProceedToPublish) setCurrentStep(step);
                                    }}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${currentStep === step
                                        ? 'bg-primary text-primary-foreground'
                                        : step === 'video' ||
                                            (step === 'music' && canProceedToMusic) ||
                                            (step === 'text' && canProceedToText) ||
                                            (step === 'publish' && canProceedToPublish)
                                            ? 'bg-muted hover:bg-accent cursor-pointer'
                                            : 'bg-muted/50 text-muted-foreground cursor-not-allowed'
                                        }`}
                                >
                                    {step === 'video' && <Video className="w-4 h-4" />}
                                    {step === 'music' && <Music className="w-4 h-4" />}
                                    {step === 'text' && <Type className="w-4 h-4" />}
                                    {step === 'publish' && <Send className="w-4 h-4" />}
                                    <span className="hidden sm:inline capitalize">{step === 'video' ? 'Vidéo' : step === 'music' ? 'Musique' : step === 'text' ? 'Texte' : 'Publier'}</span>
                                </button>
                                {index < 3 && <ChevronRight className="w-5 h-5 text-muted-foreground mx-2" />}
                            </div>
                        ))}
                    </div>

                    {/* Contenu par étape */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Colonne principale */}
                        <div className="lg:col-span-2 space-y-6">

                            {/* ÉTAPE 1: Vidéo */}
                            {currentStep === 'video' && (
                                <Card className="rounded-2xl border-border/50 shadow-lg">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Video className="w-5 h-5" />
                                            Sélectionnez une Vidéo
                                        </CardTitle>
                                        <CardDescription>
                                            Choisissez une vidéo existante ou capturez-en une nouvelle
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <input
                                            ref={cameraInputRef}
                                            type="file"
                                            accept="video/*"
                                            capture="environment"
                                            onChange={handleCameraCapture}
                                            className="hidden"
                                        />

                                        <div {...getRootProps()} className={`${isDragActive ? 'bg-primary/5 border-primary' : ''}`}>
                                            <input {...getInputProps()} />

                                            <div className="flex gap-2 mb-4">
                                                <Button
                                                    onClick={() => cameraInputRef.current?.click()}
                                                    disabled={uploadMutation.isPending}
                                                    variant="outline"
                                                    className="lg:hidden"
                                                >
                                                    <Camera className="w-4 h-4 mr-2" />
                                                    Capturer
                                                </Button>
                                                <Button
                                                    onClick={open}
                                                    disabled={uploadMutation.isPending}
                                                    variant="outline"
                                                >
                                                    <Upload className="w-4 h-4 mr-2" />
                                                    {uploadMutation.isPending ? 'Upload...' : 'Uploader'}
                                                </Button>
                                            </div>

                                            {videoList.length === 0 ? (
                                                <div className="text-center py-12 border-2 border-dashed rounded-lg">
                                                    <Video className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                                                    <p className="text-muted-foreground">
                                                        {isDragActive ? "Déposez votre vidéo ici" : "Aucune vidéo disponible"}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                                    {videoList.map((media) => (
                                                        <button
                                                            key={media.id}
                                                            onClick={() => handleSelectVideo(media)}
                                                            className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${selectedVideoId === media.id
                                                                ? 'border-primary ring-2 ring-primary'
                                                                : 'border-transparent hover:border-muted-foreground'
                                                                }`}
                                                        >
                                                            <video
                                                                src={media.originalUrl}
                                                                className="w-full h-full object-cover"
                                                                muted
                                                                playsInline
                                                                preload="metadata"
                                                            />
                                                            {selectedVideoId === media.id && (
                                                                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                                                                    <Check className="w-8 h-8 text-primary" />
                                                                </div>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {selectedVideo && (
                                            <div className="mt-4 flex justify-end">
                                                <Button onClick={() => setCurrentStep('music')}>
                                                    Continuer
                                                    <ChevronRight className="w-4 h-4 ml-2" />
                                                </Button>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* ÉTAPE 2: Musique */}
                            {currentStep === 'music' && (
                                <Card className="rounded-2xl border-border/50 shadow-lg">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Music className="w-5 h-5" />
                                            Choisissez une Musique
                                        </CardTitle>
                                        <CardDescription>
                                            Sélectionnez une musique libre de droits (optionnel)
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <audio ref={audioRef} onEnded={() => setIsPlaying(null)} />

                                        {musicLoading ? (
                                            <div className="flex items-center justify-center py-8">
                                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="space-y-2">
                                                    {(!musicData?.tracks || musicData.tracks.length === 0) && (
                                                        <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                                                            <Music className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                                                            <p className="text-muted-foreground mb-2">
                                                                Aucune musique disponible
                                                            </p>
                                                            <p className="text-xs text-muted-foreground mb-4">
                                                                Configurez un Client ID Jamendo dans les Paramètres
                                                            </p>
                                                            <a
                                                                href="https://developer.jamendo.com/v3.0"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-sm text-primary hover:underline"
                                                            >
                                                                Obtenir un Client ID Jamendo →
                                                            </a>
                                                        </div>
                                                    )}
                                                    {musicData?.tracks?.map((track) => (
                                                        <div
                                                            key={track.id}
                                                            onClick={() => handleSelectTrack(track)}
                                                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${selectedTrack?.id === track.id
                                                                ? 'bg-primary/10 border border-primary'
                                                                : 'bg-muted/50 hover:bg-muted'
                                                                }`}
                                                        >
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    togglePlayPreview(track);
                                                                }}
                                                                className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/30"
                                                            >
                                                                {isPlaying === track.id ? (
                                                                    <Pause className="w-5 h-5" />
                                                                ) : (
                                                                    <Play className="w-5 h-5 ml-0.5" />
                                                                )}
                                                            </button>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-medium truncate">{track.title}</p>
                                                                <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
                                                            </div>
                                                            <span className="text-sm text-muted-foreground">
                                                                {formatDuration(track.duration)}
                                                            </span>
                                                            {selectedTrack?.id === track.id && (
                                                                <Check className="w-5 h-5 text-primary" />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>

                                                {selectedTrack && (
                                                    <div className="mt-4 space-y-4">
                                                        <div>
                                                            <Label className="flex items-center gap-2">
                                                                <Volume2 className="w-4 h-4" />
                                                                Volume musique: {musicVolume[0]}%
                                                            </Label>
                                                            <Slider
                                                                value={musicVolume}
                                                                onValueChange={setMusicVolume}
                                                                max={100}
                                                                step={5}
                                                                className="mt-2"
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="mt-4 flex justify-between">
                                                    <Button variant="outline" onClick={() => setCurrentStep('video')}>
                                                        Retour
                                                    </Button>
                                                    <div className="flex gap-2">
                                                        <Button variant="ghost" onClick={() => {
                                                            setSelectedTrack(null);
                                                            setCurrentStep('text');
                                                        }}>
                                                            Passer
                                                        </Button>
                                                        <Button onClick={() => setCurrentStep('text')}>
                                                            Continuer
                                                            <ChevronRight className="w-4 h-4 ml-2" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* ÉTAPE 3: Texte */}
                            {currentStep === 'text' && (
                                <>
                                    <Card className="rounded-2xl border-border/50 shadow-lg">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2">
                                                <Sparkles className="w-5 h-5" />
                                                Générer avec l'IA
                                            </CardTitle>
                                            <CardDescription>
                                                Décrivez votre produit pour générer des textes
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <Textarea
                                                value={productInfo}
                                                onChange={(e) => setProductInfo(e.target.value)}
                                                placeholder="Décrivez votre produit : nom, caractéristiques, prix, etc."
                                                rows={4}
                                            />
                                            <Button
                                                onClick={handleGenerateText}
                                                disabled={generateTextMutation.isPending}
                                                className="w-full"
                                            >
                                                <Sparkles className="w-4 h-4 mr-2" />
                                                {generateTextMutation.isPending ? 'Génération...' : 'Générer 3 variations'}
                                            </Button>
                                        </CardContent>
                                    </Card>

                                    {generatedVariants.length > 0 && (
                                        <Card className="rounded-2xl border-border/50 shadow-lg">
                                            <CardHeader>
                                                <CardTitle>Variations générées</CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-3">
                                                {generatedVariants.map((variant, index) => (
                                                    <div
                                                        key={index}
                                                        className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="flex-1">
                                                                <div className="text-xs font-semibold text-muted-foreground mb-2">
                                                                    {variant.variant || `Version ${index + 1}`}
                                                                </div>
                                                                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                                                    {variant.text}
                                                                </p>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleUseVariant(variant.text)}
                                                            >
                                                                Utiliser
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </CardContent>
                                        </Card>
                                    )}

                                    <Card className="rounded-2xl border-border/50 shadow-lg">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2">
                                                <Type className="w-5 h-5" />
                                                Texte Overlay
                                            </CardTitle>
                                            <CardDescription>
                                                Ce texte s'affichera au centre de votre Reel (style TikTok)
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <Textarea
                                                value={overlayText}
                                                onChange={(e) => setOverlayText(e.target.value)}
                                                placeholder="Écrivez le texte qui apparaîtra sur votre Reel..."
                                                rows={4}
                                            />

                                            <div className="mt-4 flex justify-between">
                                                <Button variant="outline" onClick={() => setCurrentStep('music')}>
                                                    Retour
                                                </Button>
                                                <Button onClick={() => setCurrentStep('publish')}>
                                                    Continuer
                                                    <ChevronRight className="w-4 h-4 ml-2" />
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </>
                            )}

                            {/* ÉTAPE 4: Publication */}
                            {currentStep === 'publish' && (
                                <>
                                    <Card className="rounded-2xl border-border/50 shadow-lg">
                                        <CardHeader>
                                            <CardTitle>Pages cibles</CardTitle>
                                            <CardDescription>Sélectionnez les pages où publier</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            {pages.filter(p => p.platform === 'facebook').length === 0 ? (
                                                <div className="text-center py-8">
                                                    <p className="text-muted-foreground mb-2">
                                                        Aucune page Facebook connectée
                                                    </p>
                                                    <Button variant="link" onClick={() => navigate('/pages')}>
                                                        Ajouter des pages
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="space-y-3">
                                                    {pages.filter(p => p.platform === 'facebook').map((page) => (
                                                        <div key={page.id} className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id={`page-${page.id}`}
                                                                checked={selectedPages.includes(page.id)}
                                                                onCheckedChange={(checked) => {
                                                                    if (checked) {
                                                                        setSelectedPages([...selectedPages, page.id]);
                                                                    } else {
                                                                        setSelectedPages(selectedPages.filter(id => id !== page.id));
                                                                    }
                                                                }}
                                                            />
                                                            <label
                                                                htmlFor={`page-${page.id}`}
                                                                className="text-sm font-medium leading-none flex-1"
                                                            >
                                                                {page.pageName}
                                                            </label>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>

                                    <Card className="rounded-2xl border-border/50 shadow-lg">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2">
                                                <Calendar className="w-5 h-5" />
                                                Planification
                                            </CardTitle>
                                            <CardDescription>
                                                Programmez la publication (optionnel)
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <DateTimePicker
                                                value={scheduledDate}
                                                onChange={setScheduledDate}
                                                occupiedDates={[]}
                                                placeholder="Publier immédiatement"
                                            />
                                        </CardContent>
                                    </Card>

                                    <div className="flex gap-3">
                                        <Button
                                            variant="outline"
                                            onClick={() => setCurrentStep('text')}
                                            className="flex-1"
                                        >
                                            Retour
                                        </Button>
                                        <Button
                                            onClick={handleCreateReel}
                                            disabled={!canPublish || createReelMutation.isPending}
                                            className="flex-1 bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                                        >
                                            {createReelMutation.isPending ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                    Création...
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="w-4 h-4 mr-2" />
                                                    Publier le Reel
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Colonne de prévisualisation */}
                        <div className="space-y-6">
                            <Card className="rounded-2xl border-border/50 shadow-lg sticky top-4">
                                <CardHeader>
                                    <CardTitle>Aperçu</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {selectedVideo ? (
                                        <div className="relative aspect-[9/16] bg-black rounded-lg overflow-hidden">
                                            <video
                                                src={selectedVideo.originalUrl}
                                                className="w-full h-full object-cover"
                                                muted
                                                playsInline
                                                loop
                                                autoPlay
                                            />
                                            {overlayText && (
                                                <div className="absolute inset-0 flex items-center justify-center p-4">
                                                    <p className="text-white text-center text-lg font-bold drop-shadow-lg">
                                                        {overlayText}
                                                    </p>
                                                </div>
                                            )}
                                            {selectedTrack && (
                                                <div className="absolute bottom-4 left-4 right-4 bg-black/50 rounded-lg p-2 flex items-center gap-2">
                                                    <Music className="w-4 h-4 text-white" />
                                                    <span className="text-white text-sm truncate">
                                                        {selectedTrack.title} - {selectedTrack.artist}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="aspect-[9/16] bg-muted rounded-lg flex items-center justify-center">
                                            <div className="text-center text-muted-foreground">
                                                <Video className="w-12 h-12 mx-auto mb-2" />
                                                <p>Sélectionnez une vidéo</p>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Résumé */}
                            <Card className="rounded-2xl border-border/50 shadow-lg">
                                <CardHeader>
                                    <CardTitle>Résumé</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Vidéo</span>
                                        <span>{selectedVideo ? '✓' : '—'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Musique</span>
                                        <span>{selectedTrack ? selectedTrack.title : 'Aucune'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Texte</span>
                                        <span>{overlayText ? '✓' : '—'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Pages</span>
                                        <span>{selectedPages.length} sélectionnée(s)</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
