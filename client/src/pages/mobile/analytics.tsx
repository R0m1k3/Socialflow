import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard';
import { useState } from "react";

export default function AnalyticsPageMobile() {
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

                <div className="p-4 space-y-6">
                    <div className="mb-4">
                        <h1 className="text-2xl font-bold tracking-tight mb-2">Analystique Sociale</h1>
                        <p className="text-sm text-muted-foreground">Suivez vos performances.</p>
                    </div>
                    <AnalyticsDashboard />
                </div>
            </main>
        </div>
    );
}
