import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, AUTH_MUTATION, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface Session {
  id: string;
  username: string;
  role: string;
}

/** Session courante (mise en cache par react-query, partagée par toute l'app). */
export function useSession() {
  const query = useQuery<Session>({
    queryKey: ["/api/auth/session"],
    retry: false,
  });
  return { ...query, session: query.data, isAdmin: query.data?.role === "admin" };
}

export function useLogout() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  return useMutation({
    mutationKey: [AUTH_MUTATION, "logout"],
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout", {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
      toast({ title: "Déconnecté", description: "À bientôt !" });
    },
  });
}
