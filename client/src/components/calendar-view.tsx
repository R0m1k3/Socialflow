import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ScheduledPost } from "@shared/schema";

export default function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());

  const { data: scheduledPosts = [] } = useQuery<ScheduledPost[]>({
    queryKey: ["/api/scheduled-posts"],
  });

  const getPostsForDate = (date: Date) => {
    return (scheduledPosts || []).filter(post => {
      if (!post.scheduledAt) return false;
      const postDate = new Date(post.scheduledAt);
      return postDate.toDateString() === date.toDateString();
    });
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
  ];

  const daysOfWeek = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    const days = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonthDay = new Date(year, month, -startingDayOfWeek + i + 1);
      days.push({ date: prevMonthDay, isCurrentMonth: false });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }

    return days;
  };

  const days = getDaysInMonth(currentDate);
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  return (
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-lg">
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-primary/5 to-secondary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
              <CalendarIcon className="text-white w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Calendrier</h3>
              <p className="text-sm text-muted-foreground">Visualisez vos publications planifiées</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={goToPreviousMonth}
              className="rounded-xl"
              data-testid="button-prev-month"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Précédent
            </Button>
            <span className="text-sm font-semibold text-foreground min-w-[140px] text-center px-4 py-2 bg-muted/30 rounded-xl">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={goToNextMonth}
              className="rounded-xl"
              data-testid="button-next-month"
            >
              Suivant
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-7 gap-2 mb-2">
          {daysOfWeek.map((day) => (
            <div key={day} className="bg-muted/30 py-3 rounded-lg text-center">
              <span className="text-sm font-semibold text-muted-foreground">{day}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {days.map((day, index) => (
            <div
              key={index}
              className={`
                bg-card border border-border/50 rounded-xl p-4 min-h-[140px] transition-all hover:shadow-md
                ${isToday(day.date) ? "ring-2 ring-primary shadow-lg" : ""}
                ${!day.isCurrentMonth ? "opacity-40" : ""}
              `}
              data-testid={`calendar-day-${index}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`
                    text-sm font-semibold
                    ${!day.isCurrentMonth ? "text-muted-foreground" : "text-foreground"}
                    ${isToday(day.date) ? "text-primary" : ""}
                  `}
                >
                  {day.date.getDate()}
                </span>
                {isToday(day.date) && (
                  <span className="text-[10px] bg-gradient-to-r from-primary to-secondary text-white px-2 py-0.5 rounded-full font-semibold">
                    Aujourd'hui
                  </span>
                )}
              </div>
              
              {(() => {
                if (!day.isCurrentMonth) return null;
                const postsForDay = getPostsForDate(day.date);
                if (postsForDay.length === 0) return null;
                
                return (
                  <div className="space-y-2">
                    {postsForDay.slice(0, 2).map((post, idx) => {
                      const time = post.scheduledAt ? new Date(post.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
                      const isPending = !post.publishedAt;
                      const isPublished = !!post.publishedAt;
                      
                      return (
                        <div 
                          key={idx}
                          className={`
                            px-3 py-2 rounded-lg text-xs cursor-pointer transition-all font-medium shadow-sm
                            ${isPending ? 'bg-warning/20 text-warning hover:bg-warning/30' : ''}
                            ${isPublished ? 'bg-success/20 text-success hover:bg-success/30' : ''}
                          `}
                          data-testid={`calendar-post-${post.id}`}
                        >
                          <div className="font-semibold">{time}</div>
                          <div className="truncate opacity-90">{post.postType || 'Post'}</div>
                        </div>
                      );
                    })}
                    {postsForDay.length > 2 && (
                      <div className="text-[11px] text-muted-foreground pl-2 font-medium">
                        +{postsForDay.length - 2} autre(s)
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-8 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-md bg-warning/20 border-2 border-warning"></div>
            <span className="text-sm text-muted-foreground font-medium">Programmé</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-md bg-success/20 border-2 border-success"></div>
            <span className="text-sm text-muted-foreground font-medium">Publié</span>
          </div>
        </div>
      </div>
    </div>
  );
}
