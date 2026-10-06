import { useState, useCallback, useRef, useMemo } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Send, Sparkles, Image as ImageIcon, Calendar, CalendarClock, Upload, Camera, GripVertical, Loader2, PenSquare, Type, Users, ChevronDown, Check, Link2, LayoutGrid, Smartphone, Layers, AlertTriangle, Zap } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Stepper, StepNavigation, type StepDef } from "@/components/stepper";
import { EmptyState } from "@/components/empty-state";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDropzone } from "react-dropzone";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, handleUnauthorized, getErrorMessage } from "@/lib/queryClient";
import { MediaThumbnail } from "@/components/media-thumbnail";
import type { SocialPage, Media, ScheduledPost } from "@shared/schema";
import { PreviewModal } from "@/components/preview-modal";
import { DateTimePicker } from "@/components/datetime-picker";

function SortableMediaItem({
  media,
  index,
  isSelected,
  onToggle
}: {
  media: Media;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: media.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isVideo = media.type === 'video';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${isSelected
          ? 'border-primary'
          : 'border-transparent hover:border-muted-foreground'
        }`}
    >
      <button
        onClick={onToggle}
        className="w-full h-full"
        data-testid={`button-select-media-${media.id}`}
      >
        <MediaThumbnail
          src={media.facebookFeedUrl || media.originalUrl}
          alt={media.fileName}
          thumbnailUrl={media.thumbnailUrl ?? undefined}
          type={isVideo ? 'video' : 'image'}
        />
      </button>
      {isSelected && (
        <>
          <div className="absolute top-1 right-1 w-5 h-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">
            {index + 1}
          </div>
          <div
            {...attributes}
            {...listeners}
            className="absolute top-1 left-1 w-7 h-7 bg-background/80 backdrop-blur rounded-full flex items-center justify-center cursor-move hover:bg-background transition-colors"
          >
            <GripVertical className="w-4 h-4 text-foreground" />
          </div>
        </>
      )}
    </div>
  );
}

/** Nombre de médias récents proposés à la sélection. */
const RECENT_MEDIA_COUNT = 12;

/** Minuit, pour que la clé de requête reste stable d'un rendu à l'autre. */
function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

const STEPS: StepDef[] = [
  { id: "media", label: "Médias", icon: ImageIcon },
  { id: "text", label: "Texte", icon: Type },
  { id: "targets", label: "Diffusion", icon: Users },
  { id: "schedule", label: "Planification", icon: Calendar },
];

const FORMATS = [
  { value: 'feed', label: "Fil d'actualité", description: "Publication classique", icon: LayoutGrid },
  { value: 'story', label: "Story", description: "Visible 24 h, média requis", icon: Smartphone },
  { value: 'both', label: "Fil + Story", description: "Les deux à la fois", icon: Layers },
] as const;

function SummaryRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right font-medium ${ok ? 'text-foreground' : 'text-muted-foreground'}`}>{value}</dd>
    </div>
  );
}

