import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { User } from "@/hooks/useUsers";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get user display name from firstName and lastName
 */
export function getUserDisplayName(user: User | undefined): string {
  if (!user) return "";
  const firstName = user.firstName || "";
  const lastName = user.lastName || "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || user.email || "";
}

/**
 * Get user avatar initials from firstName and lastName
 */
export function getUserInitials(user: User | undefined): string {
  if (!user) return "U";
  const firstName = user.firstName || "";
  const lastName = user.lastName || "";
  if (firstName && lastName) {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }
  if (firstName) {
    return firstName.charAt(0).toUpperCase();
  }
  if (user.email) {
    return user.email.charAt(0).toUpperCase();
  }
  return "U";
}

/**
 * Find user by email (assigneeId) from users list
 */
export function getUserById(users: User[], assigneeId?: string): User | undefined {
  if (!assigneeId) return undefined;
  return users.find(user => user.email.toLowerCase() === assigneeId.toLowerCase());
}

/**
 * Get user display name from email address
 * Looks up user in the users list and returns display name, or falls back to email
 * 
 * Note: For better performance in components with many lookups, consider creating
 * a memoized user map and using it directly instead of calling this function repeatedly.
 */
export function getUserDisplayNameFromEmail(users: User[], email?: string | null): string {
  if (!email) return "";
  const user = getUserById(users, email);
  if (user) {
    return getUserDisplayName(user);
  }
  return email;
}

/**
 * Get user initials from email address
 * Looks up user in the users list and returns initials, or generates from email
 * 
 * Note: For better performance in components with many lookups, consider creating
 * a memoized user map and using it directly instead of calling this function repeatedly.
 */
export function getUserInitialsFromEmail(users: User[], email?: string | null): string {
  if (!email) return "?";
  const user = getUserById(users, email);
  if (user) {
    return getUserInitials(user);
  }
  // Fallback: use first two characters of email
  return email.substring(0, 2).toUpperCase();
}

/**
 * User map entry structure for efficient lookups
 */
export interface UserMapEntry {
  displayName: string;
  initials: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
}

/**
 * Create a memoized user map for efficient lookups
 * Use this in components that need to look up many users
 * 
 * @example
 * const userMap = useMemo(() => createUserMap(users), [users]);
 * const displayName = userMap.get(email.toLowerCase())?.displayName || email;
 */
export function createUserMap(users: User[]): Map<string, UserMapEntry> {
  const map = new Map<string, UserMapEntry>();
  users.forEach(user => {
    if (user.email) {
      const emailLower = user.email.toLowerCase();
      const displayName = getUserDisplayName(user);
      const initials = getUserInitials(user);
      map.set(emailLower, {
        displayName,
        initials,
        email: user.email,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        jobTitle: user.jobTitle,
      });
    }
  });
  return map;
}

/**
 * Get avatar color class based on user identifier
 * Returns consistent colors for the same user
 */
export function getAvatarColor(identifier?: string | null): string {
  if (!identifier) {
    return "bg-primary text-primary-foreground";
  }

  // Create a simple hash from the identifier
  let hash = 0;
  const str = identifier.toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Use absolute value and modulo to get a consistent index
  const colorIndex = Math.abs(hash) % 8;

  // Color palette - using vibrant but not too bright colors
  const colors = [
    "bg-blue-500 text-white",
    "bg-green-500 text-white",
    "bg-purple-500 text-white",
    "bg-pink-500 text-white",
    "bg-orange-500 text-white",
    "bg-teal-500 text-white",
    "bg-indigo-500 text-white",
    "bg-red-500 text-white",
  ];

  return colors[colorIndex];
}

/**
 * @deprecated Use org-based Firestore paths instead of domain-based paths.
 * Organization ID is available via getCurrentOrgId() from services/api.ts
 * 
 * This function was used for legacy domain-based Firestore paths (domains/{sanitized-domain}/)
 * The new approach uses org-based paths (orgs/{orgId}/)
 */
export function sanitizeDomainForFirestore(email: string): string {
  console.warn('sanitizeDomainForFirestore is deprecated. Use org-based paths with getCurrentOrgId() instead.');
  const domain = email.split('@')[1];
  if (!domain) {
    throw new Error(`Invalid email format: ${email}`);
  }
  // Remove all special characters (dots, hyphens, etc.) to match backend
  const sanitized = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sanitized;
}
