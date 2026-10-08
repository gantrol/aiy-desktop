import twitterText from 'twitter-text';
import { splitXText } from '../../../src/shared/x-text-split';

/** Bind the companion's character rules to the same splitter used by desktop previews. */
export function splitXThread(text: string): string[] | null {
  return splitXText(text, twitterText);
}
