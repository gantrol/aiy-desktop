import { createHash } from 'node:crypto';
import type { LibraryStorage } from '@/main/database/core/storage';
import { text, type JsonMap } from '@/main/database/core/values';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { creationEntityExists } from '@/main/database/creations/creation-form-entity';
import type { CreationItemCreateWithFormInput } from '@/shared/contracts/creation-library';
import type { CreationSource } from '@/shared/contracts/creation-source';
import { readCreationPromptStorage } from '@/shared/creation-prompt-storage';

export function draftCreationSource(storage: LibraryStorage, draftId: string): CreationSource {
  const row = storage.db
    .prepare('SELECT prompt_nodes_json FROM creation_drafts WHERE id=? AND deleted_at IS NULL')
    .get(draftId) as JsonMap | undefined;
  if (!row) throw new Error('Creation input is unavailable');
  return readCreationPromptStorage(text(row.prompt_nodes_json)).creationSource ?? { kind: 'DRAFT', id: draftId };
}

/** Resolve once when starting a task; no chain of draft-to-draft lookups is retained. */
export function continuationSource(storage: LibraryStorage, source: CreationSource): CreationSource {
  if (source.kind === 'FORM') {
    const items = new CreationItemRepository(storage);
    const form = items.getForm(source.id);
    if (!creationEntityExists(storage.db, form.entity)) throw new Error('Creation source is unavailable');
    const item = items.get(form.creationItemId);
    if (item.lifecycle === 'ARCHIVED') throw new Error('Creation item is archived');
    return source;
  }
  const active = storage.db
    .prepare('SELECT 1 FROM creation_drafts WHERE id=? AND consumed_at IS NULL AND deleted_at IS NULL')
    .get(source.id);
  if (!active) throw new Error('Creation input is no longer available');
  return draftCreationSource(storage, source.id);
}

export function creationSourceItemId(storage: LibraryStorage, source: CreationSource): string | undefined {
  if (source.kind === 'DRAFT') return `input:${createHash('sha256').update(source.id).digest('hex')}`;
  const row = storage.db.prepare('SELECT creation_item_id FROM creation_forms WHERE id=?').get(source.id) as
    JsonMap | undefined;
  return row ? text(row.creation_item_id) : undefined;
}

/** Called inside the output's write transaction: grouping and content creation succeed together. */
export function registerCreationOutput(
  storage: LibraryStorage,
  input: CreationItemCreateWithFormInput,
  source?: CreationSource,
) {
  const items = new CreationItemRepository(storage);
  if (!source) return items.createWithForm(input);
  if (source.kind === 'FORM') continuationSource(storage, source);
  const itemId = creationSourceItemId(storage, source);
  if (!itemId) throw new Error('Creation source is unavailable');
  if (source.kind === 'FORM' || storage.db.prepare('SELECT 1 FROM creation_items WHERE id=?').get(itemId)) {
    return items.addForm({
      ...input.form,
      creationItemId: itemId,
      sourceFormId: source.kind === 'FORM' ? source.id : null,
    });
  }
  return items.createWithForm(input, { id: itemId });
}
