import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CloudUpload, Image as ImageIcon, Video, X, Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SiFacebook, SiInstagram } from "react-icons/si";

export default function MediaUpload() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [visibleCount, setVisibleCount] = useState(5);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { data: mediaList } = useQuery({
    queryKey: ["/api/media"],
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
      setSelectedFile(data);
      toast({
        title: "Succès",
        description: "Média téléchargé et traité avec succès",
      });
    },
    onError: () => {
      toast({
        title: "Erreur",
        description: "Impossible de télécharger le média",
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
      "image/*": [".png", ".jpg", ".jpeg", ".gif"],
      "video/*": [".mp4", ".mov"],
    },
    maxSize: 52428800,
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

      <div className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
                ${isDragActive ? "border-primary bg-primary/5 shadow-lg" : "border-border/50 hover:border-primary hover:bg-accent/30"}
              `}
              data-testid="dropzone-upload"
            >
              <input {...getInputProps()} />
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center mx-auto mb-6">
                <CloudUpload className="w-8 h-8 text-primary" />
              </div>
              <p className="text-foreground font-semibold text-lg mb-2">
                {isDragActive ? "Déposez vos fichiers ici" : "Glissez-déposez vos fichiers"}
              </p>
              <p className="text-sm text-muted-foreground mb-4">ou cliquez pour parcourir</p>
              <p className="text-xs text-muted-foreground font-medium">PNG, JPG, MP4 jusqu'à 50MB</p>
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
                        <div className="w-full h-full bg-muted/30 flex items-center justify-center">
                          <Video className="w-12 h-12 text-secondary" />
                        </div>
                      ) : (
                        <img 
                          src={media.originalUrl} 
                          alt={media.fileName}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(media.id);
                        }}
                        className="absolute top-2 right-2 w-8 h-8 bg-black/70 hover:bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`button-delete-${media.id}`}
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
                
                {/* Élément sentinelle pour le scroll infini */}
                {mediaList && visibleCount < (mediaList as any[]).length && (
                  <div ref={loadMoreRef} className="flex justify-center py-4 mt-3">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  </div>
                )}
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
    </div>
  );
}
