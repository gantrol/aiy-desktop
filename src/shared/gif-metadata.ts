/** Bounded GIF container inspection; defaults to full-canvas frames produced by our encoder. */
export function gifMetadata(
  bytes: Uint8Array,
  { requireFullCanvasFrames = true, maxFrames = 240 }: { requireFullCanvasFrames?: boolean; maxFrames?: number } = {},
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number) => view.getUint16(offset, true);
  const ascii = (offset: number, size: number) => String.fromCharCode(...bytes.subarray(offset, offset + size));
  const invalid = () => {
    throw new Error('GIF_INVALID');
  };
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(ascii(0, 6))) invalid();
  const width = word(6),
    height = word(8);
  if (!width || !height) invalid();
  let offset = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
  let delay = 0,
    loop: number | null = null;
  let disposal = 0;
  let transparentIndex: number | null = null;
  const durations: number[] = [];
  const controls: { disposal: number; transparentIndex: number | null }[] = [];
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (size === 0) return;
      offset += size;
      if (offset > bytes.length) invalid();
    }
    invalid();
  };
  const readFrame = () => {
    if (offset + 9 > bytes.length) invalid();
    const x = word(offset),
      y = word(offset + 2),
      frameWidth = word(offset + 4),
      frameHeight = word(offset + 6);
    if (
      !frameWidth ||
      !frameHeight ||
      x + frameWidth > width ||
      y + frameHeight > height ||
      (requireFullCanvasFrames && (x !== 0 || y !== 0 || frameWidth !== width || frameHeight !== height))
    )
      invalid();
    const packed = bytes[offset + 8];
    offset += 9 + (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0);
    if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) invalid();
    offset++;
    skipBlocks();
    durations.push(delay);
    controls.push({ disposal, transparentIndex });
    delay = 0;
    disposal = 0;
    transparentIndex = null;
    if (durations.length > maxFrames) invalid();
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      if (offset !== bytes.length || !durations.length) invalid();
      return { width, height, durations, loop, controls };
    }
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) {
        if (offset + 6 > bytes.length || bytes[offset] !== 4 || bytes[offset + 5] !== 0) invalid();
        disposal = (bytes[offset + 1] >> 2) & 7;
        transparentIndex = bytes[offset + 1] & 1 ? bytes[offset + 4] : null;
        delay = word(offset + 2) * 10;
        offset += 6;
      } else {
        if (label === 0xff && bytes[offset] === 11 && ['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(ascii(offset + 1, 11))) {
          if (offset + 17 > bytes.length || bytes[offset + 12] !== 3 || bytes[offset + 13] !== 1) invalid();
          loop = word(offset + 14);
        }
        skipBlocks();
      }
    } else if (marker === 0x2c) {
      readFrame();
    } else invalid();
  }
  return invalid();
}
