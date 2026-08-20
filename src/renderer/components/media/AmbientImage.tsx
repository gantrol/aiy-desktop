import type { ComponentPropsWithoutRef, CSSProperties } from 'react';
import { cn } from '@/renderer/lib/utils';

interface ImageAmbientBackdropProps {
  src: string;
  className?: string;
  imageClassName?: string;
  scrimClassName?: string;
  loading?: ComponentPropsWithoutRef<'img'>['loading'];
  decoding?: ComponentPropsWithoutRef<'img'>['decoding'];
  crossOrigin?: ComponentPropsWithoutRef<'img'>['crossOrigin'];
  style?: CSSProperties;
}

export function ImageAmbientBackdrop({
  src,
  className,
  imageClassName,
  scrimClassName,
  loading,
  decoding = 'async',
  crossOrigin,
  style,
}: ImageAmbientBackdropProps) {
  return (
    <span
      aria-hidden="true"
      data-image-ambient-backdrop
      className={cn(
        'pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] bg-surface-sunken',
        className,
      )}
      style={style}
    >
      <img
        src={src}
        alt=""
        loading={loading}
        decoding={decoding}
        crossOrigin={crossOrigin}
        fetchPriority={loading === 'lazy' ? 'low' : undefined}
        draggable={false}
        className={cn(
          'absolute inset-0 size-full max-w-none scale-125 object-cover opacity-90 blur-3xl saturate-150 dark:opacity-80',
          imageClassName,
        )}
      />
      <span className={cn('absolute inset-0 bg-background/10 dark:bg-background/15', scrimClassName)} />
    </span>
  );
}

type AmbientImageProps = Omit<ComponentPropsWithoutRef<'img'>, 'src'> & {
  src: string;
  frameClassName?: string;
  backdropClassName?: string;
  backdropImageClassName?: string;
  scrimClassName?: string;
};

export function AmbientImage({
  src,
  frameClassName,
  backdropClassName,
  backdropImageClassName,
  scrimClassName,
  className,
  loading,
  decoding = 'async',
  crossOrigin,
  ...imageProps
}: AmbientImageProps) {
  return (
    <span data-ambient-image className={cn('relative isolate block overflow-hidden bg-surface-sunken', frameClassName)}>
      <ImageAmbientBackdrop
        src={src}
        className={backdropClassName}
        imageClassName={backdropImageClassName}
        scrimClassName={scrimClassName}
        loading={loading}
        decoding={decoding}
        crossOrigin={crossOrigin}
      />
      <img
        {...imageProps}
        src={src}
        loading={loading}
        decoding={decoding}
        crossOrigin={crossOrigin}
        className={cn('relative z-10 block', className)}
      />
    </span>
  );
}
