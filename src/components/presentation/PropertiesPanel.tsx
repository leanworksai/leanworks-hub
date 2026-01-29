import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Trash2, Palette, Type, Move, Square } from 'lucide-react';
import type { PropertiesPanelProps, SlideElement } from '@/types/presentation';

export function PropertiesPanel({ element, onUpdate }: PropertiesPanelProps) {
  const [localElement, setLocalElement] = useState<SlideElement | null>(null);

  // Update local state when element changes
  useEffect(() => {
    setLocalElement(element);
  }, [element]);

  if (!localElement) {
    return (
      <div className="w-full h-full flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <Square className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select an element to edit its properties</p>
        </div>
      </div>
    );
  }

  const updateElement = (updates: Partial<SlideElement>) => {
    const updated = { ...localElement, ...updates };
    setLocalElement(updated);
    onUpdate?.(updates);
  };

  const updateStyle = (styleUpdates: Partial<SlideElement['style']>) => {
    const updated = {
      ...localElement,
      style: { ...localElement.style, ...styleUpdates }
    };
    setLocalElement(updated);
    onUpdate?.({ style: { ...localElement.style, ...styleUpdates } });
  };

  const updateContent = (contentUpdates: any) => {
    const updated = {
      ...localElement,
      content: { ...localElement.content, ...contentUpdates }
    };
    setLocalElement(updated);
    onUpdate?.({ content: { ...localElement.content, ...contentUpdates } });
  };

  const renderTextProperties = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Type className="h-4 w-4" />
        <Label className="text-sm font-medium">Text Content</Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="text-content" className="text-xs">Content</Label>
        <textarea
          id="text-content"
          value={localElement.content?.text || ''}
          onChange={(e) => updateContent({ text: e.target.value })}
          className="w-full h-20 p-2 text-sm border rounded resize-none"
          placeholder="Enter text content..."
        />
      </div>

      <Separator />

      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4" />
        <Label className="text-sm font-medium">Text Styling</Label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="font-size" className="text-xs">Font Size</Label>
          <Input
            id="font-size"
            type="number"
            value={localElement.style?.fontSize || 16}
            onChange={(e) => updateStyle({ fontSize: parseInt(e.target.value) })}
            className="h-8"
          />
        </div>

        <div>
          <Label htmlFor="font-weight" className="text-xs">Font Weight</Label>
          <Select
            value={localElement.style?.fontWeight || 'normal'}
            onValueChange={(value) => updateStyle({ fontWeight: value })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="bold">Bold</SelectItem>
              <SelectItem value="lighter">Light</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="font-family" className="text-xs">Font Family</Label>
        <Select
          value={localElement.style?.fontFamily || 'Arial'}
          onValueChange={(value) => updateStyle({ fontFamily: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Arial">Arial</SelectItem>
            <SelectItem value="Helvetica">Helvetica</SelectItem>
            <SelectItem value="Times New Roman">Times New Roman</SelectItem>
            <SelectItem value="Georgia">Georgia</SelectItem>
            <SelectItem value="Verdana">Verdana</SelectItem>
            <SelectItem value="Courier New">Courier New</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="text-color" className="text-xs">Text Color</Label>
        <div className="flex gap-2">
          <Input
            id="text-color"
            type="color"
            value={localElement.style?.color || '#000000'}
            onChange={(e) => updateStyle({ color: e.target.value })}
            className="w-12 h-8 p-1"
          />
          <Input
            value={localElement.style?.color || '#000000'}
            onChange={(e) => updateStyle({ color: e.target.value })}
            className="flex-1 h-8"
            placeholder="#000000"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="text-align" className="text-xs">Text Alignment</Label>
        <Select
          value={localElement.style?.textAlign || 'left'}
          onValueChange={(value: 'left' | 'center' | 'right') => updateStyle({ textAlign: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="center">Center</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderShapeProperties = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Square className="h-4 w-4" />
        <Label className="text-sm font-medium">Shape Properties</Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="shape-type" className="text-xs">Shape Type</Label>
        <Select
          value={localElement.content?.shapeType || 'rect'}
          onValueChange={(value) => updateContent({ shapeType: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rect">Rectangle</SelectItem>
            <SelectItem value="circle">Circle</SelectItem>
            <SelectItem value="triangle">Triangle</SelectItem>
            <SelectItem value="oval">Oval</SelectItem>
            <SelectItem value="diamond">Diamond</SelectItem>
            <SelectItem value="star">Star</SelectItem>
            <SelectItem value="line">Line</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4" />
        <Label className="text-sm font-medium">Shape Styling</Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fill-color" className="text-xs">Fill Color</Label>
        <div className="flex gap-2">
          <Input
            id="fill-color"
            type="color"
            value={localElement.style?.fillColor || '#3B82F6'}
            onChange={(e) => updateStyle({ fillColor: e.target.value })}
            className="w-12 h-8 p-1"
          />
          <Input
            value={localElement.style?.fillColor || '#3B82F6'}
            onChange={(e) => updateStyle({ fillColor: e.target.value })}
            className="flex-1 h-8"
            placeholder="#3B82F6"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="stroke-color" className="text-xs">Stroke Color</Label>
        <div className="flex gap-2">
          <Input
            id="stroke-color"
            type="color"
            value={localElement.style?.strokeColor || '#1E40AF'}
            onChange={(e) => updateStyle({ strokeColor: e.target.value })}
            className="w-12 h-8 p-1"
          />
          <Input
            value={localElement.style?.strokeColor || '#1E40AF'}
            onChange={(e) => updateStyle({ strokeColor: e.target.value })}
            className="flex-1 h-8"
            placeholder="#1E40AF"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="stroke-width" className="text-xs">Stroke Width</Label>
        <Input
          id="stroke-width"
          type="number"
          value={localElement.style?.strokeWidth || 1}
          onChange={(e) => updateStyle({ strokeWidth: parseInt(e.target.value) })}
          min="0"
          max="20"
          className="h-8"
        />
      </div>

      {(localElement.content?.shapeType === 'rect' || localElement.content?.shapeType === 'rectangle') && (
        <div className="space-y-2">
          <Label htmlFor="border-radius" className="text-xs">Border Radius</Label>
          <Input
            id="border-radius"
            type="number"
            value={localElement.style?.borderRadius || 0}
            onChange={(e) => updateStyle({ borderRadius: parseInt(e.target.value) })}
            min="0"
            className="h-8"
          />
        </div>
      )}
    </div>
  );

  const renderPositionSizeProperties = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Move className="h-4 w-4" />
        <Label className="text-sm font-medium">Position & Size</Label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="pos-x" className="text-xs">X Position</Label>
          <Input
            id="pos-x"
            type="number"
            value={localElement.position.x}
            onChange={(e) => updateElement({
              position: { ...localElement.position, x: parseInt(e.target.value) }
            })}
            className="h-8"
          />
        </div>
        <div>
          <Label htmlFor="pos-y" className="text-xs">Y Position</Label>
          <Input
            id="pos-y"
            type="number"
            value={localElement.position.y}
            onChange={(e) => updateElement({
              position: { ...localElement.position, y: parseInt(e.target.value) }
            })}
            className="h-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="width" className="text-xs">Width</Label>
          <Input
            id="width"
            type="number"
            value={localElement.size.width}
            onChange={(e) => updateElement({
              size: { ...localElement.size, width: parseInt(e.target.value) }
            })}
            className="h-8"
          />
        </div>
        <div>
          <Label htmlFor="height" className="text-xs">Height</Label>
          <Input
            id="height"
            type="number"
            value={localElement.size.height}
            onChange={(e) => updateElement({
              size: { ...localElement.size, height: parseInt(e.target.size) }
            })}
            className="h-8"
          />
        </div>
      </div>
    </div>
  );

  const renderElementSpecificProperties = () => {
    switch (localElement.type) {
      case 'text':
        return renderTextProperties();
      case 'shape':
        return renderShapeProperties();
      case 'image':
        return (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Image properties will be available in a future update.
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="p-4 border-b">
        <h3 className="font-medium text-sm">
          {localElement.type.charAt(0).toUpperCase() + localElement.type.slice(1)} Properties
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          ID: {localElement.id}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {renderPositionSizeProperties()}
        <Separator />
        {renderElementSpecificProperties()}
      </div>

      <div className="p-4 border-t">
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => {
            // This would typically trigger element deletion
            // For now, just deselect
            onUpdate?.({}); // Empty update to trigger re-render
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Element
        </Button>
      </div>
    </div>
  );
}