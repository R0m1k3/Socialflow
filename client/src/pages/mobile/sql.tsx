import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Database, Download, Play } from "lucide-react";

export default function SqlAdminMobile() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast } = useToast();
  const [sqlQuery, setSqlQuery] = useState("");
  const [queryResult, setQueryResult] = useState<any>(null);

  const { data: tablesData } = useQuery({
    queryKey: ["/api/sql/tables"],
  });

  const executeSqlMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("POST", "/api/sql/execute", { query });
      return await res.json();
    },
    onSuccess: (data) => {
      setQueryResult(data);
      if (data.success) {
        toast({
          title: "Requête exécutée",
          description: "La requête SQL a été exécutée avec succès",
        });
      }
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur SQL",
        description: error.message || "Erreur lors de l'exécution de la requête",
      });
    },
  });

  const handleExecuteQuery = () => {
    if (!sqlQuery.trim()) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Veuillez entrer une requête SQL",
      });
      return;
    }
    executeSqlMutation.mutate(sqlQuery);
  };

  const handleDownloadResult = () => {
    if (!queryResult?.result) return;

    const json = JSON.stringify(queryResult.result, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sql-result-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const insertTable = (tableName: string) => {
    setSqlQuery(`SELECT * FROM ${tableName} LIMIT 10;`);
  };

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

        {/* MOBILE: Single column layout */}
        <div className="p-4 space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="w-7 h-7" />
              Administration SQL
            </h1>
            <p className="text-sm text-muted-foreground">
              Exécutez des requêtes SQL et gérez votre base de données
            </p>
          </div>

          {/* Tables disponibles */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="text-base">Tables disponibles</CardTitle>
              <CardDescription className="text-xs">
                Cliquez pour insérer dans la requête
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="grid grid-cols-2 gap-2">
                {(tablesData as any)?.tables?.map((table: any) => (
                  <Button
                    key={table.tablename}
                    variant="outline"
                    className="justify-start text-left min-h-[44px] text-xs"
                    onClick={() => insertTable(table.tablename)}
                    data-testid={`button-table-${table.tablename}`}
                  >
                    <Database className="w-4 h-4 mr-2 flex-shrink-0" />
                    <span className="truncate">{table.tablename}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Éditeur SQL */}
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader className="p-5">
              <CardTitle className="text-base">Éditeur SQL</CardTitle>
              <CardDescription className="text-xs">
                Entrez votre requête SQL ci-dessous
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <Textarea
                placeholder="SELECT * FROM users LIMIT 10;"
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                className="font-mono min-h-[150px] text-sm"
                data-testid="textarea-sql-query"
              />

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleExecuteQuery}
                  disabled={executeSqlMutation.isPending}
                  className="w-full min-h-[48px]"
                  data-testid="button-execute-sql"
                >
                  <Play className="w-5 h-5 mr-2" />
                  {executeSqlMutation.isPending ? "Exécution..." : "Exécuter"}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => setSqlQuery("")}
                  className="w-full min-h-[48px]"
                  data-testid="button-clear-sql"
                >
                  Effacer
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Résultats */}
          {queryResult && (
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-5">
                <div className="flex flex-col gap-3">
                  <div>
                    <CardTitle className="text-base">Résultats</CardTitle>
                    <CardDescription className="text-xs">
                      {queryResult.success ? "Requête exécutée avec succès" : "Erreur lors de l'exécution"}
                    </CardDescription>
                  </div>
                  {queryResult.success && queryResult.result && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadResult}
                      className="w-full min-h-[44px]"
                      data-testid="button-download-result"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Télécharger JSON
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                {queryResult.success ? (
                  <div className="overflow-x-auto">
                    {Array.isArray(queryResult.result) && queryResult.result.length > 0 ? (
                      <div className="space-y-3">
                        {queryResult.result.map((row: any, idx: number) => (
                          <div key={idx} className="p-3 rounded-lg border bg-card space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground">Ligne {idx + 1}</div>
                            {Object.entries(row).map(([key, value]: [string, any]) => (
                              <div key={key} className="flex flex-col gap-1">
                                <div className="text-xs font-medium">{key}</div>
                                <div className="font-mono text-xs text-muted-foreground break-all">
                                  {value === null ? (
                                    <span className="italic">null</span>
                                  ) : typeof value === 'object' ? (
                                    JSON.stringify(value)
                                  ) : (
                                    String(value)
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="bg-muted p-4 rounded-lg overflow-auto max-h-96 text-xs">
                        <code>{JSON.stringify(queryResult.result, null, 2)}</code>
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg">
                    <p className="font-semibold text-sm">Erreur :</p>
                    <p className="font-mono text-xs mt-2 break-all">{queryResult.error}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
