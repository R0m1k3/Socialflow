import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toPng } from 'html-to-image';
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
  size: number; // Font size in pixels
}

interface Logo {
  enabled: boolean;
  opacity: number;
  position: "north_east" | "south_east" | "north_west" | "south_west" | "center";
  size: "small" | "medium" | "large";
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

  // Save edited image mutation - Server-side processing with Sharp
  const saveImageMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMedia) {
        throw new Error("Aucune image sélectionnée");
      }

      // Send image URL and overlay parameters to backend
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


  // Generate Cloudinary transformation URL
  useEffect(() => {
    console.log("[ImageEditor] useEffect triggered, selectedMedia:", selectedMedia);
    
    if (!selectedMedia) {
      setPreviewUrl("");
      return;
    }

    // Start with base image URL
    let url = selectedMedia.originalUrl;
    console.log("[ImageEditor] Generating preview URL from:", url);
    
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

    // Note: Ribbon and price badge overlays are rendered as CSS elements in preview
    // They are NOT added to Cloudinary transformation URL
    // This allows for better visual control and positioning

    // Logo overlay will be added by backend when saving
    // Preview just shows the base image with CSS overlays

    // Construct final URL
    const transformedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${transformations.join('/')}/${imagePath}`;
    setPreviewUrl(transformedUrl);

  }, [selectedMedia, ribbon, priceBadge, logo]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <style>{`
        /* Triangle ribbon - auto-centered text */
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
                            onClick={() => {
                              console.log("[ImageEditor] Thumbnail clicked, media:", media);
                              setSelectedMedia(media);
                            }}
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
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Stock limité" id="ribbon-stock" data-testid="radio-ribbon-stock" />
                            <Label htmlFor="ribbon-stock">Stock limité</Label>
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
                              Rouge <Badge className="bg-red-600">19.99€</Badge>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="yellow" id="price-yellow" data-testid="radio-price-yellow" />
                            <Label htmlFor="price-yellow" className="flex items-center gap-2">
                              Jaune <Badge className="bg-yellow-500">19.99€</Badge>
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
                          max={70}
                          step={1}
                          data-testid="slider-price-size"
                        />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Logo */}
              <Card>
                <CardHeader>
                  <CardTitle>Logo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="logo-enabled"
                      checked={logo.enabled}
                      onCheckedChange={(checked) => setLogo({ ...logo, enabled: checked as boolean })}
                      data-testid="checkbox-logo-enabled"
                    />
                    <Label htmlFor="logo-enabled" className="cursor-pointer">
                      Afficher le logo
                    </Label>
                  </div>

                  {logo.enabled && (
                    <>
                      <div className="space-y-2">
                        <Label>Position</Label>
                        <Select value={logo.position} onValueChange={(value) => setLogo({ ...logo, position: value as any })}>
                          <SelectTrigger data-testid="select-logo-position">
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
                        <Label>Taille</Label>
                        <Select value={logo.size} onValueChange={(value) => setLogo({ ...logo, size: value as any })}>
                          <SelectTrigger data-testid="select-logo-size">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="small">Petit</SelectItem>
                            <SelectItem value="medium">Moyen</SelectItem>
                            <SelectItem value="large">Grand</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label>Opacité</Label>
                          <span className="text-sm text-muted-foreground">{logo.opacity}%</span>
                        </div>
                        <Slider
                          value={[logo.opacity]}
                          onValueChange={(value) => setLogo({ ...logo, opacity: value[0] })}
                          min={0}
                          max={100}
                          step={5}
                          data-testid="slider-logo-opacity"
                        />
                      </div>
                    </>
                  )}
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
                        <div ref={previewRef} className="relative">
                          <img
                            src={previewUrl || selectedMedia.originalUrl}
                            alt="Aperçu"
                            className="max-w-full max-h-[706px] w-auto h-auto"
                            data-testid="preview-image"
                          />
                          
                          {/* CSS Triangle Ribbon Overlay - Auto-centered */}
                          {ribbon.enabled && ribbon.text && (
                            <div className={`ribbon-container ${ribbon.position}`}>
                              <div className={`ribbon-triangle ${ribbon.color}`} />
                              <div 
                                className="ribbon-text"
                                style={{ 
                                  fontSize: ribbon.text === "Stock limité" ? '20px' :
                                           ribbon.text.length <= 5 ? '28px' : 
                                           ribbon.text.length <= 8 ? '24px' : 
                                           ribbon.text.length <= 11 ? '20px' : '16px',
                                  lineHeight: ribbon.text === "Stock limité" ? '1.2' : 'normal',
                                  whiteSpace: ribbon.text === "Stock limité" ? 'normal' : 'nowrap',
                                  transform: ribbon.text === "Stock limité" 
                                    ? (ribbon.position === "north_west" 
                                       ? 'translate(-50%, -50%) rotate(-45deg) translateY(-35px) translateX(2px)'
                                       : 'translate(50%, -50%) rotate(45deg) translateY(-35px) translateX(-2px)')
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
                          
                          {/* Price Badge Overlay (CSS) */}
                          {priceBadge.enabled && priceBadge.price && (
                            <div 
                              data-badge-price="true"
                              className={`absolute ${
                                priceBadge.position === "north_east" ? "top-4 right-4" :
                                priceBadge.position === "south_east" ? "bottom-4 right-4" :
                                priceBadge.position === "south_west" ? "bottom-4 left-4" :
                                "top-4 left-4"
                              } px-4 py-2 rounded-full text-white font-bold z-10 flex items-center justify-center ${
                                priceBadge.color === "red" ? "bg-red-600" : "bg-yellow-500"
                              }`}
                              style={{ fontSize: `${priceBadge.size}px` }}
                            >
                              {priceBadge.price}€
                            </div>
                          )}

                          {/* Logo Overlay (CSS) */}
                          {logo.enabled && cloudinaryConfig && (cloudinaryConfig as any).logoPublicId && (
                            <img
                              src={`https://res.cloudinary.com/${(cloudinaryConfig as any).cloudName}/image/upload/${(cloudinaryConfig as any).logoPublicId}`}
                              alt="Logo"
                              className={`absolute ${
                                logo.position === "north_east" ? "top-4 right-4" :
                                logo.position === "south_east" ? "bottom-4 right-4" :
                                logo.position === "south_west" ? "bottom-4 left-4" :
                                logo.position === "center" ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" :
                                "top-4 left-4"
                              } z-10 ${
                                logo.size === "small" ? "w-16" :
                                logo.size === "large" ? "w-32" :
                                "w-24"
                              }`}
                              style={{ opacity: logo.opacity / 100 }}
                            />
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

                      <Button 
                        className="w-full" 
                        variant="outline" 
                        data-testid="button-save"
                        onClick={() => saveImageMutation.mutate()}
                        disabled={saveImageMutation.isPending}
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {saveImageMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                      </Button>
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
