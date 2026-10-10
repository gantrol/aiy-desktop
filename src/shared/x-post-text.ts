import twitterText from 'twitter-text';
import { splitXText } from '@/shared/x-text-split';
import { xThreadWithMedia } from '@/shared/x-thread-media';

export function xPostThread(text: string, mediaCount = 0): string[] | null {
  return xThreadWithMedia(splitXText(text, twitterText), mediaCount);
}

export function xPostTitleFits(title: string): boolean {
  return twitterText.parseTweet(title).weightedLength <= 280;
}
