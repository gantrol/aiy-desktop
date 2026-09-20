import { blockDocumentSchema, type BlockDocument } from '@/shared/contracts/block-document';
import document from './software-development-outline.json';

/** Authored content, not a task database, permission grant or live acceptance report. */
export function softwareDevelopmentOutlineExample(): BlockDocument {
  return blockDocumentSchema.parse(structuredClone(document));
}
