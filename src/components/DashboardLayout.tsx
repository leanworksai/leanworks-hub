import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Bell, Search, Moon, Sun, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { selectedProjects, clearSelection: clearProjects } = useSelectedProjects();
  const { selectedTasks, clearSelection: clearTasks } = useSelectedTasks();
  const { selectedTeams, clearSelection: clearTeams } = useSelectedTeams();

  useEffect(() => {
    setMounted(true);
  }, []);

  const totalSelections = selectedProjects.length + selectedTasks.length + selectedTeams.length;

  const handleClearAllSelections = () => {
    clearProjects();
    clearTasks();
    clearTeams();
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-lg">
            <div className="flex h-16 items-center gap-4 px-6">
              <SidebarTrigger className="-ml-2" />
              <div className="flex-1 flex items-center gap-4">
                <div className="relative w-full max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search projects, teams..."
                    className="pl-9 bg-secondary/50 border-border"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                {totalSelections > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllSelections}
                    className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Clear All ({totalSelections})
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label="Toggle theme"
                >
                  {mounted && theme === "dark" ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5" />
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
                </Button>
                <Avatar>
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    JD
                  </AvatarFallback>
                </Avatar>
              </div>
            </div>
          </header>
          <main className="flex-1 p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
