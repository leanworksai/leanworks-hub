import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, FileText, ZoomIn, ZoomOut } from 'lucide-react';
import type { Doc } from '@/data/docsData';

interface PDFViewerProps {
  doc: Doc;
  downloadUrl?: string;
}

export function PDFViewer({ doc, downloadUrl }: PDFViewerProps) {
  const [zoom, setZoom] = useState(100);

  const pageCount = doc.fileMetadata?.pageCount || 0;
  const fileSize = doc.fileSize || 0;
  const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
  const MAX_PDF_SIZE_MB = 50; // 50MB limit for browser loading
  const isFileTooLarge = parseFloat(fileSizeMB) > MAX_PDF_SIZE_MB;

  const handleDownload = async () => {
    if (!downloadUrl) {
      // Fetch download URL from API
      const response = await fetch(`/api/docs/${doc.id}/download`);
      const data = await response.json();
      window.open(data.downloadUrl, '_blank');
    } else {
      window.open(downloadUrl, '_blank');
    }
  };

  // Show warning for large files
  if (isFileTooLarge) {
    return (
      <div className="h-full flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="py-8 px-6 text-center">
            <FileText className="h-16 w-16 mx-auto mb-4 text-orange-500" />
            <h3 className="text-lg font-semibold mb-2">Large PDF File</h3>
            <p className="text-muted-foreground mb-4">
              This PDF file is {fileSizeMB} MB, which may be slow to load in your browser.
              For better performance, we recommend downloading the file instead.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={handleDownload} className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                Download File
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              File size: {fileSizeMB} MB • {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* PDF Viewer */}
      <div className="flex-1 border rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900">
        {downloadUrl ? (
          <iframe
            src={`${downloadUrl}#view=FitH`}
            className="w-full h-full"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
            title={doc.title}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Loading PDF...</p>
          </div>
        )}
      </div>
    </div>
  );
}