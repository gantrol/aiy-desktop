import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCT_NAME,
  PRODUCT_NAMES,
  productNameForLocale,
  USER_DATA_DIRECTORY_NAME,
} from '../src/shared/product';
import { testMessages } from './support/i18n';

const desktopRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function source(relativePath: string): string {
  return readFileSync(path.join(desktopRoot, relativePath), 'utf8');
}

describe('product identity', () => {
  it('uses the current user-facing name across desktop surfaces', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      author: string;
      name: string;
      productName: string;
    };
    const main = source('src/main/index.ts');

    expect(packageJson.productName).toBe(DEFAULT_PRODUCT_NAME);
    expect(packageJson.author).toBe(DEFAULT_PRODUCT_NAME);
    expect(testMessages.zh.app.title).toBe(PRODUCT_NAMES.zh);
    expect(testMessages.en.app.title).toBe(PRODUCT_NAMES.en);
    expect(productNameForLocale('zh-CN')).toBe(PRODUCT_NAMES.zh);
    expect(productNameForLocale('en-US')).toBe(PRODUCT_NAMES.en);
    expect(source('electron-builder.yml')).toContain(`productName: ${DEFAULT_PRODUCT_NAME}`);
    expect(source('src/renderer/index.html')).toContain(`<title>${DEFAULT_PRODUCT_NAME}</title>`);
    expect(main).toContain('app.setName(DEFAULT_PRODUCT_NAME)');
    expect(main).toContain('title: productNameForLocale(app.getLocale())');
  });

  it('keeps persisted and protocol-facing compatibility identifiers stable', () => {
    const packageJson = JSON.parse(source('package.json')) as { name: string };
    const builder = source('electron-builder.yml');
    const main = source('src/main/index.ts');

    expect(USER_DATA_DIRECTORY_NAME).toBe('AIY');
    expect(main).toContain("path.resolve(app.getPath('appData'), USER_DATA_DIRECTORY_NAME)");
    expect(packageJson.name).toBe('@aiy/desktop');
    expect(builder).toContain('appId: com.catai.aiy');
    expect(builder).toContain('executableName: aiy');
    expect(main).toContain("scheme: 'aiy-media'");
  });
});
