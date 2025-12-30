import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Wand2, Save, Image as ImageIcon, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Ribbon {
  enabled: boolean;
  text: "Promo" | "Nouveauté" | "Arrivage" | "Stock limité";
  color: "red" | "yellow";
  position: "north_west" | "north_east";
}

interface PriceBadge {
  enabled: boolean;
  price: string;
  color: "red" | "yellow";
  position: "north_east" | "south_east" | "north_west" | "south_west";
  size: number;
}

interface Logo {
  enabled: boolean;
  opacity: number;
  position: "north_east" | "south_east" | "north_west" | "south_west" | "center";
  size: "small" | "medium" | "large";
}

export default function ImageEditorMobile() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<any>(null);

  const [ribbon, setRibbon] = useState<Ribbon>({
    enabled: false,
    text: "Promo",
    color: "red",
    position: "north_west"
  });

  const [priceBadge, setPriceBadge] = useState<PriceBadge>({
    enabled: false,
    price: "",
    color: "red",
    position: "north_east",
    size: 20
  });

  const [logo, setLogo] = useState<Logo>({
    enabled: false,
    opacity: 60,
    position: "south_east",
    size: "medium"
  });

  const [previewUrl, setPreviewUrl] = useState<string>("");

  const { data: mediaList } = useQuery({
    queryKey: ["/api/media"],
  });

  const { data: cloudinaryConfig } = useQuery({
    queryKey: ['/api/cloudinary/config'],
  });

  const previewRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const saveImageMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMedia) {
        throw new Error("Aucune image sélectionnée");
      }

      const payload = {
        imageUrl: selectedMedia.originalUrl,
        ribbon: ribbon.enabled ? ribbon : undefined,
        priceBadge: priceBadge.enabled && priceBadge.price ? priceBadge : undefined,
        logo: logo.enabled ? logo : undefined,
      };

      const response = await apiRequest('POST', '/api/media/apply-overlays', payload);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Image enregistrée !",
        description: "L'image éditée a été ajoutée à votre médiathèque.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible d'enregistrer l'image.",
        variant: "destructive"
      });
    }
  });

  useEffect(() => {
    if (!selectedMedia) {
      setPreviewUrl("");
      return;
    }

    let url = selectedMedia.originalUrl;

    const cloudinaryPattern = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/image\/upload\//;
    const match = url.match(cloudinaryPattern);

    if (!match) {
      setPreviewUrl(url);
      return;
    }

    const [fullMatch, cloudName] = match;
    const imagePath = url.replace(fullMatch, '');

    const transformations: string[] = [];
    transformations.push('w_800,h_800,c_fit');

    const transformedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${transformations.join('/')}/${imagePath}`;
    setPreviewUrl(transformedUrl);

  }, [selectedMedia, ribbon, priceBadge, logo]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <style>{`
        .ribbon-container {
          position: absolute;
          z-index: 10;
          pointer-events: none;
        }

        .ribbon-container.north_west {
          top: 0;
          left: 0;
          width: 140px;
          height: 140px;
        }

        .ribbon-container.north_east {
          top: 0;
          right: 0;
          width: 140px;
          height: 140px;
        }

        .ribbon-triangle {
          position: absolute;
          width: 0;
          height: 0;
          border-style: solid;
        }

        .ribbon-container.north_west .ribbon-triangle {
          top: 0;
          left: 0;
          border-width: 140px 140px 0 0;
        }

        .ribbon-container.north_west .ribbon-triangle.red {
          border-top-color: #FF0000;
          border-right-color: transparent;
          border-bottom-color: transparent;
          border-left-color: transparent;
        }

        .ribbon-container.north_west .ribbon-triangle.yellow {
          border-top-color: #FFC107;
          border-right-color: transparent;
          border-bottom-color: transparent;
          border-left-color: transparent;
        }

        .ribbon-container.north_east .ribbon-triangle {
          top: 0;
          right: 0;
          border-width: 0 140px 140px 0;
        }

        .ribbon-container.north_east .ribbon-triangle.red {
          border-top-color: transparent;
          border-right-color: #FF0000;
          border-bottom-color: transparent;
          border-left-color: transparent;
        }

        .ribbon-container.north_east .ribbon-triangle.yellow {
          border-top-color: transparent;
          border-right-color: #FFC107;
          border-bottom-color: transparent;
          border-left-color: transparent;
        }

        .ribbon-text {
          position: absolute;
          color: white;
          font-weight: bold;
          z-index: 11;
          text-transform: uppercase;
          text-align: center;
          white-space: nowrap;
        }

        .ribbon-container.north_west .ribbon-text {
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg) translateY(-20px);
        }

        .ribbon-container.north_east .ribbon-text {
          top: 50%;
          right: 50%;
          transform: translate(50%, -50%) rotate(45deg) translateY(-20px);
        }
      `}</style>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        {/* MOBILE: Single column layout */}
        <div className="p-4 space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Wand2 className="w-7 h-7" />
              Éditeur d'images
            </h1>
            <p className="text-sm text-muted-foreground">
              Ajoutez des rubans, badges prix et filtres
            </p>
          </div>

          {/* Preview Card - Top on mobile */}
          {selectedMedia && (
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <CardTitle className="text-base">Aperçu</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="rounded-lg overflow-hidden bg-muted aspect-square flex items-center justify-center relative">
                    <div ref={previewRef} className="relative max-w-full max-h-full">
                      <img
                        src={previewUrl || selectedMedia.originalUrl}
                        alt="Aperçu"
                        className="max-w-full max-h-[400px] w-auto h-auto"
                        data-testid="preview-image"
                      />

                      {ribbon.enabled && ribbon.text && (
                        <div className={`ribbon-container ${ribbon.position}`}>
                          <div className={`ribbon-triangle ${ribbon.color}`} />
                          <div
                            className="ribbon-text"
                            style={{
                              fontSize: ribbon.text === "Stock limité" ? '18px' :
                                       ribbon.text.length <= 5 ? '24px' :
                                       ribbon.text.length <= 8 ? '20px' :
                                       ribbon.text.length <= 11 ? '18px' : '14px',
                              lineHeight: ribbon.text === "Stock limité" ? '1.2' : 'normal',
                              whiteSpace: ribbon.text === "Stock limité" ? 'normal' : 'nowrap',
                              transform: ribbon.text === "Stock limité"
                                ? (ribbon.position === "north_west"
                                   ? 'translate(-50%, -50%) rotate(-45deg) translateY(-30px) translateX(2px)'
                                   : 'translate(50%, -50%) rotate(45deg) translateY(-30px) translateX(-2px)')
                                : undefined
                            }}
                          >
                            {ribbon.text === "Stock limité" ? (
                              <>
                                Stock
                                <br />
                                limité
                              </>
                            ) : ribbon.text}
                          </div>
                        </div>
                      )}

                      {priceBadge.enabled && priceBadge.price && (
                        <div
                          data-badge-price="true"
                          className={`absolute ${
                            priceBadge.position === "north_east" ? "top-3 right-3" :
                            priceBadge.position === "south_east" ? "bottom-3 right-3" :
                            priceBadge.position === "south_west" ? "bottom-3 left-3" :
                            "top-3 left-3"
                          } px-4 py-2 rounded-full text-white font-bold z-10 flex items-center justify-center ${
                            priceBadge.color === "red" ? "bg-red-600" : "bg-yellow-500"
                          }`}
                          style={{ fontSize: `${priceBadge.size}px` }}
                        >
                          {priceBadge.price} €
                        </div>
                      )}

                      {logo.enabled && cloudinaryConfig && (cloudinaryConfig as any).logoPublicId && (
                        <img
                          src={`https://res.cloudinary.com/${(cloudinaryConfig as any).cloudName}/image/upload/${(cloudinaryConfig as any).logoPublicId}`}
                          alt="Logo"
                          className={`absolute ${
                            logo.position === "north_east" ? "top-3 right-3" :
                            logo.position === "south_east" ? "bottom-3 right-3" :
                            logo.position === "south_west" ? "bottom-3 left-3" :
                            logo.position === "center" ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" :
                            "top-3 left-3"
                          } z-10 max-w-full max-h-full object-contain`}
                          style={{
                            opacity: logo.opacity / 100,
                            width: logo.size === "small" ? "30%" : logo.size === "large" ? "60%" : "45%"
                          }}
                        />
                      )}
                    </div>

                    <button
                      onClick={() => setSelectedMedia(null)}
                      className="absolute top-2 right-2 p-2 bg-black/70 hover:bg-black/90 rounded-full text-white transition-colors z-20 min-h-[44px] min-w-[44px] flex items-center justify-center"
                      data-testid="button-clear-selection"
                      title="Désélectionner l'image"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <Button
                    className="w-full min-h-[48px]"
                    variant="default"
                    data-testid="button-save"
                    onClick={() => saveImageMutation.mutate()}
                    disabled={saveImageMutation.isPending}
                  >
                    <Save className="w-5 h-5 mr-2" />
                    {saveImageMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Image Selection */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="w-5 h-5" />
                Sélectionner une image
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mediaList && (mediaList as any[]).filter((m: any) => m.type === 'image').length > 0 ? (
                <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto">
                  {(mediaList as any[])
                    .filter((m: any) => m.type === 'image')
                    .map((media: any) => (
                      <div
                        key={media.id}
                        className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all min-h-[44px] ${
                          selectedMedia?.id === media.id ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => setSelectedMedia(media)}
                        data-testid={`select-image-${media.id}`}
                      >
                        <img
                          src={media.instagramFeedUrl || media.originalUrl}
                          alt=""
                          className="w-full h-28 object-cover"
                        />
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Aucune image disponible. Uploadez des images dans la médiathèque.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Ribbon Controls */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="text-base">Ruban promotionnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                <Checkbox
                  id="ribbon-enabled"
                  checked={ribbon.enabled}
                  onCheckedChange={(checked) => setRibbon({ ...ribbon, enabled: checked as boolean })}
                  className="w-5 h-5"
                  data-testid="checkbox-ribbon"
                />
                <Label htmlFor="ribbon-enabled" className="cursor-pointer flex-1 text-sm">Afficher un ruban</Label>
              </div>

              {ribbon.enabled && (
                <>
                  <div className="space-y-3">
                    <Label className="text-sm">Texte du ruban</Label>
                    <RadioGroup
                      value={ribbon.text}
                      onValueChange={(value) => setRibbon({ ...ribbon, text: value as any })}
                      className="space-y-2"
                    >
                      {["Promo", "Nouveauté", "Arrivage", "Stock limité"].map((text) => (
                        <div key={text} className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                          <RadioGroupItem value={text} id={`ribbon-${text.toLowerCase()}`} data-testid={`radio-ribbon-${text.toLowerCase()}`} />
                          <Label htmlFor={`ribbon-${text.toLowerCase()}`} className="cursor-pointer flex-1 text-sm">{text}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm">Couleur</Label>
                    <RadioGroup
                      value={ribbon.color}
                      onValueChange={(value) => setRibbon({ ...ribbon, color: value as any })}
                      className="space-y-2"
                    >
                      <div className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                        <RadioGroupItem value="red" id="ribbon-red" data-testid="radio-ribbon-red" />
                        <Label htmlFor="ribbon-red" className="flex items-center gap-2 cursor-pointer flex-1 text-sm">
                          Rouge <Badge className="bg-red-600">Exemple</Badge>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                        <RadioGroupItem value="yellow" id="ribbon-yellow" data-testid="radio-ribbon-yellow" />
                        <Label htmlFor="ribbon-yellow" className="flex items-center gap-2 cursor-pointer flex-1 text-sm">
                          Jaune <Badge className="bg-yellow-500">Exemple</Badge>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Position</Label>
                    <Select value={ribbon.position} onValueChange={(value) => setRibbon({ ...ribbon, position: value as any })}>
                      <SelectTrigger className="min-h-[48px]" data-testid="select-ribbon-position">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="north_west">Haut gauche</SelectItem>
                        <SelectItem value="north_east">Haut droite</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Price Badge */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="text-base">Badge prix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                <Checkbox
                  id="price-enabled"
                  checked={priceBadge.enabled}
                  onCheckedChange={(checked) => setPriceBadge({ ...priceBadge, enabled: checked as boolean })}
                  className="w-5 h-5"
                  data-testid="checkbox-price"
                />
                <Label htmlFor="price-enabled" className="cursor-pointer flex-1 text-sm">Afficher le prix</Label>
              </div>

              {priceBadge.enabled && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="price-input" className="text-sm">Prix (€)</Label>
                    <Input
                      id="price-input"
                      type="text"
                      placeholder="19.99"
                      value={priceBadge.price}
                      onChange={(e) => setPriceBadge({ ...priceBadge, price: e.target.value })}
                      className="min-h-[48px]"
                      data-testid="input-price"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm">Couleur</Label>
                    <RadioGroup
                      value={priceBadge.color}
                      onValueChange={(value) => setPriceBadge({ ...priceBadge, color: value as any })}
                      className="space-y-2"
                    >
                      <div className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                        <RadioGroupItem value="red" id="price-red" data-testid="radio-price-red" />
                        <Label htmlFor="price-red" className="flex items-center gap-2 cursor-pointer flex-1 text-sm">
                          Rouge <Badge className="bg-red-600">19.99€</Badge>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                        <RadioGroupItem value="yellow" id="price-yellow" data-testid="radio-price-yellow" />
                        <Label htmlFor="price-yellow" className="flex items-center gap-2 cursor-pointer flex-1 text-sm">
                          Jaune <Badge className="bg-yellow-500">19.99€</Badge>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Position</Label>
                    <Select value={priceBadge.position} onValueChange={(value) => setPriceBadge({ ...priceBadge, position: value as any })}>
                      <SelectTrigger className="min-h-[48px]" data-testid="select-price-position">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="north_east">Haut droite</SelectItem>
                        <SelectItem value="north_west">Haut gauche</SelectItem>
                        <SelectItem value="south_east">Bas droite</SelectItem>
                        <SelectItem value="south_west">Bas gauche</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm">Taille du texte</Label>
                      <span className="text-sm text-muted-foreground">{priceBadge.size}px</span>
                    </div>
                    <Slider
                      value={[priceBadge.size]}
                      onValueChange={(value) => setPriceBadge({ ...priceBadge, size: value[0] })}
                      min={12}
                      max={70}
                      step={1}
                      className="touch-manipulation"
                      data-testid="slider-price-size"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Logo */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="text-base">Logo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-3 p-3 rounded-lg border touch-manipulation">
                <Checkbox
                  id="logo-enabled"
                  checked={logo.enabled}
                  onCheckedChange={(checked) => setLogo({ ...logo, enabled: checked as boolean })}
                  className="w-5 h-5"
                  data-testid="checkbox-logo-enabled"
                />
                <Label htmlFor="logo-enabled" className="cursor-pointer flex-1 text-sm">
                  Afficher le logo
                </Label>
              </div>

              {logo.enabled && (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm">Position</Label>
                    <Select value={logo.position} onValueChange={(value) => setLogo({ ...logo, position: value as any })}>
                      <SelectTrigger className="min-h-[48px]" data-testid="select-logo-position">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="north_west">Haut gauche</SelectItem>
                        <SelectItem value="north_east">Haut droit</SelectItem>
                        <SelectItem value="south_west">Bas gauche</SelectItem>
                        <SelectItem value="south_east">Bas droit</SelectItem>
                        <SelectItem value="center">Centre</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Taille</Label>
                    <Select value={logo.size} onValueChange={(value) => setLogo({ ...logo, size: value as any })}>
                      <SelectTrigger className="min-h-[48px]" data-testid="select-logo-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="small">Petit</SelectItem>
                        <SelectItem value="medium">Moyen</SelectItem>
                        <SelectItem value="large">Grand</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm">Opacité</Label>
                      <span className="text-sm text-muted-foreground">{logo.opacity}%</span>
                    </div>
                    <Slider
                      value={[logo.opacity]}
                      onValueChange={(value) => setLogo({ ...logo, opacity: value[0] })}
                      min={0}
                      max={100}
                      step={5}
                      className="touch-manipulation"
                      data-testid="slider-logo-opacity"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
