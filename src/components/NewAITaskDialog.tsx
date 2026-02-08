import { useEffect, useMemo, useState, memo } from "react";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCreateTask } from "@/hooks/useTasks";
import { useUserProjects } from "@/hooks/useProjects";
import type { Task } from "@/data/tasksData";
import { useToast } from "@/hooks/use-toast";
import { trackCreate, trackConversion, trackEvent, trackModal } from "@/lib/analytics";
import { useAIAgents } from "@/hooks/useAIAgents";
import { tasksService } from "@/services/api";

interface NewAITaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProjectId?: string;
}

type FormData = {
  title: string;
  description: string;
  projectId: string;
};

function NewAITaskDialogComponent({ open, onOpenChange, initialProjectId }: NewAITaskDialogProps) {
  const { toast } = useToast();
  const createTask = useCreateTask();
  const { data: projects = [] } = useUserProjects();
  const { data: aiAgents = [] } = useAIAgents();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<"auto" | "select">("auto");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const form = useForm<FormData>({
    defaultValues: {
      title: "",
      description: "",
      projectId: "",
    },
    mode: "onChange",
  });

  useEffect(() => {
    if (!open) {
      document.body.style.pointerEvents = "";
    }

    return () => {
      document.body.style.pointerEvents = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    form.reset();
    setAssignmentMode("auto");
    setSelectedAgentIds([]);
    setAssignmentError(null);

    if (initialProjectId && projects.length > 0) {
      const project = projects.find((item) => item.id === initialProjectId);
      if (project) {
        form.setValue("projectId", project.id);
      }
    }
  }, [open, initialProjectId, projects.length, form]);

  const selectedAgentSet = useMemo(() => new Set(selectedAgentIds), [selectedAgentIds]);

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      if (!data.title || data.title.trim().length === 0) {
        form.setError("title", {
          type: "required",
          message: "Task title is required",
        });
        setIsSubmitting(false);
        return;
      }

      if (assignmentMode === "select" && selectedAgentIds.length === 0) {
        setAssignmentError("Select at least one AI agent or choose Auto.");
        setIsSubmitting(false);
        return;
      }

      const project = data.projectId
        ? projects.find((item) => item.id === data.projectId)
        : null;

      if (data.projectId && !project) {
        throw new Error("Selected project not found");
      }

      const apiPayload = {
        title: data.title.trim(),
        description: data.description?.trim() || undefined,
        projectId: project?.id || undefined,
        projectName: project?.name,
        tags: [],
        visibility: "all_members",
        visibleToMembers: [],
      } as unknown as Task;

      const createdTask = await createTask.mutateAsync(apiPayload);
      const createdTaskId = (createdTask as { id?: string })?.id;

      if (createdTaskId) {
        try {
          if (assignmentMode === "select") {
            await tasksService.update(createdTaskId, {
              assigneeType: "ai_agent",
              agentIds: selectedAgentIds,
            });
          } else {
            await tasksService.update(createdTaskId, {
              assigneeType: "ai_agent",
            });
          }
        } catch (error) {
          toast({
            title: "Assignment failed",
            description: error instanceof Error ? error.message : "Task created, but AI assignment failed.",
            variant: "destructive",
          });
        }
      }

      trackCreate("task", "/tasks");
      trackConversion("task_created");
      trackEvent("task_created", {
        created_for: "ai",
        has_project: !!project,
        has_description: !!data.description?.trim(),
        assignment_mode: assignmentMode,
        assigned_agent_count: selectedAgentIds.length,
      });

      toast({
        title: "Task queued for AI",
        description: `"${data.title}" has been sent for execution.`,
      });

      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to execute task",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        trackModal("new_ai_task", nextOpen ? "open" : "close");
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Task for AI</DialogTitle>
          <DialogDescription>
            Provide the details and execute the task with AI.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              rules={{
                required: "Task title is required",
                validate: (value) => value.trim().length > 0 || "Task title cannot be empty",
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter task title" {...field} />
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
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Provide details about the task"
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="projectId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project</FormLabel>
                  <FormDescription>
                    Leave empty to create a task not linked to a project (visible to org members)
                  </FormDescription>
                  <Select
                    onValueChange={(value) => {
                      if (value === "none") {
                        field.onChange("");
                      } else {
                        field.onChange(value);
                      }
                    }}
                    value={field.value || "none"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No project</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3 rounded-md border border-border/60 p-3">
              <div>
                <FormLabel>AI Assignment</FormLabel>
                <FormDescription>
                  Choose Auto to let the system decide, or select one or more agents.
                </FormDescription>
              </div>
              <RadioGroup
                className="gap-3"
                value={assignmentMode}
                onValueChange={(value) => {
                  const nextValue = value === "select" ? "select" : "auto";
                  setAssignmentMode(nextValue);
                  setAssignmentError(null);
                }}
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="auto" id="ai-assignment-auto" />
                  <Label htmlFor="ai-assignment-auto" className="font-normal">
                    Auto
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="select" id="ai-assignment-select" />
                  <Label htmlFor="ai-assignment-select" className="font-normal">
                    Select agents
                  </Label>
                </div>
              </RadioGroup>

              {assignmentMode === "select" && (
                <div className="space-y-2">
                  {aiAgents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No agents available. Create one in admin settings.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {aiAgents.map((agent) => (
                        <label
                          key={agent.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={selectedAgentSet.has(agent.id)}
                              onCheckedChange={(checked) => {
                                setAssignmentError(null);
                                setSelectedAgentIds((prev) => {
                                  if (checked) {
                                    return Array.from(new Set([...prev, agent.id]));
                                  }
                                  return prev.filter((id) => id !== agent.id);
                                });
                              }}
                            />
                            <span>{agent.name}</span>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {agent.status}
                          </Badge>
                        </label>
                      ))}
                    </div>
                  )}
                  {assignmentError && (
                    <p className="text-sm text-destructive">{assignmentError}</p>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-primary hover:bg-primary/90"
              >
                {isSubmitting ? "Executing..." : "Execute"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export const NewAITaskDialog = memo(NewAITaskDialogComponent);
