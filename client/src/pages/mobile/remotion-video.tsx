import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { UploadCloud, Video, Loader2, Menu, Check, Sparkles, Mic, Volume2, Music, Play, Pause, Send, Camera } from "lucide-react";
import { MediaThumbnail } from "@/components/media-thumbnail";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Sidebar from "@/components/sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/datetime-picker";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Media, SocialPage } from "@shared/schema";

interface AudioTrack { id: string; title: string; fileName: string; url: string; duration: number; }

const TTS_VOICES = [
  { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne", type: "Femme" },
  { id: "fr-FR-RemyMultilingualNeural",     label: "Rémy",     type: "Homme" },
  { id: "fr-FR-DeniseNeural",               label: "Denise",   type: "Femme" },
  { id: "fr-FR-HenriNeural",                label: "Henri",    type: "Homme" },
  { id: "fr-FR-EloiseNeural",               label: "Éloïse",   type: "Enfant" },
];

function stripForTTS(text: string) {
  return text.replace(/#\w+/g, '').replace(/[\uD800-\uDFFF]/g, '').replace(/[\u2600-\u27BF]/g, '').replace(/\s+/g, ' ').trim();
}


export default function MobileRemotionVideoPage() {
  const [images, setImages] = useState<File[]>([]);
  const [selectedLibraryImages, setSelectedLibraryImages] = useState<Media[]>([]);
  const [overlayText, setOverlayText] = useState("");
  const [productInfo, setProductInfo] = useState("");
  const [generatedVariants, setGeneratedVariants] = useState<any[]>([]);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice, setTtsVoice] = useState("fr-FR-VivienneMultilingualNeural");
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<AudioTrack | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [publishDescription, setPublishDescription] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: allMedia = [] } = useQuery<Media[]>({ queryKey: ['/api/media'] });
  const { data: audioTracks = [], isLoading: tracksLoading } = useQuery<AudioTrack[]>({ queryKey: ['/api/audio-tracks'] });
  const { data: socialPages = [] } = useQuery<SocialPage[]>({ queryKey: ['/api/pages'] });

  const facebookPages = socialPages.filter(p => p.platform === 'facebook');
  const imageMediaList = allMedia.filter(m => m.type === 'image').slice(0, 20);

  const generateTextMutation = useMutation({
    mutationFn: async (text: string) => (await apiRequest('POST', '/api/reels/generate-text', { productInfo: text })).json(),
    onSuccess: (data: any) => { setGeneratedVariants(data.variants || []); toast({ title: "Textes générés" }); },
    onError: () => toast({ title: "Erreur IA", variant: "destructive" }),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setImages(Array.from(e.target.files).slice(0, 4 - selectedLibraryImages.length));
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const remaining = 4 - selectedLibraryImages.length - images.length;
    if (remaining <= 0) {
      toast({ title: "4 images max.", variant: "destructive" });
      e.target.value = '';
      return;
    }
    let fileToAdd = file;
    if (!file.name || file.name === 'blob' || file.name === '') {
      const ext = file.type.split('/')[1] || 'jpg';
      fileToAdd = new File([file], `camera-${Date.now()}.${ext}`, { type: file.type });
    }
    setImages(prev => [...prev, fileToAdd].slice(0, 4 - selectedLibraryImages.length));
    e.target.value = '';
  };

  const toggleLibraryImage = (media: Media) => {
    setSelectedLibraryImages(prev => {
      if (prev.find(m => m.id === media.id)) return prev.filter(m => m.id !== media.id);
      if (images.length + prev.length >= 4) { toast({ title: "4 images max.", variant: "destructive" }); return prev; }
      return [...prev, media];
    });
  };

  const totalSelected = images.length + selectedLibraryImages.length;

  const handleTtsPreview = async () => {
    const ttsText = stripForTTS(overlayText);
    if (!ttsText) return;
    try {
      const r = await apiRequest('POST', '/api/reels/tts-preview', { text: ttsText, voice: ttsVoice });
      const data = await r.json();
      if (data.success && data.audioBase64) new window.Audio(`data:audio/mp3;base64,${data.audioBase64}`).play();
    } catch { toast({ title: "Erreur prévisualisation voix", variant: "destructive" }); }
  };

  const togglePlayPreview = (track: AudioTrack) => {
    if (!audioRef.current) return;
    if (isPlaying === track.id) { audioRef.current.pause(); setIsPlaying(null); }
    else { audioRef.current.src = track.url; audioRef.current.play(); setIsPlaying(track.id); }
  };

  const handleGenerate = async () => {
    if (totalSelected < 3) { toast({ title: "Minimum 3 images", variant: "destructive" }); return; }
    setIsRendering(true);
    setVideoUrl(null);
    try {
      const formData = new FormData();
      images.forEach(img => formData.append("images", img));
      selectedLibraryImages.forEach(m => formData.append("existingImageUrls", m.originalUrl));
      if (overlayText) formData.append("overlayText", overlayText);
      if (ttsEnabled && overlayText) formData.append("ttsVoice", ttsVoice);
      if (musicFile) { formData.append("music", musicFile); formData.append("musicVolume", String(musicVolume)); }
      else if (selectedTrack) { formData.append("musicTrackUrl", selectedTrack.url); formData.append("musicVolume", String(musicVolume)); }
      const response = await fetch("/api/remotion/render", { method: "POST", body: formData });
      if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || "Erreur"); }
      const data = await response.json();
      setVideoUrl(data.url);
      toast({ title: "Vidéo générée !" });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setIsRendering(false); }
  };

  const handlePublish = async () => {
    if (!videoUrl) return;
    if (selectedPageIds.length === 0) { toast({ title: "Sélectionnez au moins une page.", variant: "destructive" }); return; }
    setIsPublishing(true);
    try {
      const response = await apiRequest('POST', '/api/remotion/publish', {
        videoUrl, pageIds: selectedPageIds,
        scheduledFor: scheduledDate?.toISOString(),
        description: publishDescription || undefined,
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.results?.find((r: any) => r.error)?.error || "Erreur");
      toast({
        title: scheduledDate ? "Publication planifiée !" : "Vidéo publiée !",
        description: scheduledDate ? `Sera publiée le ${scheduledDate.toLocaleString('fr-FR')}` : "Publiée sur Facebook.",
      });
    } catch (err: any) {
      toast({ title: "Erreur de publication", description: err.message, variant: "destructive" });
    } finally { setIsPublishing(false); }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <audio ref={audioRef} onEnded={() => setIsPlaying(null)} />

      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b p-4 flex items-center gap-3">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="-ml-2"><Menu className="h-6 w-6" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[80%]"><Sidebar /></SheetContent>
        </Sheet>
        <h1 className="font-semibold text-lg">Générateur Vidéo</h1>
      </div>

      <main className="p-4 space-y-4">

        {/* 1. Images */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">1. Images</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleCameraCapture}
              className="hidden"
            />
            <div className="flex gap-2">
              <div className="flex-1 border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center relative bg-muted/30">
                <input type="file" multiple accept="image/*" onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <UploadCloud className="h-6 w-6 text-muted-foreground mb-1" />
                <p className="text-xs font-medium">Galerie</p>
                <p className="text-xs text-muted-foreground">{images.length} choisie(s)</p>
              </div>
              <Button
                variant="outline"
                className="h-auto py-4 px-4 flex flex-col items-center gap-1"
                onClick={() => cameraInputRef.current?.click()}
                disabled={totalSelected >= 4}
              >
                <Camera className="h-6 w-6" />
                <span className="text-xs">Photo</span>
              </Button>
            </div>
            {imageMediaList.length > 0 && (
              <div className="flex overflow-x-auto gap-2 pb-1">
                {imageMediaList.map(media => {
                  const isSelected = selectedLibraryImages.some(m => m.id === media.id);
                  return (
                    <div key={media.id} onClick={() => toggleLibraryImage(media)}
                      className={`flex-shrink-0 w-16 h-16 relative rounded overflow-hidden border-2 cursor-pointer ${isSelected ? 'border-primary' : 'border-transparent'}`}>
                      <MediaThumbnail src={media.originalUrl} alt="" type="image" />
                      {isSelected && <div className="absolute top-0.5 right-0.5 bg-primary text-white p-0.5 rounded-full"><Check className="w-2.5 h-2.5" /></div>}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-primary font-medium">{totalSelected} / 4 sélectionnée(s)</p>
          </CardContent>
        </Card>

        {/* 2. Texte & Voix */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Mic className="w-4 h-4" /> 2. Texte & Voix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea placeholder="Décrivez votre produit…" value={productInfo}
              onChange={e => setProductInfo(e.target.value)} rows={2} className="text-sm" />
            <Button variant="secondary" size="sm" className="w-full"
              disabled={!productInfo || generateTextMutation.isPending}
              onClick={() => generateTextMutation.mutate(productInfo)}>
              {generateTextMutation.isPending ? <Loader2 className="mr-2 w-3 h-3 animate-spin" /> : <Sparkles className="mr-2 w-3 h-3" />}
              Générer avec l'IA
            </Button>
            {generatedVariants.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {generatedVariants.map((v: any, i: number) => (
                  <div key={i} onClick={() => { setOverlayText(v.text); toast({ title: "Appliqué" }); }}
                    className={`text-xs p-2 rounded border cursor-pointer ${overlayText === v.text ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    {v.text}
                  </div>
                ))}
              </div>
            )}
            <Textarea placeholder="Texte overlay…" value={overlayText}
              onChange={e => setOverlayText(e.target.value)} rows={2} className="text-sm" />
            <div className="flex items-center gap-3">
              <Switch id="tts-m" checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
              <Label htmlFor="tts-m" className="text-sm">Voix TTS</Label>
            </div>
            {ttsEnabled && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {TTS_VOICES.map(v => (
                    <div key={v.id} onClick={() => setTtsVoice(v.id)}
                      className={`cursor-pointer p-1.5 rounded border-2 text-center ${ttsVoice === v.id ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/30'}`}>
                      <div className="font-semibold text-xs">{v.label}</div>
                      <div className="text-[10px] text-muted-foreground">{v.type}</div>
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="outline" className="w-full" onClick={handleTtsPreview} disabled={!overlayText}>
                  <Volume2 className="mr-2 w-3 h-3" /> Écouter la voix
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Musique */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Music className="w-4 h-4" /> 3. Musique</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-40 overflow-y-auto space-y-1.5">
              {tracksLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : audioTracks.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-border rounded-xl">
                  <Music className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-40" />
                  <p className="text-xs text-muted-foreground">Aucune musique disponible.<br />Un administrateur peut en ajouter via la Bibliothèque Audio.</p>
                </div>
              ) : (
                audioTracks.map(track => {
                  const isSelected = selectedTrack?.id === track.id;
                  const playing = isPlaying === track.id;
                  return (
                    <div key={track.id} onClick={() => { setSelectedTrack(isSelected ? null : track); setMusicFile(null); }}
                      className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-primary/10 border border-primary' : 'bg-muted/50 hover:bg-muted'}`}>
                      <button onClick={e => { e.stopPropagation(); togglePlayPreview(track); }}
                        className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/30 shrink-0">
                        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{track.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                        </p>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </div>
                  );
                })
              )}
            </div>
            <div className="relative border-2 border-dashed border-border rounded p-3 flex items-center gap-2">
              <input type="file" accept="audio/*"
                onChange={e => { setMusicFile(e.target.files?.[0] ?? null); setSelectedTrack(null); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <UploadCloud className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground truncate">{musicFile ? musicFile.name : "Ou uploadez votre fichier audio"}</p>
              {musicFile && <Check className="w-3 h-3 text-primary shrink-0" />}
            </div>
            {(musicFile || selectedTrack) && (
              <div className="space-y-1">
                <Label className="flex items-center gap-2 text-xs">
                  <Volume2 className="w-3 h-3" /> Volume : {Math.round(musicVolume * 100)}%
                </Label>
                <Slider min={0} max={1} step={0.05} value={[musicVolume]}
                  onValueChange={vals => setMusicVolume(vals[0] ?? musicVolume)} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Générer */}
        <Button onClick={handleGenerate} disabled={isRendering || totalSelected < 3} className="w-full h-12" size="lg">
          {isRendering
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération (1-2 min)…</>
            : <><Video className="mr-2 h-4 w-4" /> Générer la vidéo MP4</>}
        </Button>

        {videoUrl && (
          <div className="space-y-3">
            <p className="font-semibold text-sm text-green-600">Vidéo prête :</p>
            <video src={videoUrl} controls className="w-full rounded-md shadow bg-black" />

            <Card className="border-primary/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Send className="w-4 h-4" /> Publier sur Facebook
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {facebookPages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucune page Facebook connectée.</p>
                ) : (
                  <div className="space-y-2">
                    {facebookPages.map(page => (
                      <div key={page.id} className="flex items-center gap-3">
                        <Checkbox
                          id={`mpub-${page.id}`}
                          checked={selectedPageIds.includes(page.id)}
                          onCheckedChange={checked =>
                            setSelectedPageIds(prev =>
                              checked ? [...prev, page.id] : prev.filter(id => id !== page.id)
                            )
                          }
                        />
                        <label htmlFor={`mpub-${page.id}`} className="text-sm font-medium cursor-pointer">
                          {page.pageName}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                <Textarea rows={2} placeholder="Description (optionnel)" value={publishDescription}
                  onChange={e => setPublishDescription(e.target.value)} />
                <DateTimePicker value={scheduledDate} onChange={setScheduledDate}
                  occupiedDates={[]} placeholder="Publier immédiatement" />
                <Button className="w-full" onClick={handlePublish}
                  disabled={isPublishing || selectedPageIds.length === 0}>
                  {isPublishing
                    ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Publication...</>
                    : <><Send className="mr-2 w-4 h-4" /> {scheduledDate ? "Planifier" : "Publier maintenant"}</>}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

      </main>
    </div>
  );
}
