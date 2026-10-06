import { useState } from "react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Database, Download, Play, Table2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function SqlAdmin() {
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
    <Page width="wide">
          <PageHeader
            icon={Database}
            title="Base de données"
            description="Exécutez des requêtes SQL directement sur la base. À utiliser avec précaution."
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            {/* Liste des tables */}
            <Card className="h-fit lg:sticky lg:top-6">
              <CardHeader className="pb-3">
                <CardTitle>Tables</CardTitle>
                <CardDescription>Cliquez pour pré-remplir la requête</CardDescription>
              </CardHeader>
              <CardContent>
                {(tablesData as any)?.tables?.length ? (
                  <div className="flex max-h-[60vh] flex-wrap gap-1.5 overflow-y-auto lg:flex-col lg:flex-nowrap">
                    {(tablesData as any).tables.map((table: any) => (
                      <button
                        key={table.tablename}
                        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-lg:border"
                        onClick={() => insertTable(table.tablename)}
                        data-testid={`button-table-${table.tablename}`}
                      >
                        <Table2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{table.tablename}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Aucune table trouvée.</p>
                )}
              </CardContent>
            </Card>

            {/* Éditeur SQL et résultats */}
            <div className="space-y-6 lg:col-span-3">
              <Card>
                <CardHeader>
                  <CardTitle>Requête</CardTitle>
                  <CardDescription>Ctrl + Entrée pour exécuter</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="SELECT * FROM users LIMIT 10;"
                    value={sqlQuery}
                    onChange={(e) => setSqlQuery(e.target.value)}
                    className="min-h-[200px] font-mono text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleExecuteQuery();
                      }
                    }}
                    data-testid="textarea-sql-query"
                  />
                  
                  <div className="flex gap-2">
                    <Button
                      onClick={handleExecuteQuery}
                      disabled={executeSqlMutation.isPending}
                      data-testid="button-execute-sql"
                    >
                      <Play className="h-4 w-4" />
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
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle>Résultats</CardTitle>
                        <CardDescription>
                          {queryResult.success
                            ? Array.isArray(queryResult.result)
                              ? `${queryResult.result.length} ligne(s)`
                              : "Requête exécutée avec succès"
                            : "Erreur lors de l'exécution"}
                        </CardDescription>
                      </div>
                      {queryResult.success && queryResult.result && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownloadResult}
                          data-testid="button-download-result"
                        >
                          <Download className="h-4 w-4" />
                          Télécharger JSON
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {queryResult.success ? (
                      <div className="max-h-[60vh] overflow-auto rounded-lg border">
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
                          <pre className="max-h-96 overflow-auto bg-muted p-4 text-xs">
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
        </Page>
  );
}
