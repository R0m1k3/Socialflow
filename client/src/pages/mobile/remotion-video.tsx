import { useState, useMemo } from "react";
import { Player } from "@remotion/player";
import { ImageComposition } from "@/remotion/ImageComposition";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadCloud, Video, Loader2, Menu, Check } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Sidebar from "@/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import type { Media } from "@shared/schema";

export default function MobileRemotionVideoPage() {
  const [images, setImages] = useState<File[]>([]);
  const [selectedLibraryImages, setSelectedLibraryImages] = useState<Media[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: allMedia = [] } = useQuery<Media[]>({
    queryKey: ['/api/media'],
  });
  const imageMediaList = allMedia.filter(m => m.type === 'image').slice(0, 20);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const remainingSlots = 4 - selectedLibraryImages.length;
      if (files.length > remainingSlots) {
         toast({ title: "Limite atteinte", description: `Vous ne pouvez ajouter que ${remainingSlots} image(s) supplémentaire(s).`, variant: "destructive" });
      }
      setImages(files.slice(0, remainingSlots));
    }
  };

  const toggleLibraryImage = (media: Media) => {
    setSelectedLibraryImages(prev => {
      const isSelected = prev.find(m => m.id === media.id);
      if (isSelected) {
        return prev.filter(m => m.id !== media.id);
      }
      if (images.length + prev.length >= 4) {
         toast({ title: "Limite", description: "Vous pouvez sélectionner 4 images maximum au total.", variant: "destructive" });
         return prev;
      }
      return [...prev, media];
    });
  };

  const combinedUrls = useMemo(() => {
    const urls: string[] = [];
    images.forEach(f => urls.push(URL.createObjectURL(f)));
    selectedLibraryImages.forEach(m => urls.push(m.originalUrl));
    return urls;
  }, [images, selectedLibraryImages]);

  const totalSelected = images.length + selectedLibraryImages.length;

  const handleGenerate = async () => {
    if (totalSelected < 3) {
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
      selectedLibraryImages.forEach(m => formData.append("existingImageUrls", m.originalUrl));
      
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
  const totalFrames = combinedUrls.length > 0 ? combinedUrls.length * 3 * 30 : 300;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header Mobile */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
              <Sheet>
                  <SheetTrigger asChild>
                      <Button variant="ghost" size="icon" className="-ml-2">
                          <Menu className="h-6 w-6" />
                      </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="p-0 w-[80%]">
                      <Sidebar />
                  </SheetContent>
              </Sheet>
              <h1 className="font-semibold text-lg">Générateur Remotion</h1>
          </div>
      </div>

      <main className="p-4 space-y-6">
        <p className="text-sm text-muted-foreground">Créez une vidéo à partir de vos images (version mobile).</p>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Sélectionner des Images</CardTitle>
            <CardDescription className="text-xs">Choisissez entre 3 et 4 images.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center relative bg-muted/30">
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <UploadCloud className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="font-medium text-sm text-center">Appuyez pour choisir</p>
              <p className="text-xs text-muted-foreground mt-1">{images.length} image(s)</p>
            </div>

            {imageMediaList.length > 0 && (
              <div className="pt-2 border-t border-border mt-2">
                  <p className="font-medium mb-3 text-sm">Bibliothèque :</p>
                  <div className="flex overflow-x-auto gap-2 pb-2">
                       {imageMediaList.map((media) => {
                           const isSelected = selectedLibraryImages.some(m => m.id === media.id);
                           return (
                               <div 
                                  key={media.id} 
                                  onClick={() => toggleLibraryImage(media)}
                                  className={`flex-shrink-0 w-20 h-20 relative rounded overflow-hidden border-2 cursor-pointer transition-all ${isSelected ? 'border-primary' : 'border-transparent'}`}
                               >
                                   <img src={media.originalUrl} className="w-full h-full object-cover" />
                                   {isSelected && (
                                       <div className="absolute top-1 right-1 bg-primary text-white p-0.5 rounded-full">
                                            <Check className="w-3 h-3" />
                                       </div>
                                   )}
                               </div>
                           )
                       })}
                  </div>
              </div>
            )}

            <div className="flex justify-between text-xs text-primary font-medium py-1">
                 <span>Total sélectionné : {totalSelected} / 4</span>
            </div>

            {totalSelected > 0 && (
              <Button onClick={handleGenerate} disabled={isRendering || totalSelected < 3} className="w-full h-12">
                {isRendering ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération...</>
                ) : (
                  <><Video className="mr-2 h-4 w-4" /> Générer MP4</>
                )}
              </Button>
            )}
            
            {videoUrl && (
              <div className="pt-4 border-t mt-4">
                <p className="font-semibold text-sm mb-2 text-green-600">Vidéo prête :</p>
                <video src={videoUrl} controls className="w-full rounded-md shadow bg-black" />
                <Button variant="outline" className="w-full mt-3" asChild>
                  <a href={videoUrl} download="remotion-video.mp4">Télécharger</a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">2. Aperçu</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center bg-zinc-950 rounded-lg p-2 overflow-hidden">
             {combinedUrls.length > 0 ? (
               <Player
                  component={ImageComposition}
                  inputProps={{ images: combinedUrls }}
                  durationInFrames={totalFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={30}
                  controls
                  style={{
                    width: "auto",
                    height: "400px",  // Smaller height for mobile
                    maxWidth: "100%",
                    borderRadius: "6px"
                  }}
               />
             ) : (
               <div className="h-[400px] w-full flex items-center justify-center text-xs text-center text-muted-foreground px-4">
                 Sélectionnez des images pour prévisualiser.
               </div>
             )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
