import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import TaskDetail from "@/pages/TaskDetail";
import { useDeleteTask } from "@/hooks/useTasks";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
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
import { useTask } from "@/hooks/useTasks";

interface TaskDetailDialogProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailDialog({ taskId, open, onOpenChange }: TaskDetailDialogProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { data: task } = useTask(taskId || '');
  const deleteTask = useDeleteTask();
  const { toast } = useToast();

  const handleDelete = async () => {
    if (!task || !taskId) return;

    try {
      await deleteTask.mutateAsync(taskId);
      toast({
        title: "Task deleted",
        description: `"${task.title}" has been deleted successfully.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Dialog open={open && !!taskId} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
          {/* Delete button positioned absolutely relative to DialogContent - same as exit button */}
          {taskId && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="absolute right-16 top-4 z-10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {taskId && (
            <div className="p-6">
              <TaskDetail 
                taskId={taskId} 
                onClose={() => onOpenChange(false)} 
                isDialog={true} 
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{task?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

