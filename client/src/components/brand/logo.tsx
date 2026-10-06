import { useId } from "react";
import { cn } from "@/lib/utils";

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/** Pictogramme Social Flow : deux ondes qui « coulent » vers un point de diffusion. */
export function LogoMark({ size = 36, className }: LogoMarkProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`sf-${id}`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="0.6" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#F97362" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#sf-${id})`} />
      <path d="M7 12.5c2.4-3.6 5.1-3.6 7.5 0s5.1 3.6 7.5 0" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7 19.5c2.4-3.6 5.1-3.6 7.5 0s5.1 3.6 7.5 0" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="25.2" cy="16" r="1.9" fill="#fff" />
    </svg>
  );
}

interface LogoProps extends LogoMarkProps {
  withText?: boolean;
  subtitle?: boolean;
}

export function Logo({ size = 36, withText = true, subtitle = true, className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-3 min-w-0", className)}>
      <LogoMark size={size} />
      {withText && (
        <div className="min-w-0 leading-tight">
          <p className="font-semibold tracking-tight text-foreground text-[17px]">
            Social<span className="text-primary">Flow</span>
          </p>
          {subtitle && <p className="text-xs text-muted-foreground truncate">Automatisation sociale</p>}
        </div>
      )}
    </div>
  );
}
