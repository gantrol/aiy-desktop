import type { IntakeMediaMimeType, IntakeVideoMimeType } from '@/shared/contracts';

export const intakeMediaAccept =
  'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.m4v,.webm,.mov';

const supportedMimeTypes = new Set<IntakeMediaMimeType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const mimeTypeByExtension = new Map<string, IntakeMediaMimeType>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'],
  ['mp4', 'video/mp4'],
  ['m4v', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
]);

export function intakeMediaMimeType(file: File): IntakeMediaMimeType | null {
  if (file.type === 'video/x-m4v') return 'video/mp4';
  if (supportedMimeTypes.has(file.type as IntakeMediaMimeType)) return file.type as IntakeMediaMimeType;
  return mimeTypeByExtension.get(file.name.split('.').pop()?.toLowerCase() ?? '') ?? null;
}

export function isIntakeVideoMimeType(mimeType: IntakeMediaMimeType): mimeType is IntakeVideoMimeType {
  return mimeType.startsWith('video/');
}

export function isCreatorImageMimeType(mimeType: string) {
  return (
    mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp' || mimeType === 'image/svg+xml'
  );
}
