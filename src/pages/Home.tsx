import { useState, useEffect, useRef } from 'react';
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
  
  // AI-Assisted Ticket Creation animation states
  const [ticketDemoState, setTicketDemoState] = useState<'typing' | 'generating' | 'complete'>('typing');
  const [typedTitle, setTypedTitle] = useState('');
  const [generatingProgress, setGeneratingProgress] = useState(0);

  // Progress Tracking animation states
  const [progressDemoState, setProgressDemoState] = useState<'initial' | 'generating-updates' | 'complete'>('initial');
  const [visibleUpdates, setVisibleUpdates] = useState<Array<{id: number, type: 'update' | 'comment', user: string, message: string, time: string, task: string}>>([]);

  // Group Chat animation states
  const [chatDemoState, setChatDemoState] = useState<'initial' | 'chatting' | 'ai-helping' | 'complete'>('initial');
  const [chatMessages, setChatMessages] = useState<Array<{id: number, sender: string, message: string, time: string, isAI: boolean, isSummary?: boolean}>>([]);
  const [showThinking, setShowThinking] = useState(false);

  // Document/Notes demo states
  const [docDemoState, setDocDemoState] = useState<'initial' | 'adding-notes' | 'asking-ai' | 'ai-analyzing' | 'complete'>('initial');
  const [availableNotes, setAvailableNotes] = useState<Array<{id: number, title: string, content: string}>>([
    { id: 1, title: 'User Feedback - Week 1', content: 'Users want faster load times. Mobile app crashes on iOS 15. Request for dark mode.' },
    { id: 2, title: 'User Feedback - Week 2', content: 'More crashes reported on iOS 15. Performance issues on Android. Dark mode highly requested.' },
    { id: 3, title: 'User Feedback - Week 3', content: 'iOS 15 compatibility critical. Dark mode still top request. Performance complaints increasing.' },
  ]);
  const [notesInContext, setNotesInContext] = useState<Array<{id: number, title: string, content: string}>>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState<{patterns: string[], visible: boolean}>({patterns: [], visible: false});

  // Animation sequence for AI-Assisted Ticket Creation demo
  useEffect(() => {
    let typingTimeout: NodeJS.Timeout;
    let generatingInterval: NodeJS.Timeout;
    
    const fullTitle = "Implement user authentication flow";
    
    if (ticketDemoState === 'typing') {
      // Simulate typing
      let currentIndex = 0;
      const typingInterval = setInterval(() => {
        if (currentIndex < fullTitle.length) {
          setTypedTitle(fullTitle.slice(0, currentIndex + 1));
          currentIndex++;
        } else {
          clearInterval(typingInterval);
          setTimeout(() => {
            setTicketDemoState('generating');
            setGeneratingProgress(0);
          }, 1000);
        }
      }, 80);
      
      return () => clearInterval(typingInterval);
    } else if (ticketDemoState === 'generating') {
      // Simulate AI generation progress
      generatingInterval = setInterval(() => {
        setGeneratingProgress((prev) => {
          if (prev >= 100) {
            clearInterval(generatingInterval);
            setTimeout(() => {
              setTicketDemoState('complete');
            }, 500);
            return 100;
          }
          return prev + 2;
        });
      }, 50);
      
      return () => clearInterval(generatingInterval);
    } else if (ticketDemoState === 'complete') {
      // Reset after showing complete state for 5 seconds
      typingTimeout = setTimeout(() => {
        setTicketDemoState('typing');
        setTypedTitle('');
        setGeneratingProgress(0);
      }, 5000);
      
      return () => clearTimeout(typingTimeout);
    }
  }, [ticketDemoState]);

  // Animation sequence for Progress Tracking demo
  useEffect(() => {
    let resetTimeout: NodeJS.Timeout;

    if (progressDemoState === 'initial') {
      // Start with initial state, then move to generating updates
      const timeout = setTimeout(() => {
        setProgressDemoState('generating-updates');
      }, 1000);
      return () => clearTimeout(timeout);
    } else if (progressDemoState === 'generating-updates') {
      // Show progress updates being generated automatically
      const updates = [
        { id: 1, type: 'update' as const, user: 'John Doe', message: 'Completed the initial wireframes for the dashboard.', time: '2h ago', task: 'Design System' },
        { id: 2, type: 'comment' as const, user: 'Alice Smith', message: 'Looks great! Can we add a dark mode toggle?', time: '1h ago', task: 'Design System' },
        { id: 3, type: 'update' as const, user: 'John Doe', message: 'Started implementation of the authentication flow.', time: 'Just now', task: 'API Integration' },
        { id: 4, type: 'update' as const, user: 'Alice Smith', message: 'Finished user interviews and compiled insights.', time: '30m ago', task: 'User Research' },
      ];

      // Show updates one by one with delays
      updates.forEach((update, index) => {
        setTimeout(() => {
          setVisibleUpdates((prev) => [...prev, update]);
          if (index === updates.length - 1) {
            setTimeout(() => {
              setProgressDemoState('complete');
            }, 2000);
          }
        }, index * 1800);
      });

      return () => {};
    } else if (progressDemoState === 'complete') {
      // Reset after showing complete state for 6 seconds
      resetTimeout = setTimeout(() => {
        setProgressDemoState('initial');
        setVisibleUpdates([]);
      }, 6000);

      return () => clearTimeout(resetTimeout);
    }
  }, [progressDemoState]);

  // Animation sequence for Group Chat demo
  useEffect(() => {
    let resetTimeout: NodeJS.Timeout;

    if (chatDemoState === 'initial') {
      // Start with initial state, then move to chatting
      const timeout = setTimeout(() => {
        setChatDemoState('chatting');
      }, 1000);
      return () => clearTimeout(timeout);
    } else if (chatDemoState === 'chatting') {
      // Show team members chatting
      const messages = [
        { id: 1, sender: 'John Doe', message: 'Hey team, we need to decide on the Q3 marketing strategy. Any thoughts?', time: '10:15 AM', isAI: false },
        { id: 2, sender: 'Alice Smith', message: 'I think we should focus more on social media this quarter. Our engagement has been great.', time: '10:16 AM', isAI: false },
        { id: 3, sender: 'John Doe', message: 'Good point. What about email campaigns?', time: '10:17 AM', isAI: false },
      ];

      // Show messages one by one
      messages.forEach((message, index) => {
        setTimeout(() => {
          setChatMessages((prev) => [...prev, message]);
          if (index === messages.length - 1) {
            setTimeout(() => {
              setChatDemoState('ai-helping');
            }, 2000);
          }
        }, index * 2000);
      });

      return () => {};
    } else if (chatDemoState === 'ai-helping') {
      // Show thinking indicator first
      setShowThinking(true);
      
      // AI joins to help with summary and insights
      const aiMessages = [
        { id: 4, sender: 'Lean', message: 'Based on your discussion, I can help summarize the key points:', time: '10:18 AM', isAI: true },
        { id: 5, sender: 'Lean', message: '• Social media focus for Q3\n• Email campaigns need discussion\n• Current engagement metrics are positive', time: '10:18 AM', isAI: true, isSummary: true },
        { id: 6, sender: 'Lean', message: 'Would you like me to create a draft strategy document based on this conversation?', time: '10:18 AM', isAI: true },
      ];

      // Show AI messages after a brief delay
      setTimeout(() => {
        setShowThinking(false);
        aiMessages.forEach((message, index) => {
          setTimeout(() => {
            setChatMessages((prev) => [...prev, message]);
            if (index === aiMessages.length - 1) {
              setTimeout(() => {
                setChatDemoState('complete');
              }, 2000);
            }
          }, index * 2000);
        });
      }, 1500);

      return () => {};
    } else if (chatDemoState === 'complete') {
      // Reset after showing complete state for 6 seconds
      resetTimeout = setTimeout(() => {
        setChatDemoState('initial');
        setChatMessages([]);
        setShowThinking(false);
      }, 6000);

      return () => clearTimeout(resetTimeout);
    }
  }, [chatDemoState]);

  // Animation sequence for Document/Notes demo
  useEffect(() => {
    let resetTimeout: NodeJS.Timeout;

    if (docDemoState === 'initial') {
      // Start with initial state, then move to adding notes
      const timeout = setTimeout(() => {
        setDocDemoState('adding-notes');
      }, 1000);
      return () => clearTimeout(timeout);
    } else if (docDemoState === 'adding-notes') {
      // Show notes being added to context one by one
      availableNotes.forEach((note, index) => {
        setTimeout(() => {
          setNotesInContext((prev) => [...prev, note]);
          if (index === availableNotes.length - 1) {
            setTimeout(() => {
              setDocDemoState('asking-ai');
            }, 2000);
          }
        }, index * 2000);
      });

      return () => {};
    } else if (docDemoState === 'asking-ai') {
      // Show user typing question
      const question = "What patterns do you see in these user feedback notes?";
      let currentIndex = 0;
      const typingInterval = setInterval(() => {
        if (currentIndex < question.length) {
          setUserQuestion(question.slice(0, currentIndex + 1));
          currentIndex++;
        } else {
          clearInterval(typingInterval);
          setTimeout(() => {
            setDocDemoState('ai-analyzing');
          }, 1500);
        }
      }, 50);

      return () => clearInterval(typingInterval);
    } else if (docDemoState === 'ai-analyzing') {
      // AI analyzes and finds patterns
      const patterns = [
        'iOS 15 compatibility issues are consistently reported across all weeks',
        'Dark mode is the most frequently requested feature',
        'Performance concerns are increasing over time',
        'Mobile app stability is a recurring theme'
      ];

      // Show patterns appearing one by one
      setTimeout(() => {
        setAiResponse({ patterns: [], visible: true });
        patterns.forEach((pattern, index) => {
          setTimeout(() => {
            setAiResponse((prev) => ({
              ...prev,
              patterns: [...prev.patterns, pattern]
            }));
            if (index === patterns.length - 1) {
              setTimeout(() => {
                setDocDemoState('complete');
              }, 2000);
            }
          }, index * 800);
        });
      }, 1000);

      return () => {};
    } else if (docDemoState === 'complete') {
      // Reset after showing complete state for 6 seconds
      resetTimeout = setTimeout(() => {
        setDocDemoState('initial');
        setNotesInContext([]);
        setUserQuestion('');
        setAiResponse({patterns: [], visible: false});
      }, 6000);

      return () => clearTimeout(resetTimeout);
    }
  }, [docDemoState]);

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
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-xl">Create New Ticket</CardTitle>
                      <div className="flex items-center gap-2">
                        {ticketDemoState === 'generating' && (
                          <span className="text-sm text-primary flex items-center gap-2">
                            <Brain className="h-3 w-3 animate-pulse" />
                            AI is generating...
                          </span>
                        )}
                        {ticketDemoState === 'complete' && (
                          <span className="text-sm text-green-600 flex items-center gap-2">
                            <CheckCircle2 className="h-3 w-3" />
                            Ticket created!
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Typing/Input State */}
                  {(ticketDemoState === 'typing' || ticketDemoState === 'generating') && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="ticket-title" className="text-sm font-medium">
                          Ticket Title
                        </Label>
                        <div className="relative">
                          <Input
                            id="ticket-title"
                            value={typedTitle}
                            readOnly
                            className="pr-8 bg-background"
                            placeholder="Enter ticket title..."
                          />
                          {ticketDemoState === 'typing' && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-pulse">
                              |
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {ticketDemoState === 'generating' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">AI is generating ticket details...</span>
                            <span className="text-primary font-medium">{generatingProgress}%</span>
                          </div>
                          <div className="w-full bg-secondary rounded-full h-2">
                            <div 
                              className="bg-primary h-2 rounded-full transition-all duration-300"
                              style={{ width: `${generatingProgress}%` }}
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                            <Brain className="h-3 w-3 animate-pulse" />
                            <span>Adding description, assignee, and due date...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Complete State - Show Generated Ticket */}
                  {ticketDemoState === 'complete' && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex items-start gap-3 p-4 rounded-lg bg-background border-2 border-primary/20 shadow-sm">
                        <div className="flex-shrink-0 pt-0.5">
                          <Circle className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-sm">Implement user authentication flow</p>
                            <Badge variant="outline" className="text-xs capitalize flex-shrink-0 bg-primary/10 text-primary border-primary/20">
                              New
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Create a secure authentication system with email/password login, password reset functionality, 
                            and session management. Include proper error handling and validation.
                          </p>
                          <div className="flex flex-wrap gap-3 text-xs pt-2 border-t border-border">
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3 text-muted-foreground" />
                              <span className="text-muted-foreground">Assignee:</span>
                              <span className="font-medium">John Doe</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              <span className="text-muted-foreground">Due:</span>
                              <span className="font-medium">In 3 days</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-[10px] px-2 h-5">Backend</Badge>
                            <Badge variant="outline" className="text-[10px] px-2 h-5">Security</Badge>
                            <Badge variant="outline" className="text-[10px] px-2 h-5">High Priority</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center pt-2">
                        <Brain className="h-3 w-3 text-primary" />
                        <span>AI automatically generated all details from the title</span>
                      </div>
                    </div>
                  )}
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
                      <CardTitle className="text-xl">Tasks & Progress</CardTitle>
                      {progressDemoState === 'generating-updates' && (
                        <span className="text-xs text-primary flex items-center gap-1 ml-2">
                          <Brain className="h-3 w-3 animate-pulse" />
                          Auto-tracking
                        </span>
                      )}
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="p-0 bg-background/50">
                  <ScrollArea className="h-[500px] p-4">
                    <div className="space-y-4">
                  {/* Task 1: Design System */}
                  <div className="space-y-2">
                    <div className="flex items-start gap-3 p-2 rounded-lg bg-background border border-border">
                      <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">Design System</p>
                        <p className="text-xs text-muted-foreground">Assignee: John Doe</p>
                      </div>
                      <Badge variant="outline" className="text-xs">In Progress</Badge>
                    </div>
                    {/* Progress updates for Design System */}
                    {visibleUpdates.filter(u => u.task === 'Design System').map((update) => (
                      <div 
                        key={update.id}
                        className="ml-6 border-l-2 pl-3 pb-2 animate-in fade-in slide-in-from-left-4 duration-500 border-primary"
                      >
                        <div className="flex items-start gap-2 mb-1">
                          <Avatar className="h-6 w-6 border border-border">
                            <AvatarFallback className="bg-indigo-100 text-indigo-600 text-[10px]">JD</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-xs">John Doe</p>
                              <Badge 
                                className={`${
                                  update.type === 'update'
                                    ? 'bg-green-500/10 text-green-700 border-green-500/20'
                                    : 'bg-blue-500/10 text-blue-700 border-blue-500/20'
                                } text-[9px] px-1.5 h-4 flex items-center gap-1`}
                                variant="outline"
                              >
                                {update.type === 'update' ? (
                                  <Activity className="h-2.5 w-2.5" />
                                ) : (
                                  <MessageSquare className="h-2.5 w-2.5" />
                                )}
                                <span>{update.type}</span>
                              </Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{update.time}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{update.message}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {visibleUpdates.filter(u => u.task === 'Design System' && u.user === 'Alice Smith').map((update) => (
                      <div 
                        key={update.id}
                        className="ml-6 border-l-2 pl-3 pb-2 animate-in fade-in slide-in-from-left-4 duration-500 border-muted-foreground/20"
                      >
                        <div className="flex items-start gap-2 mb-1">
                          <Avatar className="h-6 w-6 border border-border">
                            <AvatarFallback className="bg-emerald-100 text-emerald-600 text-[10px]">AS</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-xs">Alice Smith</p>
                              <Badge 
                                className="bg-blue-500/10 text-blue-700 border-blue-500/20 text-[9px] px-1.5 h-4 flex items-center gap-1"
                                variant="outline"
                              >
                                <MessageSquare className="h-2.5 w-2.5" />
                                <span>comment</span>
                              </Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{update.time}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{update.message}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Task 2: User Research */}
                  <div className="space-y-2">
                    <div className="flex items-start gap-3 p-2 rounded-lg bg-background border border-border">
                      <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">User Research</p>
                        <p className="text-xs text-muted-foreground">Assignee: Alice Smith</p>
                      </div>
                      <Badge variant="outline" className="text-xs">In Progress</Badge>
                    </div>
                    {/* Progress updates for User Research */}
                    {visibleUpdates.filter(u => u.task === 'User Research').map((update) => (
                      <div 
                        key={update.id}
                        className="ml-6 border-l-2 pl-3 pb-2 animate-in fade-in slide-in-from-left-4 duration-500 border-primary"
                      >
                        <div className="flex items-start gap-2 mb-1">
                          <Avatar className="h-6 w-6 border border-border">
                            <AvatarFallback className="bg-emerald-100 text-emerald-600 text-[10px]">AS</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-xs">Alice Smith</p>
                              <Badge 
                                className="bg-green-500/10 text-green-700 border-green-500/20 text-[9px] px-1.5 h-4 flex items-center gap-1"
                                variant="outline"
                              >
                                <Activity className="h-2.5 w-2.5" />
                                <span>update</span>
                              </Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{update.time}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{update.message}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Task 3: API Integration */}
                  <div className="space-y-2">
                    <div className="flex items-start gap-3 p-2 rounded-lg bg-background border border-border">
                      <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">API Integration</p>
                        <p className="text-xs text-muted-foreground">Assignee: John Doe</p>
                      </div>
                      <Badge variant="outline" className="text-xs">In Progress</Badge>
                    </div>
                    {/* Progress updates for API Integration */}
                    {visibleUpdates.filter(u => u.task === 'API Integration').map((update) => (
                      <div 
                        key={update.id}
                        className="ml-6 border-l-2 pl-3 pb-2 animate-in fade-in slide-in-from-left-4 duration-500 border-primary"
                      >
                        <div className="flex items-start gap-2 mb-1">
                          <Avatar className="h-6 w-6 border border-border">
                            <AvatarFallback className="bg-indigo-100 text-indigo-600 text-[10px]">JD</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-xs">John Doe</p>
                              <Badge 
                                className="bg-green-500/10 text-green-700 border-green-500/20 text-[9px] px-1.5 h-4 flex items-center gap-1"
                                variant="outline"
                              >
                                <Activity className="h-2.5 w-2.5" />
                                <span>update</span>
                              </Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{update.time}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{update.message}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                    </div>
                  </ScrollArea>
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
                    <div className="flex -space-x-2">
                      <Avatar className="h-8 w-8 border-2 border-background">
                        <AvatarFallback className="bg-indigo-100 text-indigo-600 text-xs">JD</AvatarFallback>
                      </Avatar>
                      <Avatar className="h-8 w-8 border-2 border-background">
                        <AvatarFallback className="bg-emerald-100 text-emerald-600 text-xs">AS</AvatarFallback>
                      </Avatar>
                      <Avatar className="h-8 w-8 border-2 border-background">
                        <AvatarImage src="/logo.png" alt="lean" />
                        <AvatarFallback className="bg-primary/10 text-primary">L</AvatarFallback>
                      </Avatar>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm">Team Chat</h4>
                      <span className="text-xs text-muted-foreground">
                        {chatDemoState === 'ai-helping' ? 'AI is helping...' : '3 members'}
                      </span>
                    </div>
                  </div>
                </div>
                <ScrollArea className="h-[400px] bg-background p-4">
                  <div className="space-y-4">
                    {chatMessages.length === 0 && chatDemoState === 'initial' && (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Group conversation will appear here</p>
                      </div>
                    )}
                    
                    {chatMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500 ${
                          msg.isAI ? 'justify-start' : msg.sender === 'John Doe' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {!msg.isAI && msg.sender === 'John Doe' && (
                          <>
                            <div className="flex flex-col items-end max-w-[75%]">
                              <div className="rounded-lg px-4 py-2 bg-primary text-primary-foreground break-words">
                                <p className="text-sm font-medium">{msg.message}</p>
                              </div>
                              <span className="text-xs text-muted-foreground mt-1">{msg.time}</span>
                            </div>
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarFallback className="bg-indigo-100 text-indigo-600 text-xs">JD</AvatarFallback>
                            </Avatar>
                          </>
                        )}
                        
                        {!msg.isAI && msg.sender === 'Alice Smith' && (
                          <>
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarFallback className="bg-emerald-100 text-emerald-600 text-xs">AS</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col items-start max-w-[75%]">
                              <div className="rounded-lg px-4 py-2 bg-muted border border-border break-words">
                                <p className="text-sm font-medium">{msg.message}</p>
                              </div>
                              <span className="text-xs text-muted-foreground mt-1">{msg.time}</span>
                            </div>
                          </>
                        )}

                        {msg.isAI && (
                          <>
                            <Avatar className="h-8 w-8 flex-shrink-0 border-2 border-primary/20">
                              <AvatarImage src="/logo.png" alt="lean" />
                              <AvatarFallback className="bg-primary/10 text-primary">L</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col items-start max-w-[80%]">
                              <div className={`rounded-lg px-4 py-2 break-words w-full ${
                                msg.isSummary 
                                  ? 'bg-primary/5 border-2 border-primary/20' 
                                  : 'bg-muted border border-border'
                              }`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="text-xs font-semibold text-primary">Lean</p>
                                  <Badge variant="outline" className="text-[9px] px-1.5 h-4 bg-primary/10 text-primary border-primary/20">
                                    AI Assistant
                                  </Badge>
                                </div>
                                <p className={`text-sm ${msg.isSummary ? 'font-medium whitespace-pre-line' : ''}`}>
                                  {msg.message}
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground mt-1">{msg.time}</span>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    
                    {showThinking && (
                      <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <Avatar className="h-8 w-8 flex-shrink-0 border-2 border-primary/20">
                          <AvatarImage src="/logo.png" alt="lean" />
                          <AvatarFallback className="bg-primary/10 text-primary">L</AvatarFallback>
                        </Avatar>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Brain className="h-3 w-3 animate-pulse text-primary" />
                          <span>Lean is thinking...</span>
                        </div>
                      </div>
                    )}
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
                    <CardTitle className="text-xl">Notes & AI Analysis</CardTitle>
                    {docDemoState === 'adding-notes' && (
                      <span className="text-xs text-primary flex items-center gap-1">
                        <Plus className="h-3 w-3 animate-pulse" />
                        Adding to context...
                      </span>
                    )}
                    {docDemoState === 'ai-analyzing' && (
                      <span className="text-xs text-primary flex items-center gap-1">
                        <Brain className="h-3 w-3 animate-pulse" />
                        Analyzing...
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 bg-background/50">
                  <ScrollArea className="h-[450px]">
                    <div className="space-y-4">
                      {/* Available Notes Section */}
                      {docDemoState === 'adding-notes' && availableNotes.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <h4 className="text-sm font-semibold">Available Notes</h4>
                            <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                              {availableNotes.length}
                            </Badge>
                          </div>
                          {availableNotes.map((note) => {
                            const isInContext = notesInContext.some(n => n.id === note.id);
                            return (
                              <div
                                key={note.id}
                                className={`p-3 rounded-lg border transition-all duration-500 ${
                                  isInContext 
                                    ? 'bg-primary/5 border-primary/30 opacity-50' 
                                    : 'bg-background border-border'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <FileText className={`h-4 w-4 flex-shrink-0 ${
                                    isInContext ? 'text-primary' : 'text-muted-foreground'
                                  }`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h5 className="font-semibold text-xs">{note.title}</h5>
                                      {isInContext && (
                                        <CheckCircle2 className="h-3 w-3 text-primary flex-shrink-0" />
                                      )}
                                    </div>
                                    {!isInContext && (
                                      <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{note.content}</p>
                                    )}
                                    {isInContext && (
                                      <div className="flex items-center gap-1 mt-1">
                                        <ArrowRight className="h-3 w-3 text-primary" />
                                        <span className="text-[10px] text-primary">Added to context</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Notes in Context Section */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-4 w-4 text-primary" />
                          <h4 className="text-sm font-semibold">Notes in Context</h4>
                          {notesInContext.length > 0 && (
                            <Badge variant="outline" className="text-[10px] px-1.5 h-5 bg-primary/10 text-primary border-primary/20">
                              {notesInContext.length}
                            </Badge>
                          )}
                        </div>
                        
                        {notesInContext.length === 0 && docDemoState === 'initial' && (
                          <div className="text-center py-4 text-xs text-muted-foreground">
                            <FileText className="h-6 w-6 mx-auto mb-2 opacity-50" />
                            <p>Add notes to context to analyze patterns</p>
                          </div>
                        )}

                        {notesInContext.map((note) => (
                          <div
                            key={note.id}
                            className="p-3 rounded-lg bg-primary/5 border-2 border-primary/20 animate-in fade-in slide-in-from-left-4 duration-500"
                          >
                            <h5 className="font-semibold text-xs mb-1">{note.title}</h5>
                            <p className="text-xs text-muted-foreground line-clamp-2">{note.content}</p>
                          </div>
                        ))}
                      </div>

                      {/* User Question Section */}
                      {(docDemoState === 'asking-ai' || docDemoState === 'ai-analyzing' || docDemoState === 'complete') && (
                        <div className="space-y-2 pt-4 border-t border-border">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageSquare className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-semibold">Your Question</h4>
                          </div>
                          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                            <p className="text-sm">
                              {userQuestion}
                              {docDemoState === 'asking-ai' && (
                                <span className="animate-pulse">|</span>
                              )}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* AI Response Section */}
                      {aiResponse.visible && (
                        <div className="space-y-2 pt-4 border-t border-border">
                          <div className="flex items-center gap-2 mb-2">
                            <Brain className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-semibold">AI Pattern Analysis</h4>
                            <Badge variant="outline" className="text-[9px] px-1.5 h-4 bg-primary/10 text-primary border-primary/20">
                              AI
                            </Badge>
                          </div>
                          <div className="p-3 rounded-lg bg-primary/5 border-2 border-primary/20 space-y-2">
                            {aiResponse.patterns.length === 0 && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Brain className="h-3 w-3 animate-pulse text-primary" />
                                <span>Analyzing patterns...</span>
                              </div>
                            )}
                            {aiResponse.patterns.map((pattern, index) => (
                              <div
                                key={index}
                                className="flex items-start gap-2 text-xs animate-in fade-in slide-in-from-left-4 duration-500"
                                style={{ animationDelay: `${index * 0.1}s` }}
                              >
                                <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                                <span className="text-muted-foreground">{pattern}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
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

