import { useRef } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatSrtTime, parseSrt, srtEnd, type SrtCue } from "@shared/srt";

const MAX_SRT_BYTES = 512 * 1024;

export interface SrtFile {
  name: string;
  cues: SrtCue[];
}

interface SrtUploadProps {
  value: SrtFile | null;
  onChange: (value: SrtFile | null) => void;
}

/**
 * Import d'un fichier de sous-titres SRT. Tant qu'un fichier est chargé, il
 * remplace le texte libre : la voix lit chaque sous-titre à son instant.
 */
export function SrtUpload({ value, onChange }: SrtUploadProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_SRT_BYTES) throw new Error("Fichier SRT trop volumineux (512 Ko au plus)");
      const cues = parseSrt(await file.text());
      onChange({ name: file.name, cues });
      toast({ title: "Sous-titres importés", description: `${cues.length} sous-titre(s) · ${formatSrtTime(srtEnd(cues))}` });
    } catch (error) {
      toast({
        title: "Fichier SRT invalide",
        description: error instanceof Error ? error.message : "Lecture impossible",
        variant: "destructive",
      });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept=".srt,application/x-subrip,text/plain"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {value ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 text-sm font-medium">
              <FileText className="w-4 h-4 shrink-0 text-primary" />
              <span className="truncate">{value.name}</span>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <X className="w-4 h-4 mr-1" />
              Retirer
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {value.cues.length} sous-titre(s) · jusqu'à {formatSrtTime(srtEnd(value.cues))}. La voix lira chaque
            sous-titre à son instant et accélérera si besoin pour tenir dans sa durée.
          </p>
          <ul className="max-h-40 overflow-y-auto space-y-1 text-xs">
            {value.cues.map((cue, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 font-mono text-muted-foreground">
                  {formatSrtTime(cue.start)}–{formatSrtTime(cue.end)}
                </span>
                <span>{cue.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
          <Upload className="w-4 h-4 mr-2" />
          Importer un fichier SRT
        </Button>
      )}
    </div>
  );
}
