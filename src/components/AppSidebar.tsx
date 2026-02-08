import { Users, Puzzle, FolderKanban, CheckSquare, StickyNote, Building2, ChevronDown, Settings, Check, FolderOpen, X, Target } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
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
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrg } from "@/contexts/OrgContext";
import { useContextDisplay } from "@/hooks/useContextDisplay";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContextBadges } from "@/components/ContextBadges";
import { Badge } from "@/components/ui/badge";
import { trackSidebarNavigation, trackOrgSwitch, trackAIChat, trackContextSelect } from "@/lib/analytics";

const menuItems = [
  { title: "Plans", url: "/plans", icon: Target },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Docs", url: "/docs", icon: StickyNote },
  { title: "AI Teammates", url: "/ai-team", icon: Users },
  { title: "Integrations", url: "/integrations", icon: Puzzle },
];

export function AppSidebar() {
  const { open, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const { currentOrg, organizations, switchOrg } = useOrg();
  // Use the unified context display hook
  const contextDisplay = useContextDisplay();
  const navigate = useNavigate();

  // Close mobile sidebar when a navigation item is clicked
  const handleNavClick = (itemName?: string, url?: string) => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (itemName && url) {
      trackSidebarNavigation(itemName, url);
    }
  };

  // Handle Docs navigation to show catalog (prevent auto-redirect to last opened doc)
  const handleDocsClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Store a flag to indicate explicit navigation to catalog
    sessionStorage.setItem('showDocsCatalog', 'true');
    navigate('/docs');
    handleNavClick('Docs', '/docs');
  };

  const hasAnyContext = contextDisplay.hasAnyContext;

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="px-2 py-2 border-b border-sidebar-border">
        {/* Organization Switcher as Header */}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton 
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground h-10 px-2"
                >
                  <div className="flex flex-1 items-center justify-between min-w-0">
                    <span className={cn(
                      "font-bold text-foreground truncate transition-all duration-200",
                      open ? "text-base" : "text-sm text-primary w-full text-center"
                    )}>
                      {open ? (currentOrg?.name || 'Select Org') : (currentOrg?.name?.substring(0, 2).toUpperCase() || 'LW')}
                    </span>
                    {open && <ChevronDown className="ml-auto size-4 opacity-50 shrink-0" />}
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent 
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg z-[80]"
                align="start"
                side="bottom"
                sideOffset={4}
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal uppercase tracking-wide">
                  Organizations
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-[300px] overflow-y-auto">
                  {organizations.map((org) => (
                    <DropdownMenuItem 
                      key={org.id}
                      onClick={() => {
                        switchOrg(org.id);
                        trackOrgSwitch(org.id, org.name, org.type || 'personal');
                      }}
                      className="flex items-center gap-2 py-2 px-3 cursor-pointer"
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className={cn(
                          "text-sm truncate font-bold",
                          currentOrg?.id === org.id ? "text-primary" : "text-foreground"
                        )}>
                          {org.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {org.type === 'personal' ? 'Personal Workspace' : org.role}
                        </span>
                      </div>
                      {currentOrg?.id === org.id && (
                        <Check className="size-4 text-primary shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <NavLink 
                    to="/organizations" 
                    onClick={() => handleNavClick()}
                    className="flex items-center gap-2 py-2 text-muted-foreground hover:text-foreground"
                  >
                    <Settings className="size-4" />
                    <span className="text-sm">Manage Organizations</span>
                  </NavLink>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <div className="px-2 py-2">
          {/* Organization Switcher removed from here as it's now in header */}
        </div>

        <SidebarGroup className="py-0">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider font-semibold opacity-50 px-2 h-6">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      onClick={(e) => {
                        if (item.title === "Docs") {
                          handleDocsClick(e);
                        } else {
                          handleNavClick(item.title, item.url);
                        }
                      }}
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

      {hasAnyContext && (
        <div className="border-t border-sidebar-border">
          <div className="px-3 py-1.5 border-b border-sidebar-border flex items-center justify-between">
            <span className="text-[10px] font-semibold text-sidebar-foreground/70 uppercase tracking-wider opacity-50">
              Current Context
            </span>
            <Button
              variant="default"
              size="sm"
              className="h-6 px-2 text-[10px] font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              onClick={() => {
                // Close sidebar on mobile
                if (isMobile) {
                  setOpenMobile(false);
                }
                // Track AI chat open from sidebar
                trackAIChat('open', { source: 'sidebar_context' });
                // Dispatch custom event to open chat with AI assistant
                window.dispatchEvent(new CustomEvent('openChatWithAI'));
              }}
            >
              Ask AI
            </Button>
          </div>
          <ScrollArea className="h-[200px]">
            <div className="p-2 space-y-2">
              <ContextBadges
                projects={contextDisplay.selectedProjects}
                tasks={contextDisplay.selectedTasks}
                docs={contextDisplay.selectedDocs}
                onRemoveProject={contextDisplay.onRemoveProject}
                onRemoveTask={contextDisplay.onRemoveTask}
                onRemoveDoc={contextDisplay.onRemoveDoc}
                variant="sidebar"
                implicitContext={contextDisplay.implicitContextString}
                onRemoveImplicitContext={contextDisplay.onRemoveImplicitContext}
                selectedText={contextDisplay.selectedText}
                onRemoveSelectedText={contextDisplay.onRemoveSelectedText}
              />
            </div>
          </ScrollArea>
        </div>
      )}

      <SidebarFooter>
      </SidebarFooter>
    </Sidebar>
  );
}
