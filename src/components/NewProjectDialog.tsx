import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCreateProject } from "@/hooks/useProjects";
import { useTeams, useTeam } from "@/hooks/useTeams";
import { teamsService } from "@/services/firestore";
import type { Project, ProjectMember } from "@/data/projectsData";
import type { Team, TeamMember } from "@/data/teamsData";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, Users } from "lucide-react";

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

interface TeamMemberSelectorProps {
  team: Team;
  selectedMembers: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  expanded: boolean;
  onToggleExpand: (expanded: boolean) => void;
}

function TeamMemberSelector({ 
  team, 
  selectedMembers, 
  onSelectionChange, 
  expanded, 
  onToggleExpand 
}: TeamMemberSelectorProps) {
  const { data: teamDetail, isLoading } = useTeam(team.name);

  const handleMemberToggle = (memberKey: string, checked: boolean) => {
    const newSelected = new Set(selectedMembers);
    if (checked) {
      newSelected.add(memberKey);
    } else {
      newSelected.delete(memberKey);
    }
    onSelectionChange(newSelected);
  };

  const teamSelectedCount = teamDetail?.members?.filter(member => 
    selectedMembers.has(`${team.name}:${member.name}`)
  ).length || 0;

  return (
    <Collapsible open={expanded} onOpenChange={onToggleExpand}>
      <CollapsibleTrigger className="flex w-full items-center justify-between p-2 hover:bg-accent rounded-md transition-colors">
        <div className="flex items-center gap-2">
          <ChevronDown 
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} 
          />
          <Users className="h-4 w-4" />
          <span className="font-medium">{team.name}</span>
          <span className="text-sm text-muted-foreground">
            ({teamDetail?.members?.length || 0} members)
          </span>
          {teamSelectedCount > 0 && (
            <span className="text-sm text-primary font-medium">
              ({teamSelectedCount} selected)
            </span>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pl-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading members...</p>
        ) : teamDetail?.members && teamDetail.members.length > 0 ? (
          <div className="space-y-2">
            {teamDetail.members.map((member) => {
              const memberKey = `${team.name}:${member.name}`;
              const isSelected = selectedMembers.has(memberKey);
              return (
                <div key={memberKey} className="flex items-center gap-2 py-1">
                  <Checkbox
                    id={memberKey}
                    checked={isSelected}
                    onCheckedChange={(checked) => 
                      handleMemberToggle(memberKey, checked === true)
                    }
                  />
                  <label
                    htmlFor={memberKey}
                    className="flex-1 text-sm cursor-pointer flex items-center gap-2"
                  >
                    <span className="font-medium">{member.name}</span>
                    <span className="text-muted-foreground">- {member.role}</span>
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No members in this team</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
  const { toast } = useToast();
  const createProject = useCreateProject();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const { data: teams = [] } = useTeams();
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

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

  // Reset selected members when dialog opens/closes
  useEffect(() => {
    if (open) {
      setSelectedMembers(new Set());
      setExpandedTeams(new Set());
    }
  }, [open]);

  // Convert TeamMember to ProjectMember
  const convertToProjectMember = (teamMember: TeamMember, teamName: string, index: number): ProjectMember => {
    return {
      id: `${teamName}-${teamMember.name}-${index}`,
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
      teamsService.getById(team.name).catch(error => {
        console.error(`Failed to fetch team ${team.name}:`, error);
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

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
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
              rules={{ required: "Project name is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name</FormLabel>
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
              rules={{ required: "Description is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
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
              <div className="mt-2 space-y-2 max-h-[300px] overflow-y-auto border rounded-md p-4">
                {teams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No teams available</p>
                ) : (
                  teams.map((team) => (
                    <TeamMemberSelector
                      key={team.name}
                      team={team}
                      selectedMembers={selectedMembers}
                      onSelectionChange={setSelectedMembers}
                      expanded={expandedTeams.has(team.name)}
                      onToggleExpand={(expanded) => {
                        const newExpanded = new Set(expandedTeams);
                        if (expanded) {
                          newExpanded.add(team.name);
                        } else {
                          newExpanded.delete(team.name);
                        }
                        setExpandedTeams(newExpanded);
                      }}
                    />
                  ))
                )}
              </div>
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
                    Optional: Set a target completion date for the project.
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

