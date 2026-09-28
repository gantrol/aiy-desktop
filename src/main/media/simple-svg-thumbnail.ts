import { stat } from 'node:fs/promises';
import { SaxesParser } from 'saxes';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { imageDimensions } from '@/main/media/image-dimensions';

// Keep direct rendering cheap even when many thumbnails share a viewport.
const maximumBytes = 32 * 1024;
const maximumElements = 128;
const maximumDepth = 16;
const maximumGeometryNumbers = 2_048;
const svgNamespace = 'http://www.w3.org/2000/svg';
const elements = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'metadata',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'linearGradient',
  'radialGradient',
  'stop',
]);
const attributes = new Set([
  'id',
  'class',
  'version',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'd',
  'points',
  'pathLength',
  'transform',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'fill',
  'fill-rule',
  'fill-opacity',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'stop-color',
  'stop-opacity',
  'vector-effect',
  'shape-rendering',
  'style',
  'role',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'focusable',
]);
const styleProperties = new Set([
  'fill',
  'fill-rule',
  'fill-opacity',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'stop-color',
  'stop-opacity',
  'vector-effect',
  'shape-rendering',
  'flex',
  'line-height',
]);
const geometryAttributes = new Set(['d', 'points', 'transform', 'gradientTransform']);

function staticStyleValue(value: string) {
  return (
    /^[\w\s#.,%+\-]+$/u.test(value) ||
    /^url\(\s*(?:#[\w.-]+|"#[\w.-]+"|'#[\w.-]+')\s*\)$/u.test(value) ||
    /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/u.test(value)
  );
}

function staticStyle(value: string) {
  return value.split(';').every((declaration) => {
    if (!declaration.trim()) return true;
    const separator = declaration.indexOf(':');
    return (
      separator > 0 &&
      styleProperties.has(declaration.slice(0, separator).trim().toLowerCase()) &&
      staticStyleValue(declaration.slice(separator + 1).trim())
    );
  });
}

/** An allowlist of bounded, self-contained, static vector geometry; everything else uses PNG. */
function isSimpleStaticSvg(bytes: Buffer) {
  const dimensions = imageDimensions(bytes, '.svg');
  if (
    !dimensions ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > 16_384 ||
    dimensions.height > 16_384
  )
    return false;
  const parser = new SaxesParser({ xmlns: true });
  let count = 0;
  let depth = 0;
  let geometryNumbers = 0;
  const reject = () => {
    throw new Error('SVG requires a static PNG thumbnail');
  };
  parser.on('doctype', reject);
  parser.on('processinginstruction', reject);
  parser.on('xmldecl', (declaration) => {
    if (declaration.encoding && declaration.encoding.toLowerCase() !== 'utf-8') reject();
  });
  parser.on('opentag', (tag) => {
    count += 1;
    depth += 1;
    if (count > maximumElements || depth > maximumDepth || tag.uri !== svgNamespace || !elements.has(tag.local))
      reject();
    if ((count === 1) !== (tag.local === 'svg')) reject();
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === 'http://www.w3.org/2000/xmlns/') continue;
      if (attribute.uri || !attributes.has(attribute.name)) reject();
      if (attribute.name === 'style' && !staticStyle(attribute.value)) reject();
      if (styleProperties.has(attribute.name) && !staticStyleValue(attribute.value)) reject();
      if (geometryAttributes.has(attribute.name)) {
        geometryNumbers += attribute.value.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu)?.length ?? 0;
        if (geometryNumbers > maximumGeometryNumbers) reject();
      }
    }
  });
  parser.on('closetag', () => {
    depth -= 1;
  });
  try {
    parser.write(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).close();
    return count > 0;
  } catch {
    return false;
  }
}

export async function readSimpleSvgThumbnail(filePath: string, signal: AbortSignal): Promise<Buffer | null> {
  signal.throwIfAborted();
  const entry = await stat(filePath);
  signal.throwIfAborted();
  if (entry.size > maximumBytes) return null;
  const bytes = await readBoundedImageFile(filePath, signal, maximumBytes);
  return isSimpleStaticSvg(bytes) ? bytes : null;
}
