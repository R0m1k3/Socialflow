import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, CheckCircle2, Loader2, Lock, User } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showDefaultPassword, setShowDefaultPassword] = useState(false);

  useEffect(() => {
    const checkDefaultPassword = async () => {
      try {
        const response = await fetch("/api/auth/default-password-status");
        const data = await response.json();
        setShowDefaultPassword(data.isDefault === true);
      } catch (error) {
        console.error("Error checking default password status:", error);
      }
    };

    checkDefaultPassword();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await apiRequest("POST", "/api/auth/login", { username, password });
      const data = await response.json();

      toast({
        title: "Connexion réussie",
        description: `Bienvenue ${data.username}`,
      });

      setLocation("/");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erreur de connexion",
        description: error.message || "Nom d'utilisateur ou mot de passe incorrect",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Panneau de marque (desktop) */}
      <div className="relative hidden flex-1 overflow-hidden gradient-brand lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center gap-3 text-white">
          <LogoMark size={40} className="rounded-xl ring-1 ring-white/30" />
          <span className="text-xl font-semibold tracking-tight">Social Flow</span>
        </div>
        <div className="relative max-w-md text-white">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Vos réseaux sociaux, en pilote automatique.
          </h2>
          <ul className="mt-8 space-y-3 text-white/90">
            {[
              "Créez publications et Reels en quelques clics",
              "Programmez sur Facebook, Instagram et TikTok",
              "Laissez l'IA rédiger vos textes",
            ].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">© Social Flow</p>
      </div>

      {/* Formulaire */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={44} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
          <p className="mt-1 text-sm text-muted-foreground">Connectez-vous pour gérer vos publications.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" data-testid="label-username">
                Nom d'utilisateur
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-11 pl-10"
                  required
                  disabled={isLoading}
                  data-testid="input-username"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" data-testid="label-password">
                Mot de passe
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pl-10"
                  required
                  disabled={isLoading}
                  data-testid="input-password"
                />
              </div>
            </div>

            <Button type="submit" variant="brand" size="lg" className="w-full" disabled={isLoading} data-testid="button-login">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isLoading ? "Connexion en cours…" : "Se connecter"}
            </Button>
          </form>

          {showDefaultPassword && (
            <div className="mt-6 flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="text-foreground">
                  Identifiants par défaut : <span className="font-semibold">admin / admin</span>
                </p>
                <p className="mt-1 text-muted-foreground">Changez ce mot de passe après la première connexion.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
