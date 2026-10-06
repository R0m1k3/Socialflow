import { useState, useEffect } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/empty-state";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, UserPlus, Pencil, Trash2, Shield, User as UserIcon, KeyRound } from "lucide-react";

type UserData = {
  id: string;
  username: string;
  role: "admin" | "user";
};

type SocialPage = {
  id: string;
  pageName: string;
  platform: string;
  userId: string;
};

type UserPagePermission = {
  id: string;
  userId: string;
  pageId: string;
};

export default function UsersAdmin() {
  const { toast } = useToast();
  
  // Form states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  
  // Edit dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  
  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserData | null>(null);

  // Permissions dialog states
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [permissionsUser, setPermissionsUser] = useState<UserData | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);

  // Charger la liste des utilisateurs
  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/users"],
  });

  // Charger toutes les pages (admin voit toutes les pages)
  const { data: allPages } = useQuery<SocialPage[]>({
    queryKey: ["/api/pages"],
  });

  // Charger les permissions de l'utilisateur sélectionné
  const { data: userPermissions } = useQuery<UserPagePermission[]>({
    queryKey: ["/api/users", permissionsUser?.id, "page-permissions"],
    enabled: !!permissionsUser && permissionsDialogOpen,
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
      setCreateDialogOpen(false);
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

  // Mutation pour mettre à jour les permissions d'un utilisateur
  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ userId, pageIds }: { userId: string; pageIds: string[] }) => {
      const res = await apiRequest("POST", `/api/users/${userId}/page-permissions`, { pageIds });
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Permissions mises à jour",
        description: "Les permissions de l'utilisateur ont été mises à jour avec succès",
      });
      setPermissionsDialogOpen(false);
      setPermissionsUser(null);
      setSelectedPageIds([]);
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: error.message || "Erreur lors de la mise à jour des permissions",
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

  const handlePermissionsClick = (user: UserData) => {
    setPermissionsUser(user);
    setPermissionsDialogOpen(true);
  };

  // Mettre à jour selectedPageIds quand les permissions sont chargées
  useEffect(() => {
    if (userPermissions) {
      setSelectedPageIds(userPermissions.map(p => p.pageId));
    }
  }, [userPermissions]);

  const handlePermissionsSubmit = () => {
    if (permissionsUser) {
      updatePermissionsMutation.mutate({
        userId: permissionsUser.id,
        pageIds: selectedPageIds,
      });
    }
  };

  const togglePagePermission = (pageId: string) => {
    setSelectedPageIds(prev => {
      if (prev.includes(pageId)) {
        return prev.filter(id => id !== pageId);
      } else {
        return [...prev, pageId];
      }
    });
  };

  return (
    <>
      <Page width="default">
        <PageHeader
          icon={Users}
          title="Utilisateurs"
          description="Qui peut se connecter à Social Flow et sur quels comptes publier."
          actions={
            <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-open-create-user">
              <UserPlus className="h-4 w-4" /> Nouvel utilisateur
            </Button>
          }
        />

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        ) : users && users.length > 0 ? (
          <Card className="overflow-hidden">
            <ul className="divide-y">
              {users.map((user) => (
                <li key={user.id} className="flex items-center gap-3 p-4" data-testid={`row-user-${user.id}`}>
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className={user.role === "admin" ? "bg-primary/10 font-semibold text-primary" : "bg-muted font-semibold text-muted-foreground"}>
                      {user.username.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{user.username}</p>
                    <Badge variant={user.role === "admin" ? "default" : "muted"} className="mt-1 gap-1">
                      {user.role === "admin" ? <Shield className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                      {user.role === "admin" ? "Administrateur" : "Utilisateur"}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {user.role === "user" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePermissionsClick(user)}
                        data-testid={`button-permissions-user-${user.id}`}
                      >
                        <KeyRound className="h-4 w-4" />
                        <span className="hidden sm:inline">Accès aux pages</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      onClick={() => handleEditClick(user)}
                      aria-label="Modifier"
                      data-testid={`button-edit-user-${user.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteClick(user)}
                      aria-label="Supprimer"
                      data-testid={`button-delete-user-${user.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            icon={Users}
            title="Aucun utilisateur"
            action={<Button onClick={() => setCreateDialogOpen(true)}>Créer un utilisateur</Button>}
          />
        )}
      </Page>

      {/* Dialog de création */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouvel utilisateur</DialogTitle>
            <DialogDescription>Il pourra se connecter immédiatement avec ces identifiants.</DialogDescription>
          </DialogHeader>
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
              <p className="text-xs text-muted-foreground">4 caractères minimum</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Rôle</Label>
              <Select value={role} onValueChange={(value: "admin" | "user") => setRole(value)}>
                <SelectTrigger id="role" data-testid="select-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Utilisateur — publie sur les pages autorisées</SelectItem>
                  <SelectItem value="admin">Administrateur — accès complet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-create-user">
                {createUserMutation.isPending ? "Création…" : "Créer l'utilisateur"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
            <AlertDialogTitle>Supprimer cet utilisateur ?</AlertDialogTitle>
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

      {/* Dialog de gestion des permissions */}
      <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Accès aux pages</DialogTitle>
            <DialogDescription>
              Sélectionnez les pages auxquelles l'utilisateur <strong>{permissionsUser?.username}</strong> peut accéder
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {allPages && allPages.length > 0 ? (
              <div className="space-y-3">
                {allPages.map((page) => (
                  <div key={page.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent">
                    <Checkbox
                      id={`page-${page.id}`}
                      checked={selectedPageIds.includes(page.id)}
                      onCheckedChange={() => togglePagePermission(page.id)}
                      data-testid={`checkbox-page-${page.id}`}
                    />
                    <Label
                      htmlFor={`page-${page.id}`}
                      className="flex-1 cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <PlatformIcon platform={page.platform} size="sm" />
                        <div>
                          <div className="font-medium">{page.pageName}</div>
                          <div className="text-xs text-muted-foreground">{platformLabel(page.platform)}</div>
                        </div>
                      </div>
                    </Label>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Aucune page disponible
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionsDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handlePermissionsSubmit}
              disabled={updatePermissionsMutation.isPending}
              data-testid="button-save-permissions"
            >
              {updatePermissionsMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
