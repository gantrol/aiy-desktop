import type { Preview } from '@storybook/react-vite';
import { DocsContainer } from '@storybook/addon-docs/blocks';
import { enMessages } from '@/renderer/i18n/locales/en';
import { projectAnnotations } from './projectAnnotations';
import './preview.css';

const preview: Preview = {
  ...projectAnnotations,
  globalTypes: {
    locale: {
      toolbar: {
        title: enMessages.designLab.language,
        icon: 'globe',
        dynamicTitle: true,
        items: [
          { value: 'zh', title: enMessages.common.chinese },
          { value: 'en', title: enMessages.common.english },
        ],
      },
    },
  },
  initialGlobals: { locale: 'zh' },
  parameters: {
    layout: 'fullscreen',
    options: {
      storySort: {
        order: [
          'Creation',
          ['Editor workspace', ['Existing draft', '*'], 'Outline', 'Body editor'],
          'Library',
          'References',
          'Media',
          'Delivery',
          'Interface',
          ['Overview', 'Button', ['State overview', '*'], 'Input', ['State overview', '*'], 'List and detail'],
          'Experiments',
        ],
      },
    },
    viewport: {
      options: {
        aiyDesktop: { name: 'AIY 1280 × 800', styles: { width: '1280px', height: '800px' }, type: 'desktop' },
        aiyNarrow: { name: 'AIY 768 × 800', styles: { width: '768px', height: '800px' }, type: 'tablet' },
      },
    },
    docs: {
      story: { inline: false, height: '600px' },
      container: (props: React.ComponentProps<typeof DocsContainer>) => (
        <div className="h-dvh overflow-auto">
          <DocsContainer {...props} />
        </div>
      ),
    },
  },
};
export default preview;
