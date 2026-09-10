import { createRoot } from 'react-dom/client';
import { DesktopPetalsApp } from '@/renderer/features/desktop-petals/DesktopPetalsApp';
import { PetalI18nProvider } from '@/renderer/features/desktop-petals/PetalI18nProvider';
import '@/renderer/styles/index.css';
createRoot(document.getElementById('root')!).render(
  <PetalI18nProvider>
    <DesktopPetalsApp />
  </PetalI18nProvider>,
);
