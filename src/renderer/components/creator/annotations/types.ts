import type { AnnotationBrushGeometry, AnnotationBrushStrokeMode, AnnotationDto } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/catalog';

export type AnnotationMode = 'view' | 'BRUSH' | 'RECTANGLE';
export type BrushMode = AnnotationBrushStrokeMode;

export interface PendingAnnotation {
  type: 'BRUSH' | 'RECTANGLE';
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  geometry: AnnotationBrushGeometry | null;
}

export interface NumberedAnnotation {
  annotation: AnnotationDto;
  number: number;
}

export type AnnotationLabels = MessageCatalog['creator']['annotations'];
