import { Dialog, DialogContent } from "@/components/ui/dialog";
import TaskDetail from "@/pages/TaskDetail";

interface TaskDetailDialogProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailDialog({ taskId, open, onOpenChange }: TaskDetailDialogProps) {
  return (
    <Dialog open={open && !!taskId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        {taskId && (
          <div className="p-6 relative">
            <TaskDetail 
              taskId={taskId} 
              onClose={() => onOpenChange(false)} 
              isDialog={true} 
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

