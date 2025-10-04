import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Lock, User, Sparkles } from "lucide-react";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-primary/5 to-secondary/5 p-4">
      <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
      
      <Card className="w-full max-w-md rounded-2xl border-border/50 shadow-2xl relative z-10">
        <CardHeader className="space-y-4 text-center pt-8 pb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary mx-auto flex items-center justify-center shadow-2xl">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <div>
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Social Flow
            </CardTitle>
            <CardDescription className="text-base mt-3">
              Connectez-vous à votre compte pour gérer vos publications
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pb-8 px-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-3">
              <Label htmlFor="username" className="text-sm font-semibold" data-testid="label-username">
                Nom d'utilisateur
              </Label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-12 h-12 rounded-xl bg-muted/30 border-border/50 focus:border-primary/50"
                  required
                  disabled={isLoading}
                  data-testid="input-username"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="password" className="text-sm font-semibold" data-testid="label-password">
                Mot de passe
              </Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-12 h-12 rounded-xl bg-muted/30 border-border/50 focus:border-primary/50"
                  required
                  disabled={isLoading}
                  data-testid="input-password"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 rounded-xl bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-base font-semibold shadow-lg mt-6"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? "Connexion en cours..." : "Se connecter"}
            </Button>
          </form>

          {showDefaultPassword && (
            <div className="mt-8 text-center p-4 rounded-xl bg-warning/10 border border-warning/20">
              <p className="text-sm text-muted-foreground mb-2">Identifiants par défaut :</p>
              <p className="font-semibold text-foreground">admin / admin</p>
              <p className="text-xs mt-3 text-warning flex items-center justify-center gap-2">
                <span className="text-base">⚠️</span>
                Changez ce mot de passe après la première connexion
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
