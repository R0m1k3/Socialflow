import { useState, useEffect, useCallback } from "react";
import type { DayContentProps } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Clock, X } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DayAgendaPanel } from "@/components/day-agenda-panel";
import { usePublicationAgenda } from "@/hooks/use-publication-agenda";
import { busyHours, conflictsFor, dayKey, groupByPage, occupiesSlot } from "@shared/agenda";

interface DateTimePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  /** Magasins visés : leurs publications déjà prévues sont signalées. */
  selectedPageIds?: string[];
  placeholder?: string;
}

const OPTIMAL_HOURS = [8, 12, 13, 18, 19, 20];

export function DateTimePicker({ value, onChange, selectedPageIds = [], placeholder = "Sélectionner une date" }: DateTimePickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(value);
  const [selectedHour, setSelectedHour] = useState<number>(value?.getHours() || 8);
  const [selectedMinute, setSelectedMinute] = useState<number>(value?.getMinutes() || 0);
  const [month, setMonth] = useState<Date>(value ?? new Date());
  const { itemsByDay } = usePublicationAgenda(month);

  // Sync internal state with parent value prop
  useEffect(() => {
    if (value) {
      setSelectedDate(value);
      setMonth(value);
      setSelectedHour(value.getHours());
      setSelectedMinute(value.getMinutes());
    } else {
      setSelectedDate(undefined);
      setSelectedHour(8);
      setSelectedMinute(0);
    }
  }, [value]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 15, 30, 45];

  const isOptimalHour = (hour: number) => OPTIMAL_HOURS.includes(hour);

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date) {
      const newDate = new Date(date);
      newDate.setHours(selectedHour);
      newDate.setMinutes(selectedMinute);
      onChange(newDate);
    } else {
      onChange(undefined);
    }
  };

  const handleTimeChange = (hour: number, minute: number) => {
    setSelectedHour(hour);
    setSelectedMinute(minute);
    if (selectedDate) {
      const newDate = new Date(selectedDate);
      newDate.setHours(hour);
      newDate.setMinutes(minute);
      onChange(newDate);
    }
  };

  // Publications qui occupent encore un créneau, jour par jour
  const activeItemsOn = useCallback(
    (date: Date) => (itemsByDay.get(dayKey(date)) ?? []).filter(occupiesSlot),
    [itemsByDay]
  );
  const isSelectedStoreBusy = (date: Date) => conflictsFor(activeItemsOn(date), selectedPageIds).length > 0;
  const isOtherStoreBusy = (date: Date) => activeItemsOn(date).length > 0 && !isSelectedStoreBusy(date);

  const selectedDayItems = selectedDate ? itemsByDay.get(dayKey(selectedDate)) ?? [] : [];
  const hoursTaken = busyHours(selectedDayItems, selectedPageIds);
  const selectedKey = selectedPageIds.join(",");

  // Pastille du jour : publications sur les magasins choisis, sinon sur les autres
  const AgendaDayContent = useCallback(
    ({ date }: DayContentProps) => {
      const items = activeItemsOn(date);
      const mine = conflictsFor(items, selectedKey ? selectedKey.split(",") : []).length;
      const title = groupByPage(items)
        .map(({ page, items: pageItems }) => `${page.pageName} : ${pageItems.length}`)
        .join("\n");
      return (
        <span className="relative flex h-full w-full items-center justify-center" title={title || undefined}>
          {date.getDate()}
          {items.length > 0 && (
            <span
              className={cn(
                "absolute right-0 top-0 min-w-[14px] rounded-full px-1 text-[9px] font-bold leading-[14px]",
                mine > 0 ? "bg-destructive text-destructive-foreground" : "bg-muted-foreground/70 text-background"
              )}
            >
              {mine || items.length}
            </span>
          )}
        </span>
      );
    },
    [activeItemsOn, selectedKey]
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "flex-1 justify-start text-left font-normal",
                !value && "text-muted-foreground"
              )}
              data-testid="button-date-picker"
            >
              <CalendarIcon className="h-4 w-4" />
              {value ? format(value, "PPP", { locale: fr }) : <span>{placeholder}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              month={month}
              onMonthChange={setMonth}
              locale={fr}
              modifiers={{
                selectedStoreBusy: isSelectedStoreBusy,
                otherStoreBusy: isOtherStoreBusy,
              }}
              modifiersClassNames={{
                selectedStoreBusy: "bg-destructive/15 text-destructive font-bold hover:bg-destructive/25",
                otherStoreBusy: "bg-muted font-semibold",
              }}
              components={{ DayContent: AgendaDayContent }}
              disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
              data-testid="calendar-picker"
            />
            <div className="space-y-1 border-t bg-muted/50 px-3 py-2 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                <span>Déjà prévu sur un magasin sélectionné</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/70" />
                <span>Prévu sur d'autres magasins</span>
              </div>
              {selectedPageIds.length === 0 && (
                <p className="text-muted-foreground">Cochez un magasin pour repérer ses jours déjà occupés.</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {value && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setSelectedDate(undefined);
              onChange(undefined);
            }}
            className="shrink-0"
            data-testid="button-clear-date"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {selectedDate && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-start text-left font-normal"
              data-testid="button-time-picker"
            >
              <Clock className="h-4 w-4" />
              {String(selectedHour).padStart(2, '0')}:{String(selectedMinute).padStart(2, '0')}
            </Button>
          </PopoverTrigger>
          <PopoverContent 
            className="w-auto min-w-[200px] max-w-[280px] p-0" 
            align="center"
            side="bottom"
            sideOffset={8}
            collisionPadding={16}
            avoidCollisions={true}
          >
            <div className="flex">
              <ScrollArea className="h-48 min-w-[96px] flex-1">
                <div className="p-1.5">
                  <div className="text-[10px] font-semibold mb-1.5 px-1.5 text-muted-foreground">Heures</div>
                  {hours.map((hour) => {
                    const taken = hoursTaken.get(hour) ?? 0;
                    return (
                    <Button
                      key={hour}
                      variant="ghost"
                      className={cn(
                        "w-full justify-center mb-0.5 h-9 text-xs",
                        selectedHour === hour && "bg-primary text-primary-foreground",
                        isOptimalHour(hour) && selectedHour !== hour && "bg-success/15 text-success font-semibold hover:bg-success/25"
                      )}
                      onClick={() => handleTimeChange(hour, selectedMinute)}
                      data-testid={`hour-${hour}`}
                    >
                      {String(hour).padStart(2, '0')}h
                      {isOptimalHour(hour) && selectedHour !== hour && (
                        <span className="ml-1 text-[10px]">✨</span>
                      )}
                      {taken > 0 && (
                        <span
                          className="ml-1 rounded-full bg-destructive px-1 text-[9px] font-bold leading-[14px] text-destructive-foreground"
                          title={`${taken} publication(s) déjà prévue(s) sur vos magasins`}
                        >
                          {taken}
                        </span>
                      )}
                    </Button>
                    );
                  })}
                </div>
              </ScrollArea>
              <ScrollArea className="h-48 min-w-[80px] flex-1 border-l">
                <div className="p-1.5">
                  <div className="text-[10px] font-semibold mb-1.5 px-1.5 text-muted-foreground">Minutes</div>
                  {minutes.map((minute) => (
                    <Button
                      key={minute}
                      variant="ghost"
                      className={cn(
                        "w-full justify-center mb-0.5 h-9 text-xs",
                        selectedMinute === minute && "bg-primary text-primary-foreground"
                      )}
                      onClick={() => handleTimeChange(selectedHour, minute)}
                      data-testid={`minute-${minute}`}
                    >
                      {String(minute).padStart(2, '0')}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="p-2 border-t bg-muted/50">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-success"></div>
                <span className="text-[9px] font-semibold text-success">
                  Heures optimales (8h, 12h-13h, 18h-20h)
                </span>
              </div>
              {hoursTaken.size > 0 && (
                <div className="mt-1 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-destructive"></div>
                  <span className="text-[9px] font-semibold text-destructive">
                    Déjà prévu sur vos magasins
                  </span>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {selectedDate && (
        <DayAgendaPanel date={selectedDate} items={selectedDayItems} selectedPageIds={selectedPageIds} />
      )}
    </div>
  );
}
