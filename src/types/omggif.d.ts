declare module 'omggif' {
  export interface GifFrameInfo {
    x: number;
    y: number;
    width: number;
    height: number;
    disposal: number;
    transparent_index: number | null;
  }

  export class GifReader {
    constructor(bytes: Uint8Array);
    readonly width: number;
    readonly height: number;
    numFrames(): number;
    frameInfo(index: number): GifFrameInfo;
    decodeAndBlitFrameRGBA(index: number, pixels: Uint8ClampedArray): void;
  }
}
