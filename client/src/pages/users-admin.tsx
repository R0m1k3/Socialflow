import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, UserPlus, Pencil, Trash2, Shield, User as UserIcon } from "lucide-react";

type UserData = {
  id: string;
  username: string;
  role: "admin" | "user";
};

export default function UsersAdmin() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast } = useToast();
  
  // Form states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  
  // Edit dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  
  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserData | null>(null);

  // Charger la liste des utilisateurs
  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/users"],
  });

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
      setUsername("");
      setPassword("");
      setRole("user");
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: error.message || "Erreur lors de la création de l'utilisateur",
      });
    },
  });

  // Mutation pour modifier un utilisateur
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, data);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Utilisateur modifié",
        description: `L'utilisateur ${data.username} a été modifié avec succès`,
      });
      setEditDialogOpen(false);
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: error.message || "Erreur lors de la modification de l'utilisateur",
      });
    },
  });

  // Mutation pour supprimer un utilisateur
  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/users/${id}`, {});
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Utilisateur supprimé",
        description: "L'utilisateur a été supprimé avec succès",
      });
      setDeleteDialogOpen(false);
      setUserToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: error.message || "Erreur lors de la suppression de l'utilisateur",
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

  const handleEditClick = (user: UserData) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditPassword("");
    setEditRole(user.role);
    setEditDialogOpen(true);
  };

  const handleEditSubmit = () => {
    if (!editingUser) return;

    const updateData: any = {};
    
    if (editUsername !== editingUser.username) {
      updateData.username = editUsername;
    }
    
    if (editPassword) {
      updateData.password = editPassword;
    }
    
    if (editRole !== editingUser.role) {
      updateData.role = editRole;
    }

    if (Object.keys(updateData).length === 0) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Aucune modification détectée",
      });
      return;
    }

    updateUserMutation.mutate({ id: editingUser.id, data: updateData });
  };

  const handleDeleteClick = (user: UserData) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (userToDelete) {
      deleteUserMutation.mutate(userToDelete.id);
    }
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Liste des utilisateurs */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Liste des utilisateurs</CardTitle>
                  <CardDescription>
                    {users?.length || 0} utilisateur(s) enregistré(s)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                      <p className="text-muted-foreground mt-4">Chargement...</p>
                    </div>
                  ) : users && users.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nom d'utilisateur</TableHead>
                          <TableHead>Rôle</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell className="font-medium flex items-center gap-2">
                              {user.role === "admin" ? (
                                <Shield className="w-4 h-4 text-primary" />
                              ) : (
                                <UserIcon className="w-4 h-4 text-muted-foreground" />
                              )}
                              {user.username}
                            </TableCell>
                            <TableCell>
                              <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                                {user.role === "admin" ? "Administrateur" : "Utilisateur"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditClick(user)}
                                  data-testid={`button-edit-user-${user.id}`}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDeleteClick(user)}
                                  data-testid={`button-delete-user-${user.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">Aucun utilisateur trouvé</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Formulaire de création */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="w-5 h-5" />
                    Créer un utilisateur
                  </CardTitle>
                  <CardDescription>
                    Ajouter un nouvel utilisateur
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
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createUserMutation.isPending}
                      data-testid="button-create-user"
                    >
                      {createUserMutation.isPending ? "Création..." : "Créer"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      {/* Dialog de modification */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
            <DialogDescription>
              Modifiez les informations de l'utilisateur. Laissez le mot de passe vide pour ne pas le changer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Nom d'utilisateur</Label>
              <Input
                id="edit-username"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                data-testid="input-edit-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">Nouveau mot de passe (optionnel)</Label>
              <Input
                id="edit-password"
                type="password"
                placeholder="Laisser vide pour ne pas changer"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                data-testid="input-edit-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Rôle</Label>
              <Select value={editRole} onValueChange={(value: "admin" | "user") => setEditRole(value)}>
                <SelectTrigger id="edit-role" data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Utilisateur</SelectItem>
                  <SelectItem value="admin">Administrateur</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateUserMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateUserMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de confirmation de suppression */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer l'utilisateur <strong>{userToDelete?.username}</strong> ?
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteUserMutation.isPending ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
