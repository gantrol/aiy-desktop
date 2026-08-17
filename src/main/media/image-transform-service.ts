import type { ImageCropInput } from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import { cropImageInSandbox } from '@/main/media/image-transform-worker-client';

export class ImageTransformService {
  constructor(private readonly database: LibraryDatabase) {}

  crop(input: ImageCropInput) {
    return cropImageInSandbox(this.database, input);
  }
}
