import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  FolderKanban, 
  MessageSquare, 
  BarChart3,
  ArrowRight,
  Brain,
  Phone,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  Mic,
  Video,
  Monitor,
  X,
  Users,
  Calendar,
  Send,
  Paperclip,
  Smile,
  MicOff,
  VideoOff,
  ChevronDown,
  Activity,
  Circle,
  Plus,
  PhoneOff,
  FileText,
  Pin
} from 'lucide-react';

// API base URL - use localhost in development, relative path in production
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

export default function Home() {
  const [isDemoDialogOpen, setIsDemoDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = import.meta.env.DEV ? `${API_BASE}/api/demo-requests` : `${API_BASE}/demo-requests`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to submit demo request');
      }

      setSubmitSuccess(true);
      setTimeout(() => {
        setIsDemoDialogOpen(false);
        setSubmitSuccess(false);
        setFormData({ name: '', email: '', company: '', message: '' });
      }, 2000);
    } catch (error) {
      alert(`Failed to submit. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Navigation */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-2">
              <img 
                src="/logo.png" 
                alt="LeanWorks" 
                className="h-8 w-auto object-contain"
                onError={(e) => {
                  console.error('Failed to load logo:', e);
                }}
              />
              <span className="text-xl font-bold">LeanWorks</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link to="/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link to="/login">
                <Button>Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              All-in-one Project Collaboration Platform
            </span>
          </h1>
          <p className="text-xl sm:text-2xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Project management, messaging, docs, meeting and AI—all in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/login">
              <Button size="lg" className="w-full sm:w-auto">
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="outline" 
              className="w-full sm:w-auto"
              onClick={() => setIsDemoDialogOpen(true)}
            >
              Watch Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Features Introduction */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Brain className="h-4 w-4" />
            <span>Powered by AI</span>
          </div>
          <p className="text-xl text-muted-foreground">
            Our AI answers any question about your projects, helps your team draft tickets, automatically tracks project progress, and proactively follows up with key stakeholders when action is needed.
          </p>
        </div>
      </section>

      {/* Feature 1: Project Management */}
      <section className="py-20 bg-slate-50/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <FolderKanban className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">AI-Assisted Ticket Creation</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Create perfect tickets that follow industry best practices with minimal effort. Simply provide 
                  a title, and our AI automatically generates a comprehensive ticket with detailed descriptions, 
                  proper formatting, and all the essential information your team needs. Our AI intelligently 
                  assigns each ticket to the right person based on their expertise and current workload. 
                  No more struggling with blank forms or wondering what to include—just a title, and you're done.
                </p>
              </div>
              <Card className="order-1 w-full max-w-md mx-auto rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-xl">Tasks</CardTitle>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          2 / 5 completed
                        </span>
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2 mt-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: '40%' }}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border">
                    <div className="flex-shrink-0 pt-0.5">
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">Design System</p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>Assignee: John Doe</span>
                        <span>Due: Tomorrow</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize flex-shrink-0">
                      In Progress
                    </Badge>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border">
                    <div className="flex-shrink-0 pt-0.5">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">User Research</p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>Assignee: Alice Smith</span>
                        <span>Due: Yesterday</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize flex-shrink-0">
                      Completed
                    </Badge>
                  </div>

                   <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border opacity-60">
                    <div className="flex-shrink-0 pt-0.5">
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">API Integration</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize flex-shrink-0">
                      Pending
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 2: Progress Tracking */}
      <section className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <Card className="order-2 lg:order-1 w-full max-w-md mx-auto -rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card overflow-hidden">
                <CardHeader className="pb-2 border-b bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-xl">Project Updates</CardTitle>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="p-4 bg-background/50">
                  <div className="space-y-4">
                    {/* Activity 1: Update */}
                    <div className="border-l-2 pl-4 pb-4 border-primary relative">
                      <div className="flex items-start gap-3 mb-2">
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarFallback className="bg-indigo-100 text-indigo-600 text-xs">JD</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm">John Doe</p>
                              <Badge 
                                className="bg-green-500/10 text-green-700 border-green-500/20 text-[10px] px-1.5 h-5 flex items-center gap-1"
                                variant="outline"
                              >
                                <Activity className="h-3 w-3" />
                                <span>update</span>
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">2h ago</span>
                          </div>
                          <p className="text-sm text-muted-foreground">Completed the initial wireframes for the dashboard.</p>
                        </div>
                      </div>
                    </div>

                    {/* Activity 2: Comment */}
                    <div className="border-l-2 pl-4 pb-4 border-muted-foreground/20 relative">
                      <div className="flex items-start gap-3 mb-2">
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarFallback className="bg-emerald-100 text-emerald-600 text-xs">AS</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm">Alice Smith</p>
                              <Badge 
                                className="bg-blue-500/10 text-blue-700 border-blue-500/20 text-[10px] px-1.5 h-5 flex items-center gap-1"
                                variant="outline"
                              >
                                <MessageSquare className="h-3 w-3" />
                                <span>comment</span>
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">1h ago</span>
                          </div>
                          <p className="text-sm text-muted-foreground">Looks great! Can we add a dark mode toggle to the settings page?</p>
                        </div>
                      </div>
                    </div>

                    {/* Activity 3: Update */}
                    <div className="border-l-2 pl-4 pb-0 border-primary relative">
                      <div className="flex items-start gap-3 mb-2">
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarFallback className="bg-indigo-100 text-indigo-600 text-xs">JD</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm">John Doe</p>
                              <Badge 
                                className="bg-green-500/10 text-green-700 border-green-500/20 text-[10px] px-1.5 h-5 flex items-center gap-1"
                                variant="outline"
                              >
                                <Activity className="h-3 w-3" />
                                <span>update</span>
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">Just now</span>
                          </div>
                          <p className="text-sm text-muted-foreground">Started implementation of the authentication flow.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <div className="order-1 lg:order-2">
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <BarChart3 className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">Your Tasks Are Your Progress</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Every task you create automatically becomes a progress tracker. Our AI continuously captures 
                  updates, changes, and milestones as your team works, then displays them side by side with 
                  your tasks. See exactly what's been completed, what's in progress, and what needs attention—all 
                  in one unified view. No manual updates needed, no switching between views. Your tasks and 
                  their progress, perfectly aligned.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 3: Messaging */}
      <section className="py-20 bg-slate-50/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <MessageSquare className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">Chat With Your Teams, AI, and Everyone Together</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Experience a new way of collaboration where humans and AI work seamlessly together. Chat directly 
                  with your teammates for real-time coordination, consult with Lean—our AI assistant—for instant 
                  insights and recommendations, or bring everyone together in group conversations where AI can 
                  participate, summarize, and facilitate discussions. Whether you need human expertise, AI 
                  analysis, or a blend of both, all your collaboration happens in one unified space.
                </p>
              </div>
              <Card className="w-full max-w-md mx-auto rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card overflow-hidden">
                <div className="bg-background border-b p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="/logo.png" alt="lean" />
                      <AvatarFallback>L</AvatarFallback>
                    </Avatar>
                    <div>
                      <h4 className="font-semibold text-sm">Lean</h4>
                      <span className="text-xs text-muted-foreground">AI Project Manager</span>
                    </div>
                  </div>
                </div>
                <ScrollArea className="h-[300px] bg-background p-4">
                  <div className="space-y-6">
                    {/* User Message */}
                    <div className="flex gap-3 justify-end">
                      <div className="flex flex-col items-end max-w-[80%]">
                        <div className="rounded-lg px-4 py-2 bg-muted border border-border break-words">
                          <p className="text-sm font-medium">What's the status of the Q3 marketing campaign?</p>
                        </div>
                        <span className="text-xs text-muted-foreground mt-1">10:23 AM</span>
                      </div>
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-indigo-100 text-indigo-600">JD</AvatarFallback>
                      </Avatar>
                    </div>

                    {/* Lean Message */}
                    <div className="flex gap-3 justify-start">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src="/logo.png" alt="lean" />
                        <AvatarFallback>L</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col items-start max-w-[85%]">
                        <div className="rounded-lg px-4 py-2 bg-muted border border-border break-words w-full">
                          <p className="text-sm font-medium mb-2">Here is the current status for Q3 Marketing Campaign:</p>
                          <div className="flex flex-wrap gap-2 mb-3">
                             <Badge variant="outline" className="bg-background">
                               Social Media: Completed
                             </Badge>
                             <Badge variant="outline" className="bg-background">
                               Email Drip: In Review
                             </Badge>
                          </div>
                          <p className="text-sm font-medium">Would you like me to draft an update for the team?</p>
                        </div>
                        <span className="text-xs text-muted-foreground mt-1">10:24 AM</span>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
                <div className="p-3 bg-background border-t flex items-center space-x-2">
                  <div className="flex-1 bg-muted rounded-md h-9 px-3 flex items-center text-sm text-muted-foreground">
                    Type a message...
                  </div>
                  <Button size="icon" variant="ghost" className="h-9 w-9">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 4: Voice Calls */}
      <section className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <Card className="order-2 lg:order-1 w-full max-w-md mx-auto -rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-emerald-100 text-emerald-600">AS</AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-base">Alice Smith</CardTitle>
                        <div className="flex items-center gap-2 text-sm text-green-600">
                          <div className="h-2 w-2 rounded-full bg-green-600 animate-pulse" />
                          <span>Call in progress</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">04:23</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg bg-muted/50 p-4 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="h-4 w-4 text-primary" />
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Live Transcription</span>
                    </div>
                    <p className="text-sm font-medium leading-relaxed">
                      "I'll update the roadmap by EOD and share it with the team. Can you check the latest designs?"
                    </p>
                  </div>
                  
                  <div className="rounded-lg bg-muted/50 p-4 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="h-4 w-4 text-primary" />
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AI Summary</span>
                    </div>
                    <ul className="space-y-1">
                       <li className="flex items-start gap-2 text-xs text-muted-foreground">
                         <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1" />
                         <span>Alice to update roadmap by EOD</span>
                       </li>
                       <li className="flex items-start gap-2 text-xs text-muted-foreground">
                         <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1" />
                         <span>Review latest designs</span>
                       </li>
                    </ul>
                  </div>

                  <div className="flex items-center justify-center gap-3 pt-2">
                    <Button variant="outline" size="sm">
                      <Mic className="h-4 w-4 mr-2" />
                      Mute
                    </Button>
                    <Button variant="destructive" size="sm">
                      <PhoneOff className="h-4 w-4 mr-2" />
                      Hang Up
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <div className="order-1 lg:order-2">
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <Phone className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">Your Meetings Are Your Notes</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Every voice call automatically becomes a comprehensive note. Start instant meetings directly 
                  from any conversation and focus on the discussion—our AI seamlessly transcribes everything 
                  in real-time with remarkable accuracy. After your call, the AI instantly generates a clear, 
                  organized summary highlighting key decisions, action items, and important points. No manual 
                  note-taking, no missed details. Just talk, and your meeting notes are ready.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 5: Documentation */}
      <section className="py-20 bg-slate-50/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <FileText className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">Write or Drop Any Document, and AI Helps You Manage Them</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Write a new document or drop any file—PDFs, images, text files, or anything else. Our AI 
                  automatically reads, understands, and organizes everything for you. It sorts your documents 
                  into the right categories, extracts key information, and makes everything searchable. Ask the 
                  AI any question about your documents and get instant answers with references. No manual 
                  organization needed—just drop it, and AI takes care of the rest.
                </p>
              </div>
              <Card className="w-full max-w-md mx-auto rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card overflow-hidden">
                <CardHeader className="pb-2 border-b bg-muted/30">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">My Docs</CardTitle>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4 bg-background/50 space-y-3">
                  {/* Doc 1: Pinned */}
                  <div className="p-3 rounded-lg bg-background border border-border hover:border-primary/50 transition-colors cursor-pointer">
                    <div className="flex items-start gap-2 mb-2">
                      <Pin className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-sm mb-1">Q4 Planning Meeting</h4>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          Discussed roadmap priorities, resource allocation, and key milestones for Q4...
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5">Planning</Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5">Q4</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">2 days ago</span>
                    </div>
                  </div>

                  {/* Doc 2 */}
                  <div className="p-3 rounded-lg bg-background border border-border hover:border-primary/50 transition-colors cursor-pointer">
                    <div className="flex items-start gap-2 mb-2">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-sm mb-1">API Integration Ideas</h4>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          Research docs on potential third-party integrations for the platform...
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5">Research</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">1 week ago</span>
                    </div>
                  </div>

                  {/* Doc 3 */}
                  <div className="p-3 rounded-lg bg-background border border-border hover:border-primary/50 transition-colors cursor-pointer opacity-60">
                    <div className="flex items-start gap-2 mb-2">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-sm mb-1">Design System Updates</h4>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          Docs on component library improvements and accessibility enhancements...
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5">Design</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">2 weeks ago</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Meet Lean Section */}
      <section className="py-20 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center mb-8 mx-auto">
              <Brain className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-6">Meet Lean, Your AI Project Assistant</h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Lean is your intelligent assistant that's always ready to help. Ask Lean any question about 
              your projects, teams, or tasks, and get instant answers. But Lean doesn't just answer 
              questions—it can also help you do work. From drafting task descriptions to analyzing progress 
              to providing recommendations, Lean is your partner in getting things done faster and smarter.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-12 md:p-16 text-center text-white shadow-2xl">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-10">
              Ready to Transform Your Team's Workflow?
            </h2>
            <Link to="/login">
              <Button size="lg" className="bg-white text-slate-900 hover:bg-slate-100 w-full sm:w-auto text-base px-8 py-6 h-auto">
                Start Your Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Contact Form Dialog */}
      <Dialog open={isDemoDialogOpen} onOpenChange={setIsDemoDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Request a Demo</DialogTitle>
            <DialogDescription>
              Fill out the form below and we'll get in touch with you to schedule a personalized demo.
            </DialogDescription>
          </DialogHeader>
          {submitSuccess ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-4">
                <svg
                  className="h-6 w-6 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Thank you!</h3>
              <p className="text-muted-foreground">
                We've received your request and will contact you shortly.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="john@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  required
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  name="company"
                  type="text"
                  placeholder="Acme Inc."
                  value={formData.company}
                  onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  name="message"
                  placeholder="Tell us about your team's needs..."
                  value={formData.message}
                  onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                  rows={4}
                  disabled={isSubmitting}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDemoDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Request'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="border-t bg-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <Link to="/">
                <img 
                  src="/logo.png" 
                  alt="LeanWorks" 
                  className="h-6 w-auto object-contain"
                  onError={(e) => {
                    console.error('Failed to load logo:', e);
                  }}
                />
              </Link>
              <Link to="/">
                <span className="font-semibold">LeanWorks</span>
              </Link>
            </div>
            <div className="flex items-center gap-6">
              <Link to="/team" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Team
              </Link>
              <div className="text-sm text-muted-foreground">
                © {new Date().getFullYear()} LeanWorks. All rights reserved.
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

