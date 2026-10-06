import { CalendarCheck, Link2, Sparkles, Images, TrendingUp, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface StatsResponse {
  scheduledPosts: number;
  scheduledPostsChange?: string;
  scheduledPostsTrending?: "up" | "down";
  connectedPages: number;
  aiTextsGenerated: number;
  aiTextsChange?: string;
  aiTextsTrending?: "up" | "down";
  mediaStored: number;
}

export default function StatsCards() {
  const { data: stats, isLoading } = useQuery<StatsResponse>({
    queryKey: ["/api/stats"],
  });

  const statCards = [
    {
      icon: CalendarCheck,
      tone: "bg-primary/10 text-primary",
      value: stats?.scheduledPosts ?? 0,
      label: "Publications planifiées",
      change: stats?.scheduledPostsChange,
      trending: stats?.scheduledPostsTrending,
      changeLabel: "vs mois dernier",
      href: "/calendar",
    },
    {
      icon: Link2,
      tone: "bg-info/10 text-info",
      value: stats?.connectedPages ?? 0,
      label: "Comptes connectés",
      info: "Facebook · Instagram · TikTok",
      href: "/pages",
    },
    {
      icon: Sparkles,
      tone: "bg-brand-accent/15 text-brand-accent",
      value: stats?.aiTextsGenerated ?? 0,
      label: "Textes générés par l'IA",
      change: stats?.aiTextsChange,
      trending: stats?.aiTextsTrending,
      changeLabel: "vs hier",
    },
    {
      icon: Images,
      tone: "bg-success/10 text-success",
      value: stats?.mediaStored ?? 0,
      label: "Médias stockés",
      info: "Images · Vidéos",
      href: "/media",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
            <div className="skeleton mb-4 h-10 w-10 rounded-lg" />
            <div className="skeleton mb-2 h-7 w-16 rounded" />
            <div className="skeleton h-4 w-28 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {statCards.map((stat, index) => {
        const Icon = stat.icon;
        const TrendIcon = stat.trending === "up" ? TrendingUp : TrendingDown;
        const body = (
          <>
            <div className={cn("mb-4 flex h-10 w-10 items-center justify-center rounded-lg", stat.tone)}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground sm:text-3xl" data-testid={`stat-value-${index}`}>
              {stat.value}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{stat.label}</p>
            {stat.change ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium",
                    stat.trending === "up" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                  )}
                >
                  <TrendIcon className="h-3 w-3" />
                  {stat.change}
                </span>
                <span className="text-muted-foreground">{stat.changeLabel}</span>
              </div>
            ) : stat.info ? (
              <p className="mt-3 hidden text-xs text-muted-foreground sm:block">{stat.info}</p>
            ) : null}
          </>
        );
        const cls = "block rounded-xl border bg-card p-4 shadow-soft sm:p-5";
        return stat.href ? (
          <Link key={index} href={stat.href} className={cn(cls, "card-hover")} data-testid={`stat-card-${index}`}>
            {body}
          </Link>
        ) : (
          <div key={index} className={cls} data-testid={`stat-card-${index}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
