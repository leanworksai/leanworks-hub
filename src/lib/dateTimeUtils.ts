/**
 * Timezone-aware date and time formatting utilities
 * Uses the user's configured timezone from their profile
 */

/**
 * Format a date/time value to a date string in the user's timezone
 * @param dateValue - Date object, ISO string, timestamp, or date string
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @param options - Intl.DateTimeFormatOptions
 */
export function formatDateInTimezone(
  dateValue: Date | string | number | undefined | null,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  if (!dateValue) return 'N/A';
  
  let date: Date;
  
  if (dateValue instanceof Date) {
    date = dateValue;
  } else if (typeof dateValue === 'string') {
    // Handle YYYY-MM-DD format (date-only strings)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      // Parse as date-only in the target timezone
      const [year, month, day] = dateValue.split('-').map(Number);
      // Create date in UTC first, then convert to target timezone
      const utcDate = new Date(Date.UTC(year, month - 1, day));
      date = utcDate;
    } else {
      date = new Date(dateValue);
    }
  } else if (typeof dateValue === 'number') {
    date = new Date(dateValue);
  } else {
    return 'Invalid date';
  }
  
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }
  
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: timezone,
  }).format(date);
}

/**
 * Format a date/time value to a time string in the user's timezone
 * @param dateValue - Date object, ISO string, timestamp, or date string
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @param options - Intl.DateTimeFormatOptions
 */
export function formatTimeInTimezone(
  dateValue: Date | string | number | undefined | null,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  if (!dateValue) return 'N/A';
  
  let date: Date;
  
  if (dateValue instanceof Date) {
    date = dateValue;
  } else if (typeof dateValue === 'string') {
    date = new Date(dateValue);
  } else if (typeof dateValue === 'number') {
    date = new Date(dateValue);
  } else {
    return 'Invalid time';
  }
  
  if (isNaN(date.getTime())) {
    return 'Invalid time';
  }
  
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: timezone,
  }).format(date);
}

/**
 * Format a date/time value to a combined date and time string in the user's timezone
 * @param dateValue - Date object, ISO string, timestamp, or date string
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @param options - Intl.DateTimeFormatOptions
 */
export function formatDateTimeInTimezone(
  dateValue: Date | string | number | undefined | null,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  if (!dateValue) return 'N/A';
  
  let date: Date;
  
  if (dateValue instanceof Date) {
    date = dateValue;
  } else if (typeof dateValue === 'string') {
    date = new Date(dateValue);
  } else if (typeof dateValue === 'number') {
    date = new Date(dateValue);
  } else {
    return 'Invalid date/time';
  }
  
  if (isNaN(date.getTime())) {
    return 'Invalid date/time';
  }
  
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: timezone,
  }).format(date);
}

/**
 * Format a relative time string (e.g., "2 hours ago", "yesterday")
 * @param dateValue - Date object, ISO string, timestamp, or date string
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 */
export function formatRelativeTime(
  dateValue: Date | string | number | undefined | null,
  timezone: string
): string {
  if (!dateValue) return 'N/A';
  
  let date: Date;
  
  if (dateValue instanceof Date) {
    date = dateValue;
  } else if (typeof dateValue === 'string') {
    date = new Date(dateValue);
  } else if (typeof dateValue === 'number') {
    date = new Date(dateValue);
  } else {
    return 'Invalid date';
  }
  
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return formatDateInTimezone(date, timezone);
  }
}

/**
 * Format a date-only string (YYYY-MM-DD) for display in the user's timezone
 * This handles the case where dates are stored as date-only strings
 * @param dateString - YYYY-MM-DD format string
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 */
export function formatDateStringInTimezone(
  dateString: string | undefined | null,
  timezone: string
): string {
  if (!dateString) return 'No date';
  
  // If already in display format, return as is
  if (!dateString.includes('-') || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  // Parse YYYY-MM-DD and format in target timezone
  const [year, month, day] = dateString.split('-').map(Number);
  // Create date in UTC, then format in target timezone
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  
  return formatDateInTimezone(utcDate, timezone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
