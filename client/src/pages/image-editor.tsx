import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Wand2, Save, ArrowRight, Image as ImageIcon, X } from "lucide-react";

interface Ribbon {
  enabled: boolean;
  text: "Promo" | "Nouveauté" | "Arrivage";
  color: "red" | "yellow";
  position: "north_west" | "north_east";
}

interface PriceBadge {
  enabled: boolean;
  price: string;
  color: "red" | "yellow";
  position: "north_east" | "south_east" | "north_west" | "south_west";
  size: number; // Font size in pixels
}

interface Logo {
  enabled: boolean;
  opacity: number;
  position: "north_east" | "south_east" | "north_west" | "south_west" | "center";
}

interface Filters {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  sharpen: number;
  effect: "none" | "grayscale" | "sepia" | "vintage";
}

export default function ImageEditor() {
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
    size: 20 // Default font size
  });
  
  const [logo, setLogo] = useState<Logo>({
    enabled: false,
    opacity: 60,
    position: "south_east"
  });
  
  const [filters, setFilters] = useState<Filters>({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    blur: 0,
    sharpen: 0,
    effect: "none"
  });

  const [previewUrl, setPreviewUrl] = useState<string>("");

  const { data: mediaList } = useQuery({
    queryKey: ["/api/media"],
  });

  // State for generated ribbon overlay
  const [ribbonPublicId, setRibbonPublicId] = useState<string | null>(null);
  const [isGeneratingRibbon, setIsGeneratingRibbon] = useState(false);

  // Generate ribbon when settings change
  useEffect(() => {
    if (!ribbon.enabled || !ribbon.text) {
      setRibbonPublicId(null);
      return;
    }
    
    const generateRibbon = async () => {
      setIsGeneratingRibbon(true);
      try {
        const response = await apiRequest("POST", "/api/media/generate-ribbon", {
          text: ribbon.text,
          color: ribbon.color,
          position: ribbon.position
        });
        const data = await response.json();
        setRibbonPublicId(data.publicId);
      } catch (error) {
        console.error("Error generating ribbon:", error);
      } finally {
        setIsGeneratingRibbon(false);
      }
    };
    
    // Debounce to avoid too many requests
    const timer = setTimeout(generateRibbon, 500);
    return () => clearTimeout(timer);
  }, [ribbon.enabled, ribbon.text, ribbon.color, ribbon.position]);

  // Generate Cloudinary transformation URL
  useEffect(() => {
    if (!selectedMedia) {
      setPreviewUrl("");
      return;
    }

    // Start with base image URL
    let url = selectedMedia.originalUrl;
    
    // Extract Cloudinary parts
    const cloudinaryPattern = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/image\/upload\//;
    const match = url.match(cloudinaryPattern);
    
    if (!match) {
      setPreviewUrl(url);
      return;
    }

    const [fullMatch, cloudName] = match;
    const imagePath = url.replace(fullMatch, '');
    
    // Build transformations array
    const transformations: string[] = [];

    // Base resize
    transformations.push('w_800,h_800,c_fit');

    // Filters
    if (filters.brightness !== 0) {
      transformations.push(`e_brightness:${filters.brightness}`);
    }
    if (filters.contrast !== 0) {
      transformations.push(`e_contrast:${filters.contrast}`);
    }
    if (filters.saturation !== 0) {
      transformations.push(`e_saturation:${filters.saturation}`);
    }
    if (filters.blur > 0) {
      transformations.push(`e_blur:${filters.blur * 100}`);
    }
    if (filters.sharpen > 0) {
      transformations.push(`e_sharpen:${filters.sharpen * 100}`);
    }
    if (filters.effect !== "none") {
      transformations.push(`e_${filters.effect}`);
    }

    // Note: Ribbon and price badge overlays are rendered as CSS elements in preview
    // They are NOT added to Cloudinary transformation URL
    // This allows for better visual control and positioning

    // Logo overlay - using uploaded logo if available
    if (logo.enabled) {
      // TODO: Implement logo upload/selection system
      // For now, use a watermark text
      transformations.push(
        `l_text:Arial_32:© LOGO,co_white,o_${logo.opacity}`,
        `fl_layer_apply,g_${logo.position},x_30,y_30`
      );
    }

    // Construct final URL
    const transformedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${transformations.join('/')}/${imagePath}`;
    setPreviewUrl(transformedUrl);

  }, [selectedMedia, ribbon, priceBadge, logo, filters]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <style>{`
        .ribbon-triangle {
          position: absolute;
          width: 0;
          height: 0;
          border-style: solid;
          z-index: 10;
          pointer-events: none;
        }
        
        .ribbon-triangle.north_west {
          top: 0;
          left: 0;
          border-width: 120px 120px 0 0;
        }
        
        .ribbon-triangle.north_west.red {
          border-top-color: #FF0000;
          border-right-color: transparent;
          border-bottom-color: transparent;
          border-left-color: transparent;
        }
        
        .ribbon-triangle.north_west.yellow {
          border-top-color: #FFC107;
          border-right-color: transparent;
          border-bottom-color: transparent;
          border-left-color: transparent;
        }
        
        .ribbon-triangle.north_east {
          top: 0;
          right: 0;
          border-width: 0 120px 120px 0;
        }
        
        .ribbon-triangle.north_east.red {
          border-top-color: transparent;
          border-right-color: #FF0000;
          border-bottom-color: transparent;
          border-left-color: transparent;
        }
        
        .ribbon-triangle.north_east.yellow {
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
          pointer-events: none;
          text-transform: uppercase;
          white-space: nowrap;
        }
        
        .ribbon-text.north_west {
          top: 30px;
          left: 5px;
          transform: rotate(-45deg);
          transform-origin: left center;
        }
        
        .ribbon-text.north_east {
          top: 30px;
          right: 5px;
          transform: rotate(45deg);
          transform-origin: right center;
        }
        
        /* Adaptive text sizes for ribbon */
        .ribbon-text.small {
          font-size: 10px;
        }
        
        .ribbon-text.medium {
          font-size: 14px;
        }
        
        .ribbon-text.large {
          font-size: 16px;
        }
      `}</style>
      
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <Wand2 className="w-8 h-8" />
              Éditeur d'images
            </h1>
            <p className="text-muted-foreground mt-2">
              Ajoutez des rubans promotionnels, badges prix et filtres à vos images
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - Controls */}
            <div className="space-y-6">
              {/* Image Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    Sélectionner une image
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {mediaList && (mediaList as any[]).filter((m: any) => m.type === 'image').length > 0 ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto">
                      {(mediaList as any[])
                        .filter((m: any) => m.type === 'image')
                        .map((media: any) => (
                          <div
                            key={media.id}
                            className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                              selectedMedia?.id === media.id ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                            }`}
                            onClick={() => setSelectedMedia(media)}
                            data-testid={`select-image-${media.id}`}
                          >
                            <img
                              src={media.instagramFeedUrl || media.originalUrl}
                              alt=""
                              className="w-full h-24 object-cover"
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
              <Card>
                <CardHeader>
                  <CardTitle>Ruban promotionnel</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="ribbon-enabled"
                      checked={ribbon.enabled}
                      onCheckedChange={(checked) => setRibbon({ ...ribbon, enabled: checked as boolean })}
                      data-testid="checkbox-ribbon"
                    />
                    <Label htmlFor="ribbon-enabled">Afficher un ruban</Label>
                  </div>

                  {ribbon.enabled && (
                    <>
                      <div className="space-y-2">
                        <Label>Texte du ruban</Label>
                        <RadioGroup
                          value={ribbon.text}
                          onValueChange={(value) => setRibbon({ ...ribbon, text: value as any })}
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Promo" id="ribbon-promo" data-testid="radio-ribbon-promo" />
                            <Label htmlFor="ribbon-promo">Promo</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Nouveauté" id="ribbon-nouveaute" data-testid="radio-ribbon-nouveaute" />
                            <Label htmlFor="ribbon-nouveaute">Nouveauté</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Arrivage" id="ribbon-arrivage" data-testid="radio-ribbon-arrivage" />
                            <Label htmlFor="ribbon-arrivage">Arrivage</Label>
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="space-y-2">
                        <Label>Couleur</Label>
                        <RadioGroup
                          value={ribbon.color}
                          onValueChange={(value) => setRibbon({ ...ribbon, color: value as any })}
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="red" id="ribbon-red" data-testid="radio-ribbon-red" />
                            <Label htmlFor="ribbon-red" className="flex items-center gap-2">
                              Rouge <Badge className="bg-red-600">Exemple</Badge>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="yellow" id="ribbon-yellow" data-testid="radio-ribbon-yellow" />
                            <Label htmlFor="ribbon-yellow" className="flex items-center gap-2">
                              Jaune <Badge className="bg-yellow-500">Exemple</Badge>
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="space-y-2">
                        <Label>Position</Label>
                        <Select value={ribbon.position} onValueChange={(value) => setRibbon({ ...ribbon, position: value as any })}>
                          <SelectTrigger data-testid="select-ribbon-position">
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
              <Card>
                <CardHeader>
                  <CardTitle>Badge prix</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="price-enabled"
                      checked={priceBadge.enabled}
                      onCheckedChange={(checked) => setPriceBadge({ ...priceBadge, enabled: checked as boolean })}
                      data-testid="checkbox-price"
                    />
                    <Label htmlFor="price-enabled">Afficher le prix</Label>
                  </div>

                  {priceBadge.enabled && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="price-input">Prix (€)</Label>
                        <Input
                          id="price-input"
                          type="text"
                          placeholder="19.99"
                          value={priceBadge.price}
                          onChange={(e) => setPriceBadge({ ...priceBadge, price: e.target.value })}
                          data-testid="input-price"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Couleur</Label>
                        <RadioGroup
                          value={priceBadge.color}
                          onValueChange={(value) => setPriceBadge({ ...priceBadge, color: value as any })}
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="red" id="price-red" data-testid="radio-price-red" />
                            <Label htmlFor="price-red" className="flex items-center gap-2">
                              Rouge <Badge className="bg-red-600">€19.99</Badge>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="yellow" id="price-yellow" data-testid="radio-price-yellow" />
                            <Label htmlFor="price-yellow" className="flex items-center gap-2">
                              Jaune <Badge className="bg-yellow-500">€19.99</Badge>
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="space-y-2">
                        <Label>Position</Label>
                        <Select value={priceBadge.position} onValueChange={(value) => setPriceBadge({ ...priceBadge, position: value as any })}>
                          <SelectTrigger data-testid="select-price-position">
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

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label>Taille du texte</Label>
                          <span className="text-sm text-muted-foreground">{priceBadge.size}px</span>
                        </div>
                        <Slider
                          value={[priceBadge.size]}
                          onValueChange={(value) => setPriceBadge({ ...priceBadge, size: value[0] })}
                          min={12}
                          max={40}
                          step={1}
                          data-testid="slider-price-size"
                        />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Filters */}
              <Card>
                <CardHeader>
                  <CardTitle>Filtres</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>Luminosité</Label>
                      <span className="text-sm text-muted-foreground">{filters.brightness}</span>
                    </div>
                    <Slider
                      value={[filters.brightness]}
                      onValueChange={([value]) => setFilters({ ...filters, brightness: value })}
                      min={-50}
                      max={50}
                      step={5}
                      data-testid="slider-brightness"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>Contraste</Label>
                      <span className="text-sm text-muted-foreground">{filters.contrast}</span>
                    </div>
                    <Slider
                      value={[filters.contrast]}
                      onValueChange={([value]) => setFilters({ ...filters, contrast: value })}
                      min={-50}
                      max={50}
                      step={5}
                      data-testid="slider-contrast"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>Saturation</Label>
                      <span className="text-sm text-muted-foreground">{filters.saturation}</span>
                    </div>
                    <Slider
                      value={[filters.saturation]}
                      onValueChange={([value]) => setFilters({ ...filters, saturation: value })}
                      min={-100}
                      max={100}
                      step={10}
                      data-testid="slider-saturation"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Effet</Label>
                    <Select value={filters.effect} onValueChange={(value) => setFilters({ ...filters, effect: value as any })}>
                      <SelectTrigger data-testid="select-effect">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aucun</SelectItem>
                        <SelectItem value="grayscale">Noir et blanc</SelectItem>
                        <SelectItem value="sepia">Sépia</SelectItem>
                        <SelectItem value="vintage">Vintage</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Preview */}
            <div className="lg:sticky lg:top-6 lg:h-fit">
              <Card>
                <CardHeader>
                  <CardTitle>Aperçu</CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedMedia ? (
                    <div className="space-y-4">
                      <div className="rounded-lg overflow-hidden bg-muted aspect-square flex items-center justify-center">
                        <div className="relative w-full h-full">
                          <img
                            src={previewUrl || selectedMedia.originalUrl}
                            alt="Aperçu"
                            className="w-full h-full object-contain"
                            data-testid="preview-image"
                          />
                          
                          {/* CSS Triangle Ribbon Overlay */}
                          {ribbon.enabled && ribbon.text && (
                            <>
                              <div className={`ribbon-triangle ${ribbon.position} ${ribbon.color}`} />
                              <div className={`ribbon-text ${ribbon.position} ${
                                ribbon.text.length > 8 ? 'small' : ribbon.text.length > 5 ? 'medium' : 'large'
                              }`}>
                                {ribbon.text}
                              </div>
                            </>
                          )}
                          
                          {/* Price Badge Overlay (CSS) */}
                          {priceBadge.enabled && priceBadge.price && (
                            <div 
                              className={`absolute ${
                                priceBadge.position === "north_east" ? "top-4 right-4" :
                                priceBadge.position === "south_east" ? "bottom-4 right-4" :
                                priceBadge.position === "south_west" ? "bottom-4 left-4" :
                                "top-4 left-4"
                              } px-4 py-2 rounded-full text-white font-bold z-10 ${
                                priceBadge.color === "red" ? "bg-red-600" : "bg-yellow-500"
                              }`}
                              style={{ fontSize: `${priceBadge.size}px` }}
                            >
                              €{priceBadge.price}
                            </div>
                          )}
                        </div>
                        
                        <button
                          onClick={() => setSelectedMedia(null)}
                          className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors z-20"
                          data-testid="button-clear-selection"
                          title="Désélectionner l'image"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex gap-3">
                        <Button className="flex-1" variant="outline" data-testid="button-save">
                          <Save className="w-4 h-4 mr-2" />
                          Enregistrer
                        </Button>
                        <Button className="flex-1" data-testid="button-use-in-post">
                          <ArrowRight className="w-4 h-4 mr-2" />
                          Utiliser dans un post
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-square flex items-center justify-center bg-muted rounded-lg">
                      <p className="text-muted-foreground">Sélectionnez une image</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
