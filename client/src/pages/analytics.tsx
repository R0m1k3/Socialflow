import { BarChart3 } from "lucide-react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";

export default function AnalyticsPage() {
  return (
    <Page width="wide">
      <PageHeader
        icon={BarChart3}
        title="Statistiques"
        description="Suivez l'audience et l'engagement de vos comptes."
      />
      <AnalyticsDashboard />
    </Page>
  );
}
