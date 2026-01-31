import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, FileText, FileSpreadsheet, Presentation } from 'lucide-react';
import { SpreadsheetViewer } from './SpreadsheetViewer';
import type { Doc } from '@/data/docsData';

interface DocumentViewerProps {
  doc: Doc;
  downloadUrl?: string;
}

export function DocumentViewer({ doc, downloadUrl }: DocumentViewerProps) {
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

  // Show processing state for PPTX files still being processed
  if (doc.docType === 'pptx' && doc.processingStatus === 'processing') {
    return (
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 px-6 text-center">
            <Presentation className="h-16 w-16 mx-auto mb-4 text-orange-500 animate-pulse" />
            <h3 className="text-lg font-semibold mb-2">Processing Presentation</h3>
            <p className="text-muted-foreground mb-4">
              Converting your PowerPoint presentation for viewing...
            </p>
            <p className="text-sm text-muted-foreground">
              This may take a few moments for large files.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show warning if PPTX file couldn't be converted to PDF
  if (doc.docType === 'pptx' && !doc.fileMetadata?.pdfStoragePath) {
    return (
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <Card className="max-w-2xl w-full">
          <CardContent className="py-12 px-8 text-center">
            <Presentation className="h-24 w-24 mx-auto mb-6 text-yellow-600" />
            <h2 className="text-2xl font-bold mb-2">{doc.title}</h2>
            <p className="text-muted-foreground mb-6">PowerPoint Presentation</p>
            
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-8 text-left">
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                <strong>Note:</strong> This presentation could not be converted to PDF for viewing. 
                This typically happens when LibreOffice is not installed on the server or the file is corrupted.
              </p>
            </div>

            {/* Metadata */}
            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground mb-8">
              {doc.fileMetadata?.slideCount && (
                <span>{doc.fileMetadata.slideCount} slides</span>
              )}
              {doc.fileSize && (
                <span>{(doc.fileSize / 1024 / 1024).toFixed(2)} MB</span>
              )}
            </div>

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

  // Use SpreadsheetViewer for Excel and CSV files
  if (doc.docType === 'xlsx' || doc.docType === 'csv') {
    return <SpreadsheetViewer doc={doc} downloadUrl={downloadUrl} />;
  }

  // Default view for other document types
  return (
    <div className="flex-1 flex items-center justify-center overflow-y-auto">
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
          {doc.content && doc.content.length > 0 && doc.docType !== 'pptx' && (
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