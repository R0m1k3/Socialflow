import { useState, useCallback, useRef, useEffect } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Send, Sparkles, Video, Music, Type, Film,
    Upload, Play, Pause, Volume2, VolumeX,
    ChevronDown, Loader2, Check, Mic, CheckCircle2, AlertTriangle, Zap, CalendarClock, Link2
} from "lucide-react";
import { Stepper, StepNavigation, type StepDef } from "@/components/stepper";
import { EmptyState } from "@/components/empty-state";
import { PlatformIcon } from "@/components/platform-icon";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { StoryToggle } from "@/components/reels/story-toggle";
import { Slider } from "@/components/ui/slider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { VoicePicker, isVoicePreviewCurrent, type VoicePreviewResult, type VoiceSettings } from "@/components/reels/voice-picker";
import { CaptionStylePicker } from "@/components/reels/caption-style-picker";
import { ReelPreview } from "@/components/reels/reel-preview";
import { SrtUpload, type SrtFile } from "@/components/reels/srt-upload";
import { srtText } from "@shared/srt";
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from "@shared/captions";
import { DEFAULT_TTS_STYLE, DEFAULT_VOICE } from "@shared/voices";
import { apiRequest, queryClient, handleUnauthorized, getErrorMessage } from "@/lib/queryClient";
import type { SocialPage, Media } from "@shared/schema";
import { MediaThumbnail } from "@/components/media-thumbnail";
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

const STEP_ORDER: Step[] = ['video', 'music', 'text', 'publish'];

const REEL_STEPS: StepDef[] = [
    { id: 'video', label: 'Vidéo', icon: Video },
    { id: 'music', label: 'Musique', icon: Music },
    { id: 'text', label: 'Texte & voix', icon: Type },
    { id: 'publish', label: 'Publication', icon: Send },
];

