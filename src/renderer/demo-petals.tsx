import { createRoot } from 'react-dom/client';
import { DemoPetalWindow } from '@/renderer/features/extensions/feature-demo/v050/DemoPetalWindow';
import '@/renderer/styles/index.css';
import '@/renderer/features/font-settings/installFontPreferences';

document.documentElement.style.colorScheme = 'light';
createRoot(document.getElementById('root')!).render(<DemoPetalWindow />);
