import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, Download, Play, Pause, RotateCcw, Maximize2 } from 'lucide-react';
import type { PresentationJSON, SlideJSON } from '@/types/presentation';

// Import element renderers (same as editor)
import { TextElementRenderer } from './presentation/elements/TextElement';
import { ImageElementRenderer } from './presentation/elements/ImageElement';
import { ShapeElementRenderer } from './presentation/elements/ShapeElement';

interface PresentationViewerProps {
  presentationData: PresentationJSON;
  onExport?: () => void;
  onEdit?: () => void;
  autoPlay?: boolean;
  autoPlayInterval?: number;
}

const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 540;

export function PresentationViewer({
  presentationData,
  onExport,
  onEdit,
  autoPlay = false,
  autoPlayInterval = 5000
}: PresentationViewerProps) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(autoPlay);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const currentSlide = presentationData.slides[currentSlideIndex];
  const totalSlides = presentationData.slides.length;

  // Auto-play functionality
  useEffect(() => {
    if (!isAutoPlaying) return;

    const interval = setInterval(() => {
      setCurrentSlideIndex(prev => (prev + 1) % totalSlides);
    }, autoPlayInterval);

    return () => clearInterval(interval);
  }, [isAutoPlaying, autoPlayInterval, totalSlides]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          goToPreviousSlide();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ': // Spacebar
          e.preventDefault();
          goToNextSlide();
          break;
        case 'Home':
          e.preventDefault();
          setCurrentSlideIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setCurrentSlideIndex(totalSlides - 1);
          break;
        case 'Escape':
          if (isFullscreen) {
            setIsFullscreen(false);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentSlideIndex, totalSlides, isFullscreen]);

  const goToNextSlide = useCallback(() => {
    setCurrentSlideIndex(prev => (prev + 1) % totalSlides);
  }, [totalSlides]);

  const goToPreviousSlide = useCallback(() => {
    setCurrentSlideIndex(prev => (prev - 1 + totalSlides) % totalSlides);
  }, [totalSlides]);

  const toggleAutoPlay = () => {
    setIsAutoPlaying(prev => !prev);
  };

  const resetPresentation = () => {
    setCurrentSlideIndex(0);
    setIsAutoPlaying(false);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  // Render individual element (view-only)
  const renderElement = (element: any) => {
    switch (element.type) {
      case 'text':
        return <TextElementRenderer
          key={element.id}
          element={element}
          isSelected={false}
          onClick={() => {}}
          isEditable={false}
        />;
      case 'image':
        return <ImageElementRenderer
          key={element.id}
          element={element}
          isSelected={false}
          onClick={() => {}}
          isEditable={false}
        />;
      case 'shape':
        return <ShapeElementRenderer
          key={element.id}
          element={element}
          isSelected={false}
          onClick={() => {}}
          isEditable={false}
        />;
      default:
        return null;
    }
  };

  // Get background style for a specific slide
  const getSlideBackgroundStyle = (slide: SlideJSON) => {
    if (!slide) return { backgroundColor: '#FFFFFF' };

    const background = slide.background;
    switch (background.type) {
      case 'solid':
        return { backgroundColor: background.color || '#FFFFFF' };
      case 'gradient':
        // Implement gradient logic
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
  };

  if (!currentSlide) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">No slides to display</p>
      </div>
    );
  }

  const viewerClasses = isFullscreen
    ? "fixed inset-0 z-50 bg-black"
    : "w-full h-full";

  return (
    <div className={`flex flex-col h-full ${viewerClasses}`}>
      {/* Vertical scrollable slides container */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-100 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto space-y-8">
          {presentationData.slides.map((slide, index) => (
            <div
              key={slide.id}
              className="relative shadow-lg border bg-white mx-auto"
              style={{
                width: SLIDE_WIDTH,
                minHeight: SLIDE_HEIGHT,
                ...getSlideBackgroundStyle(slide),
              }}
            >
              {/* Slide number indicator */}
              <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded">
                Slide {index + 1}
              </div>

              {/* Render all elements on this slide */}
              {slide.elements.map(element => (
                <div
                  key={element.id}
                  className="absolute"
                  style={{
                    left: element.position.x,
                    top: element.position.y,
                    width: element.size.width,
                    height: element.size.height,
                  }}
                >
                  {renderElement(element)}
                </div>
              ))}

              {/* Development info */}
              {process.env.NODE_ENV === 'development' && (
                <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                  {slide.elements.length} elements
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}