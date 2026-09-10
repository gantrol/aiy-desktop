import { FileTextIcon, FilmIcon, FlaskConicalIcon, ImageIcon, LightbulbIcon, VideoIcon } from 'lucide-react';
import type { CreationFormRole } from '@/shared/contracts';

export const creationFormIcons = {
  ANIMATION: FilmIcon,
  ARTICLE: FileTextIcon,
  SOCIAL_POST: FileTextIcon,
  VIDEO_DOCUMENT: VideoIcon,
  IMAGE_CREATION: ImageIcon,
  IMAGE_BREAKDOWN: ImageIcon,
  EVALUATION_SUITE: FlaskConicalIcon,
  INSPIRATION: LightbulbIcon,
  SOCIAL_POST_COVER: ImageIcon,
  ARTICLE_HEADER: ImageIcon,
  ARTICLE_INLINE: ImageIcon,
} satisfies Record<CreationFormRole, typeof ImageIcon>;