export default function NewReel() {
    const [, navigate] = useLocation();
    const { toast } = useToast();
    const audioRef = useRef<HTMLAudioElement>(null);

    // État du workflow
    const [currentStep, setCurrentStep] = useState<Step>('video');
    const [aiOpen, setAiOpen] = useState(false);
    const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');

    // État des données
    const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
    const [selectedVideo, setSelectedVideo] = useState<Media | null>(null);
    const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);
    const [overlayText, setOverlayText] = useState('');
    // Fichier SRT : remplace le texte libre, la voix suit son minutage
    const [srtFile, setSrtFile] = useState<SrtFile | null>(null);
    const [productInfo, setProductInfo] = useState('');
    const [generatedVariants, setGeneratedVariants] = useState<any[]>([]);
    const [selectedPages, setSelectedPages] = useState<string[]>([]);
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
    const [musicVolume, setMusicVolume] = useState([25]);
    const [ttsEnabled, setTtsEnabled] = useState(true);
    const [drawText, setDrawText] = useState(true);
    // Désactivée par défaut : double le temps de rendu, utile seulement pour une vidéo tremblée
    const [stabilize, setStabilize] = useState(false);
    const [alsoStory, setAlsoStory] = useState(false);
    const [enableEndingEffect, setEnableEndingEffect] = useState(true);
    const [showLogo, setShowLogo] = useState(true);

    // TTS Sync state
    const [syncInfo, setSyncInfo] = useState<{
        wordDuration: number;
        audioDuration: number;
        wordCount: number;
        isHealthy: boolean;
        warnings: string[];
    } | null>(null);

    // Voix : moteur, voix et ton de lecture
    const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
        engine: 'gemini',
        voice: DEFAULT_VOICE.gemini,
        style: DEFAULT_TTS_STYLE,
    });
    const { engine: ttsEngine, voice: ttsVoice, style: ttsStyle } = voiceSettings;
    const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
    // Dernière voix générée : l'aperçu l'utilise tant que texte et réglages n'ont pas changé
    const [voicePreview, setVoicePreview] = useState<VoicePreviewResult | null>(null);
    const currentVoice = isVoicePreviewCurrent(voicePreview, overlayText, voiceSettings) ? voicePreview : null;
    const { data: reelConfig } = useQuery<{ logoUrl: string | null }>({ queryKey: ['/api/reels/config'] });

    // Enable TTS by default on mobile
    useEffect(() => {
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            setTtsEnabled(true);
        }
    }, []);

    // Auto-calculate TTS sync when text changes
    useEffect(() => {
        if (!ttsEnabled || !overlayText.trim() || srtFile) {
            setSyncInfo(null);
            return;
        }
        const timer = setTimeout(() => {
            apiRequest('POST', '/api/reels/sync-info', {
                text: overlayText,
                ttsVoice,
                ttsEngine,
            })
                .then(r => r.json())
                .then(data => setSyncInfo(data))
                .catch(() => setSyncInfo(null));
        }, 800);
        return () => clearTimeout(timer);
    }, [overlayText, ttsEnabled, ttsEngine, ttsVoice, srtFile]);


    // État audio preview
    const [isPlaying, setIsPlaying] = useState<string | null>(null);

    // Récupérer les pages disponibles
    const { data: pages = [] } = useQuery<SocialPage[]>({
        queryKey: ['/api/pages'],
    });

    // Destinations acceptant une vidéo verticale
    const facebookPages = pages.filter(p => p.platform === 'facebook');
    const tiktokAccounts = pages.filter(p => p.platform === 'tiktok');

    const renderTargetCheckbox = (page: SocialPage) => {
        const checked = selectedPages.includes(page.id);
        return (
            <label
                key={page.id}
                htmlFor={`page-${page.id}`}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${checked ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
            >
                <PlatformIcon platform={page.platform} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{page.pageName}</span>
                <Checkbox
                    id={`page-${page.id}`}
                    checked={checked}
                    onCheckedChange={(value) => {
                        if (value) {
                            setSelectedPages([...selectedPages, page.id]);
                        } else {
                            setSelectedPages(selectedPages.filter(id => id !== page.id));
                        }
                    }}
                />
            </label>
        );
    };

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
                credentials: "include",
            });
            if (!response.ok) {
                if (response.status === 401) handleUnauthorized("/api/media/upload");
                throw new Error("Upload failed");
            }
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
        onError: (error: unknown) => {
            toast({
                title: "Erreur",
                description: getErrorMessage(error, "Impossible de générer le texte"),
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
                title: "Création du Reel lancée",
                description: data.queued
                    ? "Un autre Reel est en cours : le vôtre démarrera juste après. Suivez l'avancement sur le tableau de bord."
                    : "Suivez l'avancement sur le tableau de bord.",
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
            overlayText: srtFile ? undefined : overlayText,
            srtCues: srtFile?.cues,
            description: srtFile ? srtText(srtFile.cues) : overlayText,
            pageIds: selectedPages,
            scheduledFor: scheduledDate?.toISOString(),
            alsoStory,
            musicVolume: musicVolume[0] / 100,
            ttsEnabled,
            ttsEngine,
            ttsVoice,
            ttsStyle,
            captionStyle,
            drawText,
            stabilize: stabilize,
            enableEndingEffect,
            showLogo,
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

    const stepIndex = STEP_ORDER.indexOf(currentStep);
    const lockedReason = (index: number): string | null =>
        index > 0 && !selectedVideo ? "Sélectionnez d'abord une vidéo" : null;
    const goTo = (index: number) => {
        if (index < 0 || index >= STEP_ORDER.length) return;
        const reason = lockedReason(index);
        if (reason) {
            toast({ title: "Étape incomplète", description: reason, variant: "destructive" });
            return;
        }
        setCurrentStep(STEP_ORDER[index]);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const optionRow = (id: string, label: string, description: string, checked: boolean, onChange: (v: boolean) => void) => (
        <div className="flex items-start justify-between gap-4 py-3">
            <Label htmlFor={id} className="cursor-pointer space-y-0.5">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs font-normal text-muted-foreground">{description}</span>
            </Label>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    );

    return (
        <>
            <Page width="default">
                <PageHeader
                    icon={Film}
                    title="Nouveau Reel"
                    description="Montez une vidéo verticale avec musique, sous-titres et voix, puis publiez-la sur Facebook et TikTok."
                />

                <Stepper steps={REEL_STEPS} current={stepIndex} lockedReason={lockedReason} onStepClick={goTo} />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    {/* Colonne principale */}
                    <div className="min-w-0 space-y-6 lg:col-span-2">

                        {/* ÉTAPE 1 : Vidéo */}
                        {currentStep === 'video' && (
                            <Card className="fade-in">
                                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                                    <div>
                                        <CardTitle>Choisissez une vidéo</CardTitle>
                                        <CardDescription>Une vidéo de la médiathèque ou un nouveau fichier.</CardDescription>
                                    </div>
                                    <Button
                                        onClick={open}
                                        disabled={uploadMutation.isPending}
                                        variant="outline"
                                        size="sm"
                                        className="shrink-0"
                                    >
                                        {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                        {uploadMutation.isPending ? 'Import…' : 'Importer'}
                                    </Button>
                                </CardHeader>
                                <CardContent className="space-y-5">
                                    <div
                                        {...getRootProps()}
                                        className={`rounded-xl transition-colors ${isDragActive ? 'bg-primary/5 ring-2 ring-primary ring-offset-2 ring-offset-card' : ''}`}
                                    >
                                        <input {...getInputProps()} />
                                        {videoList.length === 0 ? (
                                            <EmptyState
                                                compact
                                                icon={Video}
                                                title={isDragActive ? "Déposez votre vidéo ici" : "Aucune vidéo pour l'instant"}
                                                description="Glissez-déposez une vidéo ou importez-la depuis votre appareil."
                                                action={
                                                    <Button size="sm" onClick={open} disabled={uploadMutation.isPending}>
                                                        <Upload className="w-4 h-4" /> Importer une vidéo
                                                    </Button>
                                                }
                                            />
                                        ) : (
                                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                                {videoList.map((media) => (
                                                    <button
                                                        key={media.id}
                                                        onClick={() => handleSelectVideo(media)}
                                                        className={`relative aspect-video overflow-hidden rounded-lg border-2 transition-all ${selectedVideoId === media.id
                                                            ? 'border-primary'
                                                            : 'border-transparent hover:border-primary/40'
                                                            }`}
                                                        aria-pressed={selectedVideoId === media.id}
                                                    >
                                                        <MediaThumbnail
                                                            src={media.originalUrl}
                                                            alt={media.fileName}
                                                            thumbnailUrl={media.thumbnailUrl ?? undefined}
                                                            type="video"
                                                        />
                                                        {selectedVideoId === media.id && (
                                                            <div className="absolute inset-0 bg-primary/20">
                                                                <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                                                                    <Check className="h-4 w-4" />
                                                                </span>
                                                            </div>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/40 p-4">
                                        <Label htmlFor="stabilize" className="cursor-pointer space-y-1">
                                            <span className="flex items-center gap-2 text-sm font-medium">
                                                <Sparkles className="h-4 w-4 text-primary" />
                                                Stabilisation & qualité 1080p
                                            </span>
                                            <span className="block text-xs font-normal text-muted-foreground">
                                                Utile pour une vidéo tremblée. Double le temps de traitement.
                                                Sur iPhone, activez aussi la stabilisation dans Réglages › Appareil photo.
                                            </span>
                                        </Label>
                                        <Switch id="stabilize" checked={stabilize} onCheckedChange={setStabilize} />
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* ÉTAPE 2 : Musique */}
                        {currentStep === 'music' && (
                            <Card className="fade-in">
                                <CardHeader>
                                    <CardTitle>Ajoutez une musique</CardTitle>
                                    <CardDescription>Facultatif : vous pouvez garder le son d'origine de la vidéo.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <audio ref={audioRef} onEnded={() => setIsPlaying(null)} />

                                    <div className="space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedTrack(null)}
                                            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${!selectedTrack ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                                        >
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                                <VolumeX className="h-4 w-4" />
                                            </span>
                                            <span className="flex-1">
                                                <span className="block text-sm font-medium">Pas de musique</span>
                                                <span className="block text-xs text-muted-foreground">Garder le son de la vidéo</span>
                                            </span>
                                            {!selectedTrack && <Check className="h-5 w-5 shrink-0 text-primary" />}
                                        </button>

                                        {internalTracksLoading ? (
                                            <div className="flex items-center justify-center py-8">
                                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                            </div>
                                        ) : internalTracks.length === 0 ? (
                                            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                                                Aucune musique disponible. Un administrateur peut en ajouter depuis la page Musiques.
                                            </p>
                                        ) : (
                                            internalTracks.map((track) => (
                                                <div
                                                    key={track.id}
                                                    onClick={() => handleSelectTrack(track)}
                                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${selectedTrack?.id === track.id
                                                        ? 'border-primary bg-primary/5'
                                                        : 'hover:bg-accent'
                                                        }`}
                                                >
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            togglePlayPreview(track);
                                                        }}
                                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                                                        aria-label={isPlaying === track.id ? "Pause" : "Écouter"}
                                                    >
                                                        {isPlaying === track.id ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                                                    </button>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-medium">{track.title}</p>
                                                        <p className="text-xs text-muted-foreground">{formatDuration(track.duration)}</p>
                                                    </div>
                                                    {selectedTrack?.id === track.id && <Check className="h-5 w-5 shrink-0 text-primary" />}
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    {selectedTrack && (
                                        <div className="mt-5 rounded-lg bg-muted/40 p-4">
                                            <Label className="flex items-center justify-between text-sm">
                                                <span className="flex items-center gap-2"><Volume2 className="h-4 w-4" /> Volume de la musique</span>
                                                <span className="tabular-nums text-muted-foreground">{musicVolume[0]} %</span>
                                            </Label>
                                            <Slider value={musicVolume} onValueChange={setMusicVolume} max={100} step={5} className="mt-3" />
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* ÉTAPE 3 : Texte & voix */}
                        {currentStep === 'text' && (
                            <div className="fade-in space-y-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Texte affiché sur la vidéo</CardTitle>
                                        <CardDescription>
                                            Écrivez un texte, générez-le avec l'IA ou importez des sous-titres (.srt).
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <SrtUpload value={srtFile} onChange={setSrtFile} />

                                        {srtFile ? (
                                            <p className="text-xs text-muted-foreground">
                                                Le fichier SRT remplace le texte libre. Retirez-le pour écrire un texte.
                                            </p>
                                        ) : (
                                            <>
                                                <Collapsible open={aiOpen} onOpenChange={setAiOpen} className="rounded-xl border border-primary/20 bg-primary/5">
                                                    <CollapsibleTrigger className="flex w-full items-center gap-3 p-3 text-left">
                                                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                            <Sparkles className="h-4 w-4" />
                                                        </span>
                                                        <span className="flex-1">
                                                            <span className="block text-sm font-medium">Générer avec l'IA</span>
                                                            <span className="block text-xs text-muted-foreground">Décrivez votre produit, l'IA rédige 3 propositions</span>
                                                        </span>
                                                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${aiOpen ? 'rotate-180' : ''}`} />
                                                    </CollapsibleTrigger>
                                                    <CollapsibleContent className="space-y-3 px-3 pb-3">
                                                        <Textarea
                                                            value={productInfo}
                                                            onChange={(e) => setProductInfo(e.target.value)}
                                                            placeholder="Ex. : Produit : Lampe LED — Prix : 29 € — Caractéristiques : sans fil, 3 intensités"
                                                            rows={3}
                                                            className="bg-card"
                                                        />
                                                        <Button onClick={handleGenerateText} disabled={generateTextMutation.isPending} className="w-full sm:w-auto">
                                                            {generateTextMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                                            {generateTextMutation.isPending ? 'Génération…' : 'Générer des propositions'}
                                                        </Button>
                                                        {generatedVariants.length > 0 && (
                                                            <div className="space-y-2 pt-1">
                                                                {generatedVariants.map((variant, index) => (
                                                                    <div key={index} className="rounded-lg border bg-card p-3">
                                                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                                                            <span className="text-xs font-semibold text-muted-foreground">
                                                                                {variant.variant || `Proposition ${index + 1}`}
                                                                            </span>
                                                                            <Button
                                                                                size="sm"
                                                                                variant={overlayText === variant.text ? "secondary" : "default"}
                                                                                className="h-8"
                                                                                onClick={() => handleUseVariant(variant.text)}
                                                                            >
                                                                                {overlayText === variant.text ? <><Check className="h-3.5 w-3.5" /> Utilisée</> : "Utiliser"}
                                                                            </Button>
                                                                        </div>
                                                                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{variant.text}</p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </CollapsibleContent>
                                                </Collapsible>

                                                <Textarea
                                                    value={overlayText}
                                                    onChange={(e) => setOverlayText(e.target.value)}
                                                    placeholder="Écrivez le texte qui apparaîtra sur votre Reel…"
                                                    rows={4}
                                                />
                                            </>
                                        )}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle>Habillage</CardTitle>
                                        <CardDescription>Ce qui apparaît par-dessus la vidéo.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="divide-y">
                                        <div>
                                            {optionRow("draw-text", "Afficher les sous-titres", "Le texte s'affiche au fil de la vidéo", drawText, setDrawText)}
                                            {drawText && (
                                                <div className="pb-4">
                                                    <CaptionStylePicker value={captionStyle} onChange={setCaptionStyle} />
                                                </div>
                                            )}
                                        </div>
                                        {optionRow("show-logo", "Afficher le logo", "Votre logo en filigrane pendant la vidéo", showLogo, setShowLogo)}
                                        {optionRow("enable-ending-effect", "Effet de fin", "Logo et fondu sur les dernières secondes", enableEndingEffect, setEnableEndingEffect)}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <CardTitle className="flex items-center gap-2"><Mic className="h-4 w-4" /> Voix off</CardTitle>
                                                <CardDescription>Une voix lit le texte pendant la vidéo.</CardDescription>
                                            </div>
                                            <Switch id="tts-mode" checked={ttsEnabled} onCheckedChange={setTtsEnabled} aria-label="Activer la voix off" />
                                        </div>
                                    </CardHeader>
                                    {ttsEnabled && (
                                        <CardContent className="space-y-3">
                                            <VoicePicker
                                                value={voiceSettings}
                                                onChange={setVoiceSettings}
                                                sampleText={srtFile ? srtFile.cues[0]?.text : overlayText}
                                                onPreview={setVoicePreview}
                                            />

                                            {syncInfo && !srtFile && (
                                                <div className={`rounded-lg border p-3 ${syncInfo.isHealthy ? 'border-success/30 bg-success/10' : 'border-warning/40 bg-warning/10'}`}>
                                                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                                        <span className="flex items-center gap-2 font-medium">
                                                            {syncInfo.isHealthy ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
                                                            Synchronisation texte / voix
                                                        </span>
                                                        <span className="text-xs tabular-nums text-muted-foreground">
                                                            {syncInfo.wordCount} mots · {syncInfo.audioDuration.toFixed(1)} s · {syncInfo.wordDuration.toFixed(2)} s/mot
                                                        </span>
                                                    </div>
                                                    {syncInfo.warnings.map((w, i) => (
                                                        <p key={i} className="mt-1 text-xs text-warning-foreground dark:text-warning">{w}</p>
                                                    ))}
                                                    {syncInfo.isHealthy && syncInfo.warnings.length === 0 && (
                                                        <p className="mt-1 text-xs text-muted-foreground">Le minutage est calculé automatiquement.</p>
                                                    )}
                                                </div>
                                            )}

                                            <p className="text-xs text-muted-foreground">
                                                {srtFile
                                                    ? "Chaque sous-titre sera lu à son instant et accéléré si besoin pour respecter la durée du fichier SRT."
                                                    : "Le texte sera automatiquement synchronisé avec la voix."}
                                                {' '}Les #hashtags et émojis ne sont pas lus.
                                            </p>
                                        </CardContent>
                                    )}
                                </Card>
                            </div>
                        )}

                        {/* ÉTAPE 4 : Publication */}
                        {currentStep === 'publish' && (
                            <div className="fade-in space-y-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Où publier ?</CardTitle>
                                        <CardDescription>
                                            La même vidéo peut partir sur plusieurs pages Facebook et comptes TikTok.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        {facebookPages.length === 0 && tiktokAccounts.length === 0 ? (
                                            <EmptyState
                                                compact
                                                icon={Link2}
                                                title="Aucun compte connecté"
                                                description="Connectez une page Facebook ou un compte TikTok pour publier."
                                                action={<Button size="sm" onClick={() => navigate('/pages')}>Connecter un compte</Button>}
                                            />
                                        ) : (
                                            <div className="space-y-5">
                                                {facebookPages.length > 0 && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages Facebook</p>
                                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                            {facebookPages.map(renderTargetCheckbox)}
                                                        </div>
                                                        <StoryToggle checked={alsoStory} onCheckedChange={setAlsoStory} />
                                                    </div>
                                                )}

                                                {tiktokAccounts.length > 0 && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comptes TikTok</p>
                                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                            {tiktokAccounts.map(renderTargetCheckbox)}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>Quand publier ?</CardTitle>
                                        <CardDescription>Le Reel est d'abord monté, puis publié à l'heure choisie.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <RadioGroup
                                            value={scheduleMode}
                                            onValueChange={(value) => {
                                                setScheduleMode(value as 'now' | 'later');
                                                if (value === 'now') setScheduledDate(undefined);
                                            }}
                                            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                                        >
                                            {([
                                                { value: 'now', label: 'Dès que prêt', description: 'Publication à la fin du montage', icon: Zap },
                                                { value: 'later', label: 'Programmer', description: 'Choisir une date et une heure', icon: CalendarClock },
                                            ] as const).map(({ value, label, description, icon: Icon }) => (
                                                <label
                                                    key={value}
                                                    htmlFor={`reel-when-${value}`}
                                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${scheduleMode === value ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                                                >
                                                    <Icon className={`h-5 w-5 ${scheduleMode === value ? 'text-primary' : 'text-muted-foreground'}`} />
                                                    <span className="flex-1">
                                                        <span className="block text-sm font-medium">{label}</span>
                                                        <span className="block text-xs text-muted-foreground">{description}</span>
                                                    </span>
                                                    <RadioGroupItem value={value} id={`reel-when-${value}`} />
                                                </label>
                                            ))}
                                        </RadioGroup>
                                        {scheduleMode === 'later' && (
                                            <DateTimePicker
                                                value={scheduledDate}
                                                onChange={setScheduledDate}
                                                occupiedDates={[]}
                                                placeholder="Choisir une date"
                                            />
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        <StepNavigation
                            onBack={() => goTo(stepIndex - 1)}
                            backDisabled={stepIndex === 0}
                            onNext={() => goTo(stepIndex + 1)}
                            nextDisabled={currentStep === 'video' && !selectedVideo}
                            hint={currentStep === 'video' && !selectedVideo ? "Sélectionnez une vidéo pour continuer" : undefined}
                            next={
                                currentStep === 'publish' ? (
                                    <Button
                                        onClick={() => {
                                            if (scheduleMode === 'later' && !scheduledDate) {
                                                toast({ title: "Date manquante", description: "Choisissez une date ou publiez dès que prêt.", variant: "destructive" });
                                                return;
                                            }
                                            handleCreateReel();
                                        }}
                                        disabled={!canPublish || createReelMutation.isPending}
                                        variant="brand"
                                        className="w-full sm:w-auto"
                                    >
                                        {createReelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                        {createReelMutation.isPending ? 'Création…' : scheduleMode === 'later' ? 'Programmer le Reel' : 'Créer et publier le Reel'}
                                    </Button>
                                ) : undefined
                            }
                        />
                    </div>

                    {/* Colonne de prévisualisation */}
                    <aside className="space-y-6">
                        <Card className="lg:sticky lg:top-6">
                            <CardHeader className="pb-3">
                                <CardTitle>Aperçu</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {selectedVideo ? (
                                    <ReelPreview
                                        kind="video"
                                        videoUrl={selectedVideo.originalUrl}
                                        text={srtFile ? srtText(srtFile.cues) : overlayText}
                                        srtCues={srtFile?.cues}
                                        showCaptions={drawText}
                                        captionStyle={captionStyle}
                                        ttsEnabled={ttsEnabled}
                                        voice={currentVoice}
                                        musicUrl={selectedTrack?.previewUrl}
                                        musicVolume={musicVolume[0] / 100}
                                        logoUrl={reelConfig?.logoUrl}
                                        showWatermark={showLogo}
                                        storeName={pages.find((p) => p.id === selectedPages[0])?.pageName}
                                        endingEffect={enableEndingEffect}
                                    />
                                ) : (
                                    <div className="flex aspect-[9/16] max-h-[420px] w-full items-center justify-center rounded-lg border border-dashed bg-muted/40">
                                        <div className="text-center text-sm text-muted-foreground">
                                            <Video className="mx-auto mb-2 h-8 w-8" />
                                            L'aperçu apparaîtra ici
                                        </div>
                                    </div>
                                )}

                                <dl className="space-y-2 border-t pt-3 text-sm">
                                    {[
                                        { label: "Vidéo", value: selectedVideo ? "Sélectionnée" : "—", ok: !!selectedVideo },
                                        { label: "Musique", value: selectedTrack ? selectedTrack.title : "Son d'origine", ok: true },
                                        { label: "Texte", value: srtFile ? `SRT (${srtFile.cues.length} lignes)` : overlayText ? `${overlayText.length} caractères` : "—", ok: !!(srtFile || overlayText) },
                                        { label: "Voix", value: ttsEnabled ? "Activée" : "Désactivée", ok: true },
                                        { label: "Comptes", value: selectedPages.length ? `${selectedPages.length} sélectionné(s)` : "—", ok: selectedPages.length > 0 },
                                    ].map((row) => (
                                        <div key={row.label} className="flex items-start justify-between gap-3">
                                            <dt className="text-muted-foreground">{row.label}</dt>
                                            <dd className={`truncate text-right font-medium ${row.ok ? '' : 'text-muted-foreground'}`}>{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </CardContent>
                        </Card>
                    </aside>
                </div>
            </Page>
        </>
    );
}
