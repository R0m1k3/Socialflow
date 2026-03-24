import { useState, useMemo } from "react";
import { Player } from "@remotion/player";
import { ImageComposition } from "@/remotion/ImageComposition";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UploadCloud, Video, Loader2, Check, Sparkles, Type } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Media } from "@shared/schema";

export default function RemotionVideoPage() {
  const [images, setImages] = useState<File[]>([]);
  const [selectedLibraryImages, setSelectedLibraryImages] = useState<Media[]>([]);
  const [overlayText, setOverlayText] = useState("");
  const [productInfo, setProductInfo] = useState("");
  const [generatedVariants, setGeneratedVariants] = useState<any[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: allMedia = [] } = useQuery<Media[]>({
    queryKey: ['/api/media'],
  });
  const imageMediaList = allMedia.filter(m => m.type === 'image').slice(0, 20);

  const generateTextMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest('POST', '/api/reels/generate-text', { productInfo: text });
      return response.json();
    },
    onSuccess: (data: any) => {
      setGeneratedVariants(data.variants || []);
      toast({ title: "Textes générés", description: "Cliquez sur un texte pour l'appliquer." });
    },
    onError: () => {
      toast({ title: "Erreur IA", description: "Impossible de générer le texte.", variant: "destructive" });
    }
  });

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
      if (overlayText) formData.append("overlayText", overlayText);
      
      const response = await fetch("/api/remotion/render", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Erreur inconnue" }));
        throw new Error(errData.error || "Erreur de génération");
      }

      const data = await response.json();
      setVideoUrl(data.url);
      
      toast({
        title: "Vidéo générée !",
        description: "Votre vidéo Remotion est prête.",
      });
      
    } catch (err: any) {
      toast({
        title: "Erreur",
        description: err.message || "Impossible de créer la vidéo.",
        variant: "destructive"
      });
    } finally {
      setIsRendering(false);
    }
  };

  // 3s per image, 30fps
  const totalFrames = combinedUrls.length > 0 ? combinedUrls.length * 3 * 30 : 300;

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Générateur Remotion</h1>
      <p className="text-muted-foreground">Créez une vidéo à partir de vos images avec Remotion.</p>

      <div className="grid md:grid-cols-2 gap-8">
        {/* LEFT COLUMN: Selection + Text */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Sélectionner des Images</CardTitle>
              <CardDescription>Choisissez entre 3 et 4 images (bibliothèque ou upload).</CardDescription>
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
                <p className="text-sm text-muted-foreground mt-2">{images.length} image(s) uploadée(s)</p>
              </div>

              {imageMediaList.length > 0 && (
                <div className="pt-4 border-t border-border">
                    <p className="font-medium mb-3 text-sm">Ou choisissez depuis la Bibliothèque :</p>
                    <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-2">
                         {imageMediaList.map((media) => {
                             const isSelected = selectedLibraryImages.some(m => m.id === media.id);
                             return (
                                 <div 
                                    key={media.id} 
                                    onClick={() => toggleLibraryImage(media)}
                                    className={`relative aspect-square rounded overflow-hidden border-2 cursor-pointer transition-all ${isSelected ? 'border-primary' : 'border-transparent'}`}
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

              <div className="flex justify-between text-sm text-primary font-medium py-2">
                   <span>Total sélectionné : {totalSelected} / 4 images</span>
              </div>
            </CardContent>
          </Card>

          {/* TEXT OVERLAY CARD */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Type className="w-4 h-4" /> 2. Texte Overlay</CardTitle>
              <CardDescription>Ce texte apparaîtra en bas de la vidéo sur toutes les images.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* AI Generation */}
              <div className="space-y-2">
                <Textarea
                  placeholder="Décrivez votre produit pour générer un texte IA..."
                  value={productInfo}
                  onChange={e => setProductInfo(e.target.value)}
                  rows={2}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!productInfo || generateTextMutation.isPending}
                  onClick={() => generateTextMutation.mutate(productInfo)}
                >
                  {generateTextMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Sparkles className="mr-2 w-4 h-4" />}
                  Générer avec l'IA
                </Button>
              </div>

              {generatedVariants.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Cliquez sur un texte pour l'appliquer :</p>
                  {generatedVariants.map((v: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => { setOverlayText(v.text); toast({ title: "Texte appliqué" }) }}
                      className={`text-sm p-2 rounded border cursor-pointer hover:bg-accent transition-colors ${overlayText === v.text ? 'border-primary bg-primary/5' : 'border-border'}`}
                    >
                      {v.text}
                    </div>
                  ))}
                </div>
              )}

              <Textarea
                placeholder="Ou saisissez votre texte ici..."
                value={overlayText}
                onChange={e => setOverlayText(e.target.value)}
                rows={3}
                className="mt-2"
              />
            </CardContent>
          </Card>

          {totalSelected > 0 && (
            <Button onClick={handleGenerate} disabled={isRendering || totalSelected < 3} className="w-full" size="lg">
              {isRendering ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération en cours (peut prendre 1-2 min)...</>
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
        </div>

        {/* RIGHT COLUMN: Preview */}
        <Card>
          <CardHeader>
            <CardTitle>3. Aperçu</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center bg-zinc-950 rounded-lg p-4 overflow-hidden">
             {combinedUrls.length > 0 ? (
               <Player
                  component={ImageComposition}
                  inputProps={{ images: combinedUrls, overlayText: overlayText || undefined }}
                  durationInFrames={totalFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={30}
                  controls
                  acknowledgeRemotionLicense
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
