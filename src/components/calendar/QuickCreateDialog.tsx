import { useState } from "react";
import { trackEvent, trackModal } from "@/lib/analytics";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { EventDialog } from "./EventDialog";
import { format } from "date-fns";

interface QuickCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: Date;
  initialType?: 'task' | 'project' | 'event';
}

export function QuickCreateDialog({ open, onOpenChange, initialDate, initialType = 'task' }: QuickCreateDialogProps) {
  const [activeTab, setActiveTab] = useState(initialType);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);

  const handleTaskCreate = () => {
    setTaskDialogOpen(true);
  };

  const handleProjectCreate = () => {
    setProjectDialogOpen(true);
  };

  const handleEventCreate = () => {
    setEventDialogOpen(true);
  };

  const handleTaskDialogClose = (open: boolean) => {
    setTaskDialogOpen(open);
    if (!open) {
      onOpenChange(false);
    }
  };

  const handleProjectDialogClose = (open: boolean) => {
    setProjectDialogOpen(open);
    if (!open) {
      onOpenChange(false);
    }
  };

  const handleEventDialogClose = (open: boolean) => {
    setEventDialogOpen(open);
    if (!open) {
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(open) => {
        trackModal('quick_create', open ? 'open' : 'close');
        onOpenChange(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Item</DialogTitle>
            <DialogDescription>
              {initialDate && `For ${format(initialDate, 'MMMM d, yyyy')}`}
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="task">Task</TabsTrigger>
              <TabsTrigger value="project">Project</TabsTrigger>
              <TabsTrigger value="event">Event</TabsTrigger>
            </TabsList>
            
            <TabsContent value="task" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Create a new task with a due date.
              </p>
              <Button onClick={handleTaskCreate} className="w-full">
                Create Task
              </Button>
            </TabsContent>
            
            <TabsContent value="project" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Create a new project with a due date.
              </p>
              <Button onClick={handleProjectCreate} className="w-full">
                Create Project
              </Button>
            </TabsContent>
            
            <TabsContent value="event" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Create a new calendar event.
              </p>
              <Button onClick={handleEventCreate} className="w-full">
                Create Event
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <NewTaskDialog
        open={taskDialogOpen}
        onOpenChange={handleTaskDialogClose}
      />

      <NewProjectDialog
        open={projectDialogOpen}
        onOpenChange={handleProjectDialogClose}
      />

      <EventDialog
        open={eventDialogOpen}
        onOpenChange={handleEventDialogClose}
        initialDate={initialDate}
      />
    </>
  );
}

