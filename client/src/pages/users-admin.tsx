import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, UserPlus } from "lucide-react";

export default function UsersAdmin() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  // Mutation pour créer un utilisateur
  const createUserMutation = useMutation({
    mutationFn: async (userData: { username: string; password: string; role: string }) => {
      const res = await apiRequest("POST", "/api/users", userData);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Utilisateur créé",
        description: `L'utilisateur ${data.username} a été créé avec succès`,
      });
      // Réinitialiser le formulaire
      setUsername("");
      setPassword("");
      setRole("user");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: error.message || "Erreur lors de la création de l'utilisateur",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Veuillez remplir tous les champs",
      });
      return;
    }

    if (password.length < 4) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Le mot de passe doit contenir au moins 4 caractères",
      });
      return;
    }

    createUserMutation.mutate({ username, password, role });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-6 space-y-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Users className="w-8 h-8" />
              Gestion des utilisateurs
            </h1>
            <p className="text-muted-foreground mt-2">
              Créez et gérez les utilisateurs de l'application
            </p>
          </div>

          <div className="max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5" />
                  Créer un nouvel utilisateur
                </CardTitle>
                <CardDescription>
                  Seuls les administrateurs peuvent créer des utilisateurs
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Nom d'utilisateur</Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="utilisateur123"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      data-testid="input-new-username"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Mot de passe</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      data-testid="input-new-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum 4 caractères
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">Rôle</Label>
                    <Select value={role} onValueChange={(value: "admin" | "user") => setRole(value)}>
                      <SelectTrigger id="role" data-testid="select-user-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">Utilisateur</SelectItem>
                        <SelectItem value="admin">Administrateur</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Les administrateurs ont accès à tous les paramètres et à la gestion SQL
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createUserMutation.isPending}
                    data-testid="button-create-user"
                  >
                    {createUserMutation.isPending ? "Création en cours..." : "Créer l'utilisateur"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Commandes SQL utiles</CardTitle>
                <CardDescription>
                  Utilisez ces commandes dans l'onglet SQL pour gérer les utilisateurs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm font-semibold mb-2">Voir tous les utilisateurs :</p>
                  <code className="text-xs">SELECT id, username, role FROM users;</code>
                </div>
                
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm font-semibold mb-2">Changer le rôle d'un utilisateur :</p>
                  <code className="text-xs">UPDATE users SET role = 'admin' WHERE username = 'nom_utilisateur';</code>
                </div>
                
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm font-semibold mb-2">Supprimer un utilisateur :</p>
                  <code className="text-xs">DELETE FROM users WHERE username = 'nom_utilisateur';</code>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
