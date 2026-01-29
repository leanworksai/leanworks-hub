import { useState, useRef, useEffect } from 'react';
import type { ElementRendererProps } from '@/types/presentation';

export function TextElementRenderer({ element, isSelected, onClick, isEditable }: ElementRendererProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(element.content?.text || '');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Update local state when element changes
  useEffect(() => {
    setEditText(element.content?.text || '');
  }, [element.content?.text]);

  // Focus input when starting to edit
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (isEditable) {
      setIsEditing(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      setEditText(element.content?.text || '');
      setIsEditing(false);
    }
  };

  const finishEditing = () => {
    if (editText !== element.content?.text) {
      // Call parent update function
      const updatedElement = {
        ...element,
        content: {
          ...element.content,
          text: editText,
        },
      };
      // This would typically call a prop function passed down
    }
    setIsEditing(false);
  };

  const handleBlur = () => {
    finishEditing();
  };

  const getStyle = () => {
    const style = element.style || {};

    return {
      fontSize: style.fontSize ? `${style.fontSize}px` : '16px',
      fontFamily: style.fontFamily || 'Arial',
      fontWeight: style.fontWeight || 'normal',
      color: style.color || '#000000',
      backgroundColor: style.backgroundColor || 'transparent',
      textAlign: style.textAlign as any || 'left',
      padding: '4px',
      border: 'none',
      outline: 'none',
      resize: 'none' as const,
      width: '100%',
      height: '100%',
      boxSizing: 'border-box' as const,
      cursor: isEditable ? (isSelected ? 'text' : 'pointer') : 'default',
      userSelect: isEditable ? 'text' : 'none',
    };
  };

  return (
    <div
      className={`w-full h-full ${isSelected ? 'ring-1 ring-blue-300' : ''}`}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '24px',
      }}
    >
      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          style={getStyle()}
          placeholder="Enter text..."
        />
      ) : (
        <div
          style={getStyle()}
          className="whitespace-pre-wrap break-words"
        >
          {element.content?.text || 'Text Element'}
        </div>
      )}
    </div>
  );
}