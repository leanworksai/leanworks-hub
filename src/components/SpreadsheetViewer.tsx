import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, AlertCircle, FileSpreadsheet, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Doc } from '@/data/docsData';

// Hooks
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

// Import XLSX for parsing Excel/CSV files
import * as XLSX from 'xlsx';

interface SpreadsheetViewerProps {
  doc: Doc;
  downloadUrl?: string;
}

interface SheetData {
  name: string;
  data: any[][];
  rowCount: number;
  columnCount: number;
}

export function SpreadsheetViewer({ doc, downloadUrl }: SpreadsheetViewerProps) {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');

  useEffect(() => {
    if (!doc.id) {
      return;
    }

    const loadSpreadsheet = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch the file content through our backend proxy
        const response = await fetch(`/api/docs/${doc.id}/content`, {
          headers: {
            'Authorization': `Bearer ${await user?.getIdToken()}`,
            'x-org-slug': currentOrg?.slug || '',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        // Parse the file using XLSX
        let workbook: XLSX.WorkBook;

        try {
          if (doc.docType === 'csv') {
            // For CSV files, read as CSV
            const csvText = new TextDecoder('utf-8').decode(buffer);
            workbook = XLSX.read(csvText, { type: 'string' });
          } else {
            // For Excel files (.xlsx), read as binary
            workbook = XLSX.read(buffer, { type: 'array' });
          }
        } catch (parseError) {
          throw new Error(`Failed to parse ${doc.docType?.toUpperCase()} file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
        }

        // Extract sheet data
        const sheetData: SheetData[] = workbook.SheetNames.map(sheetName => {
          const worksheet = workbook.Sheets[sheetName];

          // Convert sheet to 2D array, limiting to reasonable size for display
          const rawData = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            blankrows: false
          }) as any[][];

          // Limit to first 100 rows and 20 columns for performance
          const limitedData = rawData.slice(0, 100).map(row =>
            row.slice(0, 20)
          );

          return {
            name: sheetName,
            data: limitedData,
            rowCount: rawData.length,
            columnCount: Math.max(...rawData.map(row => row.length)),
          };
        });

        setSheets(sheetData);
        if (sheetData.length > 0) {
          setActiveSheet(sheetData[0].name);
        }

        setLoading(false);
      } catch (err) {
        console.error('Error loading spreadsheet:', err);
        setError(err instanceof Error ? err.message : 'Failed to load spreadsheet');
        setLoading(false);
      }
    };

    loadSpreadsheet();
  }, [doc.id, doc.docType, user, currentOrg]);

  const handleDownload = async () => {
    if (!downloadUrl) {
      const response = await fetch(`/api/docs/${doc.id}/download`, {
        headers: {
          'Authorization': `Bearer ${await user?.getIdToken()}`,
          'x-org-slug': currentOrg?.slug || '',
        },
      });
      const data = await response.json();
      window.open(data.downloadUrl, '_blank');
    } else {
      window.open(downloadUrl, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 px-6 text-center">
            <Loader2 className="h-16 w-16 mx-auto mb-4 text-blue-500 animate-spin" />
            <h3 className="text-lg font-semibold mb-2">Loading Spreadsheet</h3>
            <p className="text-muted-foreground mb-4">
              Parsing your {doc.docType?.toUpperCase()} file...
            </p>
            <p className="text-sm text-muted-foreground">
              This may take a moment for large files.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <Card className="max-w-2xl w-full">
          <CardContent className="py-12 px-8 text-center">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 text-red-500" />
            <h2 className="text-2xl font-bold mb-2">Failed to Load Spreadsheet</h2>
            <p className="text-muted-foreground mb-6">{error}</p>

            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground mb-8">
              <span>{doc.fileMetadata?.sheetCount ? `${doc.fileMetadata.sheetCount} sheets` : ''}</span>
              <span>{doc.fileSize ? `${(doc.fileSize / 1024 / 1024).toFixed(2)} MB` : ''}</span>
            </div>

            <div className="flex gap-3 justify-center">
              <Button onClick={() => window.location.reload()} variant="outline">
                Try Again
              </Button>
              <Button onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download Original File
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Generate column headers (A, B, C, ...)
  const getColumnHeaders = (columnCount: number) => {
    const headers = [];
    for (let i = 0; i < columnCount; i++) {
      headers.push(String.fromCharCode(65 + i)); // A, B, C, ...
    }
    return headers;
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Spreadsheet Content */}
      <div className="flex-1 overflow-hidden">
        {sheets.length > 1 ? (
          <Tabs value={activeSheet} onValueChange={setActiveSheet} className="h-full flex flex-col">
            <TabsList className="mx-4 mt-4">
              {sheets.map(sheet => (
                <TabsTrigger key={sheet.name} value={sheet.name}>
                  {sheet.name}
                </TabsTrigger>
              ))}
            </TabsList>

            {sheets.map(sheet => (
              <TabsContent key={sheet.name} value={sheet.name} className="flex-1 overflow-auto m-4">
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 bg-muted">#</TableHead>
                        {getColumnHeaders(sheet.columnCount).map(col => (
                          <TableHead key={col} className="bg-muted min-w-[100px]">{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sheet.data.map((row, rowIndex) => (
                        <TableRow key={rowIndex}>
                          <TableCell className="bg-muted font-medium">{rowIndex + 1}</TableCell>
                          {row.map((cell, colIndex) => (
                            <TableCell key={colIndex} className="min-w-[100px] max-w-[200px] truncate">
                              {cell || ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {sheet.rowCount > 100 && (
                  <p className="text-sm text-muted-foreground mt-2 px-2">
                    Showing first 100 rows of {sheet.rowCount} total rows
                  </p>
                )}
                {sheet.columnCount > 20 && (
                  <p className="text-sm text-muted-foreground px-2">
                    Showing first 20 columns of {sheet.columnCount} total columns
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        ) : sheets.length === 1 ? (
          <div className="h-full overflow-auto p-4">
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 bg-muted">#</TableHead>
                    {getColumnHeaders(sheets[0].columnCount).map(col => (
                      <TableHead key={col} className="bg-muted min-w-[100px]">{col}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheets[0].data.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      <TableCell className="bg-muted font-medium">{rowIndex + 1}</TableCell>
                      {row.map((cell, colIndex) => (
                        <TableCell key={colIndex} className="min-w-[100px] max-w-[200px] truncate">
                          {cell || ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {sheets[0].rowCount > 100 && (
              <p className="text-sm text-muted-foreground mt-2">
                Showing first 100 rows of {sheets[0].rowCount} total rows
              </p>
            )}
            {sheets[0].columnCount > 20 && (
              <p className="text-sm text-muted-foreground">
                Showing first 20 columns of {sheets[0].columnCount} total columns
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">No data found in spreadsheet</p>
          </div>
        )}
      </div>
    </div>
  );
}