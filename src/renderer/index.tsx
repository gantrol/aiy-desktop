import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/renderer/App';
import { I18nProvider } from '@/renderer/i18n/I18nProvider';
import { installRendererDiagnostics, reportRendererError } from '@/renderer/lib/rendererDiagnostics';
import './styles/index.css';

const disposeDiagnostics = installRendererDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(disposeDiagnostics);

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => {
    reportRendererError('react-uncaught', error);
    console.error(error);
  },
  onCaughtError: (error) => {
    reportRendererError('react-caught', error);
    console.error(error);
  },
  onRecoverableError: (error) => {
    reportRendererError('react-recoverable', error);
    console.error(error);
  },
}).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
