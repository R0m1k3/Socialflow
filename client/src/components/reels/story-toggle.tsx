import { Switch } from "@/components/ui/switch";

interface StoryToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Double le Reel d'une story sur les pages Facebook sélectionnées. TikTok n'a
 * pas de stories : l'option ne le concerne pas.
 */
export function StoryToggle({ checked, onCheckedChange }: StoryToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
      <label htmlFor="reel-also-story" className="space-y-0.5 cursor-pointer">
        <div className="text-sm font-medium">Publier aussi en story</div>
        <div className="text-xs text-muted-foreground">
          La vidéo est aussi publiée en story sur les pages Facebook sélectionnées (visible 24 h).
        </div>
      </label>
      <Switch
        id="reel-also-story"
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        data-testid="switch-reel-also-story"
      />
    </div>
  );
}
