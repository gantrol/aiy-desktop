import { createLucideIcon } from 'lucide-react';

/** A folded sticky note overlaps the screen without crossing its outline. */
export const PinToDesktopIcon = createLucideIcon('desktop-sticky-note', [
  ['path', { d: 'M8 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2', key: 'screen' }],
  ['path', { d: 'M12 18v4M8 22h8', key: 'stand' }],
  ['path', { d: 'M13 2h8a1 1 0 0 1 1 1v7l-3 3h-6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z', key: 'note' }],
  ['path', { d: 'M19 13v-3h3', key: 'fold' }],
]);
