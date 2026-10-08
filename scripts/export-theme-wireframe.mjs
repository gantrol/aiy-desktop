import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../design-lab/', import.meta.url));
const result = await build({
  configFile: false,
  root,
  resolve: { alias: { '@': fileURLToPath(new URL('../src/', import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  build: {
    write: false,
    cssCodeSplit: false,
    assetsInlineLimit: 1_000_000,
    rollupOptions: {
      input: fileURLToPath(new URL('../design-lab/theme-creation.tsx', import.meta.url)),
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
const scripts = outputs.filter((item) => item.type === 'chunk');
const styles = outputs.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'));
if (scripts.length !== 1 || !styles.length) throw new Error('Expected one self-contained script and stylesheet.');
const script = scripts[0].code.replace(/<\/script/gi, '<\\/script');
const css = styles.map((item) => String(item.source)).join('\n');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>AIY · 主题创作交互线框</title><style>${css}</style></head>
<body><div id="root"></div><noscript>此交互线框需要启用 JavaScript。模拟数据仅保留在本页内。</noscript><script>${script}</script></body></html>`;
const destination = new URL('../../../aiy-docs/design/interactions/assets/theme-creation-prototype/', import.meta.url);
await mkdir(destination, { recursive: true });
const target = new URL('index.html', destination);
await writeFile(target, html, 'utf8');
process.stdout.write(`${fileURLToPath(target)}\n${Buffer.byteLength(html).toLocaleString('en-US')} bytes\n`);
