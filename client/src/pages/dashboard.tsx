import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import StatsCards from "@/components/stats-cards";
import OngoingReels from "@/components/ongoing-reels";
import RecentPublications from "@/components/recent-publications";
import ManagedPages from "@/components/managed-pages";
import { useState } from "react";

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar onLinkClick={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 max-w-[1600px] mx-auto">
          <StatsCards />

          <OngoingReels />

          <RecentPublications />

          <ManagedPages />
        </div>
      </main>
    </div>
  );
}
