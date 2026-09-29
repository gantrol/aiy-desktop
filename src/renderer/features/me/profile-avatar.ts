import { profileAvatarSchema } from '@/shared/contracts/me';

export async function prepareProfileAvatar(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error('ME_AVATAR_INVALID');
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context || !side) throw new Error('ME_AVATAR_INVALID');
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
    return profileAvatarSchema.parse(canvas.toDataURL('image/png'));
  } finally {
    bitmap.close();
  }
}
