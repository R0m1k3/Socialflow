import { Switch, Route, useLocation, Link } from "wouter";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell, Page } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/empty-state";
import { LogoMark } from "@/components/brand/logo";
import { useSession } from "@/hooks/use-session";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";

// Pages chargées à la demande : une seule version responsive par écran.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const NewPost = lazy(() => import("@/pages/new-post"));
const NewReel = lazy(() => import("@/pages/new-reel"));
const ScheduleReel = lazy(() => import("@/pages/schedule-reel"));
const Calendar = lazy(() => import("@/pages/calendar"));
const Media = lazy(() => import("@/pages/media"));
const ImageEditor = lazy(() => import("@/pages/image-editor"));
const PagesManagement = lazy(() => import("@/pages/pages"));
const AI = lazy(() => import("@/pages/ai"));
const History = lazy(() => import("@/pages/history"));
const Settings = lazy(() => import("@/pages/settings"));
const SqlAdmin = lazy(() => import("@/pages/sql"));
const AudioAdmin = lazy(() => import("@/pages/audio-admin"));
const UsersAdmin = lazy(() => import("@/pages/users-admin"));
const Analytics = lazy(() => import("@/pages/analytics"));

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <LogoMark size={44} className="animate-pulse" />
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </div>
    </div>
  );
}

function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function ProtectedRoute({ component: Component, adminOnly = false }: { component: ComponentType; adminOnly?: boolean }) {
  const [, setLocation] = useLocation();
  const { session, isAdmin, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && !session) {
      setLocation("/login");
    }
  }, [isLoading, session, setLocation]);

  if (isLoading) return <FullScreenLoader />;
  if (!session) return null;

  return (
    <AppShell>
      {adminOnly && !isAdmin ? (
        <Page width="narrow">
          <EmptyState
            icon={ShieldAlert}
            title="Accès réservé aux administrateurs"
            description="Demandez à un administrateur de vous donner accès à cette page."
            action={
              <Button asChild variant="outline">
                <Link href="/">Retour au tableau de bord</Link>
              </Button>
            }
          />
        </Page>
      ) : (
        <Suspense fallback={<PageLoader />}>
          <Component />
        </Suspense>
      )}
    </AppShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/new">{() => <ProtectedRoute component={NewPost} />}</Route>
      <Route path="/reel">{() => <ProtectedRoute component={NewReel} />}</Route>
      <Route path="/reel/schedule">{() => <ProtectedRoute component={ScheduleReel} />}</Route>
      <Route path="/calendar">{() => <ProtectedRoute component={Calendar} />}</Route>
      <Route path="/media">{() => <ProtectedRoute component={Media} />}</Route>
      <Route path="/image-editor">{() => <ProtectedRoute component={ImageEditor} />}</Route>
      <Route path="/pages">{() => <ProtectedRoute component={PagesManagement} />}</Route>
      <Route path="/ai">{() => <ProtectedRoute component={AI} adminOnly />}</Route>
      <Route path="/history">{() => <ProtectedRoute component={History} />}</Route>
      <Route path="/settings">{() => <ProtectedRoute component={Settings} adminOnly />}</Route>
      <Route path="/sql">{() => <ProtectedRoute component={SqlAdmin} adminOnly />}</Route>
      <Route path="/audio-admin">{() => <ProtectedRoute component={AudioAdmin} adminOnly />}</Route>
      <Route path="/users">{() => <ProtectedRoute component={UsersAdmin} adminOnly />}</Route>
      <Route path="/analytics">{() => <ProtectedRoute component={Analytics} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
