import { memo } from 'react';
import { cn } from '@/lib/utils';

interface TitleWithToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  titlePlaceholder?: string;
  readOnly?: boolean;
  toolbar: React.ReactNode | null; // The DocToolbar JSX (nullable)
}

export const TitleWithToolbar = memo(function TitleWithToolbar({
  title,
  onTitleChange,
  titlePlaceholder = 'Untitled',
  readOnly = false,
  toolbar,
}: TitleWithToolbarProps) {
  return (
    <div className="px-2 sm:px-3 pt-0 pb-2 overflow-x-hidden w-full max-w-full border-b border-border/20">
      <div className="flex items-center gap-2 w-full">
        <input
          type="text"
          placeholder={titlePlaceholder}
          value={title || ''}
          onChange={(e) => onTitleChange(e.target.value)}
          readOnly={readOnly}
          className={cn(
            "flex-1 min-w-0 text-2xl sm:text-3xl md:text-4xl font-semibold leading-tight border-none bg-transparent outline-none placeholder:text-muted-foreground/50 break-words focus:placeholder:text-muted-foreground/30 transition-colors",
            readOnly && "cursor-default"
          )}
        />
        {toolbar && (
          <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
            {toolbar}
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if title or toolbar reference changes
  return (
    prevProps.title === nextProps.title &&
    prevProps.onTitleChange === nextProps.onTitleChange &&
    prevProps.titlePlaceholder === nextProps.titlePlaceholder &&
    prevProps.readOnly === nextProps.readOnly &&
    prevProps.toolbar === nextProps.toolbar
  );
});
