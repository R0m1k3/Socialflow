import { useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import AiChat from "@/components/ai-chat";

export default function AI() {
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
        
        <div className="p-8 max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Assistant IA</h1>
            <p className="text-muted-foreground mt-2">
              Générez du contenu personnalisé avec l'intelligence artificielle
            </p>
          </div>

          <AiChat />
        </div>
      </main>
    </div>
  );
}
