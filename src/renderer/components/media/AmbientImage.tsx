import { useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react';
import { sampleImageIsOpaque } from '@/renderer/components/media/imageOpacity';
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

function ImageAmbientBackdropFrame({
  src,
  className,
  imageClassName,
  scrimClassName,
  loading,
  decoding = 'async',
  crossOrigin = 'anonymous',
  style,
}: ImageAmbientBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opaque, setOpaque] = useState<boolean | null>(null);

  return (
    <span
      aria-hidden="true"
      data-image-ambient-backdrop
      className={cn(
        'pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] bg-surface-sunken',
        className,
      )}
      style={{ ...style, opacity: opaque ? style?.opacity : 0 }}
    >
      <canvas
        ref={canvasRef}
        width={1}
        height={1}
        className={cn(
          'absolute inset-0 size-full max-w-none scale-125 object-cover opacity-90 blur-3xl saturate-150 dark:opacity-80',
          imageClassName,
        )}
      />
      {opaque === null && (
        <img
          src={src}
          alt=""
          loading={loading}
          decoding={decoding}
          crossOrigin={crossOrigin}
          fetchPriority={loading === 'lazy' ? 'low' : undefined}
          draggable={false}
          className="absolute inset-0 size-full opacity-0"
          onLoad={(event) => {
            const canvas = canvasRef.current;
            // Keep one still frame; replaying animation through a large blur flashes the surrounding editor.
            setOpaque(canvas !== null && sampleImageIsOpaque(event.currentTarget, canvas));
          }}
          onError={() => setOpaque(false)}
        />
      )}
      <span className={cn('absolute inset-0 bg-background/10 dark:bg-background/15', scrimClassName)} />
    </span>
  );
}

export function ImageAmbientBackdrop(props: ImageAmbientBackdropProps) {
  return <ImageAmbientBackdropFrame key={props.src} {...props} />;
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
    <span data-ambient-image className={cn('relative isolate block overflow-hidden', frameClassName)}>
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
