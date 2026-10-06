import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, handleUnauthorized } from "@/lib/queryClient";
import { MediaThumbnail } from "@/components/media-thumbnail";
import { CloudUpload, Image as ImageIcon, X, Upload, Loader2, ZoomIn, Camera, Trash2 } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { SiFacebook, SiInstagram } from "react-icons/si";

/** Nombre de vignettes chargées par page. */
const MEDIA_PAGE_SIZE = 15;

export default function MediaUpload() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [mediaToDelete, setMediaToDelete] = useState<any>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Pagination côté serveur : la médiathèque entière transitait pour n'afficher
  // que les premières vignettes. La clé reste préfixée par « /api/media » afin
  // que les invalidations existantes continuent de la rafraîchir.
  const {
    data: mediaPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/media", "pages"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const response = await fetch(`/api/media?limit=${MEDIA_PAGE_SIZE}&offset=${pageParam}`, {
        credentials: "include",
      });
      if (!response.ok) {
        // Même traitement que les autres requêtes : une session expirée renvoie
        // vers l'écran de connexion plutôt que sur une médiathèque vide.
        if (response.status === 401) handleUnauthorized("/api/media");
        throw new Error("Impossible de charger la médiathèque");
      }
      const items = (await response.json()) as any[];
      const total = Number(response.headers.get("X-Total-Count"));
      return { items, total: Number.isFinite(total) ? total : items.length };
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((count, page) => count + page.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const mediaList = mediaPages?.pages.flatMap(page => page.items) ?? [];
  const totalMedia = mediaPages?.pages[0]?.total ?? 0;

  const [uploadingCount, setUploadingCount] = useState(0);

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
      setSelectedFile(data);
    },
  });

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setUploadingCount(acceptedFiles.length);
    let successCount = 0;
    let errorCount = 0;

    // Upload tous les fichiers en parallèle
    const uploadPromises = acceptedFiles.map(async (file) => {
      try {
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
        successCount++;
        return response.json();
      } catch (error) {
        errorCount++;
        throw error;
      }
    });

    try {
      await Promise.all(uploadPromises);
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });

      toast({
        title: "Succès",
        description: `${successCount} média(s) téléchargé(s) avec succès`,
      });
    } catch (error) {
      if (successCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/media"] });
        toast({
          title: "Partiellement réussi",
          description: `${successCount} média(s) téléchargé(s), ${errorCount} échec(s)`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erreur",
          description: "Impossible de télécharger les médias",
          variant: "destructive",
        });
      }
    } finally {
      setUploadingCount(0);
    }
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
      "video/*": [".mp4", ".mov", ".webm", ".3gp", ".3gpp", ".mkv", ".avi"],
    },
    maxSize: 52428800,
    multiple: true,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/media/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      setSelectedFile(null);
    },
  });

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
      // Réinitialiser l'input pour permettre de capturer la même photo à nouveau
      e.target.value = '';
    }
  };

  // Scroll infini - IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => {
      if (loadMoreRef.current) {
        observer.unobserve(loadMoreRef.current);
      }
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const formatPreview = (label: string, size: string, url: string | undefined, aspect: string, width: string) => (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SiFacebook className="text-facebook" />
          <SiInstagram className="text-instagram" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{size}</span>
      </div>
      <div className={`mx-auto overflow-hidden rounded-md border bg-muted/40 ${aspect} ${width}`}>
        {url ? (
          <img src={url} alt={`Aperçu ${label}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        onChange={handleCameraCapture}
        className="hidden"
      />
      <div
        {...getRootProps()}
        className={`
          flex cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed bg-card p-6 text-center transition-colors sm:flex-row sm:text-left
          ${isDragActive ? "border-primary bg-primary/5" : "hover:border-primary/50"}
          ${uploadingCount > 0 ? "pointer-events-none opacity-60" : ""}
        `}
        data-testid="dropzone-upload"
      >
        <input {...getInputProps()} />
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {uploadingCount > 0 ? <Loader2 className="h-6 w-6 animate-spin" /> : <CloudUpload className="h-6 w-6" />}
        </div>
        <div className="flex-1">
          {uploadingCount > 0 ? (
            <>
              <p className="font-medium">Import en cours…</p>
              <p className="text-sm text-muted-foreground">{uploadingCount} fichier(s) en cours de traitement</p>
            </>
          ) : (
            <>
              <p className="font-medium">{isDragActive ? "Déposez vos fichiers ici" : "Glissez-déposez vos images et vidéos"}</p>
              <p className="text-sm text-muted-foreground">PNG, JPG ou MP4 jusqu'à 50 Mo — recadrées automatiquement pour le fil et les stories.</p>
            </>
          )}
        </div>
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            variant="outline"
            className="lg:hidden"
            data-testid="button-camera"
          >
            <Camera className="w-4 h-4" />
            Caméra
          </Button>
          <Button onClick={open} data-testid="button-browse">
            <Upload className="w-4 h-4" />
            Importer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Vos médias</h2>
            <span className="text-xs text-muted-foreground">{totalMedia} élément(s)</span>
          </div>

          {mediaList.length === 0 ? (
            <EmptyState
              icon={ImageIcon}
              title="Votre médiathèque est vide"
              description="Importez vos premières images ou vidéos pour les utiliser dans vos publications."
            />
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 xl:grid-cols-5">
              {mediaList.map((media: any) => {
                const selected = selectedFile?.id === media.id;
                return (
                  <div
                    key={media.id}
                    onClick={() => setSelectedFile(media)}
                    className={`group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${selected ? "border-primary" : "border-transparent hover:border-primary/40"}`}
                    data-testid={`media-item-${media.id}`}
                  >
                    <MediaThumbnail
                      src={media.facebookFeedUrl || media.originalUrl}
                      alt={media.fileName}
                      thumbnailUrl={media.thumbnailUrl ?? undefined}
                      type={media.type === 'video' ? 'video' : 'image'}
                    />
                    <div className="absolute right-1.5 top-1.5 flex gap-1.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      {media.type === "image" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setZoomImage(media.originalUrl);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-background/85 text-foreground shadow backdrop-blur hover:bg-background"
                          aria-label="Agrandir"
                          data-testid={`button-zoom-${media.id}`}
                        >
                          <ZoomIn className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMediaToDelete(media);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-background/85 text-destructive shadow backdrop-blur hover:bg-destructive hover:text-destructive-foreground"
                        aria-label="Supprimer"
                        data-testid={`button-delete-${media.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Élément sentinelle pour le scroll infini */}
          {hasNextPage ? (
            <div ref={loadMoreRef} className="mt-3 flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : null}
        </div>

        <aside>
          <div className="space-y-3 rounded-xl border bg-card p-4 shadow-soft lg:sticky lg:top-6">
            <div>
              <h2 className="text-sm font-semibold">Formats générés</h2>
              <p className="text-xs text-muted-foreground">
                {selectedFile ? selectedFile.fileName : "Cliquez sur un média pour voir ses recadrages."}
              </p>
            </div>
            {formatPreview("Fil", "1080×1080", selectedFile?.facebookFeedUrl || selectedFile?.instagramFeedUrl, "aspect-square", "w-full max-w-[260px]")}
            {formatPreview("Story", "1080×1920", selectedFile?.instagramStoryUrl, "aspect-[9/16]", "w-full max-w-[160px]")}
          </div>
        </aside>
      </div>

      <AlertDialog open={!!mediaToDelete} onOpenChange={(o) => !o && setMediaToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce média ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {mediaToDelete?.fileName} » sera définitivement retiré de la médiathèque.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (mediaToDelete) {
                  deleteMutation.mutate(mediaToDelete.id);
                  if (selectedFile?.id === mediaToDelete.id) setSelectedFile(null);
                }
                setMediaToDelete(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              Votre fichier est en cours d'envoi et de recadrage.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal pour voir l'image originale en plein écran */}
      <Dialog open={!!zoomImage} onOpenChange={() => setZoomImage(null)}>
        <DialogContent className="max-w-7xl w-[95vw] h-[95vh] p-0 bg-black/95">
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={zoomImage || ""}
              alt="Image originale"
              className="max-w-full max-h-full object-contain"
            />
            <button
              onClick={() => setZoomImage(null)}
              className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
