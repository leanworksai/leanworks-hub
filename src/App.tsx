import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { initFirestore } from "@/services/api";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OrgProvider } from "@/contexts/OrgContext";
import { trackPageView, setNavigationMethod } from "@/lib/analytics";
import { useTimeOnPage } from "@/hooks/useTimeOnPage";
import { SelectedProjectsProvider } from "@/contexts/SelectedProjectsContext";
import { SelectedTasksProvider } from "@/contexts/SelectedTasksContext";
import { SelectedDocsProvider } from "@/contexts/SelectedDocsContext";
import { SelectionModeProvider } from "@/contexts/SelectionModeContext";
import { PageContextProvider } from "@/contexts/PageContext";
import { SelectedTextContextProvider } from "@/contexts/SelectedTextContext";
import { DashboardLayout } from "./components/DashboardLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AIChat } from "./components/AIChat";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import VerifyEmail from "./pages/VerifyEmail";
import Home from "./pages/Home";
import Users from "./pages/Users";
import Integrations from "./pages/Integrations";
import AIAgentsPage from "./pages/admin/AIAgents";
import AgentDeveloperPortal from "./pages/admin/AgentDeveloperPortal";
import Plans from "./pages/Plans";
import PlanDetail from "./pages/PlanDetail";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import { DocsLayout } from "./components/DocsLayout";
import DocsPlaceholder from "./pages/DocsPlaceholder";
import DocDetail from "./pages/DocDetail";
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
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

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
    
    // Plans
    if (pathname === '/plans') return 'Plans';
    if (pathname.startsWith('/plans/')) {
      const planId = pathname.split('/plans/')[1];
      return `Plan Detail - ${planId}`;
    }
    
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
    
    // Settings & Profile
    if (pathname === '/users') return 'Users';
    if (pathname === '/ai-team') return 'AI Teammates';
    if (pathname === '/ai-team/developer-portal') return 'Agent Developer Portal';
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
      {isDemoMode && (
        <div className="w-full bg-yellow-100 border-b border-yellow-400 px-4 py-2 text-center text-sm font-medium text-yellow-800 sticky top-0 z-50">
          🎭 Demo Mode - No data is saved. Auto-logged in as demo@example.com
        </div>
      )}
      <Routes>
        <Route path="/" element={<Home />} />
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
          path="/ai-team"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <AIAgentsPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai-team/developer-portal"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <AgentDeveloperPortal />
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
          path="/plans"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Plans />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/plans/:id"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <PlanDetail />
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
                <DocsLayout />
              </DashboardLayout>
            </ProtectedRoute>
          }
        >
          <Route index element={<DocsPlaceholder />} />
          <Route path=":docId" element={<DocDetail />} />
        </Route>
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
        <Route
          path="/subscription"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Subscription />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      {user && !isHomePage && <AIChat />}
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
            <PageContextProvider>
                <SelectedTextContextProvider>
                  <SelectionModeProvider>
                    <SelectedProjectsProvider>
                      <SelectedTasksProvider>
                        <SelectedDocsProvider>
                          <Toaster />
                          <Sonner />
                          <AppRoutes />
                        </SelectedDocsProvider>
                      </SelectedTasksProvider>
                    </SelectedProjectsProvider>
                  </SelectionModeProvider>
                </SelectedTextContextProvider>
            </PageContextProvider>
          </OrgProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
