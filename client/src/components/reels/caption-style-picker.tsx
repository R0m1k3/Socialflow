import { CAPTION_STYLE_OPTIONS, type CaptionStyle } from "@shared/captions";
import { cn } from "@/lib/utils";

/** Aperçu miniature de chaque style de sous-titres. */
const SAMPLE: Record<CaptionStyle, React.ReactNode> = {
  bold: (
    <span className="font-black uppercase tracking-tight" style={{ WebkitTextStroke: "1px #000", paintOrder: "stroke fill" }}>
      <span className="text-white">Nos </span>
      <span className="text-yellow-300">promos</span>
    </span>
  ),
  neon: (
    <span className="font-extrabold">
      <span className="rounded px-1 bg-black/50 text-white">Nos</span>{" "}
      <span className="rounded px-1 bg-violet-600 text-white">promos</span>
    </span>
  ),
  minimal: (
    <span className="font-bold">
      <span className="text-white">Nos </span>
      <span className="text-white/45">promos</span>
    </span>
  ),
};

export function CaptionStylePicker({
  value,
  onChange,
  compact = false,
}: {
  value: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Style des sous-titres">
      {CAPTION_STYLE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          title={option.description}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-lg border p-2 text-left transition-colors",
            value === option.id ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center rounded-md bg-gradient-to-br from-slate-700 to-slate-900",
              compact ? "h-9 text-[11px]" : "h-12 text-sm",
            )}
          >
            {SAMPLE[option.id]}
          </div>
          <p className={cn("mt-1 font-medium", compact ? "text-[11px]" : "text-xs")}>{option.label}</p>
        </button>
      ))}
    </div>
  );
}
