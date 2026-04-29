import { useState, useRef } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UploadCloud, Video, Loader2, Check, Sparkles, Mic, Volume2, Music, Play, Pause, Send } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/datetime-picker";
import type { Media, SocialPage } from "@shared/schema";

const TTS_VOICES = [
  { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne", type: "Femme" },
  { id: "fr-FR-RemyMultilingualNeural",     label: "Rémy",     type: "Homme" },
  { id: "fr-FR-DeniseNeural",               label: "Denise",   type: "Femme" },
  { id: "fr-FR-HenriNeural",                label: "Henri",    type: "Homme" },
  { id: "fr-FR-EloiseNeural",               label: "Éloïse",   type: "Enfant" },
];

interface AudioTrack {
  id: string;
  title: string;
  fileName: string;
  url: string;
  duration: number;
}

export default function RemotionVideoPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  const { toast } = useToast();

  const { data: allMedia = [] } = useQuery<Media[]>({ queryKey: ['/api/media'] });
  const { data: audioTracks = [], isLoading: tracksLoading } = useQuery<AudioTrack[]>({ queryKey: ['/api/audio-tracks'] });
  const { data: socialPages = [] } = useQuery<SocialPage[]>({ queryKey: ['/api/pages'] });

  const facebookPages = socialPages.filter(p => p.platform === 'facebook');
  const imageMediaList = allMedia.filter(m => m.type === 'image').slice(0, 20);
  const totalSelected = images.length + selectedLibraryImages.length;

  const generateTextMutation = useMutation({
    mutationFn: async (text: string) => (await apiRequest('POST', '/api/reels/generate-text', { productInfo: text })).json(),
    onSuccess: (data: any) => {
      setGeneratedVariants(data.variants || []);
      toast({ title: "Textes générés", description: "Cliquez pour appliquer." });
    },
    onError: () => toast({ title: "Erreur IA", variant: "destructive" }),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setImages(Array.from(e.target.files).slice(0, 4 - selectedLibraryImages.length));
  };

  const toggleLibraryImage = (media: Media) => {
    setSelectedLibraryImages(prev => {
      if (prev.find(m => m.id === media.id)) return prev.filter(m => m.id !== media.id);
      if (images.length + prev.length >= 4) { toast({ title: "4 images maximum.", variant: "destructive" }); return prev; }
      return [...prev, media];
    });
  };

  const handleTtsPreview = async () => {
    const ttsText = overlayText.replace(/#\w+/g, '').replace(/[\uD800-\uDFFF\u2600-\u27BF]/g, '').replace(/\s+/g, ' ').trim();
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
    if (totalSelected < 3) { toast({ title: "Minimum 3 images requises.", variant: "destructive" }); return; }
    setIsRendering(true);
    setVideoUrl(null);
    try {
      const formData = new FormData();
      images.forEach(img => formData.append("images", img));
      selectedLibraryImages.forEach(m => formData.append("existingImageUrls", m.originalUrl));
      if (overlayText) formData.append("overlayText", overlayText);
      if (ttsEnabled && overlayText) formData.append("ttsVoice", ttsVoice);
      if (selectedPageIds[0]) formData.append("selectedPageId", selectedPageIds[0]);
      if (musicFile) { formData.append("music", musicFile); formData.append("musicVolume", String(musicVolume)); }
      else if (selectedTrack) { formData.append("musicTrackUrl", selectedTrack.url); formData.append("musicVolume", String(musicVolume)); }
      const response = await fetch("/api/remotion/render", { method: "POST", body: formData });
      if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || "Erreur"); }
      const data = await response.json();
      
      if (data.jobId) {
        toast({ title: "Rendu démarré", description: "Veuillez patienter (~1-2 min)..." });
        
        const checkStatus = async () => {
          try {
            const res = await fetch(`/api/remotion/render/status/${data.jobId}`);
            if (!res.ok) throw new Error("Erreur de suivi du rendu");
            const job = await res.json();
            
            if (job.status === 'done') {
              setVideoUrl(job.url);
              if (overlayText && !publishDescription) setPublishDescription(overlayText);
              toast({ title: "Vidéo générée !", description: "Votre vidéo est prête à publier." });
              setIsRendering(false);
            } else if (job.status === 'error') {
              toast({ title: "Erreur de rendu", description: job.error || "Échec du rendu", variant: "destructive" });
              setIsRendering(false);
            } else {
              setTimeout(checkStatus, 3000);
            }
          } catch (e: any) {
            toast({ title: "Erreur de connexion", description: e.message, variant: "destructive" });
            setIsRendering(false);
          }
        };
        setTimeout(checkStatus, 3000);
      } else {
        // Fallback for older sync backend
        setVideoUrl(data.url);
        if (overlayText && !publishDescription) setPublishDescription(overlayText);
        toast({ title: "Vidéo générée !", description: "Votre vidéo est prête à publier." });
        setIsRendering(false);
      }
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message || "Impossible de créer la vidéo.", variant: "destructive" });
      setIsRendering(false);
    }
    // Note: removed finally block so isRendering stays true during polling
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
      await queryClient.invalidateQueries({ queryKey: ['/api/scheduled-posts'], refetchType: 'all' });
    } catch (err: any) {
      toast({ title: "Erreur de publication", description: err.message, variant: "destructive" });
    } finally { setIsPublishing(false); }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <div className={`fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-6">

      <audio ref={audioRef} onEnded={() => setIsPlaying(null)} />

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
              <div className="grid grid-cols-5 gap-2 max-h-44 overflow-y-auto">
                {imageMediaList.map(media => {
                  const isSelected = selectedLibraryImages.some(m => m.id === media.id);
                  return (
                    <div key={media.id} onClick={() => toggleLibraryImage(media)}
                      className={`relative aspect-square rounded overflow-hidden border-2 cursor-pointer transition-all ${isSelected ? 'border-primary' : 'border-transparent'}`}>
                      <img src={media.originalUrl} className="w-full h-full object-cover" />
                      {isSelected && <div className="absolute top-1 right-1 bg-primary text-white p-0.5 rounded-full"><Check className="w-3 h-3" /></div>}
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
          <CardDescription>La voix lira votre texte. Les hashtags s'affichent mais ne sont pas lus.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <div className="flex items-center gap-3">
            <Switch id="tts" checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
            <Label htmlFor="tts">Activer la voix TTS</Label>
          </div>
          {ttsEnabled && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg border">
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Musique */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Music className="w-4 h-4" /> 3. Musique de fond</CardTitle>
          <CardDescription>Choisissez une musique de la bibliothèque ou uploadez la vôtre.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {tracksLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : audioTracks.length === 0 ? (
              <div className="text-center py-6 border-2 border-dashed border-border rounded-xl">
                <Music className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-40" />
                <p className="text-sm text-muted-foreground">Aucune musique disponible</p>
              </div>
            ) : (
              audioTracks.map(track => {
                const isSelected = selectedTrack?.id === track.id;
                const playing = isPlaying === track.id;
                return (
                  <div key={track.id} onClick={() => { setSelectedTrack(isSelected ? null : track); setMusicFile(null); }}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-primary/10 border border-primary' : 'bg-muted/50 hover:bg-muted'}`}>
                    <button onClick={e => { e.stopPropagation(); togglePlayPreview(track); }}
                      className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/30 shrink-0">
                      {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{track.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                      </p>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
          <div className="relative">
            <div className="border-2 border-dashed border-border rounded-lg p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors cursor-pointer">
              <input type="file" accept="audio/*"
                onChange={e => { setMusicFile(e.target.files?.[0] ?? null); setSelectedTrack(null); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <UploadCloud className="h-5 w-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground truncate">
                {musicFile ? musicFile.name : "Ou uploadez votre propre fichier audio"}
              </p>
              {musicFile && <Check className="w-4 h-4 text-primary shrink-0" />}
            </div>
          </div>
          {(musicFile || selectedTrack) && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Volume2 className="w-4 h-4" /> Volume : {Math.round(musicVolume * 100)}%
              </Label>
              <Slider min={0} max={1} step={0.05} value={[musicVolume]}
                onValueChange={vals => setMusicVolume(vals[0] ?? musicVolume)} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Page Facebook */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="w-4 h-4" /> 4. Page Facebook</CardTitle>
          <CardDescription>Sélectionnez la page cible (son nom apparaîtra en fin de vidéo).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {facebookPages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune page Facebook connectée.</p>
          ) : (
            facebookPages.map(page => (
              <div key={page.id} className="flex items-center gap-3">
                <Checkbox
                  id={`pre-${page.id}`}
                  checked={selectedPageIds.includes(page.id)}
                  onCheckedChange={checked =>
                    setSelectedPageIds(prev => checked ? [...prev, page.id] : prev.filter(id => id !== page.id))
                  }
                />
                <label htmlFor={`pre-${page.id}`} className="text-sm font-medium cursor-pointer">
                  {page.pageName}
                </label>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Générer */}
      <Button onClick={handleGenerate} disabled={isRendering || totalSelected < 3} className="w-full" size="lg">
        {isRendering
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération en cours (1-2 min)...</>
          : <><Video className="mr-2 h-4 w-4" /> Générer la vidéo</>}
      </Button>

      {/* Vidéo générée */}
      {videoUrl && (
        <>
          <div>
            <p className="font-semibold text-green-600 mb-2">Vidéo prête :</p>
            <video src={videoUrl} controls className="w-full rounded-lg shadow-lg" />
          </div>

          {/* Publication */}
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-4 h-4" /> Publier sur Facebook
              </CardTitle>
              <CardDescription>Sélectionnez la page et planifiez (optionnel).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedPageIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sélectionnez une page ci-dessus avant de générer.</p>
              ) : (
                <p className="text-sm text-primary font-medium">
                  Pages : {facebookPages.filter(p => selectedPageIds.includes(p.id)).map(p => p.pageName).join(', ')}
                </p>
              )}
              <Textarea rows={2} placeholder="Description (optionnel)" value={publishDescription}
                onChange={e => setPublishDescription(e.target.value)} />
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">Date de publication</Label>
                <DateTimePicker value={scheduledDate} onChange={setScheduledDate}
                  occupiedDates={[]} placeholder="Publier immédiatement" />
              </div>
              <Button className="w-full" onClick={handlePublish}
                disabled={isPublishing || selectedPageIds.length === 0}>
                {isPublishing
                  ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Publication...</>
                  : <><Send className="mr-2 w-4 h-4" /> {scheduledDate ? "Planifier" : "Publier maintenant"}</>}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
        </div>
      </main>
    </div>
  );
}
