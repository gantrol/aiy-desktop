// Paint-only overlays use a portal. Interactive menus own their document and React root.
import '@/renderer/styles/index.css';
window.petalOverlayReady = window.name.startsWith('aiy-petal-menu:')
  ? import('@/renderer/features/desktop-petals/PetalMenuHost').then(() => undefined)
  : Promise.resolve();
