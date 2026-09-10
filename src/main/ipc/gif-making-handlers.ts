import { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { GifMakingService } from '@/main/media/gif-making-service';
import {
  gifExportSchema,
  gifIdSchema,
  gifSaveSchema,
  gifWorkspaceStateSchema,
  gifWorkspaceCreateSchema,
} from '@/shared/contracts/gif-making';
import { GifGenerationService } from '@/main/media/gif-generation-service';
import type { GenerationService } from '@/main/generation/service';
import type { CodexService } from '@/main/assistant/codex-service';
import type { AssistantRoutingConfiguration } from '@/main/assistant/assistant-routing';
import { gifPlanRequestSchema } from '@/shared/contracts/gif-motion-plan';
import { gifGenerationAdoptSchema, gifGenerationStartSchema } from '@/shared/contracts/gif-generation';
import { gifDocumentPurposeSchema } from '@/shared/contracts/gif-motion-draft';

const importSchema = z
  .object({
    name: z.string().max(500),
    bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024),
  })
  .strict();
export function registerGifMakingIpc(
  ipc: IpcHandlerRegistrar,
  database: LibraryDatabase,
  generation: GenerationService,
  codex: CodexService,
  assistantRouting: AssistantRoutingConfiguration,
) {
  const service = new GifMakingService(database);
  const generated = new GifGenerationService(database, generation, codex, assistantRouting);
  ipc.handle('gif:workspace-open', (_event, id) => database.openGifWorkspace(z.string().uuid().parse(id)));
  ipc.handle('gif:workspace-create', (_event, input) =>
    database.createGifWorkspace(gifWorkspaceCreateSchema.parse(input)),
  );
  ipc.handle('gif:frames-as-group', (_event, documentId, candidateId) =>
    database.gifFramesAsGroup(z.string().uuid().parse(documentId), z.string().uuid().parse(candidateId)),
  );
  ipc.handle('gif:workspace-save', (_event, id, state) =>
    database.saveGifWorkspace(z.string().uuid().parse(id), gifWorkspaceStateSchema.parse(state)),
  );
  ipc.handle('gif:plan', (_event, input) => generated.plan(gifPlanRequestSchema.parse(input)));
  ipc.handle('gif:generation-routes', () => generated.routes());
  ipc.handle('gif:generation-latest', (_event, id) => database.latestGifGeneration(z.string().uuid().parse(id)));
  ipc.handle('gif:generation-history', (_event, id) => database.gifGenerationHistory(z.string().uuid().parse(id)));
  ipc.handle('gif:generation-cancel', (_event, id) => generated.cancel(z.string().uuid().parse(id)));
  ipc.handle('gif:generation-adopt', (_event, input) =>
    database.adoptGifGeneration(gifGenerationAdoptSchema.parse(input)),
  );
  ipc.handle('gif:generate', (event, input) =>
    generated.generate(gifGenerationStartSchema.parse(input), (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('gif:generation-progress', progress);
    }),
  );
  ipc.handle('gif:list', (_event, id, purpose) =>
    database.listGifDocuments(gifIdSchema.nullable().parse(id), gifDocumentPurposeSchema.default('GIF').parse(purpose)),
  );
  ipc.handle('gif:load', (_event, id) => database.loadGifDocument(z.string().uuid().parse(id)));
  ipc.handle('gif:find-for-asset', (_event, id, purpose, seriesId) =>
    database.findGifDocumentForAsset(
      gifIdSchema.parse(id),
      gifDocumentPurposeSchema.default('GIF').parse(purpose),
      gifIdSchema.nullable().default(null).parse(seriesId),
    ),
  );
  ipc.handle('gif:save', (_event, input) => database.saveGifDocument(gifSaveSchema.parse(input)));
  ipc.handle('gif:import', (_event, input) => service.importImage(importSchema.parse(input)));
  ipc.handle('gif:cancel', (_event, id) => service.cancel(z.string().uuid().parse(id)));
  ipc.handle('gif:export', (event, input) =>
    service.export(gifExportSchema.parse(input), (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('gif:progress', progress);
    }),
  );
}
