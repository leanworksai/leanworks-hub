import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Task } from "@/data/tasksData";
import { Project } from "@/data/projectsData";
import { Event } from "@/data/eventsData";

export type CalendarItem = 
  | { type: 'task'; data: Task }
  | { type: 'project'; data: Project }
  | { type: 'event'; data: Event };

interface CalendarEventProps {
  item: CalendarItem;
  onClick?: () => void;
  className?: string;
}

export function CalendarEvent({ item, onClick, className }: CalendarEventProps) {
  const getItemColor = () => {
    switch (item.type) {
      case 'task':
        const task = item.data as Task;
        if (task.status === 'completed') return 'bg-green-500/20 border-green-500/50 text-green-700';
        if (task.status === 'blocked') return 'bg-red-500/20 border-red-500/50 text-red-700';
        if (task.priority === 'urgent') return 'bg-orange-500/20 border-orange-500/50 text-orange-700';
        if (task.priority === 'high') return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-700';
        return 'bg-blue-500/20 border-blue-500/50 text-blue-700';
      case 'project':
        return 'bg-purple-500/20 border-purple-500/50 text-purple-700';
      case 'event':
        return 'bg-emerald-500/20 border-emerald-500/50 text-emerald-700';
    }
  };

  const getItemTitle = () => {
    switch (item.type) {
      case 'task':
        return (item.data as Task).title;
      case 'project':
        return (item.data as Project).name;
      case 'event':
        return (item.data as Event).title;
    }
  };

  const getItemTime = () => {
    switch (item.type) {
      case 'task':
        const task = item.data as Task;
        if (!task.dueDate) return null;
        return null; // Tasks show date only
      case 'project':
        const project = item.data as Project;
        if (!project.dueDate) return null;
        return null; // Projects show date only
      case 'event':
        const event = item.data as Event;
        if (event.allDay) return null;
        try {
          const startDate = new Date(event.startDate);
          const endDate = new Date(event.endDate);
          const startTime = format(startDate, 'h:mm a');
          const endTime = format(endDate, 'h:mm a');
          return `${startTime} - ${endTime}`;
        } catch {
          return null;
        }
    }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "px-2 py-1 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity border",
        getItemColor(),
        className
      )}
      title={getItemTitle()}
    >
      <div className="font-medium truncate">{getItemTitle()}</div>
      {getItemTime() && (
        <div className="text-[10px] opacity-75 mt-0.5">{getItemTime()}</div>
      )}
    </div>
  );
}

