import { describe, expect, it } from 'vitest';
import type { CodexAssistResult } from '../src/shared/contracts';
import { createTestLibrary } from './support/test-library';

const onePixelPng = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);

const result: CodexAssistResult = {
  assistantMessage: 'Try a quieter background.',
  optimizedPrompt: 'quiet pool portrait',
  promptEdit: {
    summary: 'Reduce background noise',
    preserved: ['subject'],
    changes: [{ before: 'pool portrait', after: 'quiet pool portrait', reason: 'Clearer focus' }],
    removed: [],
    revisedUserInstruction: 'quiet pool portrait',
  },
  sharedConstraints: [],
  assumptions: [],
  directions: [],
};

describe('creator agent conversation persistence', () => {
  it('persists a message-level image attachment and returns it with history', () => {
    const library = createTestLibrary('aibd-creator-conversation-');
    try {
      const draft = library.database.saveCreationDraft({
        id: null,
        title: '',
        text: 'pool portrait',
        referenceAssetIds: [],
        termPromptLocale: 'en',
        termIds: [],
        wordPaletteReferences: [],
        canvasPresetKey: null,
        quality: 'low',
        selectedModelKeys: [],
        repeatCount: 1,
        modelTargets: [],
      });
      const [attachment] = library.database.importCreatorReferences({
        context: { seriesId: null, versionId: null, title: '', source: 'PASTE' },
        items: [{ id: 'image-1', name: 'reference.png', mimeType: 'image/png', bytes: onePixelPng }],
      });

      const turn = library.database.addCreatorAgentTurn(
        { kind: 'DRAFT', id: draft.id },
        {
          scope: { kind: 'DRAFT', id: draft.id },
          mode: 'chat',
          prompt: 'pool portrait',
          message: 'Use this as visual context',
          locale: 'en',
          directTerms: [],
          recipes: [],
          referenceAssets: [
            {
              assetId: attachment.id,
              kind: attachment.kind,
              originType: attachment.originType,
              width: attachment.width,
              height: attachment.height,
              mimeType: attachment.mimeType,
            },
          ],
          attachmentAssetIds: [attachment.id],
        },
        result,
      );

      expect(turn.attachments).toEqual([
        expect.objectContaining({
          id: attachment.id,
          mediaUrl: expect.stringContaining(attachment.id),
        }),
      ]);
      expect(library.database.listCreatorAgentTurns({ kind: 'DRAFT', id: draft.id })).toEqual([
        expect.objectContaining({
          id: turn.id,
          mode: 'chat',
          message: 'Use this as visual context',
          attachments: [expect.objectContaining({ id: attachment.id })],
          result: expect.objectContaining({ assistantMessage: 'Try a quieter background.' }),
        }),
      ]);
    } finally {
      library.cleanup();
    }
  });
});
