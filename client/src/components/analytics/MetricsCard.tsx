import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react";

interface MetricsCardProps {
    title: string;
    value: string | number;
    description?: string;
    trend?: number; // percent change
    icon?: React.ReactNode;
}

export function MetricsCard({ title, value, description, trend, icon }: MetricsCardProps) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                    {title}
                </CardTitle>
                {icon && <div className="text-muted-foreground">{icon}</div>}
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{value}</div>
                {(trend !== undefined || description) && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center">
                        {trend !== undefined && (
                            <span className={`flex items-center mr-2 ${trend > 0 ? 'text-success' : trend < 0 ? 'text-destructive' : ''}`}>
                                {trend > 0 ? <ArrowUpIcon className="w-3 h-3 mr-1" /> : trend < 0 ? <ArrowDownIcon className="w-3 h-3 mr-1" /> : <MinusIcon className="w-3 h-3 mr-1" />}
                                {Math.abs(trend)}%
                            </span>
                        )}
                        {description}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
