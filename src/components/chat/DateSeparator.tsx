import { Separator } from "@/components/ui/separator";
import { formatDateInTimezone } from "@/lib/dateTimeUtils";

interface DateSeparatorProps {
  date: Date;
  timezone: string;
}

export function DateSeparator({ date, timezone }: DateSeparatorProps) {
  const formatDateLabel = (date: Date, timezone: string): string => {
    const now = new Date();
    
    // Get date strings in the user's timezone
    const todayStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(now);
    
    const messageStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(date);

    // Calculate yesterday in user's timezone
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(yesterdayDate);

    if (messageStr === todayStr) {
      return "Today";
    } else if (messageStr === yesterdayStr) {
      return "Yesterday";
    } else {
      // Format as "Jan 1, 2024" or "Jan 1" if current year
      const currentYear = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
      }).format(now);
      
      const messageYear = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
      }).format(date);
      
      if (messageYear === currentYear) {
        return formatDateInTimezone(date, timezone, {
          month: 'short',
          day: 'numeric',
        });
      } else {
        return formatDateInTimezone(date, timezone, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
    }
  };

  const label = formatDateLabel(date, timezone);

  return (
    <div className="flex items-center gap-3 my-4 w-full">
      <Separator className="flex-1" />
      <span className="text-xs font-medium text-muted-foreground px-3 py-1 bg-background rounded-md whitespace-nowrap">
        {label}
      </span>
      <Separator className="flex-1" />
    </div>
  );
}

