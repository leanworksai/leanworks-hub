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
import { useUserTeams } from "@/hooks/useTeams";
import { useUsers } from "@/hooks/useUsers";
import { useAuth } from "@/contexts/AuthContext";
import { teamsService } from "@/services/api";
import type { Project, ProjectMember } from "@/data/projectsData";
import type { TeamMember } from "@/data/teamsData";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { v4 as uuidv4 } from 'uuid';

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
  const { data: teams = [] } = useUserTeams();
  const { data: users = [] } = useUsers();
  const { user } = useAuth();
  const [membersOpen, setMembersOpen] = useState(false);
  const [allTeamMembers, setAllTeamMembers] = useState<TeamMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [memberToTeamMap, setMemberToTeamMap] = useState<Map<string, string>>(new Map());

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

  // Fetch team details for all user teams to get member emails
  const teamDetailsQueries = useQueries({
    queries: teams.map((team) => ({
      queryKey: ['teams', team.id],
      queryFn: () => teamsService.getById(team.id),
      enabled: !!team.id && !!user?.email && open,
      staleTime: 1000 * 60 * 5,
    })),
  });

  // Extract team details data and loading states
  const isLoadingDetails = teamDetailsQueries.some((query) => query.isLoading);
  const allQueriesCompleted = teamDetailsQueries.length === 0 || teamDetailsQueries.every(
    (query) => !query.isLoading && (query.data !== undefined || query.error !== undefined)
  );
  
  // Create a stable key from team details data for dependency tracking
  const teamDetailsKey = teamDetailsQueries
    .map((query, index) => query.data ? `${teams[index]?.name}-${query.data.members?.length || 0}` : null)
    .filter(Boolean)
    .join('|');

  // Load all team members when dialog opens or teams/team details change
  useEffect(() => {
    if (!open) {
      setAllTeamMembers([]);
      setMemberToTeamMap(new Map());
      setIsLoadingMembers(false);
      return;
    }

    if (teams.length === 0) {
      setAllTeamMembers([]);
      setMemberToTeamMap(new Map());
      setIsLoadingMembers(false);
      return;
    }

    if (users.length === 0) {
      setIsLoadingMembers(true);
      return;
    }

    if (isLoadingDetails || !allQueriesCompleted) {
      setIsLoadingMembers(true);
      return;
    }

    setIsLoadingMembers(true);
    try {
      // Get all team member emails from user's teams
      const teamMemberEmails = new Set<string>();
      const emailToTeamMap = new Map<string, string>();
      
      teamDetailsQueries.forEach((query, index) => {
        if (query.data?.members && teams[index]) {
          query.data.members.forEach(member => {
            if (member.email) {
              teamMemberEmails.add(member.email.toLowerCase());
              emailToTeamMap.set(member.email.toLowerCase(), teams[index].name);
            }
          });
        }
      });
      

      // Filter users to only those in user's teams
      const filteredUsers = users.filter(user => 
        teamMemberEmails.has(user.email.toLowerCase())
      );

      // Convert users to TeamMember format and create member-to-team mapping
      const memberMap = new Map<string, TeamMember>();
      const memberTeamMap = new Map<string, string>();
      
      filteredUsers.forEach(user => {
        const fullName = `${user.firstName} ${user.lastName}`;
        const teamName = emailToTeamMap.get(user.email.toLowerCase());
        
        // Only add members that have a valid team name
        if (teamName && !memberMap.has(fullName)) {
          const avatar = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
          memberMap.set(fullName, {
            name: fullName,
            role: user.jobTitle || "Member",
            email: user.email,
            avatar: avatar,
          });
          memberTeamMap.set(fullName, teamName);
        }
      });
      
      // Also add members directly from team details (in case they're not in users list)
      teamDetailsQueries.forEach((query, index) => {
        if (query.data?.members && teams[index]) {
          const teamName = teams[index].name;
          query.data.members.forEach(member => {
            if (member.name && !memberTeamMap.has(member.name)) {
              // Only add if not already in map
              memberTeamMap.set(member.name, teamName);
              
              // Add to memberMap if not already there
              if (!memberMap.has(member.name)) {
                memberMap.set(member.name, {
                  name: member.name,
                  role: member.role || "Member",
                  email: member.email || '',
                  avatar: member.avatar || getInitials(member.name),
                });
              }
            }
          });
        }
      });

      // Sort by name
      const sortedMembers = Array.from(memberMap.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
      );

      setAllTeamMembers(sortedMembers);
      setMemberToTeamMap(memberTeamMap);
    } catch (error) {
      console.error('Failed to load team members:', error);
      setAllTeamMembers([]);
      setMemberToTeamMap(new Map());
    } finally {
      setIsLoadingMembers(false);
    }
  }, [open, teams.length, users.length, isLoadingDetails, allQueriesCompleted, teamDetailsKey]);

  // Reset selected members when dialog opens/closes
  useEffect(() => {
    if (open) {
      setSelectedMembers(new Set());
      setMembersOpen(false);
      setMemberToTeamMap(new Map());
    }
  }, [open]);

  // Convert TeamMember to ProjectMember
  const convertToProjectMember = (teamMember: TeamMember, teamName: string, index: number): ProjectMember => {
    return {
      id: teamMember.email?.toLowerCase() || `${teamName}-${teamMember.name}-${index}`,
      name: teamMember.name,
      role: teamMember.role,
      avatar: teamMember.avatar,
    };
  };

  // Get all selected members from all teams
  const getSelectedProjectMembers = async (): Promise<ProjectMember[]> => {
    const members: ProjectMember[] = [];
    let memberIndex = 0;

    // Fetch all team details in parallel
    const teamDetailsPromises = teams.map(team => 
      teamsService.getById(team.id).catch(error => {
        console.error(`Failed to fetch team ${team.id}:`, error);
        return null;
      })
    );

    const teamDetails = await Promise.all(teamDetailsPromises);

    // Process all selected members
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const teamDetail = teamDetails[i];
      
      if (teamDetail?.members) {
        for (const teamMember of teamDetail.members) {
          const memberKey = `${team.name}:${teamMember.name}`;
          if (selectedMembers.has(memberKey)) {
            members.push(convertToProjectMember(teamMember, team.name, memberIndex++));
          }
        }
      }
    }

    return members;
  };

  // Toggle member selection
  const toggleMemberSelection = (memberName: string) => {
    const teamName = memberToTeamMap.get(memberName);
    
    // If team name not found, try to find it from allTeamMembers
    if (!teamName) {
      const member = allTeamMembers.find(m => m.name === memberName);
      if (member) {
        // Try to find team name from team details queries
        for (let i = 0; i < teams.length; i++) {
          const teamDetail = teamDetailsQueries[i]?.data;
          if (teamDetail?.members?.some(m => m.name === memberName || m.email === member.email)) {
            const foundTeamName = teams[i]?.name;
            if (foundTeamName) {
              // Update the map for future use
              setMemberToTeamMap(prev => {
                const newMap = new Map(prev);
                newMap.set(memberName, foundTeamName);
                return newMap;
              });
              
              const memberKey = `${foundTeamName}:${memberName}`;
              const newSelected = new Set(selectedMembers);
              if (newSelected.has(memberKey)) {
                newSelected.delete(memberKey);
              } else {
                newSelected.add(memberKey);
              }
              setSelectedMembers(newSelected);
              return;
            }
          }
        }
      }
      
      // If still not found, log error and show toast
      console.error('Member not found in team map:', {
        memberName,
        memberToTeamMapSize: memberToTeamMap.size,
        allTeamMembersCount: allTeamMembers.length,
        memberExists: !!allTeamMembers.find(m => m.name === memberName)
      });
      toast({
        title: "Error",
        description: `Unable to add member "${memberName}". Please try again.`,
        variant: "destructive",
      });
      return;
    }

    const memberKey = `${teamName}:${memberName}`;
    const newSelected = new Set(selectedMembers);
    if (newSelected.has(memberKey)) {
      newSelected.delete(memberKey);
    } else {
      newSelected.add(memberKey);
    }
    setSelectedMembers(newSelected);
  };

  // Check if a member is selected
  const isMemberSelected = (memberName: string): boolean => {
    return Array.from(selectedMembers).some(key => key.endsWith(`:${memberName}`));
  };

  // Get selected member names for display
  const getSelectedMemberNames = (): string[] => {
    return allTeamMembers
      .filter(member => isMemberSelected(member.name))
      .map(member => member.name);
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
      const projectMembers = await getSelectedProjectMembers();

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
                Select team members to add to this project
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
                            {getSelectedMemberNames().slice(0, 3).map((name, idx) => {
                              const member = allTeamMembers.find(m => m.name === name);
                              return (
                                <Avatar key={idx} className="h-5 w-5 shrink-0">
                                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                    {member?.avatar || getInitials(name)}
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
                    <CommandInput placeholder="Search team members..." />
                    <CommandList>
                      {isLoadingMembers ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading members...</div>
                      ) : allTeamMembers.length === 0 ? (
                        <CommandEmpty>No team members found.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {allTeamMembers.map((member) => {
                            const isSelected = isMemberSelected(member.name);
                            return (
                              <CommandItem
                                key={member.name}
                                value={member.name}
                                onSelect={() => {
                                  toggleMemberSelection(member.name);
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

