import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MetricsCard } from './MetricsCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { RefreshCw, Users, BarChart3, Eye, Heart } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Maximum staleness before triggering an auto-refresh (12 hours in ms). */
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function AnalyticsDashboard() {
    const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const autoRefreshDone = useRef(false);

    // Fetch Pages
    const { data: pages = [], isLoading: isLoadingPages } = useQuery<any[]>({
        queryKey: ['/api/pages'],
    });

    // Set default selection
    useEffect(() => {
        if (pages.length > 0 && !selectedPageId) {
            setSelectedPageId(pages[0].id);
        }
    }, [pages, selectedPageId]);

    // Reset auto-refresh flag when switching pages
    useEffect(() => {
        autoRefreshDone.current = false;
    }, [selectedPageId]);

    // Fetch History for selected page (with polling every 30s)
    const { data: history = [], isLoading: isLoadingHistory } = useQuery<any[]>({
        queryKey: [`/api/analytics/pages/${selectedPageId}/history`],
        enabled: !!selectedPageId,
    });

    // Refresh Mutation
    const refreshMutation = useMutation({
        mutationFn: async () => {
            if (!selectedPageId) return;
            await apiRequest('POST', `/api/analytics/pages/${selectedPageId}/refresh`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/analytics/pages/${selectedPageId}/history`] });
            queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
            toast({
                title: "Analyses actualisées",
                description: "Les dernières données ont été récupérées depuis Facebook.",
            });
        },
        onError: () => {
            toast({
                title: "Échec de l'actualisation",
                description: "Impossible de récupérer les dernières données.",
                variant: "destructive"
            });
        }
    });

    // Auto-refresh on first load if data is stale or empty
    useEffect(() => {
        if (!selectedPageId || autoRefreshDone.current || refreshMutation.isPending) return;

        const isStale = history.length === 0
            || (history[0]?.date && (Date.now() - new Date(history[0].date).getTime()) > STALE_THRESHOLD_MS);

        if (isStale) {
            autoRefreshDone.current = true;
            refreshMutation.mutate();
        }
    }, [selectedPageId, history, refreshMutation]);

    const selectedPage = pages.find((p: any) => p.id === selectedPageId);

    // Prepare chart data (reverse to show chronological order)
    const chartData = [...history].reverse().map((entry: any) => ({
        date: format(new Date(entry.date), 'dd/MM'),
        followers: entry.followersCount,
        reach: entry.pageReach,
        engagement: entry.pageEngagement || 0,
        views: entry.pageViews || 0,
    }));

    // Calculate trends (comparison between latest and previous entry)
    const latest = history[0];
    const previous = history[1];

    const getTrend = (current: number, prev: number): number => {
        if (!prev) return 0;
        return Math.round(((current - prev) / prev) * 100);
    };

    if (isLoadingPages) {
        return (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
            </div>
        );
    }
    if (!pages.length) {
        return (
            <EmptyState
                icon={BarChart3}
                title="Aucun compte connecté"
                description="Connectez une page Facebook pour suivre son audience et son engagement."
                action={
                    <Button asChild>
                        <Link href="/pages">Connecter un compte</Link>
                    </Button>
                }
            />
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                <div className="flex items-center gap-3">
                    <Select value={selectedPageId || ''} onValueChange={setSelectedPageId}>
                        <SelectTrigger className="w-full sm:w-[260px]">
                            <SelectValue placeholder="Sélectionner une page" />
                        </SelectTrigger>
                        <SelectContent>
                            {pages.map((page: any) => (
                                <SelectItem key={page.id} value={page.id}>
                                    {page.pageName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {selectedPage && (
                        <Badge variant={selectedPage.tokenStatus === 'valid' ? 'success' : 'danger'} className="shrink-0">
                            {selectedPage.tokenStatus === 'valid' ? 'Connexion active' : 'Connexion à vérifier'}
                        </Badge>
                    )}
                </div>

                <Button
                    variant="outline"
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending || !selectedPageId}
                >
                    <RefreshCw className={`h-4 w-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                    Actualiser
                </Button>
            </div>

            {selectedPageId && (
                <>
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                        <MetricsCard
                            title="Abonnés"
                            value={latest?.followersCount?.toLocaleString() || 0}
                            icon={<Users className="h-4 w-4 text-muted-foreground" />}
                            trend={latest && previous ? getTrend(latest.followersCount, previous.followersCount) : undefined}
                            description="depuis la dernière mise à jour"
                        />
                        <MetricsCard
                            title="Portée"
                            value={latest?.pageReach?.toLocaleString() || 0}
                            icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                            trend={latest && previous ? getTrend(latest.pageReach, previous.pageReach) : undefined}
                            description="impressions uniques (jour)"
                        />
                        <MetricsCard
                            title="Engagement"
                            value={(latest?.pageEngagement || 0).toLocaleString()}
                            icon={<Heart className="h-4 w-4 text-muted-foreground" />}
                            trend={latest && previous ? getTrend(latest.pageEngagement || 0, previous.pageEngagement || 0) : undefined}
                            description="interactions totales (jour)"
                        />
                        <MetricsCard
                            title="Vues de la page"
                            value={(latest?.pageViews || 0).toLocaleString()}
                            icon={<Eye className="h-4 w-4 text-muted-foreground" />}
                            trend={latest && previous ? getTrend(latest.pageViews || 0, previous.pageViews || 0) : undefined}
                            description="vues totales (jour)"
                        />
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Évolution</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                                        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                        <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                        <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                        <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--popover-foreground))" }} />
                                        <Legend />
                                        <Line yAxisId="left" type="monotone" dataKey="followers" strokeWidth={2} dot={false} stroke="hsl(var(--chart-1))" name="Abonnés" />
                                        <Line yAxisId="right" type="monotone" dataKey="reach" strokeWidth={2} dot={false} stroke="hsl(var(--chart-3))" name="Portée" />
                                        <Line yAxisId="right" type="monotone" dataKey="engagement" strokeWidth={2} dot={false} stroke="hsl(var(--chart-2))" name="Engagement" />
                                        <Line yAxisId="right" type="monotone" dataKey="views" strokeWidth={2} dot={false} stroke="hsl(var(--chart-5))" name="Vues" />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
