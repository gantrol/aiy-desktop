import type { CreatorPromptNodeInput, PromptCommonInputDto, WordPaletteReferenceInput } from '@/shared/contracts';

export function normalizeCreatorPromptNodes(nodes: readonly CreatorPromptNodeInput[]): CreatorPromptNodeInput[] {
  const normalized: CreatorPromptNodeInput[] = [];
  const termIds = new Set<string>();
  const paletteIds = new Set<string>();
  const appendText = (text: string) => {
    if (!text) return;
    const previous = normalized.at(-1);
    if (previous?.kind === 'TEXT') previous.text += text;
    else normalized.push({ kind: 'TEXT', text });
  };
  for (const node of nodes) {
    if (node.kind === 'TEXT') {
      appendText(node.text);
      continue;
    }
    if (node.kind === 'TERM') {
      const termId = node.termId.trim();
      if (!termId || termIds.has(termId)) continue;
      termIds.add(termId);
      normalized.push({
        kind: 'TERM',
        termId,
        ...(node.promptLocale ? { promptLocale: node.promptLocale } : {}),
      });
      continue;
    }
    const paletteId = node.paletteId.trim();
    if (!paletteId || paletteIds.has(paletteId)) continue;
    paletteIds.add(paletteId);
    normalized.push({ kind: 'RECIPE', paletteId });
  }
  return normalized;
}

export function createCreatorPromptDocument(input: {
  manualPrompt: string;
  termIds: readonly string[];
  paletteIds: readonly string[];
  nodes?: readonly CreatorPromptNodeInput[];
}): CreatorPromptNodeInput[] {
  const base =
    input.nodes === undefined
      ? normalizeCreatorPromptNodes([
          ...(input.manualPrompt ? [{ kind: 'TEXT' as const, text: input.manualPrompt }] : []),
          ...input.termIds.map((termId) => ({ kind: 'TERM' as const, termId })),
          ...input.paletteIds.map((paletteId) => ({ kind: 'RECIPE' as const, paletteId })),
        ])
      : normalizeCreatorPromptNodes(input.nodes);
  const existingTerms = new Set(base.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : [])));
  const existingPalettes = new Set(base.flatMap((node) => (node.kind === 'RECIPE' ? [node.paletteId] : [])));
  return normalizeCreatorPromptNodes([
    ...base,
    ...input.termIds
      .filter((termId) => !existingTerms.has(termId))
      .map((termId) => ({ kind: 'TERM' as const, termId })),
    ...input.paletteIds
      .filter((paletteId) => !existingPalettes.has(paletteId))
      .map((paletteId) => ({ kind: 'RECIPE' as const, paletteId })),
  ]);
}

export function reconcileCreatorPromptNodesWithReferences(input: {
  nodes: readonly CreatorPromptNodeInput[];
  termIds: readonly string[];
  paletteIds: readonly string[];
}): CreatorPromptNodeInput[] {
  const termIds = new Set(input.termIds);
  const paletteIds = new Set(input.paletteIds);
  const filtered = normalizeCreatorPromptNodes(input.nodes).filter(
    (node) =>
      node.kind === 'TEXT' ||
      (node.kind === 'TERM' && termIds.has(node.termId)) ||
      (node.kind === 'RECIPE' && paletteIds.has(node.paletteId)),
  );
  const presentTermIds = new Set(filtered.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : [])));
  const presentPaletteIds = new Set(filtered.flatMap((node) => (node.kind === 'RECIPE' ? [node.paletteId] : [])));
  return normalizeCreatorPromptNodes([
    ...filtered,
    ...input.termIds
      .filter((termId) => !presentTermIds.has(termId))
      .map((termId) => ({ kind: 'TERM' as const, termId })),
    ...input.paletteIds
      .filter((paletteId) => !presentPaletteIds.has(paletteId))
      .map((paletteId) => ({ kind: 'RECIPE' as const, paletteId })),
  ]);
}

export function creatorPromptText(nodes: readonly CreatorPromptNodeInput[]) {
  return nodes
    .flatMap((node) => (node.kind === 'TEXT' ? [node.text] : []))
    .join('')
    .trim();
}

export function replaceCreatorPromptText(
  nodes: readonly CreatorPromptNodeInput[],
  text: string,
): CreatorPromptNodeInput[] {
  const firstTextIndex = nodes.findIndex((node) => node.kind === 'TEXT');
  const structured = nodes.filter((node) => node.kind !== 'TEXT');
  if (!text) return structured;
  const insertionIndex =
    firstTextIndex < 0 ? 0 : nodes.slice(0, firstTextIndex).filter((node) => node.kind !== 'TEXT').length;
  return normalizeCreatorPromptNodes([
    ...structured.slice(0, insertionIndex),
    { kind: 'TEXT', text },
    ...structured.slice(insertionIndex),
  ]);
}

export function appendCreatorPromptText(
  nodes: readonly CreatorPromptNodeInput[],
  text: string,
): CreatorPromptNodeInput[] {
  const value = text.trim();
  if (!value) return [...nodes];
  const next = [...nodes];
  let lastTextIndex = -1;
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].kind === 'TEXT') {
      lastTextIndex = index;
      break;
    }
  }
  if (lastTextIndex >= 0) {
    const current = next[lastTextIndex];
    if (current.kind === 'TEXT')
      next[lastTextIndex] = {
        kind: 'TEXT',
        text: current.text ? `${current.text}\n\n${value}` : value,
      };
  } else {
    next.push({ kind: 'TEXT', text: value });
  }
  return normalizeCreatorPromptNodes(next);
}

export function creatorPromptNodesFromCommonInput(
  commonInput: PromptCommonInputDto | null | undefined,
): CreatorPromptNodeInput[] | undefined {
  if (!commonInput?.contentNodes) return undefined;
  const paletteIdByUseId = new Map(commonInput.recipes.map((recipe) => [recipe.useId, recipe.paletteId]));
  const promptLocaleByTermId = new Map(
    commonInput.directTerms.map((term) => [term.termId, term.promptLocale ?? commonInput.directTermPromptLocale]),
  );
  return normalizeCreatorPromptNodes(
    commonInput.contentNodes.flatMap((node): CreatorPromptNodeInput[] => {
      if (node.kind === 'TEXT') return [{ kind: 'TEXT', text: node.text }];
      if (node.kind === 'TERM') {
        const promptLocale = promptLocaleByTermId.get(node.termId);
        return [{ kind: 'TERM', termId: node.termId, ...(promptLocale ? { promptLocale } : {}) }];
      }
      const paletteId = paletteIdByUseId.get(node.useId);
      return paletteId ? [{ kind: 'RECIPE', paletteId }] : [];
    }),
  );
}

export function creatorPromptNodesFromReferences(input: {
  manualPrompt: string;
  termIds: readonly string[];
  wordPaletteReferences: readonly WordPaletteReferenceInput[];
  nodes?: readonly CreatorPromptNodeInput[];
}) {
  return createCreatorPromptDocument({
    manualPrompt: input.manualPrompt,
    termIds: input.termIds,
    paletteIds: input.wordPaletteReferences.map((reference) => reference.paletteId),
    nodes: input.nodes,
  });
}
