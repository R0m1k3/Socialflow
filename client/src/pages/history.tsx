import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, CheckCircle, XCircle, Calendar, History as HistoryIcon } from "lucide-react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Post } from "@shared/schema";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function History() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: posts = [], isLoading } = useQuery<Post[]>({
    queryKey: ['/api/posts'],
  });

  const publishedPosts = posts.filter(p => p.status === 'published');

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
        
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Historique</h1>
            <p className="text-muted-foreground mt-2">
              Consultez l'historique de vos publications
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 bg-card rounded-2xl border border-border/50 animate-pulse" />
              ))}
            </div>
          ) : publishedPosts.length === 0 ? (
            <Card className="rounded-2xl border-border/50 border-dashed shadow-lg">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center mb-6">
                  <HistoryIcon className="w-10 h-10 text-muted-foreground opacity-50" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Aucune publication</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  Vos publications apparaîtront ici une fois publiées
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {publishedPosts.map((post) => (
                <Card key={post.id} className="rounded-2xl border-border/50 shadow-lg overflow-hidden" data-testid={`card-post-${post.id}`}>
                  <CardHeader className="border-b border-border/50 bg-gradient-to-r from-muted/20 to-muted/10 p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-success to-success/80 flex items-center justify-center shadow-md">
                            <CheckCircle className="w-5 h-5 text-white" />
                          </div>
                          <CardTitle className="text-lg">
                            Publication #{post.id.substring(0, 8)}
                          </CardTitle>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed line-clamp-3">
                          {post.content}
                        </p>
                      </div>
                      <Badge 
                        className={`ml-4 ${
                          post.status === 'published' 
                            ? 'bg-success/20 text-success hover:bg-success/30' 
                            : 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                        }`}
                      >
                        {post.status === 'published' && <CheckCircle className="w-3 h-3 mr-1" />}
                        {post.status === 'failed' && <XCircle className="w-3 h-3 mr-1" />}
                        {post.status === 'published' ? 'Publié' : 'Échoué'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-6 text-sm text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        <span className="font-medium">
                          {post.updatedAt 
                            ? format(new Date(post.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })
                            : 'Date inconnue'
                          }
                        </span>
                      </div>
                      {post.aiGenerated && (
                        <Badge variant="outline" className="text-xs bg-gradient-to-r from-primary/5 to-secondary/5 border-primary/20">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Généré par IA
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
