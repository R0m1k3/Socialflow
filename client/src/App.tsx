import { Switch, Route, Redirect, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import NewPost from "@/pages/new-post";
import Calendar from "@/pages/calendar";
import Media from "@/pages/media";
import PagesManagement from "@/pages/pages";
import AI from "@/pages/ai";
import History from "@/pages/history";
import Settings from "@/pages/settings";
import SqlAdmin from "@/pages/sql";
import UsersAdmin from "@/pages/users-admin";

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType; adminOnly?: boolean }) {
  const [, setLocation] = useLocation();
  
  const { data: session, isLoading } = useQuery({
    queryKey: ["/api/auth/session"],
    retry: false,
  });

  useEffect(() => {
    if (!isLoading && !session) {
      setLocation("/login");
    }
  }, [isLoading, session, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  if (adminOnly && (session as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Accès refusé</h1>
          <p className="text-muted-foreground">Cette page est réservée aux administrateurs.</p>
        </div>
      </div>
    );
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/new">{() => <ProtectedRoute component={NewPost} />}</Route>
      <Route path="/calendar">{() => <ProtectedRoute component={Calendar} />}</Route>
      <Route path="/media">{() => <ProtectedRoute component={Media} />}</Route>
      <Route path="/pages">{() => <ProtectedRoute component={PagesManagement} />}</Route>
      <Route path="/ai">{() => <ProtectedRoute component={AI} adminOnly />}</Route>
      <Route path="/history">{() => <ProtectedRoute component={History} />}</Route>
      <Route path="/settings">{() => <ProtectedRoute component={Settings} adminOnly />}</Route>
      <Route path="/sql">{() => <ProtectedRoute component={SqlAdmin} adminOnly />}</Route>
      <Route path="/users">{() => <ProtectedRoute component={UsersAdmin} adminOnly />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div>
          <Toaster />
          <Router />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
