import type { LucideIcon } from "lucide-react";
import { Check, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface StepDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface StepperProps {
  steps: StepDef[];
  current: number;
  /** Renvoie null si l'étape est accessible, sinon la raison du blocage. */
  lockedReason?: (index: number) => string | null;
  onStepClick?: (index: number) => void;
  className?: string;
}

/** Indicateur d'étapes cliquable, utilisé par les parcours de création. */
export function Stepper({ steps, current, lockedReason, onStepClick, className }: StepperProps) {
  return (
    <nav aria-label="Étapes" className={cn("mb-6", className)}>
      {/* Mobile : libellé de l'étape + barres de progression */}
      <div className="sm:hidden">
        <p className="text-xs font-medium text-muted-foreground">
          Étape {current + 1} sur {steps.length}
        </p>
        <p className="font-semibold">{steps[current]?.label}</p>
        <div className="mt-2 flex gap-1.5">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.label}
              onClick={() => !lockedReason?.(i) && onStepClick?.(i)}
              className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= current ? "bg-primary" : "bg-muted")}
            />
          ))}
        </div>
      </div>

      {/* Desktop */}
      <ol className="hidden items-center sm:flex">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const done = i < current;
          const active = i === current;
          const reason = lockedReason?.(i) ?? null;
          const button = (
            <button
              type="button"
              disabled={!!reason}
              onClick={() => onStepClick?.(i)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                active && "text-foreground",
                done && "text-foreground hover:bg-accent",
                !active && !done && !reason && "text-muted-foreground hover:bg-accent",
                reason && "cursor-not-allowed text-muted-foreground/60",
              )}
              data-testid={`step-${step.id}`}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs transition-colors",
                  active && "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30",
                  done && "border-primary/30 bg-primary/10 text-primary",
                  !active && !done && "bg-card",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : reason ? <Lock className="h-3.5 w-3.5" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className="hidden md:inline">{step.label}</span>
            </button>
          );
          return (
            <li key={step.id} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
              {reason ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>{button}</span>
                  </TooltipTrigger>
                  <TooltipContent>{reason}</TooltipContent>
                </Tooltip>
              ) : (
                button
              )}
              {i < steps.length - 1 && (
                <div className={cn("mx-2 h-px flex-1", i < current ? "bg-primary/40" : "bg-border")} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Barre Précédent / Suivant, collante en bas sur mobile (au-dessus de la navigation). */
export function StepNavigation({
  onBack,
  onNext,
  nextLabel = "Continuer",
  nextDisabled,
  backDisabled,
  next,
  hint,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  backDisabled?: boolean;
  /** Remplace le bouton « Continuer » (ex. bouton de publication). */
  next?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-16 z-20 -mx-4 mt-6 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none lg:bottom-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled}
          className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
          data-testid="button-step-back"
        >
          Retour
        </button>
        {hint && <p className="hidden flex-1 text-right text-xs text-muted-foreground sm:block">{hint}</p>}
        <div className={cn("flex flex-1 justify-end", hint && "sm:flex-none")}>
          {next ?? (
            <button
              type="button"
              onClick={onNext}
              disabled={nextDisabled}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
              data-testid="button-step-next"
            >
              {nextLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
