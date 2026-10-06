import { Link } from "wouter";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-6 text-center">
      <LogoMark size={44} />
      <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Compass className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-medium text-primary">Erreur 404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        La page que vous cherchez n'existe pas ou a été déplacée.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Retour au tableau de bord</Link>
      </Button>
    </div>
  );
}
