import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CloudUpload, Image as ImageIcon, Video, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function MediaUpload() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<any>(null);

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
    maxSize: 52428800, // 50MB
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

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="border-b border-border p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Téléchargement et recadrage de médias</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Ajoutez des photos ou vidéos, elles seront automatiquement recadrées pour Facebook et Instagram
          </p>
        </div>
        <Button 
          onClick={open}
          data-testid="button-browse"
        >
          <CloudUpload className="w-4 h-4 mr-2" />
          Parcourir
        </Button>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upload Zone */}
          <div>
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all
                ${isDragActive ? "border-primary bg-accent" : "border-border hover:border-primary hover:bg-accent"}
              `}
              data-testid="dropzone-upload"
            >
              <input {...getInputProps()} />
              <CloudUpload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-foreground font-medium mb-2">
                {isDragActive ? "Déposez vos fichiers ici" : "Glissez-déposez vos fichiers ici"}
              </p>
              <p className="text-sm text-muted-foreground mb-4">ou cliquez pour parcourir</p>
              <p className="text-xs text-muted-foreground">PNG, JPG, MP4 jusqu'à 50MB</p>
            </div>

            {/* Uploaded Files */}
            <div className="mt-6 space-y-3">
              <h4 className="text-sm font-semibold text-foreground mb-3">
                Fichiers téléchargés ({(mediaList as any[])?.length || 0})
              </h4>

              {(mediaList as any[])?.slice(0, 3).map((media: any) => (
                <div
                  key={media.id}
                  onClick={() => setSelectedFile(media)}
                  className="flex items-center gap-3 p-3 rounded-lg bg-accent border border-border cursor-pointer hover:bg-accent/80 transition-colors"
                  data-testid={`media-item-${media.id}`}
                >
                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                    {media.type === "video" ? (
                      <Video className="w-6 h-6 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{media.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {(media.fileSize / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-chart-2 text-white">
                      Prêt
                    </span>
                    <button
                      onClick={() => deleteMutation.mutate(media.id)}
                      className="text-muted-foreground hover:text-destructive transition-all"
                      data-testid={`button-delete-${media.id}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Preview and Crop */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-3">Aperçu et recadrage automatique</h4>
            <div className="space-y-4">
              {/* Facebook Feed Preview */}
              <div className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <i className="fab fa-facebook text-chart-1"></i>
                    <span className="text-sm font-medium text-foreground">Facebook - Feed</span>
                  </div>
                  <span className="text-xs text-muted-foreground">1200x630</span>
                </div>
                <div className="aspect-[1.91/1] bg-muted rounded-lg overflow-hidden">
                  {selectedFile?.facebookFeedUrl ? (
                    <img
                      src={selectedFile.facebookFeedUrl}
                      alt="Facebook preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-12 h-12 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>

              {/* Instagram Feed Preview */}
              <div className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <i className="fab fa-instagram text-chart-5"></i>
                    <span className="text-sm font-medium text-foreground">Instagram - Feed</span>
                  </div>
                  <span className="text-xs text-muted-foreground">1080x1080</span>
                </div>
                <div className="aspect-square bg-muted rounded-lg overflow-hidden">
                  {selectedFile?.instagramFeedUrl ? (
                    <img
                      src={selectedFile.instagramFeedUrl}
                      alt="Instagram feed preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-12 h-12 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>

              {/* Instagram Story Preview */}
              <div className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <i className="fab fa-instagram text-chart-5"></i>
                    <span className="text-sm font-medium text-foreground">Instagram - Story</span>
                  </div>
                  <span className="text-xs text-muted-foreground">1080x1920</span>
                </div>
                <div className="aspect-[9/16] bg-muted rounded-lg overflow-hidden max-w-[200px]">
                  {selectedFile?.instagramStoryUrl ? (
                    <img
                      src={selectedFile.instagramStoryUrl}
                      alt="Instagram story preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
