import { useEffect, useState } from 'react';
import 'katex/dist/katex.min.css';

export function CodexHistoryMath({ source, display }: { source: string; display: boolean }) {
  const renderKey = `${display ? 'block' : 'inline'}:${source}`;
  const [rendered, setRendered] = useState({ key: '', html: '' });
  useEffect(() => {
    let disposed = false;
    void import('katex')
      .then(({ default: katex }) => {
        if (disposed) return;
        setRendered({
          key: renderKey,
          html: katex.renderToString(source.slice(0, 16_384), {
            displayMode: display,
            throwOnError: false,
            trust: false,
            strict: 'warn',
            output: 'htmlAndMathml',
          }),
        });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [display, renderKey, source]);
  if (rendered.key !== renderKey) return <code>{source}</code>;
  const Component = display ? 'div' : 'span';
  return (
    <Component
      className={display ? 'my-3 overflow-x-auto py-1' : ''}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
