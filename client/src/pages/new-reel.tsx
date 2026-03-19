import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Send, Sparkles, Video, Music, Type, Calendar,
    Upload, Play, Pause, Volume2, VolumeX,
    ChevronRight, Loader2, Check, RefreshCw, Mic
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
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialPage, Media } from "@shared/schema";
import { getVideoThumbnailUrl } from "@/lib/media-utils";
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
    const [ttsEnabled, setTtsEnabled] = useState(true);
    const [ttsVoice, setTtsVoice] = useState("fr-FR-VivienneMultilingualNeural");
    const [drawText, setDrawText] = useState(true);
    const [stabilize, setStabilize] = useState(true); // default to true
    const [enableEndingEffect, setEnableEndingEffect] = useState(true);

    // Enable TTS by default on mobile
    useEffect(() => {
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            setTtsEnabled(true);
        }
    }, []);


    // État audio preview
    const [isPlaying, setIsPlaying] = useState<string | null>(null);

    // Récupérer les pages disponibles
    const { data: pages = [] } = useQuery<SocialPage[]>({
        queryKey: ['/api/pages'],
    });

    // Récupérer les vidéos disponibles
    const { data: allMedia = [] } = useQuery<Media[]>({
        queryKey: ['/api/media'],
    });

    const videoList = allMedia.filter(m => m.type === 'video').slice(0, 12);

    // --- Added for Internal Audio Tracks ---
    const { data: internalTracksResponse = [], isLoading: internalTracksLoading } = useQuery<any[]>({
        queryKey: ['/api/audio-tracks'],
    });

    const internalTracks: MusicTrack[] = (internalTracksResponse || []).map(t => ({
        id: `internal_${t.id}`,
        title: t.title,
        artist: t.fileName || t.title,
        albumName: "Bibliothèque Interne",
        duration: t.duration || 0,
        previewUrl: t.url,
        downloadUrl: t.url,
        imageUrl: "",
        license: "Internal"
    }));
    // --- End Internal Tracks ---

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

    const onDrop = useCallback((acceptedFiles: File[], fileRejections: any[]) => {
        if (fileRejections.length > 0) {
            const rej = fileRejections[0];
            const errorMsg = `Erreur: ${rej.errors?.[0]?.message}. Type: ${rej.file.type || 'Inconnu'}. Nom: ${rej.file.name}`;
            console.error('❌ Fichiers rejetés:', errorMsg);

            // Debug mobile agressif
            window.alert("Fichier rejeté !\n" + errorMsg);

            toast({
                title: "Fichier non supporté",
                description: errorMsg,
                variant: "destructive",
            });
            return;
        }

        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            console.log('✅ Fichier accepté:', file.type, file.size);
            // Accepter aussi formats iOS sans type MIME standard
            if (file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov') || file.name.toLowerCase().endsWith('.mp4')) {
                uploadMutation.mutate(file);
            } else {
                toast({
                    title: "Format invalide",
                    description: `Fichier non reconnu comme vidéo (${file.type || 'sans type'}). Essayez MP4/MOV.`,
                    variant: "destructive",
                });
            }
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
        onDrop,
        accept: {
            'video/mp4': ['.mp4', '.m4v'],
            'video/quicktime': ['.mov', '.qt'],
            'video/webm': ['.webm'],
            'video/x-msvideo': ['.avi'],
        },
        multiple: true, // Use multiple to bypass iOS Safari automatic compression
        maxSize: 4 * 1024 * 1024 * 1024, // 4GB Limit
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

    const togglePlayPreview = async (track: MusicTrack) => {
        if (isPlaying === track.id) {
            audioRef.current?.pause();
            setIsPlaying(null);
        } else {
            if (audioRef.current) {
                console.log('🎵 Playing preview:', track.previewUrl);
                audioRef.current.src = track.previewUrl;
                try {
                    await audioRef.current.play();
                    setIsPlaying(track.id);
                } catch (error) {
                    console.error('❌ Audio play error:', error);
                    toast({
                        title: "Erreur de lecture",
                        description: "Impossible de lire la prévisualisation audio. Vérifiez votre connexion.",
                        variant: "destructive",
                    });
                    setIsPlaying(null);
                }
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
            ttsEnabled,
            ttsVoice,
            drawText,
            stabilize: stabilize,
            enableEndingEffect,
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
                                            Choisissez une vidéo existante ou téléchargez-en une nouvelle
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        <div className="p-4 border rounded-xl bg-primary/5 border-primary/20 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <Label className="text-base font-semibold flex items-center gap-2">
                                                        <Sparkles className="w-5 h-5 text-primary" />
                                                        Stabilisation & Qualité 1080p
                                                    </Label>
                                                    <p className="text-sm text-muted-foreground">
                                                        Recommandé pour un rendu professionnel sur Facebook Reels
                                                    </p>
                                                    <div className="flex items-center gap-1.5 text-[10px] text-primary/70 bg-primary/5 px-2 py-0.5 rounded-full w-fit">
                                                        <Sparkles className="w-3 h-3" />
                                                        <span>Note iPhone : Activez la stabilisation dans Réglages &gt; Appareil Photo</span>
                                                    </div>
                                                </div>
                                                <Switch
                                                    checked={stabilize}
                                                    onCheckedChange={setStabilize}
                                                />
                                            </div>
                                        </div>

                                        <div {...getRootProps()} className={`${isDragActive ? 'bg-primary/5 border-primary' : ''}`}>
                                            <input {...getInputProps()} />

                                            <div className="flex gap-2 mb-4">
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
                                                            <img
                                                                src={getVideoThumbnailUrl(media.originalUrl)}
                                                                alt={media.fileName}
                                                                className="w-full h-full object-cover"
                                                                loading="lazy"
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
                                            <div className="mt-6 flex justify-end">
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

                                        {/* BIBLIOTHÈQUE INTERNE */}
                                        <div className="space-y-2">
                                            {internalTracksLoading ? (
                                                <div className="flex items-center justify-center py-8">
                                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                                </div>
                                            ) : internalTracks.length === 0 ? (
                                                <div className="text-center py-10 border-2 border-dashed border-border rounded-xl">
                                                    <Music className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-40" />
                                                    <p className="text-muted-foreground font-medium">Aucune musique disponible</p>
                                                    <p className="text-sm text-muted-foreground mt-1">Un administrateur peut ajouter des MP3 via la Bibliothèque Audio.</p>
                                                </div>
                                            ) : (
                                                internalTracks.map((track) => (
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
                                                            className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/30 shrink-0"
                                                        >
                                                            {isPlaying === track.id ? (
                                                                <Pause className="w-5 h-5" />
                                                            ) : (
                                                                <Play className="w-5 h-5 ml-0.5" />
                                                            )}
                                                        </button>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-medium truncate">{track.title}</p>
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                                                            </p>
                                                        </div>
                                                        {selectedTrack?.id === track.id && (
                                                            <Check className="w-5 h-5 text-primary shrink-0" />
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {/* Slider volume + navigation */}
                                        {selectedTrack && (
                                            <div className="mt-4">
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

                                            <div className="flex items-center space-x-2 mt-4">
                                                <Switch
                                                    id="draw-text"
                                                    checked={drawText}
                                                    onCheckedChange={setDrawText}
                                                />
                                                <Label htmlFor="draw-text" className="font-medium cursor-pointer">
                                                    Afficher le texte sur la vidéo
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2 mt-4">
                                                <Switch
                                                    id="enable-ending-effect"
                                                    checked={enableEndingEffect}
                                                    onCheckedChange={setEnableEndingEffect}
                                                />
                                                <Label htmlFor="enable-ending-effect" className="font-medium cursor-pointer">
                                                    Activer l'effet de fin (logo + fondu)
                                                </Label>
                                            </div>

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
                                                <div className="mt-4 space-y-2 ml-12 p-4 bg-muted/30 rounded-lg border border-border/50">
                                                    <Label className="flex items-center gap-2">
                                                        <Mic className="w-4 h-4" />
                                                        Voix du narrateur
                                                    </Label>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {[
                                                            { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne", type: "Femme (Défaut)", style: "bg-pink-500/10 border-pink-500/50" },
                                                            { id: "fr-FR-RemyMultilingualNeural", label: "Rémy", type: "Homme", style: "bg-blue-500/10 border-blue-500/50" },
                                                            { id: "fr-FR-DeniseNeural", label: "Denise", type: "Femme (Calme)", style: "bg-purple-500/10 border-purple-500/50" },
                                                            { id: "fr-FR-HenriNeural", label: "Henri", type: "Homme (Grave)", style: "bg-slate-500/10 border-slate-500/50" },
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
                                                                <div className="font-semibold flex items-center justify-between">
                                                                    {voice.label}
                                                                    {(ttsVoice === voice.id || (ttsVoice === 'female' && voice.id === 'fr-FR-VivienneMultilingualNeural')) && <Check className="w-3 h-3 text-primary" />}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground">{voice.type}</div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div className="mt-3 flex gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="secondary"
                                                            className="w-full"
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const textToTest = overlayText || "Ceci est un test de voix pour votre vidéo.";
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
                                                                    toast({
                                                                        title: "Erreur",
                                                                        description: "Impossible de tester la voix",
                                                                        variant: "destructive"
                                                                    });
                                                                }
                                                            }}
                                                        >
                                                            <Play className="w-3 h-3 mr-2" />
                                                            Tester la voix
                                                        </Button>
                                                    </div>

                                                    <p className="text-xs text-muted-foreground mt-2">
                                                        Le texte sera automatiquement synchronisé avec la voix.
                                                        Les #hashtags et émojis ne seront pas lus.
                                                    </p>
                                                </div>
                                            )}

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
                    </div >
                </div >
            </main >
            {/* Overlay de progression */}
            < ProcessingOverlay
                isVisible={createReelMutation.isPending}
                stabilize={stabilize}
                ttsEnabled={ttsEnabled}
            />
        </div >
    );
}

function ProcessingOverlay({ isVisible, stabilize, ttsEnabled }: { isVisible: boolean; stabilize: boolean; ttsEnabled: boolean }) {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("Initialisation...");

    useEffect(() => {
        if (!isVisible) {
            setProgress(0);
            return;
        }

        setProgress(0);
        setStatus("Préparation des fichiers...");

        const timeouts: any[] = [];
        let interval: any;

        // Sequence de simulation
        // 1. 2s: Téléchargement
        timeouts.push(setTimeout(() => {
            setStatus("Téléchargement des médias...");
            setProgress(10);
        }, 1500));

        // 2. 4s: Audio/TTS
        timeouts.push(setTimeout(() => {
            setStatus(ttsEnabled ? "Génération de la voix IA..." : "Mixage audio...");
            setProgress(25);
        }, 3500));

        // 3. 7s: Stabilisation ou Encodage
        timeouts.push(setTimeout(() => {
            if (stabilize) {
                setStatus("Stabilisation vidéo (Traitement long)...");
                setProgress(35);

                // Progression lente : +1% toutes les 800ms
                // Ça permet de couvrir ~45 secondes avant d'arriver à 90%
                let p = 35;
                interval = setInterval(() => {
                    if (p < 90) {
                        p++;
                        setProgress(p);
                    }
                }, 800);
            } else {
                setStatus("Encodage optimisé...");
                setProgress(40);

                // Progression pour encodage standard (~10-15s)
                let p = 40;
                interval = setInterval(() => {
                    if (p < 90) {
                        p += 2;
                        setProgress(p);
                    }
                }, 500);
            }
        }, 6500));

        // Nettoyage
        return () => {
            timeouts.forEach(clearTimeout);
            if (interval) clearInterval(interval);
        };
    }, [isVisible, stabilize, ttsEnabled]);

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-md space-y-8 text-center">
                <div className="relative w-24 h-24 mx-auto mb-8">
                    <Loader2 className="w-full h-full text-primary animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center font-bold text-xl">
                        {progress}%
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-2xl font-bold text-white tracking-tight">Création de votre Reel</h3>
                    <p className="text-lg text-muted-foreground animate-pulse">
                        {status}
                    </p>
                </div>

                <div className="w-full h-2 bg-secondary/30 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>

                {stabilize && (
                    <div className="flex items-center justify-center gap-2 text-sm text-yellow-500/80 bg-yellow-500/10 py-2 px-4 rounded-full mx-auto w-fit">
                        <Sparkles className="w-4 h-4" />
                        <span>Stabilisation activée : traitement prolongé</span>
                    </div>
                )}
            </div>
        </div>
    );
}
