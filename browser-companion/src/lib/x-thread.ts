import twitterText from 'twitter-text';
import { splitXText } from '../../../src/shared/x-text-split';
import { xThreadWithMedia } from '../../../src/shared/x-thread-media';

/** Bind the companion's character rules to the same splitter used by desktop previews. */
export function splitXThread(text: string, mediaCount = 0): string[] | null {
  return xThreadWithMedia(splitXText(text, twitterText), mediaCount);
}
