import type { VideoDocumentTranscriptCue } from '@/shared/contracts';

const VTT_TIME_RANGE =
  /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})\s+-->\s+(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})(?:\s+.*)?$/;

function timestampMs(hours: string | undefined, minutes: string, seconds: string, milliseconds: string) {
  return Number(hours ?? 0) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(milliseconds);
}

export function parseWebVtt(rawText: string): VideoDocumentTranscriptCue[] {
  const normalized = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (!/^WEBVTT(?:\s.*)?$/.test(lines.shift()?.trim() ?? '')) {
    throw new Error('WebVTT file has an invalid header');
  }
  while (lines.length && lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  const blocks = lines
    .join('\n')
    .replace(/\n+$/, '')
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0 && !/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(block.trimStart()));
  if (!blocks.length) throw new Error('WebVTT file has no cues');
  if (blocks.length > 20_000) throw new Error('WebVTT file contains too many cues');

  return blocks.map((block, blockIndex) => {
    const cueLines = block.split('\n');
    let timeLine = cueLines.shift()?.trim() ?? '';
    if (!timeLine.includes('-->')) timeLine = cueLines.shift()?.trim() ?? '';
    const timeRange = timeLine.match(VTT_TIME_RANGE);
    if (!timeRange) throw new Error(`WebVTT cue ${blockIndex + 1} has an invalid time range`);
    const text = cueLines.join('\n');
    if (!text.trim()) throw new Error(`WebVTT cue ${blockIndex + 1} has no text`);
    const startTimestampMs = timestampMs(timeRange[1], timeRange[2]!, timeRange[3]!, timeRange[4]!);
    const endTimestampMs = timestampMs(timeRange[5], timeRange[6]!, timeRange[7]!, timeRange[8]!);
    if (endTimestampMs < startTimestampMs) {
      throw new Error(`WebVTT cue ${blockIndex + 1} ends before it starts`);
    }
    return {
      sourceIndex: blockIndex + 1,
      startTimestampMs,
      endTimestampMs,
      text,
    };
  });
}
