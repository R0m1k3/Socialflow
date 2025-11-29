import { useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import AiChat from "@/components/ai-chat";

export default function AIMobile() {
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

        {/* MOBILE: Compact layout */}
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Assistant IA</h1>
            <p className="text-sm text-muted-foreground">
              Générez du contenu personnalisé avec l'intelligence artificielle
            </p>
          </div>

          <AiChat />
        </div>
      </main>
    </div>
  );
}
