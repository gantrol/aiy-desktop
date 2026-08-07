import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const componentRoot = path.resolve(__dirname, '../src/renderer/components/creator');

function read(relativePath: string) {
  return fs.readFileSync(path.join(componentRoot, relativePath), 'utf8');
}

describe('annotation visual contract', () => {
  it('uses the shared overlay surface and elevation for temporary annotation controls', () => {
    for (const file of [
      'annotations/AnnotationComposer.tsx',
      'annotations/AnnotationList.tsx',
      'annotations/AnnotationToolbar.tsx',
    ]) {
      const source = read(file);
      expect(source, file).toContain('bg-overlay');
      expect(source, file).toContain('shadow-overlay');
      expect(source, file).not.toMatch(/bg-background\/95|shadow-(?:sm|md|lg|xl|2xl)/);
    }
  });

  it('keeps annotation media on a neutral judgment field without decorative elevation', () => {
    const stage = read('annotations/annotorious/AnnotationImageStage.tsx');
    expect(stage).toContain('bg-media-surround');
    expect(stage).toContain('bg-media-surround-light');
    expect(stage).not.toMatch(/\bshadow-(?:sm|md|lg|xl|2xl)\b/);

    const marker = read('annotations/annotorious/AnnotationMarkerLayer.tsx');
    expect(marker).not.toMatch(/\bshadow-(?:sm|md|lg|xl|2xl)\b/);
  });

  it('keeps reference thumbnails uncropped and on the media surface', () => {
    const strip = read('CreationReferenceStrip.tsx');
    expect(strip).toContain('bg-media-surround-light');
    expect(strip).toContain('object-contain');
    expect(strip).not.toContain('object-cover');
  });

  it('keeps recipes as aggregate references while preserving explicit direct-term source actions', () => {
    const strip = read('CreationReferenceStrip.tsx');
    expect(strip).toContain('promptResolution.effectiveTerms.filter(({ directSource }) => directSource)');
    expect(strip).toContain('directTerms.map');
    expect(strip).not.toContain('promptResolution.effectiveTerms.map');
    expect(strip).toContain('data-direct-source="true"');
    expect(strip).toContain('data-recipe-source-count={recipeUseIds.length}');
    expect(strip).toContain('data-remove-source="direct"');
    expect(strip).toContain('data-remove-source="recipe"');
    expect(strip).toContain('reference.revision.terms.map');
    expect(strip).not.toContain('reference.revision.terms.slice');
    expect(strip).toContain('<Popover');
    expect(strip).toContain('onPointerEnter={show}');
    expect(strip).toContain('onFocus={show}');
    expect(strip).toContain('onClick={togglePinned}');
    expect(strip).toContain('onOpenPalette={() => onOpenPalette(reference.palette.id)}');
    expect(strip).toContain('onClick={onOpenPalette}');

    const comparisonUtils = read('generationComparisonUtils.ts');
    expect(comparisonUtils).toContain('export function comparisonVersionReferenceNames');
    expect(comparisonUtils).toContain('const directTerms = [...new Set(version.termIds)]');
    expect(comparisonUtils).toContain('const frozenRecipes = version.promptInputSnapshot?.commonInput.recipes ?? []');
    expect(comparisonUtils).toContain('const recipes = [');
    expect(comparisonUtils).not.toContain('directAndPaletteIds');
    expect(comparisonUtils).not.toContain('revisionTerms');

    const comparison = read('GenerationComparison.tsx');
    expect(comparison).toContain('comparisonVersionReferenceNames');
    expect(comparison).toContain('function versionInstruction');
    expect(comparison).not.toContain('fullPrompt: version.finalPrompt');
  });

  it('separates generation facts without flattening recipe terms into history', () => {
    const record = read('OutputGenerationRecord.tsx');
    expect(record).toContain('<GenerationFactLayers');
    expect(record).not.toContain('{generatedRecord.version.finalPrompt}');

    const layers = read('GenerationFactLayers.tsx');
    expect(layers).toContain('common.directTerms.map');
    expect(layers).toContain('common.recipes.map');
    expect(layers).toContain('<RecipeFactChip');
    expect(layers).toContain('recipe.terms.map');
    expect(layers).toContain('executionSnapshot.clientRequestText');
    expect(layers).toContain('executionSnapshot.actualRequest');
    expect(layers).toContain('run.providerReturnedDescriptions?.map');
    expect(layers).not.toContain('responseMetadata');
  });
});
