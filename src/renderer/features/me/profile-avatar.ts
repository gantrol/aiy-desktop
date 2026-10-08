import { profileAvatarSchema } from '@/shared/contracts/me';

const avatarMimeTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const supportedMimeTypes = [...new Set(Object.values(avatarMimeTypes))];
export const profileAvatarAccept = [
  ...supportedMimeTypes,
  ...Object.keys(avatarMimeTypes).map((ext) => `.${ext}`),
].join(',');

export async function prepareProfileAvatar(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = file.type.toLowerCase() || avatarMimeTypes[extension];
  if (!supportedMimeTypes.includes(mimeType)) throw new Error('ME_AVATAR_INVALID');
  const url = URL.createObjectURL(file.type === mimeType ? file : file.slice(0, file.size, mimeType));
  // Decode SVG in an image context; never insert its markup into the application document.
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context || !side) throw new Error('ME_AVATAR_INVALID');
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    return profileAvatarSchema.parse(canvas.toDataURL('image/png'));
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
