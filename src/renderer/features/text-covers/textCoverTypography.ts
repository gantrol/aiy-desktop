const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const closing = /^[，。！？：；、）》」』】”’,.!?;:)\]}]/u;
const opening = /[（《「『【“‘(\[{]$/u;
const phraseEnd = /[，。！？：；、,.!?;:]$/u;
const widthCache = new Map<string, number>();
let measuringContext: OffscreenCanvasRenderingContext2D | null | undefined;

function estimatedWidth(value: string) {
  return [...graphemes.segment(value)].reduce((width, { segment }) => {
    if (/^\s+$/u.test(segment)) return width + 0.32;
    if (/^[ilI.,'`:;!|]$/u.test(segment)) return width + 0.3;
    if (/^[mMwW]$/u.test(segment)) return width + 0.9;
    if (/^[a-z0-9]$/u.test(segment)) return width + 0.56;
    if (/^[A-Z]$/u.test(segment)) return width + 0.7;
    return width + 1;
  }, 0);
}

/** One measuring surface, no font enumeration or per-cover bitmap. Cache sizes are bounded. */
export function textCoverMeasure(family: string, weight: number) {
  if (measuringContext === undefined)
    measuringContext = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  const font = `${weight} 100px ${family}`;
  return (value: string, size: number) => {
    const key = `${font}\n${value}`;
    let width = widthCache.get(key);
    if (width === undefined) {
      if (measuringContext) {
        measuringContext.font = font;
        width = measuringContext.measureText(value).width / 100;
      } else width = estimatedWidth(value);
      if (widthCache.size >= 2048) widthCache.clear();
      widthCache.set(key, width);
    }
    return width * size;
  };
}

type Measure = ReturnType<typeof textCoverMeasure>;

function titleSizeLimit(title: string, width: number, maximum: number, measure: Measure) {
  if (title.includes('\n')) return maximum;
  const units = measure(title, 1);
  // A short title that almost fits on one line should shrink slightly instead
  // of becoming two oversized lines (for example a four-character book title).
  if (units > 0 && units * maximum <= width * 1.18) return Math.min(maximum, (width - 4) / units);
  const phrases = title
    .split(/(?<=[，。！？：；])/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const longest = Math.max(...phrases.map((part) => measure(part, 1)));
  // Keep brief clauses together when this can be done without turning a long
  // paragraph into tiny text. Explicit line breaks always belong to the user.
  return phrases.length > 1 && phrases.length <= 3 && longest <= 13
    ? Math.min(maximum, (width - 4) / longest)
    : maximum;
}

function titleTokens(paragraph: string, capacity: number, measure: Measure) {
  const tokens: string[] = [];
  for (const { segment } of words.segment(paragraph)) {
    const pieces =
      measure(segment, 1) > capacity ? [...graphemes.segment(segment)].map((item) => item.segment) : [segment];
    for (const piece of pieces) {
      const previous = tokens.at(-1);
      if (previous !== undefined && (closing.test(piece) || opening.test(previous) || /^\s+$/u.test(piece)))
        tokens[tokens.length - 1] += piece;
      else tokens.push(piece);
    }
  }
  return tokens;
}

function wrapParagraph(paragraph: string, capacity: number, measure: Measure) {
  const tokens = titleTokens(paragraph, capacity, measure);
  if (!tokens.length) return [''];
  const widths = tokens.map((token) => measure(token, 1));
  const trailingSpace = tokens.map((token) => measure(token.match(/\s+$/u)?.[0] ?? '', 1));
  const costs = Array<number>(tokens.length + 1).fill(Infinity);
  const breaks = Array<number>(tokens.length).fill(tokens.length);
  costs[tokens.length] = 0;
  for (let start = tokens.length - 1; start >= 0; start -= 1) {
    let line = '';
    let lineWidth = 0;
    for (let end = start; end < tokens.length; end += 1) {
      line += tokens[end];
      lineWidth += widths[end];
      const used = lineWidth - trailingSpace[end];
      if (used > capacity && end > start) break;
      const slack = Math.max(0, 1 - used / capacity);
      // Keep word groups and punctuation intact; prefer balanced lines without
      // forcing a phrase into equal character counts or leaving a one-word tail.
      const cost =
        costs[end + 1] + 3 + slack * slack * 4 + (slack > 0.65 ? 3 : 0) - (phraseEnd.test(line.trim()) ? 0.65 : 0);
      if (cost < costs[start]) {
        costs[start] = cost;
        breaks[start] = end + 1;
      }
    }
  }
  const lines: string[] = [];
  for (let start = 0; start < tokens.length; start = breaks[start])
    lines.push(tokens.slice(start, breaks[start]).join('').trim());
  return lines;
}

export function fitTextCoverTitle(
  title: string,
  width: number,
  height: number,
  maximumSize: number,
  leading: number,
  measure: Measure,
) {
  const wrap = (size: number) =>
    title.split('\n').flatMap((paragraph) => wrapParagraph(paragraph, (width - 4) / size, measure));
  const blockHeight = (count: number, size: number) => size * (1 + Math.max(0, count - 1) * leading);
  const fits = (lines: string[], size: number) =>
    blockHeight(lines.length, size) <= height && lines.every((line) => measure(line, size) <= width);
  let low = 28;
  let high = Math.max(low, titleSizeLimit(title, width, maximumSize, measure));
  for (let step = 0; step < 9; step += 1) {
    const size = (low + high) / 2;
    if (fits(wrap(size), size)) low = size;
    else high = size;
  }
  const size = Math.floor(low);
  let lines = wrap(size);
  const overflow = !fits(lines, size);
  if (overflow) {
    const capacity = Math.max(1, Math.floor((height / size - 1) / leading) + 1);
    lines = lines.slice(0, capacity);
    const last = [...graphemes.segment(lines.at(-1) ?? '')].map((item) => item.segment);
    while (last.length && measure(`${last.join('')}…`, size) > width) last.pop();
    lines[lines.length - 1] = `${last.join('')}…`;
  }
  return { lines, size, height: blockHeight(lines.length, size), overflow };
}
