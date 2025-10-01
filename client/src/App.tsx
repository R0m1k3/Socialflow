import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import NewPost from "@/pages/new-post";
import Calendar from "@/pages/calendar";
import Media from "@/pages/media";
import PagesManagement from "@/pages/pages";
import AI from "@/pages/ai";
import Analytics from "@/pages/analytics";
import History from "@/pages/history";
import Settings from "@/pages/settings";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/new" component={NewPost} />
      <Route path="/calendar" component={Calendar} />
      <Route path="/media" component={Media} />
      <Route path="/pages" component={PagesManagement} />
      <Route path="/ai" component={AI} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/history" component={History} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="dark">
          <Toaster />
          <Router />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
