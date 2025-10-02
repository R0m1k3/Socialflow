import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Lock, User } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showDefaultPassword, setShowDefaultPassword] = useState(false);

  // Vérifier si le mot de passe admin par défaut est toujours actif
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

      // Rediriger vers le dashboard
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-3xl font-bold">Social Flow</CardTitle>
          <CardDescription>
            Connectez-vous à votre compte pour gérer vos publications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" data-testid="label-username">
                Nom d'utilisateur
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10"
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
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  disabled={isLoading}
                  data-testid="input-password"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? "Connexion en cours..." : "Se connecter"}
            </Button>
          </form>

          {showDefaultPassword && (
            <div className="mt-6 text-center text-sm text-muted-foreground">
              <p>Identifiants par défaut :</p>
              <p className="font-semibold">admin / admin</p>
              <p className="text-xs mt-2 text-orange-500">⚠️ Changez ce mot de passe après la première connexion</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
