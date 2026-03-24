import { useState } from "react";
import { Player } from "@remotion/player";
import { ImageComposition } from "@/remotion/ImageComposition";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadCloud, Video, Loader2 } from "lucide-react";

export default function RemotionVideoPage() {
  const [images, setImages] = useState<File[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, 4);
      setImages(files);
      
      const ObjectUrls = files.map(file => URL.createObjectURL(file));
      setImageUrls(ObjectUrls);
    }
  };

  const handleGenerate = async () => {
    if (images.length < 3) {
      toast({
        title: "Pas assez d'images",
        description: "Veuillez sélectionner au moins 3 images.",
        variant: "destructive"
      });
      return;
    }

    setIsRendering(true);
    setVideoUrl(null);
    
    try {
      const formData = new FormData();
      images.forEach(img => formData.append("images", img));
      
      const response = await fetch("/api/remotion/render", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Erreur de génération");
      }

      const data = await response.json();
      setVideoUrl(data.url);
      
      toast({
        title: "Vidéo générée !",
        description: "Votre vidéo Remotion est prête.",
      });
      
    } catch (err) {
      toast({
        title: "Erreur",
        description: "Impossible de créer la vidéo.",
        variant: "destructive"
      });
    } finally {
      setIsRendering(false);
    }
  };

  // 3s per image, 30fps
  const totalFrames = imageUrls.length > 0 ? imageUrls.length * 3 * 30 : 300;

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Générateur Remotion</h1>
      <p className="text-muted-foreground">Créez une vidéo à partir de vos images avec Remotion.</p>

      <div className="grid md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>1. Sélectionner des Images</CardTitle>
            <CardDescription>Choisissez entre 3 et 4 images.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center relative hover:bg-muted/50 transition-colors">
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <UploadCloud className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="font-medium text-center">Glissez vos images ici ou cliquez</p>
              <p className="text-sm text-muted-foreground mt-2">{images.length} image(s) sélectionnée(s)</p>
            </div>

            {images.length > 0 && (
              <Button onClick={handleGenerate} disabled={isRendering || images.length < 3} className="w-full">
                {isRendering ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération en cours...</>
                ) : (
                  <><Video className="mr-2 h-4 w-4" /> Générer la vidéo MP4</>
                )}
              </Button>
            )}
            {videoUrl && (
              <div className="pt-4">
                <p className="font-semibold mb-2 text-green-600">Vidéo prête :</p>
                <video src={videoUrl} controls className="w-full rounded-md shadow" />
                <Button variant="outline" className="w-full mt-2" asChild>
                  <a href={videoUrl} download="remotion-video.mp4">Télécharger</a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Aperçu</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center bg-zinc-950 rounded-lg p-4 overflow-hidden">
             {imageUrls.length > 0 ? (
               <Player
                  component={ImageComposition}
                  inputProps={{ images: imageUrls }}
                  durationInFrames={totalFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={30}
                  controls
                  style={{
                    width: "auto",
                    height: "600px",
                    maxWidth: "100%",
                    borderRadius: "8px"
                  }}
               />
             ) : (
               <div className="h-[600px] w-full flex items-center justify-center text-muted-foreground">
                 Sélectionnez des images pour prévisualiser.
               </div>
             )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
