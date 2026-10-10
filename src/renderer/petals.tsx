import { createRoot } from 'react-dom/client';
import { DesktopPetalsApp } from '@/renderer/features/desktop-petals/DesktopPetalsApp';
import { PetalI18nProvider } from '@/renderer/features/desktop-petals/PetalI18nProvider';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { PetalSurfaceBoundary } from '@/renderer/features/desktop-petals/PetalSurfaceBoundary';
import '@/renderer/styles/index.css';
import '@/renderer/features/font-settings/installFontPreferences';
createRoot(document.getElementById('root')!).render(
  <PetalI18nProvider>
    <TooltipProvider delayDuration={280}>
      <PetalSurfaceBoundary>
        <DesktopPetalsApp />
      </PetalSurfaceBoundary>
    </TooltipProvider>
  </PetalI18nProvider>,
);
