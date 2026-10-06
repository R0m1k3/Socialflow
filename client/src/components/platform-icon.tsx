import { SiFacebook, SiInstagram, SiTiktok } from "react-icons/si";
import { cn } from "@/lib/utils";

export type Platform = "facebook" | "instagram" | "tiktok" | string;

const META: Record<string, { label: string; icon: typeof SiFacebook; text: string; bg: string }> = {
  facebook: { label: "Facebook", icon: SiFacebook, text: "text-facebook", bg: "bg-facebook/10" },
  instagram: { label: "Instagram", icon: SiInstagram, text: "text-instagram", bg: "bg-instagram/10" },
  tiktok: { label: "TikTok", icon: SiTiktok, text: "text-tiktok", bg: "bg-tiktok/10" },
};

export function platformLabel(platform: Platform): string {
  return META[platform]?.label ?? platform;
}

/** Icône de plateforme sur pastille teintée (couleurs officielles via tokens). */
export function PlatformIcon({
  platform,
  size = "md",
  className,
}: {
  platform: Platform;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const meta = META[platform] ?? META.facebook;
  const Icon = meta.icon;
  const box = { sm: "h-7 w-7 rounded-md", md: "h-10 w-10 rounded-lg", lg: "h-12 w-12 rounded-xl" }[size];
  const icon = { sm: "h-3.5 w-3.5", md: "h-5 w-5", lg: "h-6 w-6" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", box, meta.bg, meta.text, className)}>
      <Icon className={icon} />
    </span>
  );
}
