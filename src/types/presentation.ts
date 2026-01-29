/**
 * TypeScript types for PowerPoint presentation JSON structure
 */

export interface PresentationJSON {
  version: string;
  metadata: PresentationMetadata;
  slides: SlideJSON[];
}

export interface PresentationMetadata {
  title: string;
  author?: string;
  createdAt?: Date;
  modifiedAt?: Date;
  slideCount: number;
}

export interface SlideJSON {
  id: string;
  order: number;
  layout: string; // 'title-slide', 'content', 'blank', etc.
  background: SlideBackground;
  elements: SlideElement[];
  transitions?: TransitionJSON;
}

export interface SlideBackground {
  type: 'solid' | 'gradient' | 'image';
  color?: string;
  gradient?: GradientJSON;
  imageUrl?: string;
}

export interface SlideElement {
  id: string;
  type: 'text' | 'image' | 'shape' | 'table' | 'video';
  position: { x: number; y: number };
  size: { width: number; height: number };
  style: ElementStyle;
  content: any; // Type-specific content
}

export interface ElementStyle {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  borderRadius?: number;
  opacity?: number;
}

export interface GradientJSON {
  type: 'linear' | 'radial';
  colors: string[];
  angle?: number;
}

export interface TransitionJSON {
  type: string;
  duration: number;
  direction?: string;
}

// Element-specific content types
export interface TextElementContent {
  text: string;
}

export interface ImageElementContent {
  src: string;
  alt?: string;
}

export interface ShapeElementContent {
  shapeType: string; // 'rect', 'circle', 'triangle', etc.
}

export interface TableElementContent {
  rows: TableRow[];
  columns: TableColumn[];
}

export interface TableRow {
  id: string;
  cells: TableCell[];
}

export interface TableColumn {
  id: string;
  width: number;
}

export interface TableCell {
  content: string;
  style?: Partial<ElementStyle>;
}

export interface VideoElementContent {
  src: string;
  autoplay?: boolean;
  controls?: boolean;
}

// Editor-specific types
export interface PresentationEditorProps {
  doc: any; // Doc type from docsData
  presentationData: PresentationJSON;
  onSave?: (data: PresentationJSON) => Promise<void>;
}

export interface SlideCanvasProps {
  slide: SlideJSON;
  onElementUpdate?: (elementId: string, updates: Partial<SlideElement>) => void;
  onElementSelect?: (elementId: string | null) => void;
  selectedElementId?: string | null;
  isEditable?: boolean;
}

export interface ElementRendererProps {
  element: SlideElement;
  isSelected?: boolean;
  onSelect?: () => void;
  onUpdate?: (updates: Partial<SlideElement>) => void;
  isEditable?: boolean;
}

export interface PropertiesPanelProps {
  element: SlideElement | null;
  onUpdate?: (updates: Partial<SlideElement>) => void;
}

export interface SlideThumbnailsProps {
  slides: SlideJSON[];
  currentSlideIndex: number;
  onSlideSelect?: (index: number) => void;
  onSlideAdd?: () => void;
  onSlideDelete?: (index: number) => void;
  onSlideReorder?: (fromIndex: number, toIndex: number) => void;
}