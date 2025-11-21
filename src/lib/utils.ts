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
 * Sanitize domain from email for Firestore paths (remove dots and special characters)
 * Matches the backend getDomainFromEmail function behavior
 */
export function sanitizeDomainForFirestore(email: string): string {
  const domain = email.split('@')[1];
  if (!domain) {
    throw new Error(`Invalid email format: ${email}`);
  }
  // Remove all special characters (dots, hyphens, etc.) to match backend
  const sanitized = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sanitized;
}
