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
import { useCreateProject } from "@/hooks/useProjects";
import { useUsers } from "@/hooks/useUsers";
import { useAuth } from "@/contexts/AuthContext";
import type { Project, ProjectMember } from "@/data/projectsData";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import { trackCreate, trackFormSubmit } from "@/lib/analytics";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusOptions = [
  { value: "Planning", label: "Planning", color: "bg-gray-500" },
  { value: "In Progress", label: "In Progress", color: "bg-blue-500" },
  { value: "Review", label: "Review", color: "bg-yellow-500" },
  { value: "Completed", label: "Completed", color: "bg-green-500" },
];

const getStatusColor = (status: string): string => {
  const option = statusOptions.find(opt => opt.value === status);
  return option?.color || "bg-gray-500";
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
  const { toast } = useToast();
  const createProject = useCreateProject();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const { data: orgMembers = [], isLoading: isLoadingMembers } = useUsers();
  const { user } = useAuth();
  const [membersOpen, setMembersOpen] = useState(false);

  type FormData = {
    name: string;
    description: string;
    dueDate: string;
  };

  const form = useForm<FormData>({
    defaultValues: {
      name: "",
      description: "",
      dueDate: "",
    },
  });

  // Convert org members to a format suitable for selection
  const availableMembers = orgMembers
    .filter(member => member.email.toLowerCase() !== user?.email?.toLowerCase()) // Exclude current user
    .map(member => ({
      email: member.email,
      name: `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email,
      role: member.jobTitle || 'Member',
      avatar: `${(member.firstName || '').charAt(0)}${(member.lastName || '').charAt(0)}`.toUpperCase() || member.email.charAt(0).toUpperCase(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Reset selected members when dialog opens/closes
  useEffect(() => {
    if (open) {
      setSelectedMembers(new Set());
      setMembersOpen(false);
    }
  }, [open]);

  // Convert selected member emails to ProjectMember format
  const getSelectedProjectMembers = (): ProjectMember[] => {
    return Array.from(selectedMembers)
      .map(email => {
        const member = orgMembers.find(m => m.email.toLowerCase() === email.toLowerCase());
        if (!member) return null;
        
        const firstName = member.firstName || '';
        const lastName = member.lastName || '';
        const name = `${firstName} ${lastName}`.trim() || member.email;
        const avatar = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || member.email.charAt(0).toUpperCase();
        
    return {
          id: member.email.toLowerCase(),
          email: member.email,
          name: name,
          role: member.jobTitle || 'Member',
          avatar: avatar,
        };
      })
      .filter((m): m is ProjectMember => m !== null);
  };

  // Toggle member selection
  const toggleMemberSelection = (memberEmail: string) => {
    const normalizedEmail = memberEmail.toLowerCase();
    const newSelected = new Set(selectedMembers);
    if (newSelected.has(normalizedEmail)) {
      newSelected.delete(normalizedEmail);
    } else {
      newSelected.add(normalizedEmail);
    }
    setSelectedMembers(newSelected);
  };

  // Check if a member is selected
  const isMemberSelected = (memberEmail: string): boolean => {
    return selectedMembers.has(memberEmail.toLowerCase());
  };

  // Get selected member names for display
  const getSelectedMemberNames = (): string[] => {
    return Array.from(selectedMembers)
      .map(email => {
        const member = orgMembers.find(m => m.email.toLowerCase() === email.toLowerCase());
        return member ? `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email : email;
      });
  };

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      // Validate required fields
      if (!data.name || data.name.trim().length === 0) {
        form.setError("name", {
          type: "required",
          message: "Project name is required"
        });
        setIsSubmitting(false);
        return;
      }

      const now = new Date();
      // Convert YYYY-MM-DD to the format used in Project interface
      let formattedDueDate = "";
      if (data.dueDate) {
        const dueDateObj = new Date(data.dueDate);
        formattedDueDate = formatDate(dueDateObj);
      } else {
        // Default to 30 days from now if not provided
        formattedDueDate = formatDate(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
      }

      // Get selected project members
      const projectMembers = getSelectedProjectMembers();

      const project: Project = {
        id: uuidv4(), // Generate unique ID
        name: data.name,
        description: data.description,
        detailedDescription: data.description,
        status: "Planning", // Default status for new projects
        team: projectMembers.length,
        dueDate: formattedDueDate,
        createdDate: formatDate(now),
        statusColor: getStatusColor("Planning"),
        members: projectMembers,
        tasks: [],
        progressUpdates: [],
        comments: [],
        summary: {
          accomplishment: "",
          decision: "",
          risk: "",
          direction: "",
        },
      };

      await createProject.mutateAsync(project);
      trackCreate('project', '/projects');
      trackFormSubmit('new_project', true);
      
      toast({
        title: "Project created",
        description: `"${project.name}" has been created successfully.`,
      });

      form.reset();
      setSelectedMembers(new Set());
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create project",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              rules={{ 
                required: "Project name is required",
                validate: (value) => value.trim().length > 0 || "Project name cannot be empty"
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter project name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              rules={{ 
                required: "Description is required",
                validate: (value) => value.trim().length > 0 || "Description cannot be empty"
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description *</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Provide details about the project"
                      className="min-h-[100px]"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormItem>
              <FormLabel>Project Members</FormLabel>
              <FormDescription>
                Select organization members to add to this project
              </FormDescription>
              <Popover open={membersOpen} onOpenChange={setMembersOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={membersOpen}
                      className="w-full justify-between"
                    >
                      {selectedMembers.size > 0 ? (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            {Array.from(selectedMembers).slice(0, 3).map((email, idx) => {
                              const member = orgMembers.find(m => m.email.toLowerCase() === email.toLowerCase());
                              const avatar = member 
                                ? `${(member.firstName || '').charAt(0)}${(member.lastName || '').charAt(0)}`.toUpperCase() || email.charAt(0).toUpperCase()
                                : email.charAt(0).toUpperCase();
                              return (
                                <Avatar key={idx} className="h-5 w-5 shrink-0">
                                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                    {avatar}
                                  </AvatarFallback>
                                </Avatar>
                              );
                            })}
                            {selectedMembers.size > 3 && (
                              <span className="text-sm text-muted-foreground">
                                +{selectedMembers.size - 3} more
                              </span>
                            )}
                            {selectedMembers.size <= 3 && selectedMembers.size > 0 && (
                              <span className="text-sm truncate">
                                {getSelectedMemberNames().join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        "Select members..."
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0">
                  <Command>
                    <CommandInput placeholder="Search organization members..." />
                    <CommandList>
                      {isLoadingMembers ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading members...</div>
                      ) : availableMembers.length === 0 ? (
                        <CommandEmpty>No organization members found.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {availableMembers.map((member) => {
                            const isSelected = isMemberSelected(member.email);
                            return (
                              <CommandItem
                                key={member.email}
                                value={member.email}
                                onSelect={() => {
                                  toggleMemberSelection(member.email);
                                }}
                              >
                                <Check
                                  className={`mr-2 h-4 w-4 shrink-0 ${
                                    isSelected ? "opacity-100" : "opacity-0"
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
                            );
                          })}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedMembers.size > 0 && (
                <FormDescription className="mt-2">
                  {selectedMembers.size} member{selectedMembers.size !== 1 ? 's' : ''} selected
                </FormDescription>
              )}
            </FormItem>

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
                    Set a target completion date for the project
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
                {isSubmitting ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

