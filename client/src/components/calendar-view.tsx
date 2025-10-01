import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

    // Previous month days
    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonthDay = new Date(year, month, -startingDayOfWeek + i + 1);
      days.push({ date: prevMonthDay, isCurrentMonth: false });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    // Next month days to fill the grid
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
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="border-b border-border p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Calendrier des publications</h3>
          <p className="text-sm text-muted-foreground mt-1">Planifiez vos publications sur plusieurs pages</p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={goToPreviousMonth}
            data-testid="button-prev-month"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Précédent
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[120px] text-center">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={goToNextMonth}
            data-testid="button-next-month"
          >
            Suivant
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>

      <div className="p-6">
        {/* Calendar Header */}
        <div className="grid grid-cols-7 gap-px bg-border mb-px">
          {daysOfWeek.map((day) => (
            <div key={day} className="bg-muted p-3 text-center">
              <span className="text-xs font-semibold text-muted-foreground">{day}</span>
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-px bg-border">
          {days.map((day, index) => (
            <div
              key={index}
              className={`
                bg-card p-3 min-h-[120px]
                ${isToday(day.date) ? "border-2 border-primary" : ""}
              `}
              data-testid={`calendar-day-${index}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`
                    text-xs font-medium
                    ${!day.isCurrentMonth ? "text-muted-foreground/50" : "text-foreground"}
                    ${isToday(day.date) ? "font-bold text-primary" : ""}
                  `}
                >
                  {day.date.getDate()}
                </span>
                {isToday(day.date) && (
                  <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                    Aujourd'hui
                  </span>
                )}
              </div>
              
              {/* Real scheduled posts for this date */}
              {(() => {
                if (!day.isCurrentMonth) return null;
                const postsForDay = getPostsForDate(day.date);
                if (postsForDay.length === 0) return null;
                
                return (
                  <div className="space-y-1">
                    {postsForDay.slice(0, 2).map((post, idx) => {
                      const time = post.scheduledAt ? new Date(post.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
                      const isPending = !post.publishedAt;
                      const isPublished = !!post.publishedAt;
                      
                      return (
                        <div 
                          key={idx}
                          className={`
                            px-2 py-1 rounded text-xs cursor-pointer transition-all
                            ${isPending ? 'bg-chart-3/20 text-chart-3 hover:bg-chart-3/30' : ''}
                            ${isPublished ? 'bg-chart-2/20 text-chart-2 hover:bg-chart-2/30' : ''}
                          `}
                          data-testid={`calendar-post-${post.id}`}
                        >
                          <span>{time} - {post.postType || 'Post'}</span>
                        </div>
                      );
                    })}
                    {postsForDay.length > 2 && (
                      <div className="text-[10px] text-muted-foreground pl-2">
                        +{postsForDay.length - 2} autre(s)
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-6 flex items-center justify-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-chart-3"></div>
            <span className="text-sm text-muted-foreground">Programmé</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-chart-2"></div>
            <span className="text-sm text-muted-foreground">Publié</span>
          </div>
        </div>
      </div>
    </div>
  );
}
