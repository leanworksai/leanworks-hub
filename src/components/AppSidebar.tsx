import { Users, Puzzle, FolderKanban, CheckSquare, StickyNote, Building2, ChevronDown, Settings, Check } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrg } from "@/contexts/OrgContext";
import { cn } from "@/lib/utils";

const menuItems = [
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Tasks", url: "/tasks", icon: CheckSquare },
  { title: "Docs", url: "/docs", icon: StickyNote },
  { title: "Teams", url: "/teams", icon: Users },
  { title: "Integrations", url: "/integrations", icon: Puzzle },
];

export function AppSidebar() {
  const { open } = useSidebar();
  const { currentOrg, organizations, switchOrg, pendingInvitations: orgInvitations } = useOrg();

  return (
    <Sidebar>
      <SidebarContent>
        <div className="px-3 py-4">
          {/* Organization Switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                className={cn(
                  "flex items-center w-full hover:bg-sidebar-accent transition-all",
                  open ? "h-auto py-2 px-3 justify-start gap-2" : "h-10 justify-center"
                )}
              >
                <Building2 className={cn(
                  "flex-shrink-0 text-sidebar-foreground/70",
                  open ? "h-4 w-4" : "h-5 w-5"
                )} />
            {open && (
                  <>
                    <div className="flex flex-col items-start flex-1 min-w-0 gap-0.5 text-left">
                      <span className="text-sm font-semibold truncate w-full text-sidebar-foreground leading-tight text-left">
                        {currentOrg?.name || 'Select Org'}
                      </span>
                      <span className="text-[10px] text-sidebar-foreground/70 capitalize leading-tight text-left">
                        {currentOrg?.type === 'personal' ? 'Personal' : currentOrg?.role || ''}
              </span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-sidebar-foreground/70 flex-shrink-0 ml-auto" />
                    {orgInvitations.length > 0 && (
                      <Badge variant="destructive" className="h-5 min-w-5 px-1.5 flex items-center justify-center text-xs flex-shrink-0">
                        {orgInvitations.length}
                      </Badge>
                    )}
                  </>
                )}
                {!open && orgInvitations.length > 0 && (
                  <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center text-[10px]">
                    {orgInvitations.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[260px]">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal uppercase tracking-wide">
                Switch Organization
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-[300px] overflow-y-auto">
                {organizations.map(org => (
                  <DropdownMenuItem 
                    key={org.id}
                    onClick={() => switchOrg(org.id)}
                    className={`flex items-center justify-between gap-2 py-2.5 px-3 cursor-pointer ${
                      currentOrg?.id === org.id 
                        ? 'bg-primary/10 border-l-2 border-primary' 
                        : 'hover:bg-accent'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate font-medium ${
                        currentOrg?.id === org.id ? 'text-primary' : ''
                      }`}>
                        {org.name}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {org.type === 'personal' ? 'Personal Workspace' : org.role}
                      </p>
                    </div>
                    {currentOrg?.id === org.id && (
                      <Check className="h-4 w-4 text-primary flex-shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
          </div>
              {orgInvitations.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <NavLink to="/organizations" className="flex items-center gap-2 py-2">
                      <Badge variant="destructive" className="h-5 min-w-5 px-1.5">
                        {orgInvitations.length}
                      </Badge>
                      <span>Pending Invitations</span>
                    </NavLink>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <NavLink to="/organizations" className="flex items-center gap-2 py-2 text-muted-foreground hover:text-foreground">
                  <Settings className="h-4 w-4" />
                  <span>Manage Organizations</span>
                </NavLink>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className={({ isActive }) =>
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : ""
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="px-2 py-1.5 text-xs text-sidebar-foreground/70">
              LeanWorks Hub
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
