import { addons, useGlobals } from 'storybook/manager-api';
import { createElement } from 'react';
import { storybookMessages } from '../../src/renderer/i18n/locales/en.storybook';
import zhMessages from '../../extensions/com.aiy.language.zh-cn/messages.json';

const navigation = { en: storybookMessages.navigation, zh: zhMessages.designLab.storybook.navigation };

function StoryLabel({ name }: { name: string }) {
  const [globals] = useGlobals();
  const labels = navigation[globals.locale === 'en' ? 'en' : 'zh'];
  return labels[name as keyof typeof labels] ?? name;
}

addons.setConfig({
  navSize: 240,
  bottomPanelHeight: 240,
  panelPosition: 'bottom',
  showPanel: false,
  sidebar: {
    showRoots: true,
    collapsedRoots: ['interface', 'experiments'],
    renderLabel: (item) => createElement(StoryLabel, { name: item.name }),
  },
});
