import { ExternalLinkIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { FontPicker } from '@/renderer/features/font-settings/FontPicker';
import { fontRoles, setFontPreference, useFontPreferences } from '@/renderer/features/font-settings/fontPreferences';
import { discoverSystemFonts, recommendedFonts, type SystemFonts } from '@/renderer/features/font-settings/systemFonts';

export function FontSettings() {
  const { messages } = useI18n();
  const labels = messages.app.settings.fonts;
  const preferences = useFontPreferences();
  const [fonts, setFonts] = useState<SystemFonts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function load(refresh = false) {
    if (loading || (fonts && !refresh)) return;
    setLoading(true);
    try {
      setFonts(await discoverSystemFonts(refresh));
    } finally {
      setLoading(false);
    }
  }
  async function download(destination: (typeof recommendedFonts)[number]['destination']) {
    setError('');
    try {
      await window.desktopApi.appSupportOpen(destination);
    } catch {
      setError(labels.openFailed);
    }
  }
  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        {fontRoles.map((role) => (
          <div key={role} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
            <span className="text-sm">{labels.roles[role]}</span>
            <FontPicker
              role={role}
              value={preferences[role]}
              families={fonts?.families ?? []}
              onLoad={() => void load()}
              onChange={(family) => setFontPreference(role, family)}
            />
          </div>
        ))}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}>
            {loading ? labels.loading : labels.refresh}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fontRoles.forEach((role) => setFontPreference(role, null))}>
            <RotateCcwIcon className="size-3.5" />
            {labels.reset}
          </Button>
        </div>
        {fonts && !fonts.complete && (
          <p role="status" className="text-xs text-muted-foreground">
            {labels.partial}
          </p>
        )}
      </div>
      <div className="grid gap-2 border-y py-4">
        <span className="text-base font-semibold">{labels.previewTitle}</span>
        <span className="font-[family-name:var(--font-content)] text-base leading-7">{labels.previewBody}</span>
        <code className="text-xs">const answer = 42;</code>
      </div>
      <div className="grid gap-1">
        <span className="mb-1 text-sm font-medium">{labels.downloads}</span>
        {recommendedFonts.map((font) => (
          <Button
            key={font.id}
            variant="ghost"
            className="h-9 justify-start px-0 font-normal"
            onClick={() => void download(font.destination)}
          >
            <span>{labels.names[font.id]}</span>
            <span className="ml-auto text-xs text-muted-foreground">{labels.uses[font.id]}</span>
            <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
          </Button>
        ))}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{labels.installHint}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{labels.licenseHint}</p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
