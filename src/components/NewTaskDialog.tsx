import { useState, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
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
import { useUserProjects } from "@/hooks/useProjects";
import { useUserTeams } from "@/hooks/useTeams";
import { useUsers } from "@/hooks/useUsers";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import type { Task } from "@/data/tasksData";
import type { ProjectMember } from "@/data/projectsData";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { Check, ChevronsUpDown, Sparkles, Lock, Share2 } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import { getAuthToken } from "@/services/api";
import { LimitVisibilityDialog } from "@/components/LimitVisibilityDialog";
import { cn } from "@/lib/utils";

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProjectId?: string; // Optional project ID to pre-select
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

// Helper to parse YYYY-MM-DD string to Date in local timezone
const parseDateString = (dateString: string): Date => {
  // Extract date components directly from string to avoid timezone issues
  // When you do new Date("2024-12-24"), JS interprets it as UTC midnight
  // which can shift the date when converted to local timezone
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const generateTaskId = (): string => {
  return uuidv4();
};

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};


export function NewTaskDialog({ open, onOpenChange, initialProjectId }: NewTaskDialogProps) {
  const { toast } = useToast();
  const createTask = useCreateTask();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: projects = [] } = useUserProjects();
  const { data: userTeams = [] } = useUserTeams();
  const { data: users = [] } = useUsers();
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { isFreePlan } = useSubscription();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const isSettingAIAssignee = useRef(false);
  const [showLimitVisibilityDialog, setShowLimitVisibilityDialog] = useState(false);
  const [taskVisibility, setTaskVisibility] = useState<'all_members' | 'specific_members'>('all_members');
  const [taskVisibleToMembers, setTaskVisibleToMembers] = useState<Set<string>>(new Set());

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignee]);

  // Memoize the projects array to prevent infinite loops
  const projectsMemo = useMemo(() => projects, [projects.map(p => p.name).join(',')]);

  // Memoize users array to prevent infinite loops - use a stable key based on user emails
  const usersKey = useMemo(() => users.map(u => u.email).sort().join(','), [users]);
  const usersMemo = useMemo(() => users, [usersKey]);

  // Memoize the org members conversion to prevent recreating on every render
  const orgMembersAsProjectMembers = useMemo(() => {
    return usersMemo.map(user => ({
      id: user.email.toLowerCase(),
      email: user.email,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      role: user.jobTitle || 'Member',
      avatar: `${(user.firstName || '').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || user.email.charAt(0).toUpperCase(),
    }));
  }, [usersMemo]);

  // Load project members when project is selected, or use all org users when no project is selected
  useEffect(() => {
    if (selectedProjectId && projectsMemo.length > 0) {
      // Find the selected project
      const selectedProject = projectsMemo.find(p => {
        const slug = p.name.toLowerCase().replace(/\s+/g, '-');
        return slug === selectedProjectId;
      });

      if (selectedProject && selectedProject.members) {
        // Set project members for assignee selection
        setProjectMembers(selectedProject.members);
      } else {
        setProjectMembers([]);
      }
    } else {
      // No project selected - use all org users
      setProjectMembers(orgMembersAsProjectMembers);
    }
  }, [selectedProjectId, projectsMemo, orgMembersAsProjectMembers]);

  // Reset assignee when project changes (but not during AI generation)
  useEffect(() => {
    if (selectedProjectId && !isSettingAIAssignee.current) {
      setSelectedAssignee(null);
      setSelectedAssigneeId(null);
      form.setValue("assignee", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      form.reset();
      // If initialProjectId is provided, set it
      if (initialProjectId && projects.length > 0) {
        // Find the project by ID
        const project = projects.find(p => p.id === initialProjectId);
        if (project) {
          const slug = project.name.toLowerCase().replace(/\s+/g, '-');
          form.setValue("projectId", slug);
          setSelectedProjectId(slug);
          // Load project members
          if (project.members) {
            setProjectMembers(project.members);
          }
        }
      } else {
        setSelectedProjectId("");
        // Don't clear projectMembers here - the useEffect will handle setting org users
      }
      setSelectedAssignee(null);
      setSelectedAssigneeId(null);
      setAssigneeOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProjectId, projects.length]);

  const generateAITaskDetails = async () => {
    const currentTitle = form.getValues("title");
    if (!currentTitle || currentTitle.trim().length === 0) {
      toast({
        title: "Title required",
        description: "Please enter a task title first to generate AI details.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingAI(true);
    try {
      const isLocalDev = import.meta.env.DEV;
      const API_BASE = isLocalDev ? 'http://0.0.0.0:8081' : '';
      const apiUrl = `${API_BASE}/api/generate-task`;

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Get authentication token (with fallback to localStorage)
      const customToken = await getAuthToken();
      if (!isLocalDev && !customToken) {
        throw new Error('Authentication token not found. Please sign in again.');
      }

      if (isLocalDev) {
        try {
          const backendApiBase = import.meta.env.DEV ? 'http://localhost:3001' : '';
          const apiKeyResponse = await fetch(`${backendApiBase}/api/ask-api-key`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${customToken || ''}`,
            },
          });

          if (!apiKeyResponse.ok) {
            throw new Error('Failed to fetch API key from backend');
          }

          const apiKeyData = await apiKeyResponse.json();
          headers['X-API-Key'] = apiKeyData.apiKey;
        } catch (error) {
          console.error('Failed to fetch API key from backend, using fallback:', error);
          const fallbackKey = import.meta.env.VITE_ASK_API_KEY || '7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=';
          headers['X-API-Key'] = fallbackKey;
        }
      } else {
        headers['Authorization'] = `Bearer ${customToken}`;
      }

      // Get current form values to pass as context
      const currentFormData = form.getValues();
      const currentProject = currentFormData.projectId ? projects.find((p) => {
        const slug = p.name.toLowerCase().replace(/\s+/g, '-');
        return slug === currentFormData.projectId || p.id === currentFormData.projectId || p.name === currentFormData.projectId;
      }) : null;

      // Prepare request body
      const requestBody: any = {
        task_name: currentTitle,
        user_id: user?.email?.toLowerCase() || '',
        org_slug: currentOrg?.slug || currentOrg?.name || '',
        session_id: `generate-task-${Date.now()}`,
      };

      // Add optional fields if they exist
      if (currentFormData.description) {
        requestBody.description = currentFormData.description;
      }
      if (currentFormData.status) {
        requestBody.status = currentFormData.status;
      }
      if (currentFormData.priority) {
        requestBody.priority = currentFormData.priority;
      }
      if (currentFormData.estimatedHours) {
        requestBody.estimated_hours = parseInt(currentFormData.estimatedHours, 10);
      }
      if (currentFormData.dueDate) {
        requestBody.due_date = currentFormData.dueDate;
      }
      if (currentFormData.tags) {
        const tags = currentFormData.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        if (tags.length > 0) {
          requestBody.tags = tags;
        }
      }
      if (currentProject) {
        requestBody.project_id = currentProject.id;
        requestBody.project_name = currentProject.name;
      }
      if (selectedAssigneeId) {
        requestBody.assignee_id = selectedAssigneeId;
        requestBody.assignee_name = selectedAssignee;
      }
      if (user?.email) {
        requestBody.created_by = user.email;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status} ${response.statusText}` }));
        throw new Error(errorData.error || `API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      // Extract task data from response
      const generatedTask = data.task;
      if (!generatedTask) {
        throw new Error('No task data returned from API');
      }

      // Fill form with generated data
      if (generatedTask.title) {
        form.setValue("title", generatedTask.title);
      }
      if (generatedTask.description) {
        form.setValue("description", generatedTask.description);
      }
      if (generatedTask.status) {
        form.setValue("status", generatedTask.status as Task["status"]);
      }
      if (generatedTask.priority) {
        form.setValue("priority", generatedTask.priority as Task["priority"]);
      }
      if (generatedTask.estimated_hours !== undefined && generatedTask.estimated_hours !== null) {
        form.setValue("estimatedHours", generatedTask.estimated_hours.toString());
      }
      if (generatedTask.due_date) {
        // Convert YYYY-MM-DD to date input format
        form.setValue("dueDate", generatedTask.due_date);
      }
      if (generatedTask.tags && Array.isArray(generatedTask.tags) && generatedTask.tags.length > 0) {
        form.setValue("tags", generatedTask.tags.join(", "));
      }

      // Set flag to prevent clearing assignee when project changes (if assignee will be set)
      if (generatedTask.assignee_id || generatedTask.assignee_name) {
        isSettingAIAssignee.current = true;
      }

      // Handle AI-suggested project
      // API only returns project_id, not project_name, so we need to look it up
      let loadedProjectMembers: ProjectMember[] = [];
      if (generatedTask.project_id) {
        const suggestedProject = projects.find((p) => {
          return p.id === generatedTask.project_id;
        });

        if (suggestedProject) {
          const slug = suggestedProject.name.toLowerCase().replace(/\s+/g, '-');
          form.setValue("projectId", slug);
          setSelectedProjectId(slug);
          
          // Load project members for assignee selection
          if (suggestedProject.members) {
            loadedProjectMembers = suggestedProject.members;
            setProjectMembers(suggestedProject.members);
          }
        } else {
          // Project ID was suggested but not found in user's projects
          console.warn(`AI suggested project_id "${generatedTask.project_id}" but it was not found in user's projects`);
        }
      }

      // Handle AI-suggested assignee
      // API might only return assignee_id (email), so we need to look up the name
      if (generatedTask.assignee_id || generatedTask.assignee_name) {
        
        let assigneeName: string | null = null;
        let assigneeId: string | null = null;
        let assigneeAvatar: string | undefined = undefined;

        // First, try to find in project members (if project is selected)
        const membersToSearch = loadedProjectMembers.length > 0 ? loadedProjectMembers : projectMembers;
        if (membersToSearch.length > 0) {
          const suggestedAssignee = membersToSearch.find((m) => {
            if (generatedTask.assignee_id && (m.id === generatedTask.assignee_id || m.id?.toLowerCase() === generatedTask.assignee_id.toLowerCase())) {
              return true;
            }
            if (generatedTask.assignee_name && m.name === generatedTask.assignee_name) {
              return true;
            }
            return false;
          });

          if (suggestedAssignee) {
            assigneeName = suggestedAssignee.name;
            assigneeId = suggestedAssignee.id || generatedTask.assignee_id;
            assigneeAvatar = suggestedAssignee.avatar;
          }
        }

        // If not found in project members, look up by email in users list
        if (!assigneeName && generatedTask.assignee_id) {
          const assigneeEmail = generatedTask.assignee_id.toLowerCase();
          const foundUser = users.find((u) => u.email.toLowerCase() === assigneeEmail);
          
          if (foundUser) {
            assigneeName = `${foundUser.firstName} ${foundUser.lastName}`.trim();
            assigneeId = foundUser.email;
            assigneeAvatar = `${foundUser.firstName.charAt(0)}${foundUser.lastName.charAt(0)}`.toUpperCase();
          }
        }

        // If we still have a name from API, use it (fallback)
        if (!assigneeName && generatedTask.assignee_name) {
          assigneeName = generatedTask.assignee_name;
          assigneeId = generatedTask.assignee_id || null;
        }

        // If we have assignee_id but no name found, use email as fallback name
        // The backend will look up the full name when creating the task
        if (!assigneeName && generatedTask.assignee_id) {
          assigneeName = generatedTask.assignee_id;
          assigneeId = generatedTask.assignee_id;
          assigneeAvatar = generatedTask.assignee_id.charAt(0).toUpperCase();
        }

        // Set assignee if we have either a name or an ID
        // Use setTimeout to ensure this runs after the project change effect
        if (assigneeId) {
          setTimeout(() => {
            setSelectedAssignee(assigneeName || assigneeId);
            setSelectedAssigneeId(assigneeId);
            form.setValue("assignee", assigneeName || assigneeId);
            // Reset flag after setting assignee
            isSettingAIAssignee.current = false;
          }, 0);
        } else {
          isSettingAIAssignee.current = false;
        }
      }

      toast({
        title: "AI details generated",
        description: "Task form has been filled with AI-generated details. You can edit them as needed.",
      });
    } catch (error) {
      console.error('Error generating AI task details:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate AI task details. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      // Validate title is required
      if (!data.title || data.title.trim().length === 0) {
        form.setError("title", {
          type: "required",
          message: "Task title is required"
        });
        setIsSubmitting(false);
        return;
      }

      const now = new Date();
      
      // Find the selected project (if provided)
      // data.projectId could be either a project ID or a project name/slug
      const project = data.projectId ? projects.find((p) => {
        // Try matching by ID first
        if (p.id === data.projectId) return true;
        // Fall back to matching by name or slug
        const slug = p.name.toLowerCase().replace(/\s+/g, '-');
        return slug === data.projectId || p.name === data.projectId;
      }) : null;

      if (data.projectId && !project) {
        throw new Error("Selected project not found");
      }

      // Format due date (optional)
      let formattedDueDate: string | undefined = undefined;
      if (data.dueDate) {
        // Parse date string directly to avoid timezone shifts
        // The date input returns YYYY-MM-DD format, which we need to parse as local date
        const dueDateObj = parseDateString(data.dueDate);
        formattedDueDate = formatDate(dueDateObj);
      }

      // Parse tags
      const tags = data.tags
        ? data.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0)
        : [];

      // If no project, associate task with user's teams
      const teams = !project && userTeams.length > 0 
        ? userTeams.map(team => team.name)
        : undefined;

      const task: Task = {
        id: generateTaskId(),
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        assigneeId: selectedAssigneeId || undefined, // User ID (email address)
        assignee: selectedAssignee || undefined, // Display name of the assignee
        assigneeAvatar: selectedAssignee ? (projectMembers.find(m => m.name === selectedAssignee)?.avatar || getInitials(selectedAssignee)) : undefined,
        project: project?.name,
        projectId: project?.id || undefined, // Use the actual project ID, not the form value
        teams: teams,
        createdBy: user?.email || undefined,
        dueDate: formattedDueDate,
        createdDate: formatDate(now),
        createdAt: now.getTime(), // Timestamp in milliseconds for sorting
        estimatedHours: data.estimatedHours ? parseInt(data.estimatedHours, 10) : undefined,
        tags: tags,
        progressUpdates: [],
        comments: [],
        visibility: taskVisibility,
        visibleToMembers: Array.from(taskVisibleToMembers),
      };

      await createTask.mutateAsync(task);
      
      toast({
        title: "Task created",
        description: `"${task.title}" has been created successfully.`,
      });

      form.reset();
      setTaskVisibility('all_members');
      setTaskVisibleToMembers(new Set());
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowLimitVisibilityDialog(true)}
          className="absolute right-16 top-4 z-10 h-8"
        >
          <Share2 className="h-4 w-4 mr-2" />
          Limit Visibility
        </Button>
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
              rules={{ 
                required: "Task title is required",
                validate: (value) => value.trim().length > 0 || "Task title cannot be empty"
              }}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Task Title *</FormLabel>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (isFreePlan) {
                          toast({
                            title: "Upgrade Required",
                            description: "AI features are available on Standard and Pro plans. Upgrade to unlock this feature.",
                            variant: "default",
                          });
                        } else {
                          generateAITaskDetails();
                        }
                      }}
                      disabled={isGeneratingAI || !field.value || field.value.trim().length === 0 || isFreePlan}
                      className="h-8"
                    >
                      {isFreePlan ? (
                        <>
                          <Lock className="h-3 w-3 mr-1.5" />
                          Draft with AI
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 mr-1.5" />
                          {isGeneratingAI ? "Generating..." : "Draft with AI"}
                        </>
                      )}
                    </Button>
                  </div>
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
                    Leave empty to create a team-wide task visible to all your team members
                  </FormDescription>
                  <Select
                    onValueChange={(value) => {
                      if (value === "none") {
                        field.onChange("");
                        setSelectedProjectId("");
                      } else {
                        field.onChange(value);
                        setSelectedProjectId(value);
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
                      <SelectItem value="none">No Project (Team-wide task)</SelectItem>
                      {projects.map((project) => {
                        const slug = project.name.toLowerCase().replace(/\s+/g, '-');
                        return (
                          <SelectItem key={project.id} value={slug}>
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
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assignee</FormLabel>
                  <FormDescription>
                    {selectedProjectId 
                      ? "Select a project member to assign this task to"
                      : "Select an organization member to assign this task to"}
                  </FormDescription>
                  <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={assigneeOpen}
                          className={cn(
                            "w-full justify-between",
                            selectedAssignee 
                              ? "bg-accent/50 border-primary/20 text-foreground font-medium" 
                              : "text-muted-foreground"
                          )}
                        >
                          {selectedAssignee ? (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-5 w-5">
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {projectMembers.find(m => m.name === selectedAssignee)?.avatar || getInitials(selectedAssignee)}
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
                        <CommandInput placeholder={selectedProjectId ? "Search project members..." : "Search organization members..."} />
                        <CommandList>
                          {projectMembers.length === 0 ? (
                            <CommandEmpty>
                              {selectedProjectId 
                                ? "No project members found." 
                                : "No organization members found."}
                            </CommandEmpty>
                          ) : (
                            <CommandGroup>
                              {projectMembers.map((member) => (
                                <CommandItem
                                  key={member.id || member.name}
                                  value={member.name}
                                  onSelect={() => {
                                    setSelectedAssignee(member.name);
                                    setSelectedAssigneeId(member.id);
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
                      Set a target completion date
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
                      Estimated time to complete
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
                    Comma-separated tags for categorization
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

      <LimitVisibilityDialog
        open={showLimitVisibilityDialog}
        onOpenChange={setShowLimitVisibilityDialog}
        title="Limit Task Visibility"
        itemName={form.watch('title') || undefined}
        currentVisibility={taskVisibility}
        currentVisibleToMembers={Array.from(taskVisibleToMembers)}
        onSave={(visibility, visibleToMembers) => {
          setTaskVisibility(visibility);
          setTaskVisibleToMembers(new Set(visibleToMembers));
          setShowLimitVisibilityDialog(false);
        }}
      />
    </Dialog>
  );
}

