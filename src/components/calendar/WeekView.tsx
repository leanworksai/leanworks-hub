import { startOfWeek, endOfWeek, eachDayOfInterval, format, isSameDay, addWeeks, subWeeks, addDays, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarEvent, CalendarItem } from "./CalendarEvent";
import { cn } from "@/lib/utils";

interface WeekViewProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
  items: CalendarItem[];
  onItemClick: (item: CalendarItem) => void;
  onDateClick: (date: Date) => void;
}

const hours = Array.from({ length: 24 }, (_, i) => i);

export function WeekView({ currentDate, onDateChange, items, onItemClick, onDateClick }: WeekViewProps) {
  const weekStart = startOfWeek(currentDate);
  const weekEnd = endOfWeek(currentDate);
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  
  const getItemsForDate = (date: Date): CalendarItem[] => {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    
    return items.filter(item => {
      switch (item.type) {
        case 'task':
          const task = item.data as any;
          if (task.dueDate) {
            try {
              const [year, month, day] = task.dueDate.split('T')[0].split('-').map(Number);
              const itemDate = new Date(year, month - 1, day);
              return isSameDay(itemDate, date);
            } catch {
              return false;
            }
          }
          return false;
          
        case 'project':
          const project = item.data as any;
          if (project.dueDate) {
            try {
              const [year, month, day] = project.dueDate.split('T')[0].split('-').map(Number);
              const itemDate = new Date(year, month - 1, day);
              return isSameDay(itemDate, date);
            } catch {
              return false;
            }
          }
          return false;
          
        case 'event':
          const event = item.data as any;
          if (event.startDate && event.endDate) {
            try {
              const eventStart = new Date(event.startDate);
              const eventEnd = new Date(event.endDate);
              
              if (event.allDay) {
                // For all-day events, check if the date falls within the event's date range
                const startDate = startOfDay(eventStart);
                const endDate = endOfDay(eventEnd);
                return isWithinInterval(date, { start: startDate, end: endDate });
              } else {
                // For timed events, check if the event overlaps with this day
                return (eventStart <= dayEnd && eventEnd >= dayStart);
              }
            } catch {
              return false;
            }
          }
          return false;
          
        default:
          return false;
      }
    });
  };

  const getItemPosition = (item: CalendarItem): { top: number; height: number } | null => {
    if (item.type !== 'event') return null;
    
    const event = item.data as any;
    if (event.allDay) return null;
    
    try {
      const startDate = new Date(event.startDate);
      const endDate = new Date(event.endDate);
      const startHour = startDate.getHours() + startDate.getMinutes() / 60;
      const endHour = endDate.getHours() + endDate.getMinutes() / 60;
      const duration = endHour - startHour;
      
      return {
        top: (startHour / 24) * 100,
        height: (duration / 24) * 100,
      };
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onDateChange(subWeeks(currentDate, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold">
          {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
        </h2>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onDateChange(addWeeks(currentDate, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-8 border-b">
          <div className="p-2 border-r"></div>
          {days.map((day, idx) => (
            <div
              key={idx}
              className={cn(
                "p-2 text-center border-r last:border-r-0",
                isSameDay(day, new Date()) && "bg-primary/10"
              )}
              onClick={() => onDateClick(day)}
            >
              <div className="text-sm font-medium">{format(day, 'EEE')}</div>
              <div className={cn(
                "text-lg",
                isSameDay(day, new Date()) && "text-primary font-bold"
              )}>
                {format(day, 'd')}
              </div>
            </div>
          ))}
        </div>
        
        {/* All-day section */}
        <div className="grid grid-cols-8 border-b">
          <div className="p-2 border-r text-xs text-muted-foreground">All day</div>
          {days.map((day, idx) => {
            const dayItems = getItemsForDate(day).filter(item => {
              if (item.type === 'event') {
                return (item.data as any).allDay;
              }
              return true; // Tasks and projects are treated as all-day
            });
            
            return (
              <div
                key={idx}
                className="p-1 border-r last:border-r-0 min-h-[60px] space-y-1"
                onClick={() => onDateClick(day)}
              >
                {dayItems.map((item, itemIdx) => (
                  <CalendarEvent
                    key={`${item.type}-${item.data.id}-${itemIdx}`}
                    item={item}
                    onClick={(e) => {
                      e.stopPropagation();
                      onItemClick(item);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
        
        {/* Hourly timeline */}
        <div className="grid grid-cols-8 max-h-[600px] overflow-y-auto">
          <div className="border-r">
            {hours.map(hour => (
              <div key={hour} className="h-16 border-b p-1 text-xs text-muted-foreground">
                {format(new Date().setHours(hour, 0), 'h a')}
              </div>
            ))}
          </div>
          {days.map((day, dayIdx) => {
            const dayItems = getItemsForDate(day).filter(item => {
              if (item.type === 'event') {
                return !(item.data as any).allDay;
              }
              return false; // Only show timed events in hourly view
            });
            
            return (
              <div key={dayIdx} className="border-r last:border-r-0 relative">
                {hours.map(hour => (
                  <div
                    key={hour}
                    className="h-16 border-b cursor-pointer hover:bg-accent/50"
                    onClick={() => onDateClick(addDays(day, 0))}
                  />
                ))}
                {dayItems.map((item, itemIdx) => {
                  const position = getItemPosition(item);
                  if (!position) return null;
                  
                  return (
                    <div
                      key={`${item.type}-${item.data.id}-${itemIdx}`}
                      className="absolute left-0 right-0 px-1"
                      style={{
                        top: `${position.top}%`,
                        height: `${Math.max(position.height, 2)}%`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onItemClick(item);
                      }}
                    >
                      <CalendarEvent item={item} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

