import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { initFirestore } from "@/services/api";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OrgProvider } from "@/contexts/OrgContext";
import { trackPageView } from "@/lib/analytics";
import { WebRTCProvider } from "@/contexts/WebRTCContext";
import { SelectedProjectsProvider } from "@/contexts/SelectedProjectsContext";
import { SelectedTasksProvider } from "@/contexts/SelectedTasksContext";
import { SelectedTeamsProvider } from "@/contexts/SelectedTeamsContext";
import { SelectionModeProvider } from "@/contexts/SelectionModeContext";
import { DashboardLayout } from "./components/DashboardLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Chatbot } from "./components/Chatbot";
import { GlobalCallListener } from "./components/GlobalCallListener";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Home from "./pages/Home";
import Teams from "./pages/Teams";
import TeamDetail from "./pages/TeamDetail";
import Users from "./pages/Users";
import Integrations from "./pages/Integrations";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Notes from "./pages/Notes";
import NoteDetail from "./pages/NoteDetail";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Organizations from "./pages/Organizations";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AppRoutesContent = () => {
  const { user } = useAuth();
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  // Track page views
  useEffect(() => {
    const pageName = getPageName(location.pathname);
    trackPageView(pageName, location.pathname);
  }, [location.pathname]);

  // Helper function to get page name from path
  const getPageName = (pathname: string): string => {
    if (pathname === '/') return 'Home';
    if (pathname === '/login') return 'Login';
    if (pathname === '/signup') return 'Signup';
    if (pathname.startsWith('/projects/')) return 'Project Detail';
    if (pathname === '/projects') return 'Projects';
    if (pathname.startsWith('/tasks/')) return 'Task Detail';
    if (pathname === '/tasks') return 'Tasks';
    if (pathname.startsWith('/notes/')) return 'Note Detail';
    if (pathname === '/notes') return 'Notes';
    if (pathname.startsWith('/teams/')) return 'Team Detail';
    if (pathname === '/teams') return 'Teams';
    if (pathname === '/users') return 'Users';
    if (pathname === '/integrations') return 'Integrations';
    if (pathname === '/organizations') return 'Organizations';
    if (pathname === '/profile') return 'Profile';
    if (pathname === '/settings') return 'Settings';
    return 'Unknown Page';
  };

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/teams"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Teams />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teams/:teamId"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <TeamDetail />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Users />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/integrations"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Integrations />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Projects />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:projectId"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <ProjectDetail />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Tasks />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks/:taskId"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <TaskDetail />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notes"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Notes />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notes/:noteId"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <NoteDetail />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Profile />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Settings />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/organizations"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Organizations />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      {user && !isHomePage && <Chatbot />}
      {user && <GlobalCallListener />}
    </>
  );
};

const AppRoutes = () => {
  return (
    <BrowserRouter>
      <AppRoutesContent />
    </BrowserRouter>
  );
};

const App = () => {
  // Initialize Firestore when app starts
  useEffect(() => {
    try {
      initFirestore();
    } catch (error) {
      console.error('Failed to initialize Firestore:', error);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <OrgProvider>
            <WebRTCProvider>
              <SelectionModeProvider>
                <SelectedProjectsProvider>
                  <SelectedTasksProvider>
                    <SelectedTeamsProvider>
                      <Toaster />
                      <Sonner />
                      <AppRoutes />
                    </SelectedTeamsProvider>
                  </SelectedTasksProvider>
                </SelectedProjectsProvider>
              </SelectionModeProvider>
            </WebRTCProvider>
          </OrgProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
