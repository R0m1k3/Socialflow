import { useState, useMemo } from "react";
import { Player } from "@remotion/player";
import { ImageComposition } from "@/remotion/ImageComposition";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UploadCloud, Video, Loader2, Check, Sparkles, Mic, Volume2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Media } from "@shared/schema";

const TTS_VOICES = [
  { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne", type: "Femme" },
  { id: "fr-FR-RemyMultilingualNeural",     label: "Rémy",     type: "Homme" },
  { id: "fr-FR-DeniseNeural",               label: "Denise",   type: "Femme" },
  { id: "fr-FR-HenriNeural",                label: "Henri",    type: "Homme" },
  { id: "fr-FR-EloiseNeural",               label: "Éloïse",   type: "Enfant" },
];

/** strips hashtags & emojis for preview word timing (mirrors server logic) */
function stripForTTS(text: string): string {
  return text
    .replace(/#\w+/g, '')
    .replace(/[\uD800-\uDFFF]/g, '') // surrogate pairs (most emojis)
    .replace(/[\u2600-\u27BF]/g, '') // misc symbols
    .replace(/\s+/g, ' ')
    .trim();
}

/** Client-side word timing estimate for live preview */
function estimateWordTimings(text: string, fps = 30, wps = 2.5) {
  const words = text.split(/\s+/).filter(Boolean);
  const ttsWords = stripForTTS(text).split(/\s+/).filter(Boolean);
  const framesPerTTSWord = fps / wps;
  let frame = 0;
  let ttsIdx = 0;
  return words.map(word => {
    const isSpoken = !/^#/.test(word) && !(/[\uD800-\uDFFF\u2600-\u27BF]/.test(word));
    const dur = isSpoken ? framesPerTTSWord : framesPerTTSWord * 0.4;
    const start = frame;
    frame += Math.round(dur);
    if (isSpoken) ttsIdx++;
    return { word, startFrame: start, endFrame: frame };
  });
}

export default function RemotionVideoPage() {
  const [images, setImages] = useState<File[]>([]);
  const [selectedLibraryImages, setSelectedLibraryImages] = useState<Media[]>([]);
  const [overlayText, setOverlayText] = useState("");
  const [productInfo, setProductInfo] = useState("");
  const [generatedVariants, setGeneratedVariants] = useState<any[]>([]);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice, setTtsVoice] = useState("fr-FR-VivienneMultilingualNeural");
  const [isRendering, setIsRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: allMedia = [] } = useQuery<Media[]>({ queryKey: ['/api/media'] });
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
      setImages(files.slice(0, remainingSlots));
    }
  };

  const toggleLibraryImage = (media: Media) => {
    setSelectedLibraryImages(prev => {
      if (prev.find(m => m.id === media.id)) return prev.filter(m => m.id !== media.id);
      if (images.length + prev.length >= 4) {
        toast({ title: "Limite", description: "4 images maximum.", variant: "destructive" });
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

  // For the Player preview: estimate word timings locally (no server roundtrip)
  const previewWordTimings = useMemo(() => {
    if (!overlayText) return undefined;
    return estimateWordTimings(overlayText);
  }, [overlayText]);

  const totalFrames = useMemo(() => {
    if (previewWordTimings && previewWordTimings.length > 0) {
      const textFrames = previewWordTimings[previewWordTimings.length - 1].endFrame + 30;
      const imageFrames = combinedUrls.length * 3 * 30;
      return Math.max(imageFrames, textFrames);
    }
    return combinedUrls.length > 0 ? combinedUrls.length * 3 * 30 : 300;
  }, [previewWordTimings, combinedUrls]);

  const handleTtsPreview = async () => {
    if (!overlayText) return;
    const ttsText = stripForTTS(overlayText);
    if (!ttsText) { toast({ title: "Aucun texte à lire", description: "Hashtags et emojis ne sont pas lus.", variant: "destructive" }); return; }
    try {
      const response = await apiRequest('POST', '/api/reels/tts-preview', { text: ttsText, voice: ttsVoice });
      const data = await response.json();
      if (data.success && data.audioBase64) {
        const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`);
        audio.play();
      }
    } catch {
      toast({ title: "Erreur", description: "Prévisualisation voix impossible.", variant: "destructive" });
    }
  };

  const handleGenerate = async () => {
    if (totalSelected < 3) {
      toast({ title: "Pas assez d'images", description: "Au moins 3 images requises.", variant: "destructive" });
      return;
    }

    setIsRendering(true);
    setVideoUrl(null);
    
    try {
      const formData = new FormData();
      images.forEach(img => formData.append("images", img));
      selectedLibraryImages.forEach(m => formData.append("existingImageUrls", m.originalUrl));
      if (overlayText) formData.append("overlayText", overlayText);
      if (ttsEnabled && overlayText) formData.append("ttsVoice", ttsVoice);
      
      const response = await fetch("/api/remotion/render", { method: "POST", body: formData });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Erreur inconnue" }));
        throw new Error(errData.error || "Erreur de génération");
      }

      const data = await response.json();
      setVideoUrl(data.url);
      toast({ title: "Vidéo générée !", description: "Votre vidéo Remotion est prête." });
      
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message || "Impossible de créer la vidéo.", variant: "destructive" });
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Générateur Remotion</h1>
      <p className="text-muted-foreground">Créez une vidéo animée à partir de vos images avec voix et texte style TikTok.</p>

      <div className="grid md:grid-cols-2 gap-8">
        {/* ─── LEFT COLUMN ─── */}
        <div className="space-y-6">

          {/* 1. Images */}
          <Card>
            <CardHeader>
              <CardTitle>1. Images</CardTitle>
              <CardDescription>Sélectionnez 3 à 4 images (bibliothèque ou upload).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center relative hover:bg-muted/50 transition-colors">
                <input type="file" multiple accept="image/*" onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <UploadCloud className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-medium text-center">Glissez ou cliquez</p>
                <p className="text-sm text-muted-foreground mt-1">{images.length} uploadée(s)</p>
              </div>

              {imageMediaList.length > 0 && (
                <div className="pt-3 border-t border-border">
                  <p className="font-medium mb-2 text-sm">Bibliothèque :</p>
                  <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto">
                    {imageMediaList.map(media => {
                      const isSelected = selectedLibraryImages.some(m => m.id === media.id);
                      return (
                        <div key={media.id} onClick={() => toggleLibraryImage(media)}
                          className={`relative aspect-square rounded overflow-hidden border-2 cursor-pointer transition-all ${isSelected ? 'border-primary' : 'border-transparent'}`}>
                          <img src={media.originalUrl} className="w-full h-full object-cover" />
                          {isSelected && (
                            <div className="absolute top-1 right-1 bg-primary text-white p-0.5 rounded-full">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-sm text-primary font-medium">Total : {totalSelected} / 4</p>
            </CardContent>
          </Card>

          {/* 2. Texte + Voix */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mic className="w-4 h-4" /> 2. Texte & Voix</CardTitle>
              <CardDescription>La voix lira votre texte. Les hashtags et emojis s'affichent mais ne sont pas lus.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* AI generation */}
              <Textarea placeholder="Décrivez votre produit pour générer un texte IA..." value={productInfo}
                onChange={e => setProductInfo(e.target.value)} rows={2} />
              <Button variant="secondary" className="w-full" disabled={!productInfo || generateTextMutation.isPending}
                onClick={() => generateTextMutation.mutate(productInfo)}>
                {generateTextMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Sparkles className="mr-2 w-4 h-4" />}
                Générer avec l'IA
              </Button>

              {generatedVariants.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Cliquez pour appliquer :</p>
                  {generatedVariants.map((v: any, i: number) => (
                    <div key={i} onClick={() => { setOverlayText(v.text); toast({ title: "Texte appliqué" }); }}
                      className={`text-sm p-2 rounded border cursor-pointer hover:bg-accent transition-colors ${overlayText === v.text ? 'border-primary bg-primary/5' : 'border-border'}`}>
                      {v.text}
                    </div>
                  ))}
                </div>
              )}

              <Textarea placeholder="Votre texte overlay..." value={overlayText}
                onChange={e => setOverlayText(e.target.value)} rows={3} />

              {/* TTS toggle */}
              <div className="flex items-center gap-3 pt-1">
                <Switch id="tts" checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
                <Label htmlFor="tts">Activer la voix TTS</Label>
              </div>

              {ttsEnabled && (
                <div className="space-y-3 p-3 bg-muted/30 rounded-lg border">
                  <p className="text-sm font-medium">Voix :</p>
                  <div className="grid grid-cols-3 gap-2">
                    {TTS_VOICES.map(v => (
                      <div key={v.id} onClick={() => setTtsVoice(v.id)}
                        className={`cursor-pointer p-2 rounded border-2 text-center transition-all ${ttsVoice === v.id ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/30'}`}>
                        <div className="font-semibold text-sm">{v.label}</div>
                        <div className="text-xs text-muted-foreground">{v.type}</div>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="w-full" onClick={handleTtsPreview} disabled={!overlayText}>
                    <Volume2 className="mr-2 w-3 h-3" /> Écouter la voix
                  </Button>
                  <p className="text-xs text-muted-foreground italic">
                    ℹ️ Les hashtags et emojis s'affichent à l'écran, mais la voix ne les lit pas.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Generate button */}
          {totalSelected > 0 && (
            <Button onClick={handleGenerate} disabled={isRendering || totalSelected < 3} className="w-full" size="lg">
              {isRendering
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération (1-2 min)...</>
                : <><Video className="mr-2 h-4 w-4" /> Générer la vidéo MP4</>}
            </Button>
          )}

          {videoUrl && (
            <div>
              <p className="font-semibold mb-2 text-green-600">Vidéo prête :</p>
              <video src={videoUrl} controls className="w-full rounded-md shadow" />
              <Button variant="outline" className="w-full mt-2" asChild>
                <a href={videoUrl} download="remotion-video.mp4">Télécharger</a>
              </Button>
            </div>
          )}
        </div>

        {/* ─── RIGHT COLUMN: PREVIEW ─── */}
        <Card>
          <CardHeader>
            <CardTitle>3. Aperçu en direct</CardTitle>
            <CardDescription>Le texte animé style TikTok s'affiche ici en temps réel.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center bg-zinc-950 rounded-lg p-4 overflow-hidden">
            {combinedUrls.length > 0 ? (
              <Player
                component={ImageComposition}
                inputProps={{ images: combinedUrls, overlayText: overlayText || undefined, wordTimings: previewWordTimings }}
                durationInFrames={totalFrames}
                compositionWidth={1080}
                compositionHeight={1920}
                fps={30}
                controls
                acknowledgeRemotionLicense
                style={{ width: "auto", height: "600px", maxWidth: "100%", borderRadius: "8px" }}
              />
            ) : (
              <div className="h-[600px] w-full flex items-center justify-center text-muted-foreground text-center px-4">
                Sélectionnez des images pour voir l'aperçu.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
