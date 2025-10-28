import { useState, useEffect } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Clock, X } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DateTimePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  occupiedDates?: Date[];
  placeholder?: string;
}

const OPTIMAL_HOURS = [8, 12, 13, 18, 19, 20];

export function DateTimePicker({ value, onChange, occupiedDates = [], placeholder = "Sélectionner une date" }: DateTimePickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(value);
  const [selectedHour, setSelectedHour] = useState<number>(value?.getHours() || 8);
  const [selectedMinute, setSelectedMinute] = useState<number>(value?.getMinutes() || 0);

  // Sync internal state with parent value prop
  useEffect(() => {
    if (value) {
      setSelectedDate(value);
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

  // Convert occupied dates to a Set of date strings for efficient lookup
  const occupiedDateStrings = new Set(
    occupiedDates.map(date => format(date, 'yyyy-MM-dd'))
  );

  // Check if a date is occupied
  const isDateOccupied = (date: Date) => {
    return occupiedDateStrings.has(format(date, 'yyyy-MM-dd'));
  };

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
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value ? format(value, "PPP", { locale: fr }) : <span>{placeholder}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              locale={fr}
              modifiers={{
                occupied: (date) => isDateOccupied(date)
              }}
              modifiersClassNames={{
                occupied: "bg-red-500/20 text-red-700 dark:text-red-300 font-bold hover:bg-red-500/30"
              }}
              disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
              data-testid="calendar-picker"
            />
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
              <Clock className="mr-2 h-4 w-4" />
              {String(selectedHour).padStart(2, '0')}:{String(selectedMinute).padStart(2, '0')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex">
              <ScrollArea className="h-60">
                <div className="p-2">
                  <div className="text-xs font-semibold mb-2 px-2 text-muted-foreground">Heures</div>
                  {hours.map((hour) => (
                    <Button
                      key={hour}
                      variant="ghost"
                      className={cn(
                        "w-full justify-center mb-1",
                        selectedHour === hour && "bg-primary text-primary-foreground",
                        isOptimalHour(hour) && selectedHour !== hour && "bg-green-500/20 text-green-700 dark:text-green-300 font-semibold hover:bg-green-500/30"
                      )}
                      onClick={() => handleTimeChange(hour, selectedMinute)}
                      data-testid={`hour-${hour}`}
                    >
                      {String(hour).padStart(2, '0')}h
                      {isOptimalHour(hour) && selectedHour !== hour && (
                        <span className="ml-1 text-[10px]">✨</span>
                      )}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
              <ScrollArea className="h-60 border-l">
                <div className="p-2">
                  <div className="text-xs font-semibold mb-2 px-2 text-muted-foreground">Minutes</div>
                  {minutes.map((minute) => (
                    <Button
                      key={minute}
                      variant="ghost"
                      className={cn(
                        "w-full justify-center mb-1",
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
            <div className="p-3 border-t bg-muted/50">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">
                  Heures optimales (8h, 12h-13h, 18h-20h)
                </span>
              </div>
              <p className="text-[9px] text-muted-foreground">
                Ces créneaux maximisent l'engagement
              </p>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {occupiedDates.length > 0 && (
        <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <span className="text-xs font-semibold text-red-600 dark:text-red-400">
              Les dates en fond rouge ont déjà des publications programmées
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
