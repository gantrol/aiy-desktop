import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Popup } from '@/entrypoints/popup/popup';
import '@/entrypoints/popup/style.css';
import { companionLanguageTag, companionMessage } from '@/lib/i18n';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root is missing');

document.documentElement.lang = companionLanguageTag();
document.title = companionMessage('extensionName');

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
