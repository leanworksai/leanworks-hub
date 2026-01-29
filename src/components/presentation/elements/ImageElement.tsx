import { ImageOff } from 'lucide-react';
import type { ElementRendererProps } from '@/types/presentation';

export function ImageElementRenderer({ element, isSelected, onClick, isEditable }: ElementRendererProps) {
  const imageSrc = element.content?.src;
  const alt = element.content?.alt || 'Image';

  const getStyle = () => {
    return {
      width: '100%',
      height: '100%',
      objectFit: 'cover' as const,
      borderRadius: element.style?.borderRadius ? `${element.style.borderRadius}px` : '0',
      opacity: element.style?.opacity !== undefined ? element.style.opacity : 1,
      cursor: isEditable ? (isSelected ? 'move' : 'pointer') : 'default',
    };
  };

  if (!imageSrc) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center bg-gray-100 border-2 border-dashed border-gray-300 ${isSelected ? 'ring-1 ring-blue-300' : ''}`}
        onClick={onClick}
        style={{ cursor: isEditable ? 'pointer' : 'default' }}
      >
        <div className="text-center text-gray-500">
          <ImageOff className="h-8 w-8 mx-auto mb-2" />
          <div className="text-xs">No image</div>
        </div>
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      style={getStyle()}
      onClick={onClick}
      className={`${isSelected ? 'ring-1 ring-blue-300' : ''}`}
      onError={(e) => {
        // Fallback to placeholder on error
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        const parent = target.parentElement;
        if (parent) {
          parent.innerHTML = `
            <div class="w-full h-full flex items-center justify-center bg-gray-100 border-2 border-dashed border-gray-300">
              <div class="text-center text-gray-500">
                <svg class="h-8 w-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div class="text-xs">Image failed to load</div>
              </div>
            </div>
          `;
        }
      }}
    />
  );
}