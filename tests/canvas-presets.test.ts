import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCanvasPresets } from '../src/main/canvas-presets';

import { fixturePath } from './support/fixtures';

const sourcePath = fixturePath('config/canvas-presets.json');

describe('canvas preset source', () => {
  it('loads localized, GPT Image 2-compatible presets from external content', () => {
    const zh = readCanvasPresets(sourcePath, 'zh');
    const en = readCanvasPresets(sourcePath, 'en');

    expect(zh).toHaveLength(2);
    expect(zh.find((item) => item.stableKey === 'test_wide')).toMatchObject({
      ratio: '2:1',
      width: 1280,
      height: 640,
    });
    expect(zh.find((item) => item.stableKey === 'test_square')?.name).toBe('测试方形');
    expect(en.find((item) => item.stableKey === 'test_square')?.name).toBe('Test square');
    for (const preset of zh) {
      expect(preset.width % 16).toBe(0);
      expect(preset.height % 16).toBe(0);
    }
  });

  it('treats missing optional configuration as an empty preset list', () => {
    expect(readCanvasPresets(path.join(path.dirname(sourcePath), 'missing.json'), 'en')).toEqual([]);
  });
});
