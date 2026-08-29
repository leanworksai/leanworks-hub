import { useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarEvent, CalendarItem } from "./CalendarEvent";
import { cn } from "@/lib/utils";

interface MonthViewProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
  items: CalendarItem[];
  onItemClick: (item: CalendarItem) => void;
  onDateClick: (date: Date) => void;
}

export function MonthView({ currentDate, onDateChange, items, onItemClick, onDateClick }: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  
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
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onDateChange(subMonths(currentDate, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold">
          {format(currentDate, 'MMMM yyyy')}
        </h2>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onDateChange(addMonths(currentDate, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {/* Day headers */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="p-2 text-center text-sm font-medium text-muted-foreground">
            {day}
          </div>
        ))}
        
        {/* Calendar days */}
        {days.map((day, idx) => {
          const dayItems = getItemsForDate(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isToday = isSameDay(day, new Date());
          
          return (
            <div
              key={idx}
              className={cn(
                "min-h-[100px] border rounded-md p-1",
                !isCurrentMonth && "opacity-40",
                isToday && "ring-2 ring-primary"
              )}
              onClick={() => onDateClick(day)}
            >
              <div className={cn(
                "text-sm font-medium mb-1",
                isToday && "text-primary"
              )}>
                {format(day, 'd')}
              </div>
              <div className="space-y-1">
                {dayItems.slice(0, 3).map((item, itemIdx) => (
                  <CalendarEvent
                    key={`${item.type}-${item.data.id}-${itemIdx}`}
                    item={item}
                    onClick={(e) => {
                      e.stopPropagation();
                      onItemClick(item);
                    }}
                  />
                ))}
                {dayItems.length > 3 && (
                  <div className="text-xs text-muted-foreground px-2">
                    +{dayItems.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

