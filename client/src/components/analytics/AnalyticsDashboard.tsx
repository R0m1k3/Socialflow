import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MetricsCard } from './MetricsCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RefreshCw, Users, BarChart3, Eye } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AnalyticsDashboard() {
    const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

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

    // Fetch History for selected page
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

    const selectedPage = pages.find((p: any) => p.id === selectedPageId);

    // Prepare chart data (reverse to show chronological)
    const chartData = [...history].reverse().map((entry: any) => ({
        date: format(new Date(entry.date), 'MM/dd'),
        followers: entry.followersCount,
        reach: entry.pageReach
    }));

    // Calculate trends (simple comparison with previous entry)
    const latest = history[0];
    const previous = history[1];

    const getTrend = (current: number, prev: number) => {
        if (!prev) return 0;
        return Math.round(((current - prev) / prev) * 100);
    };

    if (isLoadingPages) return <div>Chargement des pages...</div>;
    if (!pages.length) return <div>Aucune page connectée. Veuillez connecter une page Facebook dans les Paramètres.</div>;

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-4">
                    <Select value={selectedPageId || ''} onValueChange={setSelectedPageId}>
                        <SelectTrigger className="w-[250px]">
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
                        <span className={`px-2 py-1 rounded text-xs ${selectedPage.tokenStatus === 'valid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            Token : {selectedPage.tokenStatus || 'Inconnu'}
                        </span>
                    )}
                </div>

                <Button
                    variant="outline"
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending || !selectedPageId}
                >
                    <RefreshCw className={`mr-2 h-4 w-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                    Actualiser les données
                </Button>
            </div>

            {selectedPageId && (
                <>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <MetricsCard
                            title="Abonnés Totaux"
                            value={latest?.followersCount?.toLocaleString() || 0}
                            icon={<Users className="h-4 w-4 text-muted-foreground" />}
                            trend={latest && previous ? getTrend(latest.followersCount, previous.followersCount) : undefined}
                            description="depuis la dernière mise à jour"
                        />
                        <MetricsCard
                            title="Portée de la Page"
                            value={latest?.pageReach?.toLocaleString() || 0}
                            icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                            trend={latest && previous ? getTrend(latest.pageReach, previous.pageReach) : undefined}
                            description="depuis la dernière mise à jour"
                        />
                        {/* Add more metrics if available */}
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Historique de Croissance & Portée</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" />
                                        <YAxis yAxisId="left" />
                                        <YAxis yAxisId="right" orientation="right" />
                                        <Tooltip />
                                        <Line yAxisId="left" type="monotone" dataKey="followers" stroke="#8884d8" name="Abonnés" />
                                        <Line yAxisId="right" type="monotone" dataKey="reach" stroke="#82ca9d" name="Portée" />
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
