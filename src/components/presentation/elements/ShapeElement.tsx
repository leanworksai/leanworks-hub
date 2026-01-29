import type { ElementRendererProps } from '@/types/presentation';

export function ShapeElementRenderer({ element, isSelected, onClick, isEditable }: ElementRendererProps) {
  const shapeType = element.content?.shapeType || 'rect';
  const style = element.style || {};

  const getShapeStyle = () => {
    return {
      width: '100%',
      height: '100%',
      fill: style.fillColor || '#3B82F6',
      stroke: style.strokeColor || '#1E40AF',
      strokeWidth: style.strokeWidth || 1,
      cursor: isEditable ? (isSelected ? 'move' : 'pointer') : 'default',
    };
  };

  const renderShape = () => {
    switch (shapeType) {
      case 'rect':
      case 'rectangle':
        return (
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx={style.borderRadius || 0}
            style={getShapeStyle()}
          />
        );

      case 'circle':
        return (
          <circle
            cx="50%"
            cy="50%"
            r="45%"
            style={getShapeStyle()}
          />
        );

      case 'triangle':
        return (
          <polygon
            points="50,10 90,90 10,90"
            style={getShapeStyle()}
          />
        );

      case 'oval':
      case 'ellipse':
        return (
          <ellipse
            cx="50%"
            cy="50%"
            rx="45%"
            ry="30%"
            style={getShapeStyle()}
          />
        );

      case 'diamond':
        return (
          <polygon
            points="50,10 90,50 50,90 10,50"
            style={getShapeStyle()}
          />
        );

      case 'star':
        return (
          <polygon
            points="50,5 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35"
            style={getShapeStyle()}
          />
        );

      case 'line':
        return (
          <line
            x1="10%"
            y1="50%"
            x2="90%"
            y2="50%"
            style={{
              ...getShapeStyle(),
              strokeWidth: style.strokeWidth || 4,
            }}
          />
        );

      default:
        // Default to rectangle
        return (
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            style={getShapeStyle()}
          />
        );
    }
  };

  return (
    <div
      className={`w-full h-full ${isSelected ? 'ring-1 ring-blue-300' : ''}`}
      onClick={onClick}
      style={{ cursor: isEditable ? (isSelected ? 'move' : 'pointer') : 'default' }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-full"
      >
        {renderShape()}
      </svg>

      {/* Shape type label for debugging */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-0 right-0 bg-black/50 text-white text-xs px-1 rounded">
          {shapeType}
        </div>
      )}
    </div>
  );
}