import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Copy, Trash2, FileText, Image, Square } from 'lucide-react';
import type { SlideThumbnailsProps, SlideJSON } from '@/types/presentation';

const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_HEIGHT = 90;

export function SlideThumbnails({
  slides,
  currentSlideIndex,
  onSlideSelect,
  onSlideAdd,
  onSlideDelete,
  onSlideReorder
}: SlideThumbnailsProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      onSlideReorder?.(draggedIndex, dropIndex);
    }
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const renderSlideThumbnail = (slide: SlideJSON, index: number) => {
    const isSelected = index === currentSlideIndex;
    const isDragging = draggedIndex === index;

    // Count elements by type
    const elementCounts = slide.elements.reduce((counts, element) => {
      counts[element.type] = (counts[element.type] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    return (
      <Card
        key={slide.id}
        className={`cursor-pointer transition-all hover:shadow-md ${
          isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
        } ${isDragging ? 'opacity-50' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(e, index)}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, index)}
        onDragEnd={handleDragEnd}
        onClick={() => onSlideSelect?.(index)}
      >
        <CardContent className="p-3">
          {/* Slide number */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Slide {index + 1}
            </span>
            <div className="flex gap-1">
              {slides.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSlideDelete?.(index);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Mini slide preview */}
          <div
            className="border rounded bg-white mb-2 relative overflow-hidden"
            style={{
              width: THUMBNAIL_WIDTH,
              height: THUMBNAIL_HEIGHT,
            }}
          >
            {/* Background */}
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: slide.background.type === 'solid' ? slide.background.color : '#FFFFFF',
              }}
            />

            {/* Element indicators */}
            <div className="absolute inset-0 p-1">
              <div className="flex flex-wrap gap-1">
                {slide.elements.slice(0, 6).map((element, elementIndex) => (
                  <div
                    key={elementIndex}
                    className="w-2 h-2 rounded-sm border"
                    style={{
                      backgroundColor: getElementColor(element.type),
                    }}
                    title={`${element.type} element`}
                  />
                ))}
                {slide.elements.length > 6 && (
                  <div className="w-2 h-2 rounded-sm bg-gray-300 border flex items-center justify-center">
                    <span className="text-xs">+</span>
                  </div>
                )}
              </div>
            </div>

            {/* Element count overlay */}
            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
              {slide.elements.length}
            </div>
          </div>

          {/* Slide info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>{slide.elements.length} elements</span>
              <span>{slide.layout}</span>
            </div>

            {/* Element type counts */}
            <div className="flex gap-2 text-xs">
              {Object.entries(elementCounts).map(([type, count]) => (
                <span key={type} className="flex items-center gap-1">
                  {getElementIcon(type)}
                  {count}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="h-full flex flex-col bg-muted/20">
      {/* Header */}
      <div className="p-4 border-b bg-card">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Slides</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={onSlideAdd}
            className="h-8 px-2"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {slides.length} slide{slides.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Slides list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {slides.map((slide, index) => renderSlideThumbnail(slide, index))}

        {/* Add slide button at bottom */}
        <Card className="border-2 border-dashed border-muted-foreground/30 hover:border-muted-foreground/50 cursor-pointer transition-colors">
          <CardContent className="p-4 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onSlideAdd}
              className="w-full h-12"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Slide
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Footer with duplicate/delete actions */}
      {currentSlideIndex !== null && slides.length > 1 && (
        <div className="p-2 border-t bg-card">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => {
                // Duplicate current slide
                const duplicatedSlide: SlideJSON = {
                  ...slides[currentSlideIndex],
                  id: `slide-${Date.now()}`,
                  order: slides.length,
                  elements: slides[currentSlideIndex].elements.map(el => ({
                    ...el,
                    id: `${el.id}-copy-${Date.now()}`,
                  })),
                };
                // This would need to be handled by parent component
                console.log('Duplicate slide:', duplicatedSlide);
              }}
            >
              <Copy className="h-3 w-3 mr-1" />
              Duplicate
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function getElementColor(type: string): string {
  switch (type) {
    case 'text':
      return '#3B82F6'; // Blue
    case 'image':
      return '#10B981'; // Green
    case 'shape':
      return '#F59E0B'; // Yellow
    case 'table':
      return '#8B5CF6'; // Purple
    default:
      return '#6B7280'; // Gray
  }
}

function getElementIcon(type: string) {
  switch (type) {
    case 'text':
      return <FileText className="h-3 w-3" />;
    case 'image':
      return <Image className="h-3 w-3" />;
    case 'shape':
      return <Square className="h-3 w-3" />;
    default:
      return <Square className="h-3 w-3" />;
  }
}