import { format, parse } from "date-fns";

/**
 * Utility functions for date handling in local timezone
 * Can be used directly or through the useDateSelection hook
 */
export const dateUtils = {
  /**
   * Parse date string to Date object in LOCAL timezone
   * Handles both YYYY-MM-DD (from server) and MMM d, yyyy (display format)
   */
  parseDateString: (dateString: string | undefined): Date | undefined => {
    if (!dateString) return undefined;
    try {
      // First try YYYY-MM-DD format (from server)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        // Parse as local date at midnight to avoid timezone issues
        // Using Date constructor with year, month, day creates date in LOCAL timezone
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
      }
      // Then try MMM d, yyyy format (display format)
      const parsed = parse(dateString, "MMM d, yyyy", new Date());
      // Normalize to midnight local time to ensure consistency
      if (parsed) {
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
      }
      return parsed;
    } catch {
      return undefined;
    }
  },

  /**
   * Format Date object to date string for display (uses LOCAL timezone)
   */
  formatDateString: (date: Date): string => {
    // Ensure we're using local date components to avoid timezone shifts
    const localDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    // date-fns format uses local timezone by default
    return format(localDate, "MMM d, yyyy");
  },

  /**
   * Format Date object to YYYY-MM-DD for server (uses LOCAL timezone)
   * This ensures the date shown to the user is the date saved to the server
   */
  formatDateForServer: (date: Date): string => {
    // Use local timezone methods (not UTC) to ensure consistency
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Handle date selection from calendar component
   * react-day-picker creates dates in local timezone when user clicks,
   * but we need to handle cases where dates might be in UTC
   */
  handleDateSelection: (date: Date): string => {
    // When user clicks on a date in the calendar, react-day-picker typically
    // creates it using new Date(year, month, day) which is in local timezone.
    // However, if the date was previously set from a string like "2024-12-24",
    // it might be in UTC.
    //
    // Strategy: Check if UTC and local date components differ.
    // If they differ, it means the date is in UTC (from string parsing),
    // so we should use UTC components to get the intended date.
    // Otherwise, use local components.
    
    const utcYear = date.getUTCFullYear();
    const utcMonth = date.getUTCMonth();
    const utcDay = date.getUTCDate();
    const localYear = date.getFullYear();
    const localMonth = date.getMonth();
    const localDay = date.getDate();
    
    // If UTC and local differ, the date is in UTC (from string like "2024-12-24")
    // In this case, UTC components represent the intended date
    const dateDiffers = utcYear !== localYear || utcMonth !== localMonth || utcDay !== localDay;
    
    let year: number;
    let month: number;
    let day: number;
    
    if (dateDiffers) {
      // Date is in UTC (from string parsing), use UTC components
      year = utcYear;
      month = utcMonth;
      day = utcDay;
    } else {
      // Date is in local timezone (from user click), use local components
      year = localYear;
      month = localMonth;
      day = localDay;
    }
    
    // Create a new date in local timezone at midnight using the extracted components
    // This ensures the selected date is preserved
    const localDate = new Date(year, month, day, 0, 0, 0, 0);
    
    // Return in YYYY-MM-DD format for server (uses local timezone)
    return dateUtils.formatDateForServer(localDate);
  },

  /**
   * Format date string for display
   * Converts YYYY-MM-DD to MMM d, yyyy format
   * IMPORTANT: Extracts date components directly from string to avoid timezone issues
   */
  formatDateForDisplay: (dateString: string | undefined): string => {
    if (!dateString) return 'No due date';
    
    // If already in display format, return as is
    if (!dateString.includes('-') || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return dateString;
    }
    
    // Extract date components directly from string to avoid timezone conversion
    // When you parse "2024-12-24" as a Date, JS interprets it as UTC midnight
    // which can shift the date when converted to local timezone
    const [year, month, day] = dateString.split('-').map(Number);
    
    // Create date in local timezone using the extracted components
    // This ensures "2024-12-24" stays as December 24th, not December 23rd
    const localDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    
    return dateUtils.formatDateString(localDate);
  },
};

/**
 * Hook for date selection functionality
 * Provides utilities and handlers for date selection components
 */
export function useDateSelection() {
  return {
    // Utility functions
    parseDateString: dateUtils.parseDateString,
    formatDateString: dateUtils.formatDateString,
    formatDateForServer: dateUtils.formatDateForServer,
    formatDateForDisplay: dateUtils.formatDateForDisplay,
    
    // Handler for calendar date selection
    handleDateSelection: (date: Date | undefined, onSave: (dateString: string) => void) => {
      if (!date) return;
      const serverFormat = dateUtils.handleDateSelection(date);
      onSave(serverFormat);
    },
  };
}

