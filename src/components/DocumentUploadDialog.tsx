/**
 * Document Upload Dialog
 * 
 * Allows users to upload PDF, Word, PowerPoint, and Excel files.
 * Shows upload progress and processing status.
 */

import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Upload, FileText, FileSpreadsheet, Presentation, File, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  teamId?: string;
}

type UploadStatus = 'idle' | 'uploading' | 'processing' | 'complete' | 'error';

interface UploadState {
  status: UploadStatus;
  progress: number;
  message: string;
  docId?: string;
  error?: string;
}

const SUPPORTED_TYPES = {
  'application/pdf': { ext: '.pdf', icon: FileText, color: 'text-red-500', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', icon: FileText, color: 'text-blue-500', label: 'Word' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', icon: Presentation, color: 'text-orange-500', label: 'PowerPoint' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', icon: FileSpreadsheet, color: 'text-green-500', label: 'Excel' },
  'text/csv': { ext: '.csv', icon: FileSpreadsheet, color: 'text-green-600', label: 'CSV' },
};

const ACCEPT_TYPES = '.pdf,.docx,.pptx,.xlsx,.csv';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function DocumentUploadDialog({
  open,
  onOpenChange,
  projectId,
  teamId,
}: DocumentUploadDialogProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    message: '',
  });
  const [isDragging, setIsDragging] = useState(false);

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedFile(null);
      setTitle('');
      setUploadState({ status: 'idle', progress: 0, message: '' });
      setIsDragging(false);
    }
    onOpenChange(newOpen);
  };

  // Handle file selection
  const handleFileSelect = (file: File) => {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: 'File too large',
        description: `File size must be less than 50MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB.`,
        variant: 'destructive',
      });
      return;
    }

    // Validate file type
    const fileType = file.type;
    if (!Object.keys(SUPPORTED_TYPES).includes(fileType)) {
      toast({
        title: 'Unsupported file type',
        description: 'Please upload a PDF, Word, PowerPoint, or Excel file.',
        variant: 'destructive',
      });
      return;
    }

    setSelectedFile(file);
    setTitle(file.name); // Use full filename including extension
  };

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Poll document status
  const pollDocumentStatus = async (docId: string): Promise<void> => {
    const maxAttempts = 60; // Poll for up to 5 minutes (60 * 5 seconds)
    let attempts = 0;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/docs/${docId}/status`, {
          headers: {
            'Authorization': `Bearer ${await user?.getIdToken()}`,
            'x-org-slug': currentOrg?.slug || '',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to get document status');
        }

        const data = await response.json();

        if (data.processingStatus === 'ready') {
          setUploadState({
            status: 'complete',
            progress: 100,
            message: 'Document processed successfully!',
            docId,
          });
          return;
        }

        if (data.processingStatus === 'error') {
          setUploadState({
            status: 'error',
            progress: 0,
            message: 'Processing failed',
            error: data.job?.errorMessage || 'Unknown error',
          });
          return;
        }

        // Still processing
        attempts++;
        if (attempts >= maxAttempts) {
          setUploadState({
            status: 'error',
            progress: 0,
            message: 'Processing timeout',
            error: 'Document processing is taking longer than expected',
          });
          return;
        }

        // Update progress (estimate based on status)
        const progress = data.processingStatus === 'processing' ? 50 : 30;
        setUploadState({
          status: 'processing',
          progress,
          message: 'Processing document...',
          docId,
        });

        // Poll again in 5 seconds
        setTimeout(() => poll(), 5000);
      } catch (error) {
        console.error('Error polling document status:', error);
        setUploadState({
          status: 'error',
          progress: 0,
          message: 'Failed to check processing status',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    await poll();
  };

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile || !user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to upload documents',
        variant: 'destructive',
      });
      return;
    }

    if (!currentOrg) {
      toast({
        title: 'Error',
        description: 'No organization selected. Please select an organization first.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setUploadState({
        status: 'uploading',
        progress: 10,
        message: 'Uploading file...',
      });

      // Create form data
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (title) formData.append('title', title);
      if (projectId) formData.append('projectId', projectId);
      if (teamId) formData.append('teamId', teamId);

      // Upload file
      const response = await fetch('/api/docs/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await user.getIdToken()}`,
          'x-org-slug': currentOrg.slug,
        },
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = 'Upload failed';
        let errorDetails = '';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
          errorDetails = error.details || error.code || '';
          console.error('Upload error response:', error);
        } catch (e) {
          // Response might not be JSON
          errorMessage = `Upload failed with status ${response.status}`;
          console.error('Upload failed, non-JSON response');
        }
        throw new Error(`${errorMessage}${errorDetails ? ': ' + errorDetails : ''}`);
      }

      const data = await response.json();

      setUploadState({
        status: 'processing',
        progress: 30,
        message: 'File uploaded. Processing document...',
        docId: data.id,
      });

      // Start polling for processing status
      await pollDocumentStatus(data.id);

    } catch (error) {
      console.error('Upload error:', error);
      setUploadState({
        status: 'error',
        progress: 0,
        message: 'Upload failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to upload document',
        variant: 'destructive',
      });
    }
  };

  // Handle view document
  const handleViewDocument = () => {
    if (uploadState.docId) {
      navigate(`/docs/${uploadState.docId}`);
      handleOpenChange(false);
    }
  };

  // Get file icon
  const getFileIcon = () => {
    if (!selectedFile) return File;
    const typeInfo = SUPPORTED_TYPES[selectedFile.type as keyof typeof SUPPORTED_TYPES];
    return typeInfo?.icon || File;
  };

  // Get file color
  const getFileColor = () => {
    if (!selectedFile) return 'text-gray-500';
    const typeInfo = SUPPORTED_TYPES[selectedFile.type as keyof typeof SUPPORTED_TYPES];
    return typeInfo?.color || 'text-gray-500';
  };

  // Get file label
  const getFileLabel = () => {
    if (!selectedFile) return 'File';
    const typeInfo = SUPPORTED_TYPES[selectedFile.type as keyof typeof SUPPORTED_TYPES];
    return typeInfo?.label || 'File';
  };

  const FileIcon = getFileIcon();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload a PDF, Word, PowerPoint, or Excel file. Maximum file size: 50MB.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File selection area */}
          {!selectedFile && uploadState.status === 'idle' && (
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, Word, PowerPoint, or Excel (max 50MB)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          )}

          {/* Selected file info */}
          {selectedFile && uploadState.status === 'idle' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 border rounded-lg">
                <FileIcon className={cn('h-8 w-8', getFileColor())} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {getFileLabel()} • {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedFile(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Document Title (Optional)</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={selectedFile.name.replace(/\.[^/.]+$/, '')}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUpload}>
                  Upload
                </Button>
              </div>
            </div>
          )}

          {/* Upload progress */}
          {(uploadState.status === 'uploading' || uploadState.status === 'processing') && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 border rounded-lg">
                <FileIcon className={cn('h-8 w-8', getFileColor())} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedFile?.name}</p>
                  <p className="text-xs text-muted-foreground">{uploadState.message}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{uploadState.progress}%</span>
                </div>
                <Progress value={uploadState.progress} />
              </div>

              <p className="text-xs text-muted-foreground text-center">
                This may take a few moments depending on file size...
              </p>
            </div>
          )}

          {/* Success state */}
          {uploadState.status === 'complete' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 p-6 border rounded-lg bg-green-50 dark:bg-green-950/20">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <div className="text-center">
                  <p className="text-sm font-medium mb-1">Document uploaded successfully!</p>
                  <p className="text-xs text-muted-foreground">
                    Your document has been processed and is ready to view.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
                <Button onClick={handleViewDocument}>
                  View Document
                </Button>
              </div>
            </div>
          )}

          {/* Error state */}
          {uploadState.status === 'error' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 p-6 border rounded-lg bg-red-50 dark:bg-red-950/20">
                <AlertCircle className="h-12 w-12 text-red-500" />
                <div className="text-center">
                  <p className="text-sm font-medium mb-1">{uploadState.message}</p>
                  {uploadState.error && (
                    <p className="text-xs text-muted-foreground">{uploadState.error}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
                <Button
                  onClick={() => {
                    setUploadState({ status: 'idle', progress: 0, message: '' });
                    setSelectedFile(null);
                  }}
                >
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
