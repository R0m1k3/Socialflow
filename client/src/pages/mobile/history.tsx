import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    Calendar, CheckCircle, XCircle, Clock,
    MoreHorizontal, Filter, Search, Loader2
} from "lucide-react";
import { useState } from "react";
import Sidebar from "@/components/sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MobileHistory() {
    const [searchTerm, setSearchTerm] = useState("");

    // Fetch posts history with polling to see status updates
    const { data: posts } = useQuery<any[]>({
        queryKey: ['/api/posts'],
        refetchInterval: 3000, // Poll every 3 seconds
    });

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'published': return <CheckCircle className="w-5 h-5 text-green-500" />;
            case 'failed': return <XCircle className="w-5 h-5 text-red-500" />;
            case 'scheduled': return <Clock className="w-5 h-5 text-amber-500" />;
            case 'draft': return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
            default: return <Clock className="w-5 h-5 text-muted-foreground" />;
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'published': return "Publié";
            case 'failed': return "Échec";
            case 'scheduled': return "Programmé";
            case 'draft': return "Traitement...";
            default: return "Brouillon";
        }
    };

    const filteredPosts = posts?.filter(post =>
        post.content?.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

    return (
        <div className="min-h-screen bg-background">
            {/* Mobile Header */}
            <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="-ml-2">
                                <MoreHorizontal className="h-6 w-6" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-0 w-[80%]">
                            <Sidebar />
                        </SheetContent>
                    </Sheet>
                    <h1 className="font-semibold text-lg">Historique</h1>
                </div>
                <Button variant="ghost" size="icon">
                    <Filter className="h-5 w-5" />
                </Button>
            </div>

            <div className="p-4 space-y-4">
                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Rechercher une publication..."
                        className="pl-9 bg-secondary/50"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Timeline List */}
                <div className="space-y-3">
                    {filteredPosts.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>Aucune publication trouvée</p>
                        </div>
                    ) : (
                        filteredPosts.map((post) => (
                            <Card key={post.id} className="overflow-hidden border-none shadow-sm bg-card">
                                <CardContent className="p-0">
                                    <div className="flex items-stretch">
                                        <div className={`w-1.5 ${post.status === 'published' ? 'bg-green-500' :
                                            post.status === 'failed' ? 'bg-red-500' :
                                                post.status === 'draft' ? 'bg-blue-500' : 'bg-amber-500'
                                            }`} />

                                        <div className="flex-1 p-3">
                                            <div className="flex justify-between items-start mb-2">
                                                <Badge variant="outline" className="flex items-center gap-1.5 px-2 py-0.5 h-6 text-xs font-normal">
                                                    {getStatusIcon(post.status)}
                                                    {getStatusLabel(post.status)}
                                                </Badge>
                                                <span className="text-xs text-muted-foreground">
                                                    {post.scheduledFor ? format(new Date(post.scheduledFor), "d MMM HH:mm", { locale: fr }) : '-'}
                                                </span>
                                            </div>

                                            <p className="text-sm line-clamp-2 text-foreground mb-2">
                                                {post.content || "Sans contenu"}
                                            </p>

                                            <div className="flex items-center justify-between mt-2">
                                                <div className="flex -space-x-2">
                                                    {/* Placeholder for page icons if available in data */}
                                                    <div className="w-6 h-6 rounded-full bg-blue-100 border border-background flex items-center justify-center text-[10px]">fb</div>
                                                </div>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem>Voir détails</DropdownMenuItem>
                                                        <DropdownMenuItem className="text-red-500">Supprimer</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
