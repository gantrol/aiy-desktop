import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ImageBreakdownCreateInput } from '@/shared/contracts/image-breakdown';

export function createImageBreakdownApi(
  repositories: Pick<LibraryDatabaseRepositories, 'creationItems' | 'imageBreakdowns' | 'workbench'>,
) {
  return {
    listImageBreakdowns() {
      return repositories.imageBreakdowns.list();
    },

    getImageBreakdown(id: string) {
      return repositories.imageBreakdowns.get(id);
    },

    getImageBreakdownCreationItem(id: string) {
      return repositories.creationItems.findForEntity({ kind: 'IMAGE_BREAKDOWN', id });
    },

    createImageBreakdown(input: ImageBreakdownCreateInput) {
      return repositories.imageBreakdowns.create(input);
    },

    replaceImageBreakdownSource(id: string, sourceAssetId: string) {
      return repositories.imageBreakdowns.replaceSource(id, sourceAssetId);
    },

    beginImageBreakdown(
      id: string,
      focus: string,
      routeKey: 'ANTIGRAVITY_CLI' | 'GOOGLE_GEMINI' | 'DEEPSEEK_VL',
      modelKey: string,
    ) {
      return repositories.imageBreakdowns.begin(id, focus, routeKey, modelKey);
    },

    succeedImageBreakdown(
      id: string,
      result: Parameters<LibraryDatabaseRepositories['imageBreakdowns']['succeed']>[1],
    ) {
      return repositories.imageBreakdowns.succeed(id, result);
    },

    failImageBreakdown(id: string, code: string, message: string) {
      return repositories.imageBreakdowns.fail(id, code, message);
    },

    imageBreakdownPrompt(id: string, kind: 'FULL' | 'STYLE' | 'COMPOSITION_LIGHT') {
      return repositories.imageBreakdowns.prompt(id, kind);
    },

    getImageBreakdownImageForm(id: string) {
      return repositories.imageBreakdowns.imageForm(id);
    },

    getImageBreakdownAssetPath(assetId: string) {
      return repositories.workbench.getGenerationAssetPath(assetId);
    },
  };
}
