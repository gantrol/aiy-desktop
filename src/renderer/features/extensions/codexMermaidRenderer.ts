import type {
  CodexVisualizationArtifactDto,
  CodexVisualizationMermaidPreviewDto,
} from '@/shared/contracts/codex-visualizations';
import { readCssTokens } from '@/renderer/lib/tokens';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAX_CACHED_PREVIEWS = 24;
const MAX_MERMAID_SVG_CHARACTERS = 8 * 1024 * 1024;
const blockedSvgTags = new Set(['audio', 'embed', 'foreignobject', 'iframe', 'image', 'object', 'script', 'video']);
const blockedCssPattern = /@import|expression\s*\(|url\s*\(\s*(?!['"]?#)/i;
const blockedAttributeValuePattern = /javascript\s*:|data\s*:\s*text\/html/i;
const secureMermaidConfigKeys = [
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  'htmlLabels',
  'theme',
  'themeVariables',
  'themeCSS',
  'darkMode',
  'look',
  'fontFamily',
  'altFontFamily',
  'dompurifyConfig',
  'deterministicIds',
  'deterministicIDSeed',
];

const svgByCacheKey = new Map<string, Promise<string>>();
let renderQueue = Promise.resolve();

function sanitizeStaticSvg(source: string) {
  if (source.length > MAX_MERMAID_SVG_CHARACTERS) throw new Error('Mermaid preview SVG exceeds its safety limit');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.namespaceURI !== SVG_NAMESPACE || root.localName !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('Mermaid did not produce a valid SVG');
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.namespaceURI !== SVG_NAMESPACE || blockedSvgTags.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const externalReference = (name === 'href' || name === 'xlink:href') && !value.startsWith('#');
      const unsafeStyle = name === 'style' && blockedCssPattern.test(value);
      if (name.startsWith('on') || externalReference || unsafeStyle || blockedAttributeValuePattern.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.localName === 'style' && blockedCssPattern.test(element.textContent ?? '')) {
      throw new Error('Mermaid preview contains blocked CSS');
    }
  }
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  const width = viewBox?.[2];
  const height = viewBox?.[3];
  if (typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height)) {
    if (width > 0 && height > 0) {
      root.setAttribute('width', String(width));
      root.setAttribute('height', String(height));
    }
  }
  root.setAttribute('xmlns', SVG_NAMESPACE);
  return new XMLSerializer().serializeToString(root);
}

function mermaidThemeVariables() {
  const tokens = readCssTokens([
    '--background',
    '--surface',
    '--surface-sunken',
    '--foreground',
    '--foreground-secondary',
    '--border',
    '--border-strong',
    '--success',
    '--success-surface',
    '--warning',
    '--warning-surface',
  ] as const);
  return {
    background: tokens['--background'],
    primaryColor: tokens['--success-surface'],
    primaryTextColor: tokens['--foreground'],
    primaryBorderColor: tokens['--success'],
    secondaryColor: tokens['--warning-surface'],
    secondaryTextColor: tokens['--foreground'],
    secondaryBorderColor: tokens['--warning'],
    tertiaryColor: tokens['--surface-sunken'],
    tertiaryTextColor: tokens['--foreground'],
    tertiaryBorderColor: tokens['--border-strong'],
    lineColor: tokens['--foreground-secondary'],
    textColor: tokens['--foreground'],
    mainBkg: tokens['--success-surface'],
    nodeBorder: tokens['--success'],
    clusterBkg: tokens['--surface'],
    clusterBorder: tokens['--border-strong'],
    edgeLabelBackground: tokens['--background'],
    actorBkg: tokens['--success-surface'],
    actorBorder: tokens['--success'],
    actorTextColor: tokens['--foreground'],
    noteBkgColor: tokens['--warning-surface'],
    noteBorderColor: tokens['--warning'],
    noteTextColor: tokens['--foreground'],
    signalColor: tokens['--foreground-secondary'],
    signalTextColor: tokens['--foreground'],
    labelBoxBkgColor: tokens['--surface'],
    labelBoxBorderColor: tokens['--border-strong'],
    labelTextColor: tokens['--foreground'],
  };
}

async function renderMermaidNow(access: CodexVisualizationMermaidPreviewDto) {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    maxTextSize: 512 * 1024,
    maxEdges: 5_000,
    theme: 'base',
    look: 'classic',
    deterministicIds: true,
    deterministicIDSeed: access.artifactId,
    secure: secureMermaidConfigKeys,
    themeVariables: mermaidThemeVariables(),
  });
  const renderId = `codexMermaid${crypto.randomUUID().replaceAll('-', '')}`;
  const { svg } = await mermaid.render(renderId, access.sourceText);
  return sanitizeStaticSvg(svg);
}

function enqueueMermaidRender(access: CodexVisualizationMermaidPreviewDto) {
  const result = renderQueue.then(() => renderMermaidNow(access));
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function codexMermaidPreviewCacheKey(artifact: CodexVisualizationArtifactDto) {
  const theme = document.documentElement.dataset.theme ?? 'light';
  return `${artifact.id}:${artifact.byteSize}:${artifact.modifiedAt}:${theme}`;
}

export function renderCodexMermaidSvg(cacheKey: string, access: CodexVisualizationMermaidPreviewDto): Promise<string> {
  const cached = svgByCacheKey.get(cacheKey);
  if (cached) {
    svgByCacheKey.delete(cacheKey);
    svgByCacheKey.set(cacheKey, cached);
    return cached;
  }
  const result = enqueueMermaidRender(access).catch((reason: unknown) => {
    svgByCacheKey.delete(cacheKey);
    throw reason;
  });
  svgByCacheKey.set(cacheKey, result);
  while (svgByCacheKey.size > MAX_CACHED_PREVIEWS) {
    const oldestKey = svgByCacheKey.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    svgByCacheKey.delete(oldestKey);
  }
  return result;
}
