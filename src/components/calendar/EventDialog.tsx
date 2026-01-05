import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useCreateEvent, useUpdateEvent, useDeleteEvent } from "@/hooks/useEvents";
import { useUsers } from "@/hooks/useUsers";
import { useUserMap } from "@/hooks/useUserMap";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { trackEvent, trackModal } from "@/lib/analytics";
import { format } from "date-fns";
import { CalendarIcon, Trash2, Clock, MapPin, Users as UsersIcon, FileText, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Event } from "@/data/eventsData";

interface EventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: Event | null;
  initialDate?: Date;
}

type FormData = {
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  attendees: string[];
};

export function EventDialog({ open, onOpenChange, event, initialDate }: EventDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const { data: users = [] } = useUsers();
  const userMap = useUserMap();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [selectedAttendees, setSelectedAttendees] = useState<string[]>(event?.attendees || []);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  
  // Check if current user is the event creator
  const isEventCreator = event && user && event.createdBy?.toLowerCase() === user.email?.toLowerCase();

  // Helper to format time from Date to HH:mm string
  const formatTime = (date: Date): string => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Helper to create Date from date and time string
  const combineDateAndTime = (date: Date, time: string): Date => {
    const [hours, minutes] = time.split(':').map(Number);
    const newDate = new Date(date);
    newDate.setHours(hours, minutes, 0, 0);
    return newDate;
  };

  const getDefaultStartDate = () => {
    if (event?.startDate) return new Date(event.startDate);
    if (initialDate) return initialDate;
    const now = new Date();
    // Round to next hour
    now.setHours(now.getHours() + 1, 0, 0, 0);
    return now;
  };

  const getDefaultEndDate = () => {
    if (event?.endDate) return new Date(event.endDate);
    if (initialDate) {
      const end = new Date(initialDate);
      end.setHours(end.getHours() + 1, 0, 0, 0);
      return end;
    }
    const now = new Date();
    // Round to next hour + 1 hour duration
    now.setHours(now.getHours() + 2, 0, 0, 0);
    return now;
  };

  const defaultStartDate = getDefaultStartDate();
  const defaultEndDate = getDefaultEndDate();

  const form = useForm<FormData>({
    defaultValues: {
      title: event?.title || "",
      description: event?.description || "",
      startDate: defaultStartDate,
      endDate: defaultEndDate,
      startTime: formatTime(defaultStartDate),
      endTime: formatTime(defaultEndDate),
      allDay: event?.allDay || false,
      location: event?.location || "",
      attendees: event?.attendees || [],
    },
  });

  useEffect(() => {
    if (event) {
      const startDate = event.startDate ? new Date(event.startDate) : new Date();
      const endDate = event.endDate ? new Date(event.endDate) : new Date();
      form.reset({
        title: event.title || "",
        description: event.description || "",
        startDate: startDate,
        endDate: endDate,
        startTime: formatTime(startDate),
        endTime: formatTime(endDate),
        allDay: event.allDay || false,
        location: event.location || "",
        attendees: event.attendees || [],
      });
      setSelectedAttendees(event.attendees || []);
    } else if (initialDate) {
      const startDate = initialDate;
      const endDate = new Date(initialDate);
      endDate.setHours(endDate.getHours() + 1, 0, 0, 0);
      form.reset({
        title: "",
        description: "",
        startDate: startDate,
        endDate: endDate,
        startTime: formatTime(startDate),
        endTime: formatTime(endDate),
        allDay: false,
        location: "",
        attendees: [],
      });
      setSelectedAttendees([]);
    }
  }, [event, initialDate, form]);

  const onSubmit = async (data: FormData) => {
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      // Combine date and time if not all-day
      let startDateTime = data.startDate;
      let endDateTime = data.endDate;
      
      if (!data.allDay) {
        startDateTime = combineDateAndTime(data.startDate, data.startTime);
        endDateTime = combineDateAndTime(data.endDate, data.endTime);
      } else {
        // For all-day events, set to start and end of day
        startDateTime = new Date(data.startDate);
        startDateTime.setHours(0, 0, 0, 0);
        endDateTime = new Date(data.endDate);
        endDateTime.setHours(23, 59, 59, 999);
      }

      const eventData: Partial<Event> = {
        title: data.title,
        description: data.description || undefined,
        startDate: startDateTime.toISOString(),
        endDate: endDateTime.toISOString(),
        allDay: data.allDay,
        location: data.location || undefined,
        attendees: selectedAttendees,
      };

      if (event) {
        await updateEvent.mutateAsync({ eventId: event.id, updates: eventData });
        toast({
          title: "Event updated",
          description: "Event has been updated successfully.",
        });
      } else {
        // For creation, we don't need id - backend will generate it
        const createdEvent = await createEvent.mutateAsync(eventData as Omit<Event, 'id'> & { id?: string });
        
        // Track calendar event creation
        trackEvent('calendar_event_created', {
          event_type: data.allDay ? 'all_day' : 'timed',
          event_date: startDateTime.toISOString(),
          has_location: !!data.location,
          attendee_count: selectedAttendees.length,
        });
        
        toast({
          title: "Event created",
          description: "Event has been created successfully.",
        });
      }
      
      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save event",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleAttendee = (email: string) => {
    setSelectedAttendees(prev => {
      if (prev.includes(email)) {
        return prev.filter(e => e !== email);
      }
      return [...prev, email];
    });
  };

  const handleDelete = async () => {
    if (!event) return;
    
    setIsSubmitting(true);
    try {
      await deleteEvent.mutateAsync(event.id);
      toast({
        title: "Event deleted",
        description: "Event has been deleted successfully.",
      });
      setShowDeleteDialog(false);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete event",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getInitials = (name: string): string => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      trackModal('event_dialog', open ? 'open' : 'close');
      onOpenChange(open);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{event ? "Edit Event" : "Create Event"}</DialogTitle>
          <DialogDescription>
            {event ? "Update event details below" : "Fill in the details to create a new calendar event"}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Title and Description Section */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                rules={{ required: "Title is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-semibold">Event Title</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Enter event title..." 
                        className="h-11 text-base"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2 text-base font-semibold">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Description
                    </FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Add event description (optional)..." 
                        className="min-h-[100px] resize-none"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Date & Time Section */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal h-11",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? format(field.value, "PPP") : "Pick a date"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarComponent
                            mode="single"
                            selected={field.value}
                            onSelect={(date) => {
                              if (date) {
                                field.onChange(date);
                                setStartDateOpen(false);
                              }
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal h-11",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? format(field.value, "PPP") : "Pick a date"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarComponent
                            mode="single"
                            selected={field.value}
                            onSelect={(date) => {
                              if (date) {
                                field.onChange(date);
                                setEndDateOpen(false);
                              }
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="allDay"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal cursor-pointer">
                      All day
                    </FormLabel>
                  </FormItem>
                )}
              />

              {/* Time inputs - only show when not all-day */}
              {!form.watch('allDay') && (
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          Start Time
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            className="h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="endTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          End Time
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            className="h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            <Separator />

            {/* Location Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-base font-semibold">Location</h3>
              </div>
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input 
                        placeholder="Enter location (e.g., Conference Room A, Zoom link, etc.)" 
                        className="h-11"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Attendees Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <UsersIcon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-base font-semibold">Attendees</h3>
              </div>
              <FormField
                control={form.control}
                name="attendees"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <Popover open={attendeesOpen} onOpenChange={setAttendeesOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "w-full justify-between h-11",
                              !selectedAttendees.length && "text-muted-foreground"
                            )}
                          >
                            {selectedAttendees.length > 0
                              ? `${selectedAttendees.length} attendee${selectedAttendees.length > 1 ? 's' : ''} selected`
                              : "Search and select attendees..."}
                            <UsersIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search users..." />
                          <CommandList>
                            <CommandEmpty>No users found.</CommandEmpty>
                            <CommandGroup>
                              {users.map((user) => {
                                const email = user.email?.toLowerCase() || '';
                                const isSelected = selectedAttendees.includes(email);
                                const userName = user.firstName && user.lastName
                                  ? `${user.firstName} ${user.lastName}`
                                  : email;
                                return (
                                  <CommandItem
                                    key={email}
                                    value={userName}
                                    onSelect={() => toggleAttendee(email)}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        isSelected ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    <Avatar className="h-6 w-6 mr-2">
                                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                        {getInitials(userName)}
                                      </AvatarFallback>
                                    </Avatar>
                                    {userName}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedAttendees.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {selectedAttendees.map((email) => {
                          const userEntry = userMap.get(email.toLowerCase());
                          const userName = userEntry ? userEntry.displayName : email;
                          return (
                            <Badge
                              key={email}
                              variant="secondary"
                              className="flex items-center gap-1 pr-1"
                            >
                              <Avatar className="h-4 w-4">
                                <AvatarFallback className="bg-primary/10 text-primary text-[8px]">
                                  {getInitials(userName)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs">{userName}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleAttendee(email);
                                }}
                                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="flex items-center justify-between">
              <div>
                {event && isEventCreator && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={isSubmitting}
                    className="mr-auto"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : event ? "Update" : "Create"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

