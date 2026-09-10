import type { VideoDocumentTranscriptCue } from '@/shared/contracts';
import { trimTrailingCharacters } from '@/shared/string-boundaries';

const SRT_TIME_RANGE =
  /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s.*)?$/;

function timestampMs(hours: string, minutes: string, seconds: string, milliseconds: string) {
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(milliseconds);
}

export function parseSrt(rawText: string): VideoDocumentTranscriptCue[] {
  const normalized = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = trimTrailingCharacters(normalized, '\n')
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0);
  if (!blocks.length) throw new Error('Subtitle file has no cues');
  if (blocks.length > 20_000) throw new Error('Subtitle file contains too many cues');

  return blocks.map((block, blockIndex) => {
    const lines = block.split('\n');
    const sourceIndexText = lines.shift()?.trim() ?? '';
    if (!/^\d+$/.test(sourceIndexText) || Number(sourceIndexText) < 1) {
      throw new Error(`Subtitle cue ${blockIndex + 1} has an invalid source index`);
    }
    const timeRange = lines.shift()?.trim().match(SRT_TIME_RANGE);
    if (!timeRange) throw new Error(`Subtitle cue ${sourceIndexText} has an invalid time range`);
    const text = lines.join('\n');
    if (!text.trim()) throw new Error(`Subtitle cue ${sourceIndexText} has no text`);
    const startTimestampMs = timestampMs(timeRange[1]!, timeRange[2]!, timeRange[3]!, timeRange[4]!);
    const endTimestampMs = timestampMs(timeRange[5]!, timeRange[6]!, timeRange[7]!, timeRange[8]!);
    if (endTimestampMs < startTimestampMs) {
      throw new Error(`Subtitle cue ${sourceIndexText} ends before it starts`);
    }
    return {
      sourceIndex: Number(sourceIndexText),
      startTimestampMs,
      endTimestampMs,
      text,
    };
  });
}
