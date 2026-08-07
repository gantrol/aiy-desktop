import { ShapeType, type ImageAnnotation, type Rectangle } from '@annotorious/react';
import type { NumberedAnnotation, PendingAnnotation } from '@/renderer/components/creator/annotations/types';

export interface ImageDimensions {
  width: number;
  height: number;
}

export const pendingAnnotationId = '__pending_annotation__';

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function positiveDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function rectangleAnnotation(
  id: string,
  rectangle: Pick<PendingAnnotation, 'x' | 'y' | 'width' | 'height'>,
  dimensions: ImageDimensions,
  properties: NonNullable<ImageAnnotation['properties']>,
  comment = '',
): ImageAnnotation {
  const imageWidth = positiveDimension(dimensions.width);
  const imageHeight = positiveDimension(dimensions.height);
  const x = clamp01(rectangle.x) * imageWidth;
  const y = clamp01(rectangle.y) * imageHeight;
  const width = Math.min(1 - clamp01(rectangle.x), clamp01(rectangle.width ?? 0)) * imageWidth;
  const height = Math.min(1 - clamp01(rectangle.y), clamp01(rectangle.height ?? 0)) * imageHeight;
  const selector: Rectangle = {
    type: ShapeType.RECTANGLE,
    geometry: {
      x,
      y,
      w: width,
      h: height,
      bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
    },
  };
  return {
    id,
    bodies: comment
      ? [
          {
            id: `${id}:comment`,
            annotation: id,
            purpose: 'commenting',
            value: comment,
          },
        ]
      : [],
    properties,
    target: {
      annotation: id,
      selector,
    },
  };
}

export function toAnnotoriousAnnotation(item: NumberedAnnotation, dimensions: ImageDimensions): ImageAnnotation | null {
  const { annotation, number } = item;
  if (annotation.type !== 'RECTANGLE') return null;
  return rectangleAnnotation(
    annotation.id,
    annotation,
    dimensions,
    {
      domainType: annotation.type,
      number,
      status: annotation.status,
    },
    annotation.comment,
  );
}

export function toPendingAnnotoriousAnnotation(
  pending: PendingAnnotation | null,
  dimensions: ImageDimensions,
): ImageAnnotation | null {
  if (!pending || pending.type !== 'RECTANGLE') return null;
  return rectangleAnnotation(pendingAnnotationId, pending, dimensions, {
    domainType: pending.type,
    pending: true,
  });
}

export function fromAnnotoriousRectangle(
  annotation: ImageAnnotation,
  dimensions: ImageDimensions,
): PendingAnnotation | null {
  if (annotation.target.selector.type !== ShapeType.RECTANGLE) return null;
  const rectangle = annotation.target.selector as Rectangle;
  const imageWidth = positiveDimension(dimensions.width);
  const imageHeight = positiveDimension(dimensions.height);
  const { x: rawX, y: rawY, w: rawWidth, h: rawHeight } = rectangle.geometry;
  if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite)) return null;

  const x = clamp01(Math.min(rawX, rawX + rawWidth) / imageWidth);
  const y = clamp01(Math.min(rawY, rawY + rawHeight) / imageHeight);
  const maxX = clamp01(Math.max(rawX, rawX + rawWidth) / imageWidth);
  const maxY = clamp01(Math.max(rawY, rawY + rawHeight) / imageHeight);
  const width = maxX - x;
  const height = maxY - y;
  if (width <= 0 || height <= 0) return null;
  return { type: 'RECTANGLE', x, y, width, height, geometry: null };
}
