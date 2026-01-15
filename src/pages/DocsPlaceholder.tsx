import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import DocsCatalog from "./DocsCatalog";
import { loadLastOpenedDoc } from "@/utils/docsStorage";

export default function DocsPlaceholder() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  // Determine mobile status immediately to avoid timing issues
  const [isMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    // On mobile, always show catalog page - don't auto-redirect
    if (isMobile) {
      return;
    }

    // Desktop only: Check if user explicitly navigated to show catalog
    const showCatalog = sessionStorage.getItem('showDocsCatalog');
    if (showCatalog === 'true') {
      sessionStorage.removeItem('showDocsCatalog');
      // Don't auto-redirect, show catalog instead
      return;
    }

    // Desktop only: Auto-redirect to last opened doc if available
    if (!user?.email || !currentOrg?.id) return;
    
    const lastOpenedDoc = loadLastOpenedDoc(user.email, currentOrg.id);
    if (lastOpenedDoc) {
      // Verify it exists in the docs list? 
      // For now just navigate, if it doesn't exist DocDetail might handle 404 or redirect.
      // But to be safe, we rely on DocDetail to handle invalid IDs or we just try to navigate.
      navigate(`/docs/${lastOpenedDoc}`, { replace: true });
    }
  }, [navigate, user?.email, currentOrg?.id, isMobile]);

  // On mobile, show catalog page; on desktop, show blank page when there is no last opened doc
  if (isMobile) {
    return <DocsCatalog />;
  }

  // Show blank page when there is no last opened doc - return nothing
  return null;
}
