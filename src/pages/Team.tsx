import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Linkedin, Mail } from 'lucide-react';

export default function Team() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Navigation */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-2">
              <Link to="/">
                <img 
                  src="/logo.png" 
                  alt="LeanWorks" 
                  className="h-8 w-auto object-contain"
                  onError={(e) => {
                    console.error('Failed to load logo:', e);
                  }}
                />
              </Link>
              <Link to="/">
                <span className="text-xl font-bold">LeanWorks</span>
              </Link>
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

      {/* Team Section */}
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="max-w-4xl mx-auto">
          {/* Back Button */}
          <Link to="/">
            <Button variant="ghost" className="mb-8">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Home
            </Button>
          </Link>

          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
              Meet Our Team
            </h1>
          </div>

          {/* Founder Card */}
          <Card className="max-w-2xl mx-auto bg-gradient-card border-border shadow-card overflow-hidden">
            <CardContent className="p-8 sm:p-12">
              <div className="flex flex-col sm:flex-row gap-8 items-start">
                {/* Profile Image */}
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="relative">
                    <img
                      src="/yanfu-zhu.png"
                      alt="Yanfu Zhu"
                      className="w-48 h-48 rounded-full object-cover border-4 border-primary/20 shadow-lg"
                      onError={(e) => {
                        console.error('Failed to load profile image:', e);
                        (e.target as HTMLImageElement).src = '/placeholder.svg';
                      }}
                    />
                  </div>
                </div>

                {/* Founder Info */}
                <div className="flex-1 text-center sm:text-left">
                  <div className="mb-4">
                    <h2 className="text-3xl font-bold mb-4">Yanfu Zhu</h2>
                    <p className="text-muted-foreground leading-relaxed">
                      Yanfu is the visionary behind LeanWorks, dedicated to transforming how teams 
                      collaborate and work together. With 7 years of experience in artificial intelligence 
                      and as a full-stack machine learning engineer, he's building an all-in-one platform 
                      that brings project management, messaging, notes, and meetings into one seamless 
                      experience powered by artificial intelligence.
                    </p>
                  </div>

                  {/* Contact Links */}
                  <div className="flex flex-col sm:flex-row gap-4 justify-center sm:justify-start mt-6">
                    <a
                      href="https://www.linkedin.com/in/yanfu-zhu/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Linkedin className="h-4 w-4" />
                      LinkedIn
                    </a>
                    <a
                      href="mailto:yanfu@leanworks.ai"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                    >
                      <Mail className="h-4 w-4" />
                      Email
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white mt-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <img 
                src="/logo.png" 
                alt="LeanWorks" 
                className="h-6 w-auto object-contain"
                onError={(e) => {
                  console.error('Failed to load logo:', e);
                }}
              />
              <span className="font-semibold">LeanWorks</span>
            </div>
            <div className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} LeanWorks. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
