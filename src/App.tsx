import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { initFirestore } from "@/services/api";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OrgProvider } from "@/contexts/OrgContext";
import { trackPageView, setNavigationMethod } from "@/lib/analytics";
import { useTimeOnPage } from "@/hooks/useTimeOnPage";
import { WebRTCProvider } from "@/contexts/WebRTCContext";
import { SelectedProjectsProvider } from "@/contexts/SelectedProjectsContext";
import { SelectedTasksProvider } from "@/contexts/SelectedTasksContext";
import { SelectedTeamsProvider } from "@/contexts/SelectedTeamsContext";
import { SelectedDocsProvider } from "@/contexts/SelectedDocsContext";
import { SelectionModeProvider } from "@/contexts/SelectionModeContext";
import { DashboardLayout } from "./components/DashboardLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Chatbot } from "./components/Chatbot";
import { GlobalCallListener } from "./components/GlobalCallListener";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import VerifyEmail from "./pages/VerifyEmail";
import Home from "./pages/Home";
import Team from "./pages/Team";
import Teams from "./pages/Teams";
import TeamDetail from "./pages/TeamDetail";
import Users from "./pages/Users";
import Integrations from "./pages/Integrations";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Docs from "./pages/Docs";
import DocDetail from "./pages/DocDetail";
import Calendar from "./pages/Calendar";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Organizations from "./pages/Organizations";
import Subscription from "./pages/Subscription";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AppRoutesContent = () => {
  const { user } = useAuth();
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  // Track time on page
  useTimeOnPage();

  // Track page views with navigation context
  useEffect(() => {
    const pageName = getPageName(location.pathname);
    
    // Detect navigation method
    // Check if it's a back navigation
    const navigationEntry = (window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming);
    if (navigationEntry?.type === 'back_forward') {
      setNavigationMethod('back');
    } else {
      // Default to 'link' for programmatic navigation
      setNavigationMethod('link');
    }
    
    trackPageView(pageName, location.pathname);
  }, [location.pathname]);

  // Helper function to get page name from path
  const getPageName = (pathname: string): string => {
    // Authentication pages
    if (pathname === '/login') return 'Login';
    if (pathname === '/signup') return 'Signup';
    if (pathname === '/verify-email') return 'Verify Email';
    
    // Main pages
    if (pathname === '/') return 'Home';
    if (pathname === '/team') return 'Team';
    
    // Projects
    if (pathname === '/projects') return 'Projects';
    if (pathname.startsWith('/projects/')) {
      const projectId = pathname.split('/projects/')[1];
      return `Project Detail - ${projectId}`;
    }
    
    // Tasks
    if (pathname === '/tasks') return 'Tasks';
    if (pathname.startsWith('/tasks/')) {
      const taskId = pathname.split('/tasks/')[1];
      return `Task Detail - ${taskId}`;
    }
    
    // Docs
    if (pathname === '/docs') return 'Docs';
    if (pathname.startsWith('/docs/')) {
      const docId = pathname.split('/docs/')[1];
      return `Doc Detail - ${docId}`;
    }
    
    // Calendar
    if (pathname === '/calendar') return 'Calendar';
    
    // Teams (redirected but track for completeness)
    if (pathname === '/teams') return 'Teams';
    if (pathname.startsWith('/teams/')) {
      const teamId = pathname.split('/teams/')[1];
      return `Team Detail - ${teamId}`;
    }
    
    // Settings & Profile
    if (pathname === '/users') return 'Users';
    if (pathname === '/integrations') return 'Integrations';
    if (pathname === '/organizations') return 'Organizations';
    if (pathname === '/profile') return 'Profile';
    if (pathname === '/settings') return 'Settings';
    if (pathname === '/subscription') return 'Subscription';
    
    // 404 page
    return 'Not Found';
  };

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/team" element={<Team />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        {/* Teams page hidden - redirect to home */}
        <Route
          path="/teams"
          element={<Navigate to="/" replace />}
        />
        <Route
          path="/teams/:teamId"
          element={<Navigate to="/" replace />}
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
          path="/docs"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Docs />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/docs/:docId"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <DocDetail />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Calendar />
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
        {/* Subscription page hidden - everyone is on standard tier */}
        {/* <Route
          path="/subscription"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Subscription />
              </DashboardLayout>
            </ProtectedRoute>
          }
        /> */}
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
                      <SelectedDocsProvider>
                      <Toaster />
                      <Sonner />
                      <AppRoutes />
                      </SelectedDocsProvider>
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
