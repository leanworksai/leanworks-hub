import { useState, useCallback, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Plus,
  Trash2,
  Copy,
  Undo,
  Redo,
  Save,
  Download,
  Eye,
  Edit3,
  FileText,
  Image as ImageIcon,
  Square,
  Type
} from 'lucide-react';

import type {
  PresentationJSON,
  SlideJSON,
  SlideElement,
  PresentationEditorProps
} from '@/types/presentation';

// Import child components (will create these next)
import { SlideThumbnails } from './presentation/SlideThumbnails';
import { SlideCanvas } from './presentation/SlideCanvas';
import { PropertiesPanel } from './presentation/PropertiesPanel';

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function PresentationEditor({ doc, presentationData, onSave }: PresentationEditorProps) {
  const [slides, setSlides] = useState<SlideJSON[]>(presentationData.slides);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Debounced auto-save function
  const debouncedSave = useMemo(
    () => debounce(async (data: typeof slides) => {
      if (!onSave) return;

      try {
        setSaveStatus('saving');
        const updatedPresentation = {
          ...presentationData,
          slides: data,
          metadata: {
            ...presentationData.metadata,
            slideCount: data.length,
            modifiedAt: new Date(),
          },
        };

        await onSave(updatedPresentation);
        setSaveStatus('saved');
        setIsDirty(false);

        // Reset saved status after 2 seconds
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (error) {
        console.error('Auto-save failed:', error);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    }, 2000), // 2 second debounce
    [presentationData, onSave]
  );

  // Auto-save when slides change
  useEffect(() => {
    if (isDirty && slides.length > 0) {
      debouncedSave(slides);
    }
  }, [slides, isDirty, debouncedSave]);

  const currentSlide = slides[currentSlideIndex];

  // Update element in current slide
  const updateElement = useCallback((elementId: string, updates: Partial<SlideElement>) => {
    setSlides(prev => prev.map(slide =>
      slide.id === currentSlide.id
        ? {
            ...slide,
            elements: slide.elements.map(el =>
              el.id === elementId ? { ...el, ...updates } : el
            )
          }
        : slide
    ));
    setIsDirty(true);
  }, [currentSlide?.id]);

  // Add new slide
  const addSlide = useCallback(() => {
    const newSlide: SlideJSON = {
      id: `slide-${Date.now()}`,
      order: slides.length,
      layout: 'content',
      background: {
        type: 'solid',
        color: '#FFFFFF',
      },
      elements: [],
    };

    setSlides(prev => [...prev, newSlide]);
    setCurrentSlideIndex(slides.length);
    setIsDirty(true);
  }, [slides.length]);

  // Delete current slide
  const deleteSlide = useCallback(() => {
    if (slides.length <= 1) return; // Keep at least one slide

    setSlides(prev => prev.filter((_, index) => index !== currentSlideIndex));
    setCurrentSlideIndex(Math.min(currentSlideIndex, slides.length - 2));
    setSelectedElementId(null);
    setIsDirty(true);
  }, [currentSlideIndex, slides.length]);

  // Duplicate current slide
  const duplicateSlide = useCallback(() => {
    const duplicatedSlide: SlideJSON = {
      ...currentSlide,
      id: `slide-${Date.now()}`,
      order: slides.length,
      elements: currentSlide.elements.map(el => ({
        ...el,
        id: `${el.id}-copy-${Date.now()}`,
      })),
    };

    setSlides(prev => [...prev, duplicatedSlide]);
    setCurrentSlideIndex(slides.length);
    setSelectedElementId(null);
    setIsDirty(true);
  }, [currentSlide, slides.length]);

  // Add text element
  const addTextElement = useCallback(() => {
    const newElement: SlideElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      position: { x: 100, y: 100 },
      size: { width: 300, height: 50 },
      style: {
        fontSize: 24,
        fontFamily: 'Arial',
        color: '#000000',
        textAlign: 'left',
      },
      content: {
        text: 'New Text',
      },
    };

    setSlides(prev => prev.map(slide =>
      slide.id === currentSlide.id
        ? { ...slide, elements: [...slide.elements, newElement] }
        : slide
    ));
    setSelectedElementId(newElement.id);
    setIsDirty(true);
  }, [currentSlide?.id]);

  // Add shape element
  const addShapeElement = useCallback(() => {
    const newElement: SlideElement = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      position: { x: 200, y: 150 },
      size: { width: 200, height: 100 },
      style: {
        fillColor: '#3B82F6',
        strokeColor: '#1E40AF',
        strokeWidth: 2,
      },
      content: {
        shapeType: 'rect',
      },
    };

    setSlides(prev => prev.map(slide =>
      slide.id === currentSlide.id
        ? { ...slide, elements: [...slide.elements, newElement] }
        : slide
    ));
    setSelectedElementId(newElement.id);
    setIsDirty(true);
  }, [currentSlide?.id]);

  // Manual save presentation
  const handleSave = useCallback(async () => {
    if (!onSave) return;

    try {
      setSaveStatus('saving');
      const updatedPresentation: PresentationJSON = {
        ...presentationData,
        slides,
        metadata: {
          ...presentationData.metadata,
          slideCount: slides.length,
          modifiedAt: new Date(),
        },
      };

      await onSave(updatedPresentation);
      setSaveStatus('saved');
      setIsDirty(false);

      // Reset saved status after 2 seconds
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Manual save failed:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [presentationData, slides, onSave]);

  // Delete selected element
  const deleteSelectedElement = useCallback(() => {
    if (!selectedElementId) return;

    setSlides(prev => prev.map(slide =>
      slide.id === currentSlide.id
        ? {
            ...slide,
            elements: slide.elements.filter(el => el.id !== selectedElementId)
          }
        : slide
    ));
    setSelectedElementId(null);
    setIsDirty(true);
  }, [selectedElementId, currentSlide?.id]);

  const selectedElement = selectedElementId
    ? currentSlide?.elements.find(el => el.id === selectedElementId)
    : null;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{doc.title}</h1>
          {isDirty && <span className="text-sm text-muted-foreground">(Unsaved changes)</span>}
        </div>

        <div className="flex items-center gap-2">
          {/* Element Tools */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={addTextElement} title="Add Text">
              <Type className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={addShapeElement} title="Add Shape">
              <Square className="h-4 w-4" />
            </Button>
            {selectedElementId && (
              <Button
                variant="outline"
                size="sm"
                onClick={deleteSelectedElement}
                title="Delete Element"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Slide Tools */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={addSlide} title="Add Slide">
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={duplicateSlide} title="Duplicate Slide">
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={deleteSlide}
              disabled={slides.length <= 1}
              title="Delete Slide"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Actions */}
          <Button onClick={handleSave} disabled={!isDirty || saveStatus === 'saving'}>
            <Save className="h-4 w-4 mr-2" />
            {saveStatus === 'saving' ? 'Saving...' :
             saveStatus === 'saved' ? 'Saved' :
             saveStatus === 'error' ? 'Save Failed' :
             'Save'}
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slide Thumbnails Panel */}
        <div className="w-48 bg-muted/30 border-r overflow-y-auto">
          <SlideThumbnails
            slides={slides}
            currentSlideIndex={currentSlideIndex}
            onSlideSelect={setCurrentSlideIndex}
            onSlideAdd={addSlide}
            onSlideDelete={deleteSlide}
          />
        </div>

        {/* Slide Canvas */}
        <div className="flex-1 flex items-center justify-center p-8 bg-muted/10">
          {currentSlide && (
            <SlideCanvas
              slide={currentSlide}
              onElementUpdate={updateElement}
              onElementSelect={setSelectedElementId}
              selectedElementId={selectedElementId}
              isEditable={true}
            />
          )}
        </div>

        {/* Properties Panel */}
        <div className="w-80 bg-card border-l overflow-y-auto">
          <PropertiesPanel
            element={selectedElement}
            onUpdate={(updates) => {
              if (selectedElementId) {
                updateElement(selectedElementId, updates);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}