export default function NewPost() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [productInfo, setProductInfo] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [generatedVariants, setGeneratedVariants] = useState<any[]>([]);
  const [postText, setPostText] = useState('');
  const [postType, setPostType] = useState<'feed' | 'story' | 'both'>('feed');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');

  // Ce composeur gère les publications feed/story : TikTok n'accepte que des
  // vidéos et se pilote depuis la création de reel.
  const { data: allPages = [] } = useQuery<SocialPage[]>({
    queryKey: ['/api/pages'],
  });
  const pages = allPages.filter(p => p.platform !== 'tiktok');

  // Seuls les douze derniers médias sont proposés ici : autant ne demander
  // que ceux-là plutôt que toute la médiathèque.
  const { data: allMedia = [] } = useQuery<Media[]>({
    queryKey: ['/api/media', { limit: RECENT_MEDIA_COUNT }],
  });

  // Afficher seulement les 12 derniers médias triés par date décroissante
  // Utilisation de useMemo pour éviter de re-trier à chaque render
  // Création d'une copie pour ne pas muter le cache React Query
  const mediaList = useMemo(() => {
    return [...allMedia]
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA; // Tri décroissant (plus récent en premier)
      })
      .slice(0, RECENT_MEDIA_COUNT);
  }, [allMedia]);

  // Ne sert qu'à griser les créneaux déjà pris dans le sélecteur de date : le
  // passé n'a aucune influence sur une planification à venir.
  const { data: scheduledPosts = [] } = useQuery<ScheduledPost[]>({
    queryKey: ['/api/scheduled-posts', { startDate: startOfToday().toISOString() }],
  });

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
      // Add to selected media array if not already at max (10)
      setSelectedMedia(prev => {
        if (prev.length >= 10) {
          toast({
            title: "Limite atteinte",
            description: "Maximum 10 photos par publication",
            variant: "destructive",
          });
          return prev;
        }
        return [...prev, data.id];
      });
      toast({
        title: "Succès",
        description: "Photo téléchargée avec succès",
      });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de télécharger la photo",
        variant: "destructive",
      });
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      uploadMutation.mutate(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
      "video/*": [".mp4", ".mov", ".webm", ".3gp", ".3gpp", ".mkv", ".avi"],
    },
    maxSize: 52428800,
    noClick: true,
    noKeyboard: true,
  });

  const generateTextMutation = useMutation({
    mutationFn: async (productInfoText: string) => {
      const productInfo = {
        name: productInfoText.match(/Produit:\s*(.+?)(?:\n|$)/i)?.[1] ||
          productInfoText.match(/Nom:\s*(.+?)(?:\n|$)/i)?.[1] ||
          productInfoText,
        price: productInfoText.match(/Prix:\s*(.+?)(?:\n|$)/i)?.[1] || "",
        description: productInfoText.match(/Description:\s*(.+?)(?:\n|$)/i)?.[1] || "",
        features: productInfoText.match(/Caractéristiques:\s*(.+?)(?:\n|$)/i)?.[1]?.split(",") || [],
      };
      const response = await apiRequest('POST', '/api/ai/generate', productInfo);
      return response.json();
    },
    onSuccess: (data: any) => {
      const variants = data.variants || [];
      setGeneratedVariants(variants);
      toast({
        title: "Texte généré",
        description: `${variants.length} variations créées`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ai/generations'] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Erreur",
        description: getErrorMessage(error, "Impossible de générer le texte"),
        variant: "destructive",
      });
    },
  });

  const createPostMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest('POST', '/api/posts', data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'], refetchType: 'all' });
      toast({
        title: "Publication créée",
        description: "La publication a été créée avec succès",
      });
      navigate('/');
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de créer la publication",
        variant: "destructive",
      });
    },
  });

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

  const handleCreatePost = () => {
    // Le texte est facultatif si au moins un média est présent
    if (!postText.trim() && selectedMedia.length === 0) {
      toast({
        title: "Contenu requis",
        description: "Veuillez saisir du texte ou sélectionner un média",
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

    if ((postType === 'story' || postType === 'both') && selectedMedia.length === 0) {
      toast({
        title: "Média requis",
        description: "Les stories nécessitent au moins une image ou vidéo",
        variant: "destructive",
      });
      return;
    }

    createPostMutation.mutate({
      content: postText,
      scheduledFor: scheduledDate ? scheduledDate.toISOString() : undefined,
      mediaIds: selectedMedia.length > 0 ? selectedMedia : undefined,
      pageIds: selectedPages,
      postType,
    });
  };

  const handleUseVariant = (text: string) => {
    setPostText(text);
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Logs de diagnostic pour Android
      console.log('📹 Capture camera détectée:', {
        nom: file.name,
        type: file.type,
        taille: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        estVideo: file.type.startsWith('video/')
      });

      // Correction Android : créer un nom valide si le fichier n'a pas de nom
      let fileToUpload = file;
      if (!file.name || file.name === 'blob' || file.name === '') {
        const extension = file.type.split('/')[1] || 'jpg';
        const newFileName = `camera-${Date.now()}.${extension}`;
        fileToUpload = new File([file], newFileName, { type: file.type });
        console.log('✅ Nom de fichier corrigé:', newFileName);
      }

      // Vérification taille (50 MB max)
      if (file.size > 52428800) {
        toast({
          title: "Fichier trop volumineux",
          description: `La taille maximale est de 50 MB. Votre fichier fait ${(file.size / 1024 / 1024).toFixed(2)} MB`,
          variant: "destructive",
        });
        console.error('❌ Fichier rejeté: trop volumineux');
        e.target.value = '';
        return;
      }

      uploadMutation.mutate(fileToUpload);
      e.target.value = '';
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSelectedMedia((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const contentReady = postText.trim().length > 0 || selectedMedia.length > 0;
  const needsMedia = postType === 'story' || postType === 'both';
  const targetsReady = selectedPages.length > 0 && (!needsMedia || selectedMedia.length > 0);

  const lockedReason = (index: number): string | null => {
    if (index >= 2 && !contentReady) return "Ajoutez un média ou un texte";
    if (index >= 3 && !targetsReady) return selectedPages.length === 0 ? "Choisissez au moins une page" : "Les stories nécessitent un média";
    return null;
  };

  const goTo = (index: number) => {
    const reason = lockedReason(index);
    if (reason) {
      toast({ title: "Étape incomplète", description: reason, variant: "destructive" });
      return;
    }
    setStep(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const formatLabel = postType === 'feed' ? "Fil d'actualité" : postType === 'story' ? "Story" : "Fil + Story";
  const selectedPageNames = pages.filter(p => selectedPages.includes(p.id)).map(p => p.pageName);

  const toggleMedia = (mediaId: string) => {
    if (selectedMedia.includes(mediaId)) {
      setSelectedMedia(prev => prev.filter(id => id !== mediaId));
    } else if (selectedMedia.length < 10) {
      setSelectedMedia(prev => [...prev, mediaId]);
    } else {
      toast({
        title: "Limite atteinte",
        description: "Maximum 10 médias par publication",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Page width="default">
        <PageHeader
          icon={PenSquare}
          title="Nouvelle publication"
          description="Préparez une publication photo ou vidéo pour Facebook et Instagram."
        />

        <Stepper steps={STEPS} current={step} lockedReason={lockedReason} onStepClick={goTo} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              onChange={handleCameraCapture}
              className="hidden"
            />

            {/* ÉTAPE 1 : Médias */}
            {step === 0 && (
              <Card className="fade-in">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle>Choisissez vos médias</CardTitle>
                    <CardDescription>Jusqu'à 10 photos ou vidéos. Facultatif pour une publication texte.</CardDescription>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={uploadMutation.isPending}
                      size="icon"
                      variant="outline"
                      className="lg:hidden"
                      aria-label="Prendre une photo"
                      data-testid="button-camera-capture"
                    >
                      <Camera className="w-4 h-4" />
                    </Button>
                    <Button
                      onClick={open}
                      disabled={uploadMutation.isPending}
                      size="sm"
                      variant="outline"
                      data-testid="button-upload-new-media"
                    >
                      <Upload className="w-4 h-4" />
                      Importer
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div
                    {...getRootProps()}
                    className={`rounded-xl transition-colors ${isDragActive ? 'bg-primary/5 ring-2 ring-primary ring-offset-2 ring-offset-card' : ''}`}
                  >
                    <input {...getInputProps()} />
                    {mediaList.length === 0 ? (
                      <EmptyState
                        compact
                        icon={ImageIcon}
                        title={isDragActive ? "Déposez votre fichier ici" : "Aucun média pour l'instant"}
                        description="Glissez-déposez une image ou une vidéo, ou importez-la depuis votre appareil."
                        action={
                          <div className="flex flex-wrap justify-center gap-2">
                            <Button
                              onClick={() => cameraInputRef.current?.click()}
                              disabled={uploadMutation.isPending}
                              size="sm"
                              variant="outline"
                              className="lg:hidden"
                              data-testid="button-camera-first"
                            >
                              <Camera className="w-4 h-4" />
                              Prendre une photo
                            </Button>
                            <Button
                              onClick={open}
                              disabled={uploadMutation.isPending}
                              size="sm"
                              data-testid="button-upload-first-media"
                            >
                              <Upload className="w-4 h-4" />
                              Importer un fichier
                            </Button>
                          </div>
                        }
                      />
                    ) : (
                      <>
                        {selectedMedia.length > 0 && (
                          <div className="mb-5">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-sm font-medium">Sélection ({selectedMedia.length}/10)</p>
                              <p className="text-xs text-muted-foreground">Glissez pour réordonner</p>
                            </div>
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={handleDragEnd}
                            >
                              <SortableContext
                                items={selectedMedia}
                                strategy={rectSortingStrategy}
                              >
                                <div className="grid grid-cols-4 gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2 sm:grid-cols-5">
                                  {selectedMedia.map((mediaId, index) => {
                                    const media = mediaList.find(m => m.id === mediaId);
                                    if (!media) return null;

                                    return (
                                      <SortableMediaItem
                                        key={media.id}
                                        media={media}
                                        index={index}
                                        isSelected={true}
                                        onToggle={() => {
                                          setSelectedMedia(prev => prev.filter(id => id !== media.id));
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              </SortableContext>
                            </DndContext>
                          </div>
                        )}
                        <p className="mb-2 text-sm font-medium">Médias récents</p>
                        <div className="grid max-h-[460px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                          {mediaList.map((media) => {
                            const isSelected = selectedMedia.includes(media.id);
                            const isVideo = media.type === 'video';
                            const order = selectedMedia.indexOf(media.id);

                            return (
                              <button
                                key={media.id}
                                onClick={() => toggleMedia(media.id)}
                                className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${isSelected
                                  ? 'border-primary'
                                  : 'border-transparent hover:border-primary/40'
                                  }`}
                                aria-pressed={isSelected}
                                data-testid={`button-select-media-${media.id}`}
                              >
                                <MediaThumbnail
                                  src={media.facebookFeedUrl || media.originalUrl}
                                  alt={media.fileName}
                                  thumbnailUrl={media.thumbnailUrl ?? undefined}
                                  type={isVideo ? 'video' : 'image'}
                                />
                                {isSelected && (
                                  <div className="absolute inset-0 bg-primary/20">
                                    <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow">
                                      {order + 1}
                                    </span>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ÉTAPE 2 : Texte */}
            {step === 1 && (
              <div className="fade-in space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Rédigez votre texte</CardTitle>
                    <CardDescription>Écrivez-le vous-même ou laissez l'IA vous proposer des versions.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Collapsible open={aiOpen} onOpenChange={setAiOpen} className="rounded-xl border border-primary/20 bg-primary/5">
                      <CollapsibleTrigger className="flex w-full items-center gap-3 p-3 text-left" data-testid="toggle-ai-assist">
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
                          id="productInfo"
                          value={productInfo}
                          onChange={(e) => setProductInfo(e.target.value)}
                          placeholder="Ex. : Produit : Chaise en rotin — Prix : 49 € — Caractéristiques : légère, résistante"
                          rows={4}
                          className="bg-card"
                          data-testid="input-product-info"
                        />
                        <Button
                          onClick={handleGenerateText}
                          disabled={generateTextMutation.isPending}
                          className="w-full sm:w-auto"
                          data-testid="button-generate-text"
                        >
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
                                    variant={postText === variant.text ? "secondary" : "default"}
                                    className="h-8"
                                    onClick={() => handleUseVariant(variant.text)}
                                    data-testid={`button-use-variant-${index}`}
                                  >
                                    {postText === variant.text ? <><Check className="h-3.5 w-3.5" /> Utilisée</> : "Utiliser"}
                                  </Button>
                                </div>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed">{variant.text}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="post-text">Texte de la publication</Label>
                        <span className="text-xs tabular-nums text-muted-foreground">{postText.length} caractères</span>
                      </div>
                      <Textarea
                        id="post-text"
                        value={postText}
                        onChange={(e) => setPostText(e.target.value)}
                        placeholder="Écrivez votre texte ici…"
                        rows={9}
                        data-testid="textarea-post-text"
                      />
                      {selectedMedia.length > 0 && !postText.trim() && (
                        <p className="text-xs text-muted-foreground">Le texte est facultatif puisque vous avez ajouté un média.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ÉTAPE 3 : Diffusion */}
            {step === 2 && (
              <div className="fade-in space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Où publier ?</CardTitle>
                    <CardDescription>Sélectionnez une ou plusieurs pages.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {pages.length === 0 ? (
                      <EmptyState
                        compact
                        icon={Link2}
                        title="Aucune page connectée"
                        description="Connectez une page Facebook ou Instagram pour pouvoir publier."
                        action={
                          <Button size="sm" onClick={() => navigate('/pages')} data-testid="link-add-pages">
                            Connecter un compte
                          </Button>
                        }
                      />
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {pages.map((page) => {
                          const checked = selectedPages.includes(page.id);
                          return (
                            <label
                              key={page.id}
                              htmlFor={`page-${page.id}`}
                              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${checked ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                            >
                              <PlatformIcon platform={page.platform} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{page.pageName}</span>
                                <span className="block text-xs text-muted-foreground">{platformLabel(page.platform)}</span>
                              </span>
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
                                data-testid={`checkbox-page-${page.id}`}
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Format</CardTitle>
                    <CardDescription>Comment la publication apparaîtra.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <RadioGroup
                      value={postType}
                      onValueChange={(value) => setPostType(value as 'feed' | 'story' | 'both')}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                      data-testid="select-post-type"
                    >
                      {FORMATS.map(({ value, label, description, icon: Icon }) => (
                        <label
                          key={value}
                          htmlFor={`format-${value}`}
                          className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors sm:flex-col ${postType === value ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                          data-testid={`option-${value}`}
                        >
                          <div className="flex items-center justify-between">
                            <Icon className={`h-5 w-5 ${postType === value ? 'text-primary' : 'text-muted-foreground'}`} />
                            <RadioGroupItem value={value} id={`format-${value}`} className="hidden sm:block" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{label}</p>
                            <p className="text-xs text-muted-foreground">{description}</p>
                          </div>
                        </label>
                      ))}
                    </RadioGroup>
                    {needsMedia && selectedMedia.length === 0 && (
                      <p className="mt-3 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        Une story nécessite au moins une image ou vidéo : revenez à l'étape Médias.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ÉTAPE 4 : Planification */}
            {step === 3 && (
              <Card className="fade-in">
                <CardHeader>
                  <CardTitle>Quand publier ?</CardTitle>
                  <CardDescription>Publiez tout de suite ou choisissez une date.</CardDescription>
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
                      { value: 'now', label: 'Publier maintenant', description: 'Envoi immédiat après validation', icon: Zap },
                      { value: 'later', label: 'Programmer', description: 'Choisir une date et une heure', icon: CalendarClock },
                    ] as const).map(({ value, label, description, icon: Icon }) => (
                      <label
                        key={value}
                        htmlFor={`when-${value}`}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${scheduleMode === value ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                        data-testid={`option-schedule-${value}`}
                      >
                        <Icon className={`h-5 w-5 ${scheduleMode === value ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="flex-1">
                          <span className="block text-sm font-medium">{label}</span>
                          <span className="block text-xs text-muted-foreground">{description}</span>
                        </span>
                        <RadioGroupItem value={value} id={`when-${value}`} />
                      </label>
                    ))}
                  </RadioGroup>

                  {scheduleMode === 'later' && (
                    <div className="space-y-2">
                      <Label>Date et heure</Label>
                      <DateTimePicker
                        value={scheduledDate}
                        onChange={setScheduledDate}
                        occupiedDates={scheduledPosts
                          .filter(post => post.scheduledAt)
                          .map(post => new Date(post.scheduledAt!))}
                        placeholder="Choisir une date"
                      />
                      <p className="text-xs text-muted-foreground">Les créneaux déjà occupés sont signalés dans le calendrier.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <StepNavigation
              onBack={() => goTo(step - 1)}
              backDisabled={step === 0}
              onNext={() => goTo(step + 1)}
              nextLabel={step === 0 && selectedMedia.length === 0 ? "Continuer sans média" : "Continuer"}
              next={
                step === STEPS.length - 1 ? (
                  <Button
                    onClick={() => {
                      if (scheduleMode === 'later' && !scheduledDate) {
                        toast({ title: "Date manquante", description: "Choisissez une date ou publiez maintenant.", variant: "destructive" });
                        return;
                      }
                      setPreviewModalOpen(true);
                    }}
                    disabled={createPostMutation.isPending}
                    variant="brand"
                    className="w-full sm:w-auto"
                    data-testid="button-preview-post"
                  >
                    <Send className="w-4 h-4" />
                    Prévisualiser et {scheduleMode === 'later' ? 'programmer' : 'publier'}
                  </Button>
                ) : undefined
              }
            />
          </div>

          {/* Récapitulatif */}
          <aside className="hidden lg:block">
            <Card className="sticky top-6">
              <CardHeader className="pb-3">
                <CardTitle>Récapitulatif</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {selectedMedia.length > 0 ? (
                  <div className="grid grid-cols-4 gap-1.5">
                    {selectedMedia.slice(0, 8).map((id) => {
                      const media = mediaList.find(m => m.id === id);
                      if (!media) return null;
                      return (
                        <div key={id} className="aspect-square overflow-hidden rounded-md">
                          <MediaThumbnail
                            src={media.facebookFeedUrl || media.originalUrl}
                            alt={media.fileName}
                            thumbnailUrl={media.thumbnailUrl ?? undefined}
                            type={media.type === 'video' ? 'video' : 'image'}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                {postText.trim() && <p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">{postText}</p>}
                <dl className="space-y-2 border-t pt-3">
                  <SummaryRow label="Médias" value={selectedMedia.length ? `${selectedMedia.length} sélectionné(s)` : "Aucun"} ok={selectedMedia.length > 0} />
                  <SummaryRow label="Texte" value={postText.trim() ? `${postText.length} caractères` : "Vide"} ok={!!postText.trim()} />
                  <SummaryRow label="Pages" value={selectedPageNames.length ? selectedPageNames.join(", ") : "Aucune"} ok={selectedPageNames.length > 0} />
                  <SummaryRow label="Format" value={formatLabel} ok />
                  <SummaryRow
                    label="Envoi"
                    value={scheduleMode === 'later' && scheduledDate ? format(scheduledDate, "d MMM 'à' HH:mm", { locale: fr }) : "Immédiat"}
                    ok
                  />
                </dl>
              </CardContent>
            </Card>
          </aside>
        </div>
      </Page>

      <Dialog open={uploadMutation.isPending}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">
              Import en cours…
            </h3>
            <p className="text-sm text-muted-foreground text-center">
              Votre fichier est en cours d'envoi et de traitement.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <PreviewModal
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        postText={postText}
        selectedMedia={selectedMedia}
        mediaList={mediaList}
        onPublish={handleCreatePost}
        isPublishing={createPostMutation.isPending}
      />
    </>
  );
}
