import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Send, Sparkles, Image as ImageIcon, Calendar, Upload, Camera, GripVertical, Loader2 } from "lucide-react";
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
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
        isSelected
          ? 'border-primary ring-2 ring-primary'
          : 'border-transparent hover:border-muted-foreground'
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full h-full min-h-[44px]"
        data-testid={`button-select-media-${media.id}`}
      >
        {isVideo ? (
          <video
            src={media.originalUrl}
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            src={media.facebookFeedUrl || media.originalUrl}
            alt={media.fileName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </button>
      {isSelected && (
        <>
          <div className="absolute top-2 right-2 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold shadow-lg">
            {index + 1}
          </div>
          <div
            {...attributes}
            {...listeners}
            className="absolute top-2 left-2 w-10 h-10 bg-black/70 rounded-full flex items-center justify-center cursor-move hover:bg-black/90 transition-colors touch-manipulation"
          >
            <GripVertical className="w-5 h-5 text-white" />
          </div>
        </>
      )}
    </div>
  );
}

export default function NewPostMobile() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  const { data: pages = [] } = useQuery<SocialPage[]>({
    queryKey: ['/api/pages'],
  });

  const { data: allMedia = [] } = useQuery<Media[]>({
    queryKey: ['/api/media'],
  });

  const mediaList = useMemo(() => {
    return [...allMedia]
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 12);
  }, [allMedia]);

  const { data: scheduledPosts = [] } = useQuery<ScheduledPost[]>({
    queryKey: ['/api/scheduled-posts'],
  });

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
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de générer le texte",
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
    if (!postText.trim()) {
      toast({
        title: "Contenu requis",
        description: "Veuillez saisir le contenu de la publication",
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
    toast({
      title: "Texte sélectionné",
      description: "Le texte a été ajouté à votre publication",
    });
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      let fileToUpload = file;
      if (!file.name || file.name === 'blob' || file.name === '') {
        const extension = file.type.split('/')[1] || 'jpg';
        const newFileName = `camera-${Date.now()}.${extension}`;
        fileToUpload = new File([file], newFileName, { type: file.type });
      }

      if (file.size > 52428800) {
        toast({
          title: "Fichier trop volumineux",
          description: `La taille maximale est de 50 MB. Votre fichier fait ${(file.size / 1024 / 1024).toFixed(2)} MB`,
          variant: "destructive",
        });
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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <div className="p-4 space-y-6 pb-24">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Nouvelle publication</h1>
            <p className="text-sm text-muted-foreground">
              Créez et planifiez une nouvelle publication
            </p>
          </div>

          {/* MOBILE: Single column layout */}
          <div className="space-y-6">
            {/* Média Card */}
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Média</CardTitle>
                    <CardDescription className="text-xs">Sélectionnez ou uploadez</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={uploadMutation.isPending}
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      data-testid="button-camera-capture"
                    >
                      <Camera className="w-5 h-5" />
                    </Button>
                    <Button
                      onClick={open}
                      disabled={uploadMutation.isPending}
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      data-testid="button-upload-new-media"
                    >
                      <Upload className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*,video/*"
                  capture="environment"
                  onChange={handleCameraCapture}
                  className="hidden"
                />
                <div {...getRootProps()} className={`${isDragActive ? 'bg-primary/5 border-primary' : ''}`}>
                  <input {...getInputProps()} />
                  {mediaList.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                      <ImageIcon className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground mb-4 text-sm">
                        {isDragActive ? "Déposez votre photo ici" : "Aucun média disponible"}
                      </p>
                      <div className="flex flex-col gap-3">
                        <Button
                          onClick={() => cameraInputRef.current?.click()}
                          disabled={uploadMutation.isPending}
                          size="lg"
                          variant="outline"
                          className="w-full min-h-[48px]"
                          data-testid="button-camera-first"
                        >
                          <Camera className="w-5 h-5 mr-2" />
                          Prendre une photo
                        </Button>
                        <Button
                          onClick={open}
                          disabled={uploadMutation.isPending}
                          size="lg"
                          className="w-full min-h-[48px]"
                          data-testid="button-upload-first-media"
                        >
                          <Upload className="w-5 h-5 mr-2" />
                          Uploader une photo
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {selectedMedia.length > 0 && (
                        <div className="mb-4">
                          <div className="text-sm font-medium text-muted-foreground mb-3">
                            Photos sélectionnées ({selectedMedia.length}/10)
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
                              <div className="grid grid-cols-2 gap-3 p-4 bg-accent/20 rounded-lg border border-accent">
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
                      <div className="text-sm font-medium text-muted-foreground mb-3">
                        Toutes les photos ({mediaList.length})
                      </div>
                      <div className="max-h-[400px] overflow-y-auto">
                        <div className="grid grid-cols-2 gap-3">
                          {mediaList.map((media) => {
                            const isSelected = selectedMedia.includes(media.id);
                            const isVideo = media.type === 'video';

                            return (
                              <button
                                key={media.id}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedMedia(prev => prev.filter(id => id !== media.id));
                                  } else if (selectedMedia.length < 10) {
                                    setSelectedMedia(prev => [...prev, media.id]);
                                  } else {
                                    toast({
                                      title: "Limite atteinte",
                                      description: "Maximum 10 photos par publication",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all min-h-[44px] ${
                                  isSelected
                                    ? 'border-primary ring-2 ring-primary opacity-50'
                                    : 'border-transparent hover:border-muted-foreground'
                                }`}
                                data-testid={`button-select-media-${media.id}`}
                              >
                                {isVideo ? (
                                  <video
                                    src={media.originalUrl}
                                    className="w-full h-full object-cover"
                                    muted
                                    playsInline
                                    preload="metadata"
                                  />
                                ) : (
                                  <img
                                    src={media.facebookFeedUrl || media.originalUrl}
                                    alt={media.fileName}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                )}
                                {isSelected && (
                                  <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                                    <div className="text-xs font-semibold text-primary bg-white px-2 py-1 rounded">Sélectionnée</div>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Contenu Card */}
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <CardTitle className="text-lg">Contenu</CardTitle>
                <CardDescription className="text-xs">Informations du produit ou message</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="productInfo" className="text-sm">Informations du produit</Label>
                  <Textarea
                    id="productInfo"
                    value={productInfo}
                    onChange={(e) => setProductInfo(e.target.value)}
                    placeholder="Décrivez votre produit : nom, caractéristiques, prix, etc."
                    rows={5}
                    className="mt-2"
                    data-testid="input-product-info"
                  />
                </div>
                <Button
                  onClick={handleGenerateText}
                  disabled={generateTextMutation.isPending}
                  className="w-full min-h-[48px]"
                  size="lg"
                  data-testid="button-generate-text"
                >
                  <Sparkles className="w-5 h-5 mr-2" />
                  {generateTextMutation.isPending ? 'Génération...' : 'Générer le texte IA'}
                </Button>
              </CardContent>
            </Card>

            {/* Variations générées */}
            {generatedVariants.length > 0 && (
              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="p-5">
                  <CardTitle className="text-lg">Variations générées par l'IA</CardTitle>
                  <CardDescription className="text-xs">Cliquez sur "Utiliser"</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {generatedVariants.map((variant, index) => (
                    <div
                      key={index}
                      className="p-4 rounded-lg border bg-card"
                    >
                      <div className="space-y-3">
                        <div className="text-xs font-semibold text-muted-foreground">
                          {variant.variant || `Version ${index + 1}`}
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {variant.text}
                        </p>
                        <Button
                          size="sm"
                          onClick={() => handleUseVariant(variant.text)}
                          className="w-full min-h-[44px]"
                          data-testid={`button-use-variant-${index}`}
                        >
                          Utiliser
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Texte de la publication */}
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <CardTitle className="text-lg">Texte de la publication</CardTitle>
                <CardDescription className="text-xs">Écrivez ou générez le texte</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder="Écrivez votre texte ici ou générez-le avec l'IA..."
                  rows={6}
                  data-testid="textarea-post-text"
                />
              </CardContent>
            </Card>

            {/* Pages cibles */}
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <CardTitle className="text-lg">Pages cibles</CardTitle>
                <CardDescription className="text-xs">Sélectionnez les pages</CardDescription>
              </CardHeader>
              <CardContent>
                {pages.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-3 text-sm">Aucune page connectée</p>
                    <Button
                      variant="link"
                      onClick={() => navigate('/pages')}
                      className="min-h-[44px]"
                      data-testid="link-add-pages"
                    >
                      Ajouter des pages
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pages.map((page) => (
                      <div key={page.id} className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent touch-manipulation">
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
                          className="w-5 h-5"
                          data-testid={`checkbox-page-${page.id}`}
                        />
                        <label
                          htmlFor={`page-${page.id}`}
                          className="text-sm font-medium leading-relaxed flex-1 cursor-pointer"
                        >
                          {page.pageName} ({page.platform})
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Type de publication */}
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <CardTitle className="text-lg">Type de publication</CardTitle>
                <CardDescription className="text-xs">Choisissez où publier</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label htmlFor="postType">Format</Label>
                <Select value={postType} onValueChange={(value: 'feed' | 'story' | 'both') => setPostType(value)}>
                  <SelectTrigger id="postType" className="min-h-[48px]" data-testid="select-post-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feed" data-testid="option-feed">Feed uniquement</SelectItem>
                    <SelectItem value="story" data-testid="option-story">Story uniquement</SelectItem>
                    <SelectItem value="both" data-testid="option-both">Feed + Story</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {postType === 'feed' && 'Publication classique dans le fil d\'actualité'}
                  {postType === 'story' && 'Story éphémère (24h) - Nécessite un média'}
                  {postType === 'both' && 'Publie à la fois dans le feed et en story - Nécessite un média'}
                </p>
              </CardContent>
            </Card>

            {/* Planification */}
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <CardTitle className="text-lg">Planification</CardTitle>
                <CardDescription className="text-xs">Programmez (optionnel)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label>Date et heure</Label>
                <DateTimePicker
                  value={scheduledDate}
                  onChange={setScheduledDate}
                  occupiedDates={scheduledPosts
                    .filter(post => post.scheduledAt)
                    .map(post => new Date(post.scheduledAt!))}
                  placeholder="Publier immédiatement"
                />
                <p className="text-xs text-muted-foreground">
                  Sélectionnez une date pour planifier, sinon publication immédiate
                </p>
              </CardContent>
            </Card>

            {/* Bouton Publier - Fixed au bottom */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border shadow-lg">
              <Button
                onClick={() => setPreviewModalOpen(true)}
                disabled={createPostMutation.isPending}
                className="w-full bg-gradient-to-r from-primary to-secondary hover:opacity-90 shadow-lg min-h-[52px]"
                size="lg"
                data-testid="button-preview-post"
              >
                <Send className="w-5 h-5 mr-2" />
                Prévisualiser et publier
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Dialog open={uploadMutation.isPending}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              Upload en cours...
            </h3>
            <p className="text-sm text-muted-foreground text-center">
              Votre image est en cours de téléchargement et de traitement.
              <br />
              Veuillez patienter.
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
    </div>
  );
}
