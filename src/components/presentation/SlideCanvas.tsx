import { useCallback } from 'react';
import type { SlideCanvasProps, SlideElement } from '@/types/presentation';

// Import element renderers
import { TextElementRenderer } from './elements/TextElement';
import { ImageElementRenderer } from './elements/ImageElement';
import { ShapeElementRenderer } from './elements/ShapeElement';

const SLIDE_WIDTH = 960; // 16:9 aspect ratio
const SLIDE_HEIGHT = 540;

export function SlideCanvas({
  slide,
  onElementUpdate,
  onElementSelect,
  selectedElementId,
  isEditable = true
}: SlideCanvasProps) {
  // Handle element click for selection
  const handleElementClick = useCallback((elementId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditable) {
      onElementSelect?.(elementId);
    }
  }, [onElementSelect, isEditable]);

  // Handle canvas click (deselect)
  const handleCanvasClick = useCallback(() => {
    if (isEditable) {
      onElementSelect?.(null);
    }
  }, [onElementSelect, isEditable]);

  // Render individual element
  const renderElement = useCallback((element: SlideElement) => {
    const isSelected = selectedElementId === element.id;
    const commonProps = {
      element,
      isSelected,
      onClick: (e: React.MouseEvent) => handleElementClick(element.id, e),
      isEditable,
    };

    switch (element.type) {
      case 'text':
        return <TextElementRenderer {...commonProps} />;
      case 'image':
        return <ImageElementRenderer {...commonProps} />;
      case 'shape':
        return <ShapeElementRenderer {...commonProps} />;
      default:
        return (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
            Unknown element
          </div>
        );
    }
  }, [selectedElementId, handleElementClick, isEditable]);

  // Get background style
  const getBackgroundStyle = useCallback(() => {
    const background = slide.background;
    switch (background.type) {
      case 'solid':
        return { backgroundColor: background.color || '#FFFFFF' };
      case 'gradient':
        // Implement gradient logic here
        return { backgroundColor: background.color || '#FFFFFF' };
      case 'image':
        return {
          backgroundImage: `url(${background.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        };
      default:
        return { backgroundColor: '#FFFFFF' };
    }
  }, [slide.background]);

  return (
    <div className="flex items-center justify-center w-full h-full p-4">
      {/* Slide Container */}
      <div
        className="relative shadow-lg border bg-white"
        style={{
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          ...getBackgroundStyle(),
        }}
        onClick={handleCanvasClick}
      >
        {/* Render all elements */}
        {slide.elements.map(element => (
          <div
            key={element.id}
            className={`absolute ${
              selectedElementId === element.id ? 'ring-2 ring-blue-500 ring-offset-1' : ''
            } ${isEditable ? 'cursor-pointer' : ''}`}
            style={{
              left: element.position.x,
              top: element.position.y,
              width: element.size.width,
              height: element.size.height,
              zIndex: selectedElementId === element.id ? 10 : 1,
            }}
            onClick={(e) => handleElementClick(element.id, e)}
          >
            {renderElement(element)}
          </div>
        ))}

        {/* Slide info overlay (for debugging) */}
        {process.env.NODE_ENV === 'development' && (
          <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
            Slide {slide.order + 1} - {slide.elements.length} elements
          </div>
        )}

        {/* Instructions overlay for editable slides */}
        {isEditable && slide.elements.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            Click "Add Text" or "Add Shape" to start editing
          </div>
        )}
      </div>
    </div>
  );
}