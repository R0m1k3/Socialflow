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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function SqlAdmin() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast } = useToast();
  const [sqlQuery, setSqlQuery] = useState("");
  const [queryResult, setQueryResult] = useState<any>(null);

  // Charger la liste des tables
  const { data: tablesData } = useQuery({
    queryKey: ["/api/sql/tables"],
  });

  // Mutation pour exécuter une requête SQL
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
        
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6 sm:space-y-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Database className="w-8 h-8" />
              Administration SQL
            </h1>
            <p className="text-muted-foreground mt-2">
              Exécutez des requêtes SQL et gérez votre base de données
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {/* Liste des tables */}
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="p-6">
                <CardTitle>Tables disponibles</CardTitle>
                <CardDescription>
                  Cliquez pour insérer dans la requête
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(tablesData as any)?.tables?.map((table: any) => (
                    <Button
                      key={table.tablename}
                      variant="outline"
                      className="w-full justify-start text-left"
                      onClick={() => insertTable(table.tablename)}
                      data-testid={`button-table-${table.tablename}`}
                    >
                      <Database className="w-4 h-4 mr-2" />
                      {table.tablename}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Éditeur SQL et résultats */}
            <div className="lg:col-span-3 space-y-8">
              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="p-6">
                  <CardTitle>Éditeur SQL</CardTitle>
                  <CardDescription>
                    Entrez votre requête SQL ci-dessous
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="SELECT * FROM users LIMIT 10;"
                    value={sqlQuery}
                    onChange={(e) => setSqlQuery(e.target.value)}
                    className="font-mono min-h-[200px]"
                    data-testid="textarea-sql-query"
                  />
                  
                  <div className="flex gap-2">
                    <Button
                      onClick={handleExecuteQuery}
                      disabled={executeSqlMutation.isPending}
                      data-testid="button-execute-sql"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      {executeSqlMutation.isPending ? "Exécution..." : "Exécuter"}
                    </Button>
                    
                    <Button
                      variant="outline"
                      onClick={() => setSqlQuery("")}
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
                  <CardHeader className="p-6">
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle>Résultats</CardTitle>
                        <CardDescription>
                          {queryResult.success ? "Requête exécutée avec succès" : "Erreur lors de l'exécution"}
                        </CardDescription>
                      </div>
                      {queryResult.success && queryResult.result && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownloadResult}
                          data-testid="button-download-result"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Télécharger JSON
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {queryResult.success ? (
                      <div className="overflow-x-auto">
                        {Array.isArray(queryResult.result) && queryResult.result.length > 0 ? (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {Object.keys(queryResult.result[0]).map((key) => (
                                  <TableHead key={key}>{key}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {queryResult.result.map((row: any, idx: number) => (
                                <TableRow key={idx}>
                                  {Object.values(row).map((value: any, cellIdx: number) => (
                                    <TableCell key={cellIdx} className="font-mono text-xs">
                                      {value === null ? (
                                        <span className="text-muted-foreground italic">null</span>
                                      ) : typeof value === 'object' ? (
                                        JSON.stringify(value)
                                      ) : (
                                        String(value)
                                      )}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <pre className="bg-muted p-4 rounded-lg overflow-auto max-h-96">
                            <code>{JSON.stringify(queryResult.result, null, 2)}</code>
                          </pre>
                        )}
                      </div>
                    ) : (
                      <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg">
                        <p className="font-semibold">Erreur :</p>
                        <p className="font-mono text-sm mt-2">{queryResult.error}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
