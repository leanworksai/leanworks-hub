import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertCircle, WifiOff, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SaveStatus } from '@/hooks/useAutoSave';

interface DocSaveStatusProps {
  status: SaveStatus;
  lastSavedAt?: Date | null;
  onRetry?: () => void;
  className?: string;
}

export const DocSaveStatus = memo(function DocSaveStatus({ 
  status, 
  lastSavedAt, 
  onRetry,
  className 
}: DocSaveStatusProps) {
  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) {
      return 'just now';
    } else if (minutes < 60) {
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'saving':
        return {
          icon: Loader2,
          text: 'Saving...',
          variant: 'secondary' as const,
          className: 'animate-spin',
        };
      case 'saved':
        return {
          icon: CheckCircle2,
          text: 'Saved',
          variant: 'default' as const,
          className: 'text-green-600',
        };
      case 'error':
        return {
          icon: AlertCircle,
          text: 'Error saving',
          variant: 'destructive' as const,
          className: '',
        };
      case 'offline':
        return {
          icon: WifiOff,
          text: 'Offline - will save when online',
          variant: 'secondary' as const,
          className: '',
        };
      case 'draft':
        return {
          icon: FileText,
          text: 'Draft saved',
          variant: 'outline' as const,
          className: '',
        };
      default:
        return {
          icon: null,
          text: '',
          variant: 'secondary' as const,
          className: '',
        };
    }
  };

  const config = getStatusConfig();

  // Only show status when actively saving, error, or offline
  // Don't show idle, saved, or draft states
  if (status === 'idle' || status === 'saved' || status === 'draft') {
    return null;
  }

  if (!config.text) {
    return null;
  }

  const Icon = config.icon;

  // Custom styling for different statuses
  const getStatusStyles = () => {
    switch (status) {
      case 'saving':
        return 'bg-blue-50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/30 text-blue-700 dark:text-blue-300';
      case 'saved':
        return 'bg-green-50 dark:bg-green-950/20 border-green-200/50 dark:border-green-800/30 text-green-700 dark:text-green-300';
      case 'error':
        return 'bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/30 text-red-700 dark:text-red-300';
      case 'offline':
        return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30 text-amber-700 dark:text-amber-300';
      case 'draft':
        return 'bg-slate-50 dark:bg-slate-900/50 border-slate-200/50 dark:border-slate-700/30 text-slate-600 dark:text-slate-400';
      default:
        return 'bg-secondary border-border text-foreground';
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all duration-200',
        getStatusStyles(),
        status === 'error' && onRetry && 'cursor-pointer hover:opacity-80 hover:scale-[1.02]',
        className
      )}
      onClick={status === 'error' && onRetry ? onRetry : undefined}
    >
      {Icon && (
        <Icon className={cn(
          'h-3.5 w-3.5',
          status === 'saving' && 'animate-spin',
          config.className
        )} />
      )}
      <span className="text-xs font-medium">{config.text}</span>
    </div>
  );
});

