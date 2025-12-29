export interface Event {
  id: string;
  title: string;
  description?: string;
  startDate: string; // ISO date string (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:mm:ss)
  endDate: string; // ISO date string (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:mm:ss)
  allDay: boolean; // If true, event is all-day (no time component)
  location?: string;
  attendees?: string[]; // Array of user emails
  createdBy?: string; // Email of the user who created the event
  visibility?: 'all_members' | 'specific_members';
  visibleToMembers?: string[]; // Array of member emails who can view this event
  createdAt?: number; // Timestamp in milliseconds
  updatedAt?: string; // ISO timestamp
}

