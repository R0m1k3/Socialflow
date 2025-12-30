import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import StatsCards from "@/components/stats-cards";
import RecentPublications from "@/components/recent-publications";
import ManagedPages from "@/components/managed-pages";
import { useState } from "react";

export default function DashboardMobile() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        {/* MOBILE: Reduced padding, single column layout with better spacing */}
        <div className="p-4 space-y-6">
          <StatsCards />

          <RecentPublications />

          <ManagedPages />
        </div>
      </main>
    </div>
  );
}
