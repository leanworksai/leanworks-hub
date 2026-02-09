import React from 'react';
import { Share2, Mail, Trash2, Download } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Check if a user is the owner of a document
 */
export function isDocOwner(
  userEmail: string | undefined,
  docOwnerEmail: string | undefined
): boolean {
  if (!userEmail || !docOwnerEmail) return false;
  return userEmail.toLowerCase() === docOwnerEmail.toLowerCase();
}

/**
 * Format file size in bytes to human-readable string
 */
export function formatFileSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Create document actions array for DetailPageHeader
 */
export function createDocActions(
  isOwner: boolean,
  handlers: {
    onShare: () => void;
    onShareViaEmail: () => void;
    onDelete: () => void;
    onExportPDF?: () => void;
  }
): Array<{
  label: string;
  icon: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}> {
  const actions: Array<{
    label: string;
    icon: ReactNode;
    onClick: () => void;
    destructive?: boolean;
  }> = [];

  if (isOwner) {
    actions.push({
      label: "Limit Visibility",
      icon: <Share2 className="h-4 w-4" />,
      onClick: handlers.onShare,
    });
  }

  if (isOwner) {
    actions.push({
      label: "Share",
      icon: <Mail className="h-4 w-4" />,
      onClick: handlers.onShareViaEmail,
    });
  }

  // Add PDF export option
  if (handlers.onExportPDF) {
    actions.push({
      label: "Export as PDF",
      icon: <Download className="h-4 w-4" />,
      onClick: handlers.onExportPDF,
    });
  }

  if (isOwner) {
    actions.push({
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: handlers.onDelete,
      destructive: true,
    });
  }

  return actions;
}
