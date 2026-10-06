import { Link } from "wouter";
import { Film, PenSquare } from "lucide-react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import StatsCards from "@/components/stats-cards";
import OngoingReels from "@/components/ongoing-reels";
import RecentPublications from "@/components/recent-publications";
import ManagedPages from "@/components/managed-pages";
import { useSession } from "@/hooks/use-session";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5 || h >= 18) return "Bonsoir";
  return "Bonjour";
}

export default function Dashboard() {
  const { session } = useSession();

  return (
    <Page width="wide">
      <PageHeader
        title={`${greeting()}${session ? ` ${session.username}` : ""} 👋`}
        description="Voici un aperçu de votre activité sur les réseaux sociaux."
        actions={
          <>
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href="/reel">
                <Film className="h-4 w-4" /> Nouveau Reel
              </Link>
            </Button>
            <Button asChild variant="brand" className="flex-1 sm:flex-none">
              <Link href="/new">
                <PenSquare className="h-4 w-4" /> Nouvelle publication
              </Link>
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <StatsCards />
        <OngoingReels />
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <RecentPublications />
          </div>
          <div className="xl:col-span-2">
            <ManagedPages />
          </div>
        </div>
      </div>
    </Page>
  );
}
