import { useMemo } from 'react';
import { automaticTextCover, type TextCoverRecipe } from '@/renderer/features/text-covers/textCoverPresets';
import { buildTextCoverScene, type TextCoverScene } from '@/renderer/features/text-covers/textCoverScene';
import type { ArticleCoverRatio } from '@/shared/article-covers';

export function TextCoverArtwork({ scene, className }: { scene: TextCoverScene; className?: string }) {
  return (
    <svg viewBox={`0 0 ${scene.width} ${scene.height}`} className={className} aria-hidden="true" focusable="false">
      {scene.shapes.map((shape, index) =>
        shape.kind === 'rect' ? (
          <rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.fill} />
        ) : (
          <text
            key={index}
            x={shape.x}
            y={shape.y}
            fontSize={shape.size}
            fontWeight={shape.weight}
            fontFamily={shape.family}
            textAnchor={shape.anchor}
            fill={shape.fill}
            xmlSpace="preserve"
          >
            {shape.value}
          </text>
        ),
      )}
    </svg>
  );
}

export function TextCoverPreview({
  title,
  seed,
  recipe,
  ratio = '4:3',
  className,
}: {
  title: string;
  seed: string;
  recipe?: TextCoverRecipe;
  ratio?: ArticleCoverRatio;
  className?: string;
}) {
  const scene = useMemo(
    () => buildTextCoverScene(title, recipe ?? automaticTextCover(seed), ratio),
    [title, seed, recipe, ratio],
  );
  return <TextCoverArtwork scene={scene} className={className} />;
}
