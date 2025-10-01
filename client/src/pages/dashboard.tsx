import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import StatsCards from "@/components/stats-cards";
import AiChat from "@/components/ai-chat";
import MediaUpload from "@/components/media-upload";
import CalendarView from "@/components/calendar-view";
import ManagedPages from "@/components/managed-pages";
import QuickActions from "@/components/quick-actions";
import { Menu } from "lucide-react";
import { useState } from "react";

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-6 space-y-6">
          <StatsCards />
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <AiChat />
            </div>
            <div>
              <QuickActions />
            </div>
          </div>

          <MediaUpload />
          <CalendarView />
          <ManagedPages />
        </div>
      </main>

      {/* Floating action button for mobile */}
      <button 
        className="fixed bottom-6 right-6 w-14 h-14 bg-primary rounded-full shadow-xl flex items-center justify-center text-primary-foreground lg:hidden hover:scale-110 transition-all z-30"
        data-testid="button-new-post"
      >
        <Menu className="w-6 h-6" />
      </button>
    </div>
  );
}
