import type { ReactNode } from 'react';
import type { ImageEditDocument, ImageEditMark } from '@/shared/contracts/image-edit';
import type { ImageEditTool } from '@/renderer/features/image-editing/image-edit-geometry';

export interface ImageEditCanvasProps {
  document: ImageEditDocument;
  sourceUrl: string;
  image: HTMLImageElement;
  onRasterError(): void;
  parameters?: ReactNode;
  onTextChange(document: ImageEditDocument): void;
  onComposing(value: boolean): void;
  tool: ImageEditTool;
  selected: string | null;
  color: string;
  stroke: number;
  fontSize: number;
  fontFamily: ImageEditMark['fontFamily'];
  zoom: number | null;
  disabled: boolean;
  original: boolean;
  label: string;
  onSelect(id: string | null): void;
  onChange(document: ImageEditDocument, commit?: boolean): void;
}
