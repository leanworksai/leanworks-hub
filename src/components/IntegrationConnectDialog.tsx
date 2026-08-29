import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { integrationsService } from "@/services/api";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";

export interface IntegrationField {
  id: string;
  label: string;
  type?: "text" | "email" | "password";
  placeholder?: string;
  required?: boolean;
}

export interface IntegrationConfig {
  id: string;
  name: string;
  title: string;
  description: string;
  fields: IntegrationField[];
}

interface IntegrationConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  config: IntegrationConfig;
}

export function IntegrationConnectDialog({
  open,
  onOpenChange,
  onSuccess,
  config,
}: IntegrationConnectDialogProps) {
  // Initialize form state from config fields
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    config.fields.forEach((field) => {
      initial[field.id] = "";
    });
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const { currentOrg } = useOrg();
  const { toast } = useToast();

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      const reset: Record<string, string> = {};
      config.fields.forEach((field) => {
        reset[field.id] = "";
      });
      setFormData(reset);
    }
  }, [open, config.fields]);

  const handleFieldChange = (fieldId: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const validateForm = (): boolean => {
    if (!currentOrg?.slug) {
      toast({
        title: "Error",
        description: `Please select an organization before connecting ${config.name}.`,
        variant: "destructive",
      });
      return false;
    }

    // Check required fields
    const missingFields = config.fields.filter(
      (field) => field.required !== false && !formData[field.id]?.trim()
    );

    if (missingFields.length > 0) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      
      // Prepare credentials object
      const credentials: Record<string, string> = {};
      config.fields.forEach((field) => {
        if (formData[field.id]) {
          credentials[field.id] = formData[field.id];
        }
      });

      await integrationsService.connect(config.id, credentials);
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || `Failed to connect ${config.name}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {config.fields.map((field) => (
              <div key={field.id} className="space-y-2">
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input
                  id={field.id}
                  type={field.type || "text"}
                  placeholder={field.placeholder}
                  value={formData[field.id] || ""}
                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                  disabled={loading}
                  required={field.required !== false}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

