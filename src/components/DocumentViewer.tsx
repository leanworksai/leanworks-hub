import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, FileText, FileSpreadsheet, Presentation, Edit3 } from 'lucide-react';
import type { Doc } from '@/data/docsData';
import { PresentationEditor } from './PresentationEditor';
import { PresentationViewer } from './PresentationViewer';
import { usePresentation } from '@/hooks/usePresentation';
import type { PresentationJSON } from '@/types/presentation';

interface DocumentViewerProps {
  doc: Doc;
  downloadUrl?: string;
}

export function DocumentViewer({ doc, downloadUrl }: DocumentViewerProps) {
  const [showEditor, setShowEditor] = useState(false);

  // Check if this is a PPTX document with presentation JSON available
  const isEditablePPTX = doc.docType === 'pptx' && doc.processingStatus === 'ready';

  // Use the presentation hook for data fetching
  const {
    presentationData,
    isLoading: isLoadingPresentation,
    savePresentation
  } = usePresentation(isEditablePPTX ? doc.id : undefined);

  const getIcon = () => {
    switch (doc.docType) {
      case 'docx': return FileText;
      case 'pptx': return Presentation;
      case 'xlsx': return FileSpreadsheet;
      default: return FileText;
    }
  };

  const getLabel = () => {
    switch (doc.docType) {
      case 'docx': return 'Word Document';
      case 'pptx': return 'PowerPoint Presentation';
      case 'xlsx': return 'Excel Spreadsheet';
      default: return 'Document';
    }
  };

  const Icon = getIcon();

  const handleDownload = async () => {
    if (!downloadUrl) {
      const response = await fetch(`/api/docs/${doc.id}/download`);
      const data = await response.json();
      window.open(data.downloadUrl, '_blank');
    } else {
      window.open(downloadUrl, '_blank');
    }
  };

  const handleSavePresentation = async (data: PresentationJSON) => {
    await savePresentation(data);
  };

  // Render presentation editor for PPTX files with JSON data
  if (isEditablePPTX && presentationData && showEditor) {
    return (
      <PresentationEditor
        doc={doc}
        presentationData={presentationData}
        onSave={handleSavePresentation}
      />
    );
  }

  // Show loading state while fetching presentation data
  if (isEditablePPTX && isLoadingPresentation) {
    return (
      <div className="h-full flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 px-6 text-center">
            <Presentation className="h-16 w-16 mx-auto mb-4 text-blue-500" />
            <h3 className="text-lg font-semibold mb-2">Loading Presentation</h3>
            <p className="text-muted-foreground">
              Preparing your presentation for editing...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show presentation viewer for PPTX files with presentation data
  if (isEditablePPTX && presentationData && !showEditor) {
    return (
      <PresentationViewer
        presentationData={presentationData}
        onEdit={() => setShowEditor(true)}
      />
    );
  }

  // Show processing state for PPTX files still being processed
  if (doc.docType === 'pptx' && doc.processingStatus === 'processing') {
    return (
      <div className="h-full flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 px-6 text-center">
            <Presentation className="h-16 w-16 mx-auto mb-4 text-orange-500 animate-pulse" />
            <h3 className="text-lg font-semibold mb-2">Processing Presentation</h3>
            <p className="text-muted-foreground mb-4">
              Converting your PowerPoint presentation for editing...
            </p>
            <p className="text-sm text-muted-foreground">
              This may take a few moments for large files.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Default view for other document types or PPTX without presentation data
  return (
    <div className="h-full flex items-center justify-center">
      <Card className="max-w-2xl w-full">
        <CardContent className="py-12 px-8 text-center">
          <Icon className="h-24 w-24 mx-auto mb-6 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">{doc.title}</h2>
          <p className="text-muted-foreground mb-6">{getLabel()}</p>

          {/* Metadata */}
          <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground mb-8">
            {doc.fileMetadata?.pageCount && (
              <span>{doc.fileMetadata.pageCount} pages</span>
            )}
            {doc.fileMetadata?.slideCount && (
              <span>{doc.fileMetadata.slideCount} slides</span>
            )}
            {doc.fileMetadata?.sheetCount && (
              <span>{doc.fileMetadata.sheetCount} sheets</span>
            )}
            {doc.fileSize && (
              <span>{(doc.fileSize / 1024 / 1024).toFixed(2)} MB</span>
            )}
          </div>

          {/* Extracted Content Preview */}
          {doc.content && doc.content.length > 0 && (
            <div className="mb-8 text-left">
              <h3 className="text-sm font-medium mb-2 text-muted-foreground">
                Extracted Content Preview
              </h3>
              <div className="border rounded-lg p-4 bg-muted/30 max-h-64 overflow-y-auto">
                <p className="text-sm whitespace-pre-wrap line-clamp-12">
                  {doc.content.substring(0, 500)}
                  {doc.content.length > 500 && '...'}
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-center">
            <Button onClick={handleDownload} size="lg">
              <Download className="h-4 w-4 mr-2" />
              Download Original File
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}