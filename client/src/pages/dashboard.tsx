import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import StatsCards from "@/components/stats-cards";
import AiChat from "@/components/ai-chat";
import MediaUpload from "@/components/media-upload";
import CalendarView from "@/components/calendar-view";
import ManagedPages from "@/components/managed-pages";
import QuickActions from "@/components/quick-actions";
import { PlusCircle } from "lucide-react";
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
        <Sidebar />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-8 space-y-8 max-w-[1600px] mx-auto">
          <StatsCards />
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <AiChat />
              <MediaUpload />
            </div>
            <div className="space-y-8">
              <QuickActions />
            </div>
          </div>

          <CalendarView />
          <ManagedPages />
        </div>
      </main>

      <button 
        className="fixed bottom-8 right-8 w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl shadow-2xl flex items-center justify-center text-white lg:hidden hover:scale-110 transition-all z-30"
        data-testid="button-new-post"
      >
        <PlusCircle className="w-7 h-7" />
      </button>
    </div>
  );
}
