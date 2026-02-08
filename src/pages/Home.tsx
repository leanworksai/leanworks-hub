import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { trackHomePageCTA, trackDemoInteraction } from '@/lib/analytics';
import { useSectionVisibility } from '@/hooks/useSectionVisibility';
import { useScrollDepth } from '@/hooks/useScrollDepth';
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
  Pin,
  Bot,
  GanttChart,
  ListTodo,
  FileCode,
  Sparkles,
  LayoutDashboard,
  Cpu
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
  
  // Plans demo states
  const [plansDemoState, setPlansDemoState] = useState<'initial' | 'generating' | 'complete'>('initial');
  const [planProgress, setPlanProgress] = useState(0);

  // AI agents demo states
  const [agentDemoState, setAgentDemoState] = useState<'idle' | 'working' | 'reporting'>('idle');
  
  // Task Creation & Execution demo states
  const [taskDemoState, setTaskDemoState] = useState<'idea' | 'generating' | 'execution'>('idea');
  const [taskInput, setTaskInput] = useState('');
  const [taskGenerationProgress, setTaskGenerationProgress] = useState(0);

  // Progress Tracking animation states
  const [progressDemoState, setProgressDemoState] = useState<'initial' | 'collecting' | 'complete'>('initial');
  const [visibleUpdates, setVisibleUpdates] = useState<Array<{id: number, type: 'human' | 'ai', name: string, role: string, message: string, time: string, status: 'on-track' | 'blocked' | 'completed'}>>([]);

  // Document/Notes demo states
  const [docDemoState, setDocDemoState] = useState<'initial' | 'analyzing' | 'complete'>('initial');
  const [docAnalysisProgress, setDocAnalysisProgress] = useState(0);
  const [notesInContext, setNotesInContext] = useState<Array<{id: number, title: string, content: string}>>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState<{
    patterns: string[], 
    visible: boolean,
    table?: {
      headers: string[],
      rows: string[][]
    }
  }>({patterns: [], visible: false});

  // Section refs for visibility tracking
  const heroSectionRef = useRef<HTMLElement>(null);
  const problemSectionRef = useRef<HTMLElement>(null);
  const feature1Ref = useRef<HTMLElement>(null); // Plans
  const feature2Ref = useRef<HTMLElement>(null); // AI agents
  const feature3Ref = useRef<HTMLElement>(null); // Tasks
  const feature4Ref = useRef<HTMLElement>(null); // Progress
  const feature5Ref = useRef<HTMLElement>(null); // Documents
  const meetLeanRef = useRef<HTMLElement>(null);
  const ctaSectionRef = useRef<HTMLElement>(null);
  const socialProofRef = useRef<HTMLElement>(null);

  // Section refs map for useSectionVisibility hook (memoized to prevent re-renders)
  const sectionRefs = useMemo(() => ({
    hero: heroSectionRef,
    problem: problemSectionRef,
    feature_plans: feature1Ref,
    feature_agents: feature2Ref,
    feature_tasks: feature3Ref,
    feature_progress: feature4Ref,
    feature_documents: feature5Ref,
    meet_lean: meetLeanRef,
    social_proof: socialProofRef,
    cta: ctaSectionRef,
  }), []);

  // Track section visibility
  useSectionVisibility(sectionRefs);

  // Track scroll depth
  useScrollDepth();

  // Animation sequence for Plans demo
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (plansDemoState === 'initial') {
      const timeout = setTimeout(() => {
        setPlansDemoState('generating');
        setPlanProgress(0);
      }, 1000);
      return () => clearTimeout(timeout);
    } else if (plansDemoState === 'generating') {
      interval = setInterval(() => {
        setPlanProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => setPlansDemoState('complete'), 500);
            return 100;
          }
          return prev + 2;
        });
      }, 30);
      return () => clearInterval(interval);
    } else if (plansDemoState === 'complete') {
      const timeout = setTimeout(() => {
        setPlansDemoState('initial');
        setPlanProgress(0);
      }, 6000);
      return () => clearTimeout(timeout);
    }
  }, [plansDemoState]);

  // Animation sequence for AI agents demo
  useEffect(() => {
    const interval = setInterval(() => {
      setAgentDemoState(prev => {
        if (prev === 'idle') return 'working';
        if (prev === 'working') return 'reporting';
        return 'idle';
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Animation sequence for Tasks demo
  useEffect(() => {
    let typingInterval: NodeJS.Timeout;
    let genInterval: NodeJS.Timeout;
    const ideaText = "Build user auth flow";

    if (taskDemoState === 'idea') {
      let idx = 0;
      typingInterval = setInterval(() => {
        if (idx < ideaText.length) {
          setTaskInput(ideaText.slice(0, idx + 1));
          idx++;
        } else {
          clearInterval(typingInterval);
          setTimeout(() => {
            setTaskDemoState('generating');
            setTaskGenerationProgress(0);
          }, 800);
        }
      }, 100);
      return () => clearInterval(typingInterval);
    } else if (taskDemoState === 'generating') {
      genInterval = setInterval(() => {
        setTaskGenerationProgress(prev => {
          if (prev >= 100) {
            clearInterval(genInterval);
            setTimeout(() => setTaskDemoState('execution'), 500);
            return 100;
          }
          return prev + 5;
        });
      }, 50);
      return () => clearInterval(genInterval);
    } else if (taskDemoState === 'execution') {
      const timeout = setTimeout(() => {
        setTaskDemoState('idea');
        setTaskInput('');
        setTaskGenerationProgress(0);
      }, 6000);
      return () => clearTimeout(timeout);
    }
  }, [taskDemoState]);

  // Animation sequence for Progress Tracking demo
  useEffect(() => {
    if (progressDemoState === 'initial') {
      const timeout = setTimeout(() => setProgressDemoState('collecting'), 1000);
      return () => clearTimeout(timeout);
    } else if (progressDemoState === 'collecting') {
      const updates = [
        { id: 1, type: 'human' as const, name: 'Sarah Chen', role: 'Product Manager', message: 'PRD approved by stakeholders', time: '10m ago', status: 'completed' as const },
        { id: 2, type: 'ai' as const, name: 'Code Agent', role: 'Backend Dev', message: 'Implemented auth middleware. 12 tests passed.', time: '5m ago', status: 'on-track' as const },
        { id: 3, type: 'ai' as const, name: 'Test Agent', role: 'QA', message: 'Found regression in login flow. Creating ticket.', time: '2m ago', status: 'blocked' as const },
        { id: 4, type: 'human' as const, name: 'Mike Ross', role: 'Tech Lead', message: 'Reviewing auth architecture changes', time: 'Just now', status: 'on-track' as const },
      ];

      updates.forEach((update, index) => {
        setTimeout(() => {
          setVisibleUpdates(prev => [...prev, update]);
          if (index === updates.length - 1) {
            setTimeout(() => setProgressDemoState('complete'), 2000);
          }
        }, index * 1000);
      });
    } else if (progressDemoState === 'complete') {
      const timeout = setTimeout(() => {
        setProgressDemoState('initial');
        setVisibleUpdates([]);
      }, 6000);
      return () => clearTimeout(timeout);
    }
  }, [progressDemoState]);

  // Animation sequence for Documents demo
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (docDemoState === 'initial') {
      setNotesInContext([]);
      setUserQuestion('');
      setAiResponse({patterns: [], visible: false});
      
      const timeout = setTimeout(() => {
        setDocDemoState('analyzing');
        setNotesInContext([
          { id: 1, title: 'Q3 Sales Data.csv', content: '' },
          { id: 2, title: 'Customer Feedback Logs', content: '' },
          { id: 3, title: 'Product Roadmap 2026', content: '' },
        ]);
        setUserQuestion('Generate a summary table of Q3 performance.');
        setDocAnalysisProgress(0);
      }, 1000);
      return () => clearTimeout(timeout);
    } else if (docDemoState === 'analyzing') {
      interval = setInterval(() => {
        setDocAnalysisProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => setDocDemoState('complete'), 500);
            return 100;
          }
          return prev + 2;
        });
      }, 40);
      return () => clearInterval(interval);
    } else if (docDemoState === 'complete') {
      setAiResponse({
        patterns: ['Analyzing Q3 Sales Data.csv...', 'Filtering departments...', 'Formatting results...'],
        visible: true,
        table: {
          headers: ['Department', 'Growth', 'Revenue'],
          rows: [
            ['SaaS Products', '+24.2%', '$1.2M'],
            ['Cloud Services', '+18.5%', '$850k'],
            ['Enterprise AI', '+32.1%', '$420k']
          ]
        }
      });
      
      const timeout = setTimeout(() => {
        setDocDemoState('initial');
      }, 6000);
      return () => clearTimeout(timeout);
    }
  }, [docDemoState]);

  // Handle demo dialog state changes with tracking
  const handleDemoDialogChange = (open: boolean) => {
    setIsDemoDialogOpen(open);
    if (open) {
      trackDemoInteraction('open');
    } else {
      trackDemoInteraction('close');
    }
  };

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
      trackDemoInteraction('submit');
      setTimeout(() => {
        handleDemoDialogChange(false);
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
                <Button 
                  variant="ghost"
                  onClick={() => trackHomePageCTA('sign_in', 'navigation')}
                >
                  Sign In
                </Button>
              </Link>
              <Link to="/login">
                <Button
                  onClick={() => trackHomePageCTA('get_started', 'navigation')}
                >
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section ref={heroSectionRef} className="container mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              The project OS for human + AI workforce
            </span>
          </h1>
          <p className="text-xl sm:text-2xl text-muted-foreground mb-10 max-w-3xl mx-auto leading-relaxed">
            AI agents scale fast. Humans can’t coordinate them fast enough. LeanWorks fixes the bottleneck.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/login">
              <Button 
                size="lg" 
                className="w-full sm:w-auto"
                onClick={() => trackHomePageCTA('get_started_free', 'hero')}
              >
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="outline" 
              className="w-full sm:w-auto"
              onClick={() => handleDemoDialogChange(true)}
            >
              Watch Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Problem Statement Section */}
      <section ref={problemSectionRef} className="container mx-auto px-4 sm:px-6 lg:px-8 py-16 border-b">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-red-100 text-red-700 text-sm font-medium mb-6">
                <Activity className="h-4 w-4" />
                <span>The Bottleneck</span>
              </div>
              <h2 className="text-3xl font-bold mb-4">Humans Don't Scale Like AI</h2>
              <p className="text-lg text-muted-foreground mb-6">
                One engineer can now spin up dozens of AI agents writing code, running tests, and shipping changes. 
                But humans—PMs, tech leads, stakeholders—still coordinate everything manually.
              </p>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                    <Users className="h-4 w-4" />
                  </div>
                  <span className="text-slate-600">Humans are overwhelmed by updates</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                    <Clock className="h-4 w-4" />
                  </div>
                  <span className="text-slate-600">Coordination slows down execution</span>
                </div>
              </div>
            </div>
            <div className="relative bg-slate-50 rounded-2xl p-8 border border-slate-200">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm">
                <div className="flex flex-col items-center gap-8">
                  {/* Human Coordinator */}
                  <div className="relative z-10">
                    <div className="h-16 w-16 rounded-full bg-white border-2 border-slate-200 shadow-lg flex items-center justify-center">
                      <Users className="h-8 w-8 text-slate-400" />
                    </div>
                    <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full animate-pulse">
                      Overloaded
                    </div>
                  </div>
                  
                  {/* Connections */}
                  <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
                  
                  {/* AI Agents */}
                  <div className="grid grid-cols-5 gap-4 w-full">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex flex-col items-center gap-2">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot className="h-5 w-5 text-primary" />
                        </div>
                        <div className="h-1 w-full bg-green-500 rounded-full animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-sm text-muted-foreground mt-2">
                    Dozens of AI Agents executing in parallel
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-16 text-center">
            <h3 className="text-2xl font-semibold mb-4">The Solution: Meet Lean</h3>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Your AI Technical Program Manager. Lean coordinates your human and AI workforce so you don't have to.
            </p>
          </div>
        </div>
      </section>

      {/* Feature 1: Plans - Lean Plans Your Projects */}
      <section ref={feature1Ref} className="py-20 bg-slate-50/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <GanttChart className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">Lean Plans Your Projects</h2>
                <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                  You set the goals. Lean builds the plan, allocates resources, and manages execution across your human and AI workforce.
                  Get comprehensive project plans with optimal resource allocation, timelines, and budget forecasts in seconds.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Resource allocation for humans & AI agents</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Automated timeline & dependency mapping</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Real-time budget forecasting</span>
                  </li>
                </ul>
              </div>
              <Card className="order-1 w-full max-w-md mx-auto rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card">
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Q3 Platform Scale</CardTitle>
                        <CardDescription className="text-xs">Generated by Lean</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      Optimized
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  {plansDemoState === 'generating' ? (
                    <div className="space-y-4 py-8">
                      <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                        <span>Analyzing resources...</span>
                        <span>{planProgress}%</span>
                      </div>
                      <Progress value={planProgress} className="h-2" />
                      <div className="space-y-2 mt-4">
                        <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                        <div className="h-4 w-1/2 bg-muted rounded animate-pulse" />
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 animate-in fade-in duration-500">
                      {/* Timeline Visualization */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Timeline</span>
                          <span>4 Weeks</span>
                        </div>
                        <div className="space-y-2">
                          {/* Task 1 */}
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarFallback className="bg-blue-100 text-blue-600 text-[10px]">JD</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 h-6 bg-blue-100 rounded-md relative overflow-hidden">
                              <div className="absolute inset-y-0 left-0 bg-blue-500/20 w-3/4" />
                              <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-blue-700">API Design</span>
                            </div>
                          </div>
                          {/* Task 2 */}
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center">
                              <Bot className="h-3 w-3 text-purple-600" />
                            </div>
                            <div className="flex-1 h-6 bg-purple-100 rounded-md relative overflow-hidden ml-8">
                              <div className="absolute inset-y-0 left-0 bg-purple-500/20 w-1/2" />
                              <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-purple-700">Implementation</span>
                            </div>
                          </div>
                          {/* Task 3 */}
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-orange-100 flex items-center justify-center">
                              <Bot className="h-3 w-3 text-orange-600" />
                            </div>
                            <div className="flex-1 h-6 bg-orange-100 rounded-md relative overflow-hidden ml-16">
                              <div className="absolute inset-y-0 left-0 bg-orange-500/20 w-full" />
                              <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-orange-700">Testing</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                        <div className="text-center p-2 bg-slate-50 rounded-lg">
                          <div className="text-xs text-muted-foreground">Budget</div>
                          <div className="font-semibold text-sm text-green-600">$12k</div>
                        </div>
                        <div className="text-center p-2 bg-slate-50 rounded-lg">
                          <div className="text-xs text-muted-foreground">Speed</div>
                          <div className="font-semibold text-sm text-blue-600">2x</div>
                        </div>
                        <div className="text-center p-2 bg-slate-50 rounded-lg">
                          <div className="text-xs text-muted-foreground">Agents</div>
                          <div className="font-semibold text-sm text-purple-600">5</div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 2: AI Agents - Your AI Agent Workforce */}
      <section ref={feature2Ref} className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <Card className="order-2 lg:order-1 w-full max-w-md mx-auto -rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card overflow-hidden">
                <CardHeader className="pb-2 border-b bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-xl">AI Agents</CardTitle>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {agentDemoState === 'idle' ? 'Standby' : 'Active'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 bg-background/50">
                  <div className="space-y-3">
                    {/* Agent 1 */}
                    <div className="flex items-center gap-3 p-3 bg-white rounded-lg border shadow-sm">
                      <div className="relative">
                        <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                          <FileCode className="h-5 w-5 text-purple-600" />
                        </div>
                        <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${agentDemoState !== 'idle' ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">Code Agent</p>
                          <span className="text-[10px] text-muted-foreground">Backend</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={agentDemoState === 'idle' ? 0 : 75} className="h-1.5 flex-1" />
                          <span className="text-[10px] text-muted-foreground">{agentDemoState === 'idle' ? 'Idle' : 'Coding...'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Agent 2 */}
                    <div className="flex items-center gap-3 p-3 bg-white rounded-lg border shadow-sm">
                      <div className="relative">
                        <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center">
                          <CheckCircle2 className="h-5 w-5 text-orange-600" />
                        </div>
                        <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${agentDemoState === 'reporting' ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">Test Agent</p>
                          <span className="text-[10px] text-muted-foreground">QA</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={agentDemoState === 'reporting' ? 90 : 30} className="h-1.5 flex-1" />
                          <span className="text-[10px] text-muted-foreground">{agentDemoState === 'reporting' ? 'Testing...' : 'Waiting'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Agent 3 */}
                    <div className="flex items-center gap-3 p-3 bg-white rounded-lg border shadow-sm">
                      <div className="relative">
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <FileText className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${agentDemoState !== 'idle' ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">Docs Agent</p>
                          <span className="text-[10px] text-muted-foreground">Technical Writer</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={agentDemoState === 'idle' ? 0 : 45} className="h-1.5 flex-1" />
                          <span className="text-[10px] text-muted-foreground">{agentDemoState === 'idle' ? 'Idle' : 'Drafting...'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <div className="order-1 lg:order-2">
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">Your AI Agent Workforce</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Manage AI agents. Assign roles, monitor work, and scale your workforce on demand.
                  Each agent specializes in a specific domain—coding, testing, deployment, or documentation—and works autonomously to execute tasks.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 3: Tasks - AI Helps Create and Execute Tasks */}
      <section ref={feature3Ref} className="py-20 bg-slate-50/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <ListTodo className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">AI Helps Create and Execute Tasks</h2>
                <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                  AI helps you create better tasks and execute them faster—whether you're doing the work or delegating to AI agents.
                  From generating comprehensive task descriptions to autonomous execution, Lean supports the entire lifecycle.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Smart task creation from brief ideas</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>AI Copilot for human tasks</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Autonomous execution by AI agents</span>
                  </li>
                </ul>
              </div>
              <Card className="w-full max-w-md mx-auto rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card overflow-hidden">
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      <CardTitle className="text-xl">Smart Task Assist</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  {/* Task Creation Part */}
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Creation</div>
                    <div className="relative">
                      <Input 
                        value={taskInput}
                        readOnly
                        placeholder="Describe task..."
                        className="pr-8"
                      />
                      {taskDemoState === 'idea' && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary animate-pulse" />
                      )}
                    </div>
                    
                    {taskDemoState === 'generating' && (
                      <div className="space-y-2 animate-in fade-in">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Generating details...</span>
                          <span>{taskGenerationProgress}%</span>
                        </div>
                        <Progress value={taskGenerationProgress} className="h-1.5" />
                      </div>
                    )}
                  </div>

                  {/* Task Execution Part */}
                  {(taskDemoState === 'execution' || taskDemoState === 'generating') && (
                    <div className="space-y-3 pt-4 border-t animate-in slide-in-from-bottom-4 duration-500">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Execution</div>
                      
                      {/* Generated Task Card */}
                      <div className="bg-white rounded-lg border shadow-sm p-3 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium text-sm">Implement User Auth Flow</div>
                            <div className="text-xs text-muted-foreground mt-1">Backend • High Priority</div>
                          </div>
                          <Badge variant="outline" className="text-[10px]">In Progress</Badge>
                        </div>
                        
                        {/* Split Execution View */}
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {/* Human Side */}
                          <div className="bg-slate-50 p-2 rounded border">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Avatar className="h-4 w-4">
                                <AvatarFallback className="text-[8px] bg-blue-100 text-blue-600">JD</AvatarFallback>
                              </Avatar>
                              <span className="text-[10px] font-medium">Human</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              AI suggests auth libraries...
                            </div>
                          </div>
                          
                          {/* AI Agent Side */}
                          <div className="bg-purple-50 p-2 rounded border border-purple-100">
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className="h-4 w-4 rounded-full bg-purple-100 flex items-center justify-center">
                                <Bot className="h-2.5 w-2.5 text-purple-600" />
                              </div>
                              <span className="text-[10px] font-medium text-purple-700">AI Agent</span>
                            </div>
                            <div className="text-[10px] text-purple-600/80">
                              Generating boilerplate...
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 4: Progress Tracking - Lean tracks your workforce */}
      <section ref={feature4Ref} className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <Card className="order-2 lg:order-1 w-full max-w-md mx-auto -rotate-2 hover:rotate-0 transition-transform duration-500 bg-gradient-card border-border shadow-card">
                <CardHeader className="pb-4 border-b bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-xl">Unified Progress</CardTitle>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-green-500" /> Live</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0 bg-background/50">
                  <ScrollArea className="h-[400px] p-4">
                    <div className="space-y-4">
                      {visibleUpdates.map((update) => (
                        <div key={update.id} className="flex items-start gap-3 animate-in fade-in slide-in-from-left-4 duration-500">
                          {update.type === 'human' ? (
                            <Avatar className="h-8 w-8 border border-border mt-1">
                              <AvatarFallback className="bg-blue-100 text-blue-600 text-xs">
                                {update.name.split(' ').map(n => n[0]).join('')}
                              </AvatarFallback>
                            </Avatar>
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-purple-100 border border-purple-200 flex items-center justify-center mt-1">
                              <Bot className="h-4 w-4 text-purple-600" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0 bg-white p-3 rounded-lg border shadow-sm">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{update.name}</span>
                                <Badge variant="secondary" className="text-[10px] h-4 px-1">{update.role}</Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{update.time}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{update.message}</p>
                            <div className="flex items-center gap-2">
                              {update.status === 'completed' && <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">Completed</Badge>}
                              {update.status === 'on-track' && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">On Track</Badge>}
                              {update.status === 'blocked' && <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">Blocked</Badge>}
                            </div>
                          </div>
                        </div>
                      ))}
                      {visibleUpdates.length === 0 && (
                        <div className="text-center py-12 text-muted-foreground">
                          <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
                          <p className="text-sm">Waiting for updates...</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
              <div className="order-1 lg:order-2">
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <BarChart3 className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">Lean tracks your workforce</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Lean tracks progress across everyone—humans and AI agents. One unified view, no status meetings needed.
                  Lean aggregates updates, surfaces blockers, and provides a single source of truth for project status.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 5: Documents - AI Helps You Handle Complex Documents */}
      <section ref={feature5Ref} className="py-24 bg-slate-50/50 overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 mx-auto">
                <FileText className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-4xl sm:text-5xl font-bold mb-6">AI Helps You Handle Complex Documents</h2>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Drowning in technical documents? AI reads, analyzes, and synthesizes complex docs so you don't have to.
                Transform raw data into professional documents through simple conversations.
              </p>
            </div>
              <Card className="w-full max-w-5xl mx-auto border-border shadow-2xl overflow-hidden bg-background">
              <div className="grid grid-cols-1 lg:grid-cols-12 h-[600px]">
                {/* Left Pane: Document Editor */}
                <div className="lg:col-span-7 border-r border-border bg-white flex flex-col">
                  <div className="h-12 border-b flex items-center px-4 bg-muted/20">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <div className="h-3 w-3 rounded-sm bg-blue-500" />
                        <span className="text-xs font-medium">Q3_Analysis_Report.doc</span>
                      </div>
                      <div className="h-4 w-[1px] bg-border" />
                      <div className="flex gap-2">
                        <div className="h-2 w-12 rounded-full bg-muted-foreground/10" />
                        <div className="h-2 w-8 rounded-full bg-muted-foreground/10" />
                        <div className="h-2 w-16 rounded-full bg-muted-foreground/10" />
                      </div>
                    </div>
                  </div>
                  <ScrollArea className="flex-1 p-8 lg:p-12">
                    <div className="max-w-2xl mx-auto space-y-6">
                      {docDemoState === 'initial' && (
                        <div className="space-y-4 opacity-20">
                          <div className="h-8 w-3/4 bg-muted rounded" />
                          <div className="space-y-2">
                            <div className="h-4 w-full bg-muted rounded" />
                            <div className="h-4 w-full bg-muted rounded" />
                            <div className="h-4 w-2/3 bg-muted rounded" />
                          </div>
                        </div>
                      )}

                      {(docDemoState === 'analyzing' || docDemoState === 'complete') && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
                          <h1 className="text-2xl font-bold mb-4">Q3 Department Performance Summary</h1>
                          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                            This report summarizes the high-growth departments for Q3 2025, based on the analyzed 
                            sales data and performance logs. Growth is filtered for departments exceeding 15%.
                          </p>
                          
                          {aiResponse.table ? (
                            <div className="my-8 overflow-hidden rounded-xl border border-border shadow-sm animate-in zoom-in-95 duration-700">
                              <table className="w-full text-sm text-left border-collapse">
                                <thead className="bg-muted/50">
                                  <tr>
                                    {aiResponse.table.headers.map((header, i) => (
                                      <th key={i} className="px-4 py-3 font-semibold border-b text-xs uppercase tracking-wider">{header}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {aiResponse.table.rows.map((row, i) => (
                                    <tr key={i} className="border-b last:border-0">
                                      {row.map((cell, j) => (
                                        <td key={j} className="px-4 py-3 text-sm font-medium">
                                          {j === 1 ? <span className="text-green-600 font-bold">{cell}</span> : cell}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="space-y-4 py-8">
                              <div className="h-4 w-full bg-primary/5 animate-pulse rounded" />
                              <div className="h-4 w-full bg-primary/5 animate-pulse rounded" />
                              <div className="h-32 w-full bg-primary/5 animate-pulse rounded-xl" />
                            </div>
                          )}

                          {docDemoState === 'complete' && (
                            <div className="mt-8 p-4 bg-blue-50/50 rounded-lg border border-blue-100 text-sm text-blue-800 animate-in fade-in duration-500">
                              <p className="font-semibold mb-1">AI Recommendation:</p>
                              Based on the 32.1% growth in Enterprise AI, we recommend allocating 
                              additional server capacity for Q4 to maintain this momentum.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Right Pane: AI Chat */}
                <div className="lg:col-span-5 flex flex-col bg-slate-50">
                  <div className="h-12 border-b flex items-center justify-between px-4 bg-background">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs font-semibold uppercase tracking-wider">AI Assistant</span>
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-4 space-y-4">
                      {/* File Uploads */}
                      {notesInContext.length > 0 && (
                        <div className="flex flex-col items-end space-y-2">
                          {notesInContext.map((note) => (
                            <div
                              key={note.id}
                              className="flex items-center gap-2 max-w-[85%] animate-in slide-in-from-right-4 fade-in duration-500"
                            >
                              <div className="bg-white border border-border rounded-xl p-2 flex items-center gap-3 shadow-sm">
                                <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center">
                                  <FileText className="h-3.5 w-3.5 text-primary" />
                                </div>
                                <span className="text-[10px] font-medium truncate max-w-[120px]">{note.title}</span>
                                <CheckCircle2 className="h-3 w-3 text-primary" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* User Question */}
                      {userQuestion && (
                        <div className="flex justify-end animate-in slide-in-from-right-4 fade-in duration-500">
                          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-none px-4 py-2 text-xs shadow-md max-w-[85%]">
                            {userQuestion}
                          </div>
                        </div>
                      )}

                      {/* AI Response */}
                      {aiResponse.visible && (
                        <div className="flex justify-start animate-in slide-in-from-left-4 fade-in duration-500">
                          <div className="flex items-start gap-2 max-w-[90%]">
                            <Avatar className="h-6 w-6 mt-1 flex-shrink-0 border border-primary/20">
                              <AvatarImage src="/logo.png" />
                              <AvatarFallback className="bg-primary/10 text-primary text-[8px]">L</AvatarFallback>
                            </Avatar>
                            <div className="space-y-2">
                              <div className="bg-white border border-border rounded-2xl rounded-tl-none p-3 shadow-sm">
                                {aiResponse.patterns.length === 0 ? (
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground py-1">
                                    <div className="flex gap-1">
                                      <span className="h-1 w-1 rounded-full bg-primary/40 animate-bounce" />
                                      <span className="h-1 w-1 rounded-full bg-primary/40 animate-bounce [animation-delay:0.2s]" />
                                      <span className="h-1 w-1 rounded-full bg-primary/40 animate-bounce [animation-delay:0.4s]" />
                                    </div>
                                    <span>Processing data...</span>
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {aiResponse.patterns.map((pattern, index) => (
                                      <div
                                        key={index}
                                        className="flex items-start gap-2 text-[10px] animate-in fade-in slide-in-from-left-2 duration-300"
                                      >
                                        <div className="h-1 w-1 rounded-full bg-primary/60 mt-1.5 flex-shrink-0" />
                                        <span className="text-foreground/80 leading-tight">{pattern}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                  <div className="p-4 bg-background border-t">
                    <div className="flex items-center gap-2 p-2 bg-slate-50 border rounded-xl">
                      <div className="flex-1 text-[11px] text-muted-foreground px-2">
                        {docDemoState === 'asking-ai' ? userQuestion : 'Ask AI to analyze data...'}
                      </div>
                      <Button size="icon" className="h-8 w-8 rounded-lg shadow-sm">
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Meet Lean Section */}
      <section ref={meetLeanRef} className="py-20 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center mb-8 mx-auto">
              <Brain className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-6">Meet Lean: Your Personal Technical Program Manager</h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8">
              Lean acts as your Technical Program Manager, handling coordination at scale. It breaks down complex goals into executable plans, 
              assigns work to humans and AI agents, tracks progress, and keeps projects on track. Lean never gets overwhelmed—it scales 
              coordination capacity instantly with your organization.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
              <div className="bg-white/50 p-4 rounded-lg border border-primary/10">
                <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center mb-3">
                  <GanttChart className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Planning</h3>
                <p className="text-sm text-muted-foreground">Creates plans and allocates resources</p>
              </div>
              <div className="bg-white/50 p-4 rounded-lg border border-primary/10">
                <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center mb-3">
                  <Activity className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Tracking</h3>
                <p className="text-sm text-muted-foreground">Monitors progress and surfaces risks</p>
              </div>
              <div className="bg-white/50 p-4 rounded-lg border border-primary/10">
                <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center mb-3">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Communication</h3>
                <p className="text-sm text-muted-foreground">Facilitates human-AI collaboration</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof / Use Case Section */}
      <section ref={socialProofRef} className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Built for organizations scaling with AI</h2>
            <p className="text-lg text-muted-foreground">Stop being the bottleneck. Let Lean coordinate while you focus on building.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <Card className="bg-slate-50 border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Avatar>
                    <AvatarFallback className="bg-blue-100 text-blue-600">ET</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold">Engineering</div>
                    <div className="text-xs text-muted-foreground">Managing 20+ AI Agents</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  "We now manage 20 AI coding agents with 3 people. Lean keeps everyone aligned and ensures we're shipping faster than ever."
                </p>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Avatar>
                    <AvatarFallback className="bg-purple-100 text-purple-600">TL</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold">Tech Leads</div>
                    <div className="text-xs text-muted-foreground">Focusing on Architecture</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  "I used to spend half my day coordinating. Now Lean handles the project management, and I focus on system architecture."
                </p>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Avatar>
                    <AvatarFallback className="bg-orange-100 text-orange-600">PM</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold">Project Managers</div>
                    <div className="text-xs text-muted-foreground">Overseeing Human + AI</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  "Lean gives me a unified view of my humans and AI workforce. No more chasing status updates across different tools."
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section ref={ctaSectionRef} className="container mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-12 md:p-16 text-center text-white shadow-2xl">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6">
              Stop Being the Bottleneck Between Humans and Machines
            </h2>
            <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
              Join the future of project management where humans and AI agents work side by side.
            </p>
            <Link to="/login">
              <Button 
                size="lg" 
                className="bg-white text-slate-900 hover:bg-slate-100 w-full sm:w-auto text-base px-8 py-6 h-auto"
                onClick={() => trackHomePageCTA('start_free_trial', 'bottom_cta')}
              >
                Start Your Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Contact Form Dialog */}
      <Dialog open={isDemoDialogOpen} onOpenChange={handleDemoDialogChange}>
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
                  placeholder="Tell us about your organization's needs..."
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
                  onClick={() => handleDemoDialogChange(false)}
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

