import type { Components } from 'react-markdown';
import type { Element } from 'hast';
import { createElement } from 'react';
import { ContentMath } from '@/renderer/features/content-editor/ContentMath';

function mathCode(node: Element | undefined) {
  const classes = node?.properties.className;
  return Array.isArray(classes) && (classes.includes('language-math') || classes.includes('math-inline'));
}

function sourceText(node: Element): string {
  return node.children
    .map((child) => (child.type === 'text' ? child.value : child.type === 'element' ? sourceText(child) : ''))
    .join('');
}

/** Math owns only its syntax; hosts still resolve ordinary code, links and media. */
export function contentMarkdownMath(components: Components): Components {
  const Code = components.code;
  const Pre = components.pre;
  return {
    ...components,
    code: ({ node, ...props }) =>
      mathCode(node) ? (
        <ContentMath source={sourceText(node!).replace(/\n$/u, '')} display={false} />
      ) : Code ? (
        typeof Code === 'string' ? (
          createElement(Code, props)
        ) : (
          <Code node={node} {...props} />
        )
      ) : (
        <code {...props} />
      ),
    pre: ({ node, ...props }) => {
      const code = node?.children[0];
      if (code?.type === 'element' && mathCode(code)) {
        const source = sourceText(code);
        return <ContentMath source={source.replace(/\n$/u, '')} display />;
      }
      return Pre ? (
        typeof Pre === 'string' ? (
          createElement(Pre, props)
        ) : (
          <Pre node={node} {...props} />
        )
      ) : (
        <pre {...props} />
      );
    },
  };
}
