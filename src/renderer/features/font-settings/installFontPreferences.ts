import { installFontPreferences } from '@/renderer/features/font-settings/fontPreferences';

const dispose = installFontPreferences();
if (import.meta.hot) import.meta.hot.dispose(dispose);
