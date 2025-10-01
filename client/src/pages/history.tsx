import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, CheckCircle, XCircle, Calendar } from "lucide-react";
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
        <Sidebar />
      </div>

      <main className="flex-1 overflow-y-auto">
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Historique</h1>
            <p className="text-muted-foreground mt-2">
              Consultez l'historique de vos publications
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader className="h-24 bg-muted"></CardHeader>
                </Card>
              ))}
            </div>
          ) : publishedPosts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Clock className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Aucune publication</h3>
                <p className="text-muted-foreground text-center">
                  Vos publications apparaîtront ici une fois publiées
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {publishedPosts.map((post) => (
                <Card key={post.id} data-testid={`card-post-${post.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg mb-2">
                          Publication #{post.id}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {post.content}
                        </p>
                      </div>
                      <Badge 
                        variant={post.status === 'published' ? 'default' : 'secondary'}
                        className="ml-4"
                      >
                        {post.status === 'published' && <CheckCircle className="w-3 h-3 mr-1" />}
                        {post.status === 'failed' && <XCircle className="w-3 h-3 mr-1" />}
                        {post.status === 'published' ? 'Publié' : 'Échoué'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {post.updatedAt 
                          ? format(new Date(post.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })
                          : 'Date inconnue'
                        }
                      </div>
                      {post.aiGenerated && (
                        <Badge variant="outline" className="text-xs">
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
