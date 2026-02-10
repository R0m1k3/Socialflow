import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getVideoThumbnailUrl } from "@/lib/media-utils";
import { CloudUpload, Image as ImageIcon, Video, X, Upload, Loader2, ZoomIn, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SiFacebook, SiInstagram } from "react-icons/si";

export default function MediaUpload() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [visibleCount, setVisibleCount] = useState(5);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const { data: mediaList } = useQuery({
    queryKey: ["/api/media"],
  });

  const [uploadingCount, setUploadingCount] = useState(0);

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
        });
        if (!response.ok) throw new Error("Upload failed");
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
        if (entries[0].isIntersecting && mediaList && visibleCount < (mediaList as any[]).length) {
          setVisibleCount(prev => Math.min(prev + 5, (mediaList as any[]).length));
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
  }, [mediaList, visibleCount]);

  return (
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-lg">
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-primary/5 to-secondary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
              <Upload className="text-white w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Médiathèque</h3>
              <p className="text-sm text-muted-foreground">Téléchargement et recadrage automatique</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              variant="outline"
              className="lg:hidden"
              data-testid="button-camera"
            >
              <Camera className="w-4 h-4" />
            </Button>
            <Button
              onClick={open}
              className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 rounded-xl"
              data-testid="button-browse"
            >
              <CloudUpload className="w-4 h-4 mr-2" />
              Parcourir
            </Button>
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
                ${isDragActive ? "border-primary bg-primary/5 shadow-lg" : "border-border/50 hover:border-primary hover:bg-accent/30"}
                ${uploadingCount > 0 ? "pointer-events-none opacity-50" : ""}
              `}
              data-testid="dropzone-upload"
            >
              <input {...getInputProps()} />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                onChange={handleCameraCapture}
                className="hidden"
              />
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center mx-auto mb-6">
                {uploadingCount > 0 ? (
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                ) : (
                  <CloudUpload className="w-8 h-8 text-primary" />
                )}
              </div>
              {uploadingCount > 0 ? (
                <>
                  <p className="text-foreground font-semibold text-lg mb-2">
                    Téléchargement en cours...
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {uploadingCount} fichier(s) en cours de traitement
                  </p>
                </>
              ) : (
                <>
                  <p className="text-foreground font-semibold text-lg mb-2">
                    {isDragActive ? "Déposez vos fichiers ici" : "Glissez-déposez vos fichiers"}
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">ou cliquez pour parcourir</p>
                  <p className="text-xs text-muted-foreground font-medium">PNG, JPG, MP4 jusqu'à 50MB</p>
                </>
              )}
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-foreground flex items-center justify-between">
                <span>Fichiers téléchargés</span>
                <span className="text-xs font-medium text-muted-foreground bg-muted/30 px-3 py-1 rounded-full">
                  {(mediaList as any[])?.length || 0} média(s)
                </span>
              </h4>

              <div className="max-h-[500px] overflow-y-auto">
                <div className="grid grid-cols-3 gap-3">
                  {(mediaList as any[])?.slice(0, visibleCount).map((media: any) => (
                    <div
                      key={media.id}
                      onClick={() => setSelectedFile(media)}
                      className="relative aspect-square rounded-lg overflow-hidden border-2 border-border/50 cursor-pointer hover:border-primary hover:shadow-lg transition-all group"
                      data-testid={`media-item-${media.id}`}
                    >
                      {media.type === "video" ? (
                        <>
                          <img
                            src={getVideoThumbnailUrl(media.originalUrl)}
                            alt={media.fileName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              // Fallback: replace broken img with Video icon
                              const target = e.currentTarget;
                              target.style.display = 'none';
                              const fallback = target.parentElement?.querySelector('.video-fallback');
                              if (fallback) (fallback as HTMLElement).style.display = 'flex';
                            }}
                          />
                          <div className="video-fallback w-full h-full bg-muted/30 flex items-center justify-center absolute inset-0" style={{ display: 'none' }}>
                            <Video className="w-12 h-12 text-secondary" />
                          </div>
                        </>
                      ) : (
                        <img
                          src={media.facebookFeedUrl || media.originalUrl}
                          alt={media.fileName}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="absolute top-2 right-2 flex gap-2">
                        {media.type === "image" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setZoomImage(media.originalUrl);
                            }}
                            className="w-8 h-8 bg-black/70 hover:bg-primary rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-zoom-${media.id}`}
                          >
                            <ZoomIn className="w-4 h-4 text-white" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(media.id);
                          }}
                          className="w-8 h-8 bg-black/70 hover:bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          data-testid={`button-delete-${media.id}`}
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Élément sentinelle pour le scroll infini */}
                {(mediaList && visibleCount < (mediaList as any[]).length) ? (
                  <div ref={loadMoreRef} className="flex justify-center py-4 mt-3">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-sm font-semibold text-foreground">Aperçu et recadrage automatique</h4>

            <div className="space-y-5">
              <div className="border border-border/50 rounded-xl p-5 bg-card shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <SiFacebook className="text-[#1877F2] text-lg" />
                    <SiInstagram className="text-[#E4405F] text-lg" />
                    <span className="text-sm font-semibold text-foreground">Feed</span>
                  </div>
                  <span className="text-xs text-muted-foreground bg-muted/30 px-2 py-1 rounded-md font-medium">1080×1080</span>
                </div>
                <div className="aspect-square bg-muted/30 rounded-lg overflow-hidden border border-border/50" style={{ width: '250px' }}>
                  {selectedFile?.facebookFeedUrl || selectedFile?.instagramFeedUrl ? (
                    <img
                      src={selectedFile.facebookFeedUrl || selectedFile.instagramFeedUrl}
                      alt="Feed preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-12 h-12 text-muted-foreground opacity-50" />
                    </div>
                  )}
                </div>
              </div>

              <div className="border border-border/50 rounded-xl p-5 bg-card shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <SiFacebook className="text-[#1877F2] text-lg" />
                    <SiInstagram className="text-[#E4405F] text-lg" />
                    <span className="text-sm font-semibold text-foreground">Story</span>
                  </div>
                  <span className="text-xs text-muted-foreground bg-muted/30 px-2 py-1 rounded-md font-medium">1080×1920</span>
                </div>
                <div className="aspect-[9/16] bg-muted/30 rounded-lg overflow-hidden border border-border/50" style={{ width: '200px' }}>
                  {selectedFile?.instagramStoryUrl ? (
                    <img
                      src={selectedFile.instagramStoryUrl}
                      alt="Story preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-10 h-10 text-muted-foreground opacity-50" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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
