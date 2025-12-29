import { format, isAfter, isBefore, startOfDay, endOfDay, isSameDay, addDays, isWithinInterval } from "date-fns";
import { CalendarEvent, CalendarItem } from "./CalendarEvent";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AgendaViewProps {
  currentDate: Date;
  items: CalendarItem[];
  onItemClick: (item: CalendarItem) => void;
  daysToShow?: number;
}

export function AgendaView({ currentDate, items, onItemClick, daysToShow = 14 }: AgendaViewProps) {
  const getItemsForDateRange = (): Array<{ date: Date; items: CalendarItem[] }> => {
    const result: Array<{ date: Date; items: CalendarItem[] }> = [];
    const today = startOfDay(currentDate);
    
    for (let i = 0; i < daysToShow; i++) {
      const date = addDays(today, i);
      const dayItems = items.filter(item => {
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
                const startDate = startOfDay(new Date(event.startDate));
                const endDate = endOfDay(new Date(event.endDate));
                // Check if the date falls within the event's date range
                return isWithinInterval(date, { start: startDate, end: endDate });
              } catch {
                return false;
              }
            }
            return false;
            
          default:
            return false;
        }
      });
      
      if (dayItems.length > 0 || isSameDay(date, new Date())) {
        result.push({ date, items: dayItems });
      }
    }
    
    return result;
  };

  const getItemTime = (item: CalendarItem): string => {
    switch (item.type) {
      case 'task':
      case 'project':
        return 'All day';
      case 'event':
        const event = item.data as any;
        if (event.allDay) return 'All day';
        try {
          const startDate = new Date(event.startDate);
          const endDate = new Date(event.endDate);
          const startTime = format(startDate, 'h:mm a');
          const endTime = format(endDate, 'h:mm a');
          return `${startTime} - ${endTime}`;
        } catch {
          return 'All day';
        }
    }
  };

  const dateItems = getItemsForDateRange();

  if (dateItems.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No upcoming items in the next {daysToShow} days
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dateItems.map(({ date, items: dayItems }) => (
        <Card key={date.toISOString()} className="p-4">
          <div className="flex gap-4">
            <div className={cn(
              "min-w-[100px] text-sm",
              isSameDay(date, new Date()) && "font-semibold text-primary"
            )}>
              <div className="text-lg font-medium">
                {format(date, 'd')}
              </div>
              <div className="text-muted-foreground">
                {format(date, 'EEE')}
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {dayItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">No items</div>
              ) : (
                dayItems.map((item, itemIdx) => (
                  <div
                    key={`${item.type}-${item.data.id}-${itemIdx}`}
                    className="flex items-start gap-3 cursor-pointer hover:bg-accent/50 p-2 rounded -mx-2"
                    onClick={() => onItemClick(item)}
                  >
                    <div className="text-xs text-muted-foreground min-w-[80px] mt-1">
                      {getItemTime(item)}
                    </div>
                    <div className="flex-1">
                      <CalendarEvent item={item} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

