import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCreateTask } from "@/hooks/useTasks";
import { useProjects } from "@/hooks/useProjects";
import { useTeams } from "@/hooks/useTeams";
import { teamsService } from "@/services/firestore";
import type { Task } from "@/data/tasksData";
import type { TeamMember } from "@/data/teamsData";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown } from "lucide-react";

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusOptions = [
  { value: "todo", label: "Todo" },
  { value: "in-progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
];

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const formatDate = (date: Date): string => {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const generateTaskId = (): string => {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};


export function NewTaskDialog({ open, onOpenChange }: NewTaskDialogProps) {
  const { toast } = useToast();
  const createTask = useCreateTask();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: projects = [] } = useProjects();
  const { data: teams = [] } = useTeams();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [allTeamMembers, setAllTeamMembers] = useState<TeamMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  type FormData = {
    title: string;
    description: string;
    projectId: string;
    assignee: string;
    status: Task["status"];
    priority: Task["priority"];
    dueDate: string;
    estimatedHours: string;
    tags: string;
  };

  const form = useForm<FormData>({
    defaultValues: {
      title: "",
      description: "",
      projectId: "",
      assignee: "",
      status: "todo",
      priority: "medium",
      dueDate: "",
      estimatedHours: "",
      tags: "",
    },
    mode: "onChange",
  });

  // Update form when assignee changes
  useEffect(() => {
    if (selectedAssignee) {
      form.setValue("assignee", selectedAssignee);
    } else {
      form.setValue("assignee", "");
    }
  }, [selectedAssignee, form]);

  // Load all team members when dialog opens or teams change
  useEffect(() => {
    const loadAllTeamMembers = async () => {
      if (teams.length === 0) {
        setAllTeamMembers([]);
        return;
      }

      setIsLoadingMembers(true);
      try {
        // Fetch all team details in parallel
        const teamDetailsPromises = teams.map(team => 
          teamsService.getById(team.name).catch(error => {
            console.error(`Failed to fetch team ${team.name}:`, error);
            return null;
          })
        );

        const teamDetails = await Promise.all(teamDetailsPromises);

        // Aggregate all members from all teams
        const memberMap = new Map<string, TeamMember>();
        teamDetails.forEach(teamDetail => {
          if (teamDetail?.members) {
            teamDetail.members.forEach(member => {
              if (!memberMap.has(member.name)) {
                memberMap.set(member.name, member);
              }
            });
          }
        });

        // Sort by name
        const sortedMembers = Array.from(memberMap.values()).sort((a, b) => 
          a.name.localeCompare(b.name)
        );

        setAllTeamMembers(sortedMembers);
      } catch (error) {
        console.error('Failed to load team members:', error);
        setAllTeamMembers([]);
      } finally {
        setIsLoadingMembers(false);
      }
    };

    if (open) {
      loadAllTeamMembers();
    }
  }, [open, teams]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      form.reset();
      setSelectedProjectId("");
      setSelectedAssignee(null);
      setAssigneeOpen(false);
    }
  }, [open, form]);

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const now = new Date();
      
      // Find the selected project
      const project = projects.find((p) => {
        const slug = p.name.toLowerCase().replace(/\s+/g, '-');
        return slug === data.projectId || p.name === data.projectId;
      });

      if (!project) {
        throw new Error("Selected project not found");
      }

      // Format due date
      let formattedDueDate = "";
      if (data.dueDate) {
        const dueDateObj = new Date(data.dueDate);
        formattedDueDate = formatDate(dueDateObj);
      } else {
        // Default to 7 days from now if not provided
        formattedDueDate = formatDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
      }

      // Parse tags
      const tags = data.tags
        ? data.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0)
        : [];

      // Get assignee avatar
      const assigneeAvatar = getInitials(data.assignee);

      const task: Task = {
        id: generateTaskId(),
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        assignee: data.assignee,
        assigneeAvatar: assigneeAvatar,
        project: project.name,
        projectId: data.projectId,
        dueDate: formattedDueDate,
        createdDate: formatDate(now),
        createdAt: now.getTime(), // Timestamp in milliseconds for sorting
        estimatedHours: data.estimatedHours ? parseInt(data.estimatedHours, 10) : undefined,
        tags: tags,
        progressUpdates: [],
        comments: [],
      };

      await createTask.mutateAsync(task);
      
      toast({
        title: "Task created",
        description: `"${task.title}" has been created successfully.`,
      });

      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create task",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>
            Add a new task to track work and progress
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              rules={{ required: "Task title is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Title</FormLabel>
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
              rules={{ required: "Description is required" }}
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
              rules={{ required: "Project is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      setSelectedProjectId(value);
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {projects.map((project) => {
                        const slug = project.name.toLowerCase().replace(/\s+/g, '-');
                        return (
                          <SelectItem key={project.name} value={slug}>
                            {project.name}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="assignee"
              rules={{ required: "Assignee is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assignee</FormLabel>
                  <FormDescription>
                    Select a team member to assign this task to
                  </FormDescription>
                  <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={assigneeOpen}
                          className="w-full justify-between"
                        >
                          {selectedAssignee ? (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-5 w-5">
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {allTeamMembers.find(m => m.name === selectedAssignee)?.avatar || getInitials(selectedAssignee)}
                                </AvatarFallback>
                              </Avatar>
                              <span>{selectedAssignee}</span>
                            </div>
                          ) : (
                            "Select assignee..."
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0">
                      <Command>
                        <CommandInput placeholder="Search team members..." />
                        <CommandList>
                          {isLoadingMembers ? (
                            <div className="p-4 text-sm text-muted-foreground">Loading members...</div>
                          ) : allTeamMembers.length === 0 ? (
                            <CommandEmpty>No team members found.</CommandEmpty>
                          ) : (
                            <CommandGroup>
                              {allTeamMembers.map((member) => (
                                <CommandItem
                                  key={member.name}
                                  value={member.name}
                                  onSelect={() => {
                                    setSelectedAssignee(member.name);
                                    setAssigneeOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 shrink-0 ${
                                      selectedAssignee === member.name ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Avatar className="h-6 w-6 shrink-0">
                                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                        {member.avatar}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-medium truncate">
                                        {member.name}
                                      </span>
                                      <span className="text-xs text-muted-foreground truncate">
                                        {member.role}
                                      </span>
                                    </div>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {statusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {priorityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date</FormLabel>
                    <FormControl>
                      <Input 
                        type="date" 
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional: Set a target completion date
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="estimatedHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated Hours</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        placeholder="e.g., 40"
                        {...field}
                        min="0"
                      />
                    </FormControl>
                    <FormDescription>
                      Optional: Estimated time to complete
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tags</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="e.g., frontend, mobile, urgent"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Optional: Comma-separated tags for categorization
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                {isSubmitting ? "Creating..." : "Create Task"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

