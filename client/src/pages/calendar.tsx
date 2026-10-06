import { Link } from "wouter";
import { Calendar as CalendarIcon, Plus } from "lucide-react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import CalendarView from "@/components/calendar-view";

export default function Calendar() {
  return (
    <Page width="wide">
      <PageHeader
        icon={CalendarIcon}
        title="Calendrier"
        description="Visualisez et gérez vos publications programmées."
        actions={
          <Button asChild>
            <Link href="/new">
              <Plus className="h-4 w-4" /> Programmer
            </Link>
          </Button>
        }
      />
      <CalendarView />
    </Page>
  );
}
