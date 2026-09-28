import { useEffect, useState } from 'react';
import { mathSourceLimit } from '@/shared/content-math';
import 'katex/dist/katex.min.css';

/** Source remains visible while loading, and when a formula cannot be rendered. */
export function ContentMath({ source, display }: { source: string; display: boolean }) {
  const key = `${display}:${source}`;
  const [rendered, setRendered] = useState({ key: '', html: '' });
  useEffect(() => {
    if (source.length > mathSourceLimit) return;
    let disposed = false;
    void import('katex')
      .then(({ default: katex }) => {
        if (disposed) return;
        try {
          const html = katex.renderToString(source, {
            displayMode: display,
            throwOnError: false,
            trust: false,
            strict: 'ignore',
            maxExpand: 1000,
            maxSize: 20,
            output: 'htmlAndMathml',
          });
          setRendered({ key, html });
        } catch {
          // Keep the complete source available for correction and copying.
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [display, key, source]);
  return (
    <span
      data-content-math={display ? 'block' : 'inline'}
      className={display ? 'my-3 block max-w-full overflow-x-auto py-1' : 'inline'}
      {...(rendered.key === key
        ? { dangerouslySetInnerHTML: { __html: rendered.html } }
        : { children: <code className="whitespace-pre-wrap break-words">{source}</code> })}
    />
  );
}
