import { setImmediate } from 'node:timers/promises';
import { SaxesParser } from 'saxes';

/** Validate the complete XML document without rendering or rewriting the source. */
export async function validateSvgImageAsync(text: string, signal: AbortSignal): Promise<boolean> {
  const parser = new SaxesParser({ xmlns: true });
  let rootSeen = false;
  const reject = () => {
    throw new Error('Invalid SVG document');
  };
  parser.on('doctype', reject);
  parser.on('processinginstruction', reject);
  parser.on('xmldecl', (declaration) => {
    if (declaration.encoding && declaration.encoding.toLowerCase() !== 'utf-8') reject();
  });
  parser.on('opentag', (tag) => {
    if (!rootSeen) {
      if (tag.local !== 'svg' || tag.uri !== 'http://www.w3.org/2000/svg') reject();
      rootSeen = true;
    }
  });
  try {
    for (let offset = 0; offset < text.length; offset += 64 * 1024) {
      signal.throwIfAborted();
      parser.write(text.slice(offset, offset + 64 * 1024));
      await setImmediate(undefined, { signal });
    }
    parser.close();
    return rootSeen;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}
