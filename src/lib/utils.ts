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
