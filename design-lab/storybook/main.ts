import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import remarkGfm from 'remark-gfm';

const config: StorybookConfig = {
  stories: ['./*.stories.tsx', './*.mdx'],
  addons: [
    {
      name: '@storybook/addon-docs',
      options: {
        mdxPluginOptions: {
          mdxCompileOptions: { remarkPlugins: [remarkGfm] },
        },
      },
    },
  ],
  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) } },
  },
  // Stories own their AIY surface; the background/grid only shows between mounts.
  features: { backgrounds: false },
  // Vite emits the imported CSS into the built iframe head; dev needs an early link.
  previewHead: (head, { configType }) =>
    configType === 'DEVELOPMENT' ? `${head}<link rel="stylesheet" href="./storybook/preview.css" />` : head,
  core: { disableTelemetry: true },
};
export default config;
