import type { TermListItem, WordPalettePromptNodeInput, WordPaletteRevisionDto } from '@/shared/contracts';
import {
  renderPaletteOptionPrompt,
  type PaletteParameterDraft,
} from '@/renderer/components/palette/wordPaletteOptions';

export type PromptDocumentNode =
  | {
      kind: 'TEXT';
      editorKey: string;
      promptFragment: string;
    }
  | {
      kind: 'TERM';
      editorKey: string;
      termId: string;
    }
  | {
      kind: 'SLOT';
      editorKey: string;
      stableKey: string;
    };

const EMPTY_DOCUMENT_EDITOR_KEY = 'prompt_document_empty';

function editorKeyPart(value: string) {
  return encodeURIComponent(value).replaceAll('%', '_');
}

function emptyPromptDocument(): PromptDocumentNode[] {
  return [
    {
      kind: 'TEXT',
      editorKey: EMPTY_DOCUMENT_EDITOR_KEY,
      promptFragment: '',
    },
  ];
}

/**
 * Keeps Prompt characters byte-for-byte while removing structurally redundant
 * TEXT nodes. Whitespace-only TEXT nodes are meaningful in an inline document.
 */
export function normalizePromptDocument(nodes: readonly PromptDocumentNode[]): PromptDocumentNode[] {
  const normalized: PromptDocumentNode[] = [];

  for (const node of nodes) {
    if (node.kind !== 'TEXT') {
      normalized.push({ ...node });
      continue;
    }
    if (!node.promptFragment.length) continue;
    const previous = normalized.at(-1);
    if (previous?.kind === 'TEXT') {
      previous.promptFragment += node.promptFragment;
      continue;
    }
    normalized.push({ ...node });
  }

  return normalized.length ? normalized : emptyPromptDocument();
}

export function loadPromptDocument(revision: Pick<WordPaletteRevisionDto, 'promptNodes'>): PromptDocumentNode[] {
  return normalizePromptDocument(
    revision.promptNodes.map((node): PromptDocumentNode => {
      if (node.kind === 'TEXT') {
        return { kind: 'TEXT', editorKey: node.id, promptFragment: node.promptFragment };
      }
      if (node.kind === 'TERM') {
        return { kind: 'TERM', editorKey: node.id, termId: node.term.id };
      }
      return { kind: 'SLOT', editorKey: node.id, stableKey: node.stableKey };
    }),
  );
}

export function createInitialPromptDocument(termIds: readonly string[]): PromptDocumentNode[] {
  const termNodes = termIds.flatMap((termId, index): PromptDocumentNode[] => {
    const normalizedTermId = termId.trim();
    return normalizedTermId
      ? [
          {
            kind: 'TERM',
            editorKey: `initial_term_${editorKeyPart(normalizedTermId)}_${index}`,
            termId: normalizedTermId,
          },
        ]
      : [];
  });
  return normalizePromptDocument(
    termNodes.flatMap((node, index): PromptDocumentNode[] => [
      ...(index
        ? [
            {
              kind: 'TEXT' as const,
              editorKey: `initial_separator_${index}`,
              promptFragment: ', ',
            },
          ]
        : []),
      node,
    ]),
  );
}

/** The visual editor currently edits only the positive channel. */
export function loadPromptDocumentNegative(revision: Pick<WordPaletteRevisionDto, 'promptNodes'>): string {
  return revision.promptNodes.flatMap((node) => (node.kind === 'TEXT' ? [node.negativeFragment] : [])).join('');
}

export function promptDocumentInputs(
  nodes: readonly PromptDocumentNode[],
  negativePrompt = '',
): WordPalettePromptNodeInput[] {
  let negativeAssigned = false;
  const inputs = normalizePromptDocument(nodes).map((node): WordPalettePromptNodeInput => {
    if (node.kind === 'TERM') return { kind: 'TERM', termId: node.termId };
    if (node.kind === 'SLOT') return { kind: 'SLOT', stableKey: node.stableKey };
    const negativeFragment = negativeAssigned ? '' : negativePrompt;
    negativeAssigned = true;
    return {
      kind: 'TEXT',
      promptFragment: node.promptFragment,
      negativeFragment,
    };
  });

  if (negativePrompt && !negativeAssigned) {
    inputs.unshift({
      kind: 'TEXT',
      promptFragment: '',
      negativeFragment: negativePrompt,
    });
  }
  return inputs;
}

export function promptDocumentTermIds(nodes: readonly PromptDocumentNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : []));
}

export function promptDocumentSlotKeys(nodes: readonly PromptDocumentNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === 'SLOT' ? [node.stableKey] : []));
}

/** Renders the first option in each SLOT and never inserts punctuation or spaces. */
export function renderPromptDocumentPreview(
  nodes: readonly PromptDocumentNode[],
  terms: readonly TermListItem[],
  parameters: readonly PaletteParameterDraft[],
): string {
  const termsById = new Map(terms.map((term) => [term.id, term]));
  const parametersByKey = new Map(parameters.map((parameter) => [parameter.stableKey, parameter]));

  return normalizePromptDocument(nodes)
    .map((node) => {
      if (node.kind === 'TEXT') return node.promptFragment;
      if (node.kind === 'TERM') {
        const term = termsById.get(node.termId);
        return term?.modelExpressions[0]?.positive ?? term?.title ?? '';
      }
      const option = parametersByKey.get(node.stableKey)?.options[0];
      return option ? renderPaletteOptionPrompt(option, termsById) : '';
    })
    .join('');
}
