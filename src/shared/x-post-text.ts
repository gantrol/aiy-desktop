import twitterText from 'twitter-text';
import { splitXText } from '@/shared/x-text-split';

export function xPostThread(text: string): string[] | null {
  return splitXText(text, twitterText);
}

export function xPostTitleFits(title: string): boolean {
  return twitterText.parseTweet(title).weightedLength <= 280;
}
