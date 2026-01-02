import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useUserTasks } from "@/hooks/useTasks";
import { useUserProjects } from "@/hooks/useProjects";
import { useUserEvents } from "@/hooks/useEvents";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import { AgendaView } from "@/components/calendar/AgendaView";
import { EventDialog } from "@/components/calendar/EventDialog";
import { CalendarItem } from "@/components/calendar/CalendarEvent";
import type { Task } from "@/data/tasksData";
import type { Project } from "@/data/projectsData";
import type { Event } from "@/data/eventsData";

type ViewType = 'month' | 'week' | 'day' | 'agenda';

export default function Calendar() {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>('month');
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  const { data: tasks = [], isLoading: tasksLoading } = useUserTasks();
  const { data: projects = [], isLoading: projectsLoading } = useUserProjects();
  const { data: events = [], isLoading: eventsLoading } = useUserEvents();

  const isLoading = tasksLoading || projectsLoading || eventsLoading;

  // Combine all items into calendar items
  const calendarItems: CalendarItem[] = [
    ...tasks
      .filter((task: Task) => task.dueDate)
      .map((task: Task) => ({ type: 'task' as const, data: task })),
    ...projects
      .filter((project: Project) => project.dueDate)
      .map((project: Project) => ({ type: 'project' as const, data: project })),
    ...events.map((event: Event) => ({ type: 'event' as const, data: event })),
  ];

  const handleItemClick = (item: CalendarItem) => {
    switch (item.type) {
      case 'task':
        navigate(`/tasks/${item.data.id}`);
        break;
      case 'project':
        navigate(`/projects/${item.data.id}`);
        break;
      case 'event':
        setSelectedEvent(item.data as Event);
        setEventDialogOpen(true);
        break;
    }
  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedEvent(null);
    setEventDialogOpen(true);
    
    // Track date selection
    trackEvent('calendar_date_selected', {
      selected_date: date.toISOString(),
    });
  };


  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Calendar</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedDate(undefined);
              setSelectedEvent(null);
              setEventDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Event
          </Button>
          <Select value={view} onValueChange={(v) => {
            const newView = v as ViewType;
            setView(newView);
            trackEvent('calendar_view_changed', {
              view_type: newView,
            });
          }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="agenda">Agenda</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Calendar Views */}
      {view === 'month' && (
        <MonthView
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          items={calendarItems}
          onItemClick={handleItemClick}
          onDateClick={handleDateClick}
        />
      )}

      {view === 'week' && (
        <WeekView
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          items={calendarItems}
          onItemClick={handleItemClick}
          onDateClick={handleDateClick}
        />
      )}

      {view === 'day' && (
        <DayView
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          items={calendarItems}
          onItemClick={handleItemClick}
          onDateClick={handleDateClick}
        />
      )}

      {view === 'agenda' && (
        <AgendaView
          currentDate={currentDate}
          items={calendarItems}
          onItemClick={handleItemClick}
        />
      )}

      {/* Event Dialog */}
      <EventDialog
        open={eventDialogOpen}
        onOpenChange={(open) => {
          setEventDialogOpen(open);
          if (!open) {
            setSelectedEvent(null);
            setSelectedDate(undefined);
          }
        }}
        event={selectedEvent}
        initialDate={selectedDate}
      />
    </div>
  );
}

