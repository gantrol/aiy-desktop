import { createRoot } from 'react-dom/client';
import { TrayMenuApp } from '@/renderer/features/app-shell/TrayMenuApp';
import '@/renderer/styles/index.css';

createRoot(document.getElementById('root')!).render(<TrayMenuApp />);
