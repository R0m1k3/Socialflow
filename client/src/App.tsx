import { Switch, Route, Redirect, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createResponsiveRoute } from "@/components/responsive-route";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";


// Create responsive routes with lazy loading for optimal performance
const History = createResponsiveRoute(
  () => import("@/pages/history"),
  () => import("@/pages/mobile/history")
);
const Dashboard = createResponsiveRoute(
  () => import("@/pages/dashboard"),
  () => import("@/pages/mobile/dashboard")
);

const NewPost = createResponsiveRoute(
  () => import("@/pages/new-post"),
  () => import("@/pages/mobile/new-post")
);

const Calendar = createResponsiveRoute(
  () => import("@/pages/calendar"),
  () => import("@/pages/mobile/calendar")
);

const Media = createResponsiveRoute(
  () => import("@/pages/media"),
  () => import("@/pages/mobile/media")
);

const ImageEditor = createResponsiveRoute(
  () => import("@/pages/image-editor"),
  () => import("@/pages/mobile/image-editor")
);

const PagesManagement = createResponsiveRoute(
  () => import("@/pages/pages"),
  () => import("@/pages/mobile/pages")
);

const AI = createResponsiveRoute(
  () => import("@/pages/ai"),
  () => import("@/pages/mobile/ai")
);

const Settings = createResponsiveRoute(
  () => import("@/pages/settings"),
  () => import("@/pages/mobile/settings")
);

const SqlAdmin = createResponsiveRoute(
  () => import("@/pages/sql"),
  () => import("@/pages/mobile/sql")
);

const UsersAdmin = createResponsiveRoute(
  () => import("@/pages/users-admin"),
  () => import("@/pages/mobile/users-admin")
);

const Analytics = createResponsiveRoute(
  () => import("@/pages/AnalyticsPage"),
  () => import("@/pages/mobile/analytics")
);

// NewReel uses desktop version for now (mobile can be added later)
const NewReel = createResponsiveRoute(
  () => import("@/pages/new-reel"),
  () => import("@/pages/mobile/new-reel") // Uses same component for now
);

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
      <Route path="/reel">{() => <ProtectedRoute component={NewReel} />}</Route>
      <Route path="/calendar">{() => <ProtectedRoute component={Calendar} />}</Route>
      <Route path="/media">{() => <ProtectedRoute component={Media} />}</Route>
      <Route path="/image-editor">{() => <ProtectedRoute component={ImageEditor} />}</Route>
      <Route path="/pages">{() => <ProtectedRoute component={PagesManagement} />}</Route>
      <Route path="/ai">{() => <ProtectedRoute component={AI} adminOnly />}</Route>
      <Route path="/history">{() => <ProtectedRoute component={History} />}</Route>
      <Route path="/settings">{() => <ProtectedRoute component={Settings} adminOnly />}</Route>
      <Route path="/sql">{() => <ProtectedRoute component={SqlAdmin} adminOnly />}</Route>
      <Route path="/users">{() => <ProtectedRoute component={UsersAdmin} adminOnly />}</Route>
      <Route path="/analytics">{() => <ProtectedRoute component={Analytics} />}</Route>
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
