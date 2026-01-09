import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Mail, Loader2 } from "lucide-react";
import { docsService } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

interface ShareDocDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: string;
  docTitle: string;
}

export function ShareDocDialog({
  open,
  onOpenChange,
  docId,
  docTitle,
}: ShareDocDialogProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const { toast } = useToast();

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = email.trim() !== "" && emailRegex.test(email.trim());
  const isMessageTooLong = message.length > 500;

  const handleShare = async () => {
    if (!isValidEmail || isMessageTooLong) {
      return;
    }

    setIsSharing(true);
    try {
      const result = await docsService.shareDoc(docId, email.trim(), message.trim() || undefined);
      
      toast({
        title: "Document shared",
        description: result.isNewMember 
          ? `Invitation sent to ${email.trim()}. They'll need to join the organization to view the document.`
          : `Document shared with ${email.trim()}. They'll receive an email notification.`,
      });
      
      // Reset form
      setEmail("");
      setMessage("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to share document",
        variant: "destructive",
      });
    } finally {
      setIsSharing(false);
    }
  };

  const handleClose = () => {
    if (!isSharing) {
      setEmail("");
      setMessage("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Share Document
          </DialogTitle>
          <DialogDescription>
            Share "{docTitle}" with someone via email
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSharing}
              className={email && !isValidEmail ? "border-destructive" : ""}
            />
            {email && !isValidEmail && (
              <p className="text-xs text-destructive">
                Please enter a valid email address
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">
              Optional Message
              <span className="text-muted-foreground font-normal ml-1">
                ({message.length}/500)
              </span>
            </Label>
            <Textarea
              id="message"
              placeholder="Add a personal message (optional)..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSharing}
              rows={4}
              maxLength={500}
              className={isMessageTooLong ? "border-destructive" : ""}
            />
            {isMessageTooLong && (
              <p className="text-xs text-destructive">
                Message is too long. Maximum 500 characters.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSharing}
            size="sm"
          >
            Cancel
          </Button>
          <Button
            onClick={handleShare}
            disabled={!isValidEmail || isMessageTooLong || isSharing}
            size="sm"
          >
            {isSharing ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Sharing...
              </>
            ) : (
              <>
                <Mail className="h-3 w-3 mr-1.5" />
                Share
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
