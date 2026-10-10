import { ChevronDownIcon, ExternalLinkIcon, RefreshCwIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { useI18n } from '@/renderer/i18n/useI18n';
import { FontPicker } from '@/renderer/features/font-settings/FontPicker';
import {
  fontRoles,
  setFontPreference,
  useFontPreferences,
  type FontRole,
} from '@/renderer/features/font-settings/fontPreferences';
import { discoverSystemFonts, recommendedFonts, type SystemFonts } from '@/renderer/features/font-settings/systemFonts';

export function FontSettings({ roles = fontRoles }: { roles?: readonly FontRole[] }) {
  const { messages } = useI18n();
  const labels = messages.app.settings.fonts;
  const preferences = useFontPreferences();
  const [fonts, setFonts] = useState<SystemFonts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const downloads = recommendedFonts.filter((font) =>
    roles.some((role) => (font.roles as readonly string[]).includes(role)),
  );
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
    <div className="grid gap-4 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{labels.tab}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={loading}
            aria-label={labels.refresh}
            title={labels.refresh}
            onClick={() => void load(true)}
          >
            <RefreshCwIcon className={loading ? 'size-3.5 animate-spin motion-reduce:animate-none' : 'size-3.5'} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={roles.every((role) => preferences[role] === null)}
            onClick={() => roles.forEach((role) => setFontPreference(role, null))}
          >
            <RotateCcwIcon className="size-3.5" />
            {labels.reset}
          </Button>
        </div>
      </div>
      <div className="grid gap-5">
        {roles.map((role) => (
          <div key={role} className="grid gap-3">
            <div className="grid grid-cols-[minmax(5rem,1fr)_minmax(0,2fr)] items-center gap-4">
              <span className="text-sm">{labels.roles[role]}</span>
              <FontPicker
                role={role}
                value={preferences[role]}
                families={fonts?.families ?? []}
                onLoad={() => void load()}
                onChange={(family) => setFontPreference(role, family)}
              />
            </div>
            <div className="grid gap-2 bg-muted/50 px-4 py-3" aria-label={labels.preview}>
              <span className="text-xs text-muted-foreground">{labels.preview}</span>
              <span
                className={
                  role === 'mono'
                    ? 'font-mono text-sm leading-6'
                    : role === 'content'
                      ? 'font-[family-name:var(--font-content)] text-base leading-7'
                      : 'text-base leading-7'
                }
              >
                {role === 'mono' ? 'const answer = 42;' : labels.previewBody}
              </span>
            </div>
          </div>
        ))}
        {loading && (
          <span role="status" className="text-xs text-muted-foreground">
            {labels.loading}
          </span>
        )}
        {fonts && !fonts.complete && (
          <p role="status" className="text-xs text-muted-foreground">
            {labels.partial}
          </p>
        )}
      </div>
      <Collapsible className="border-t pt-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="group h-9 w-full justify-between px-0 text-xs font-normal text-muted-foreground"
          >
            {labels.downloads}
            <ChevronDownIcon className="size-3.5 group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-1 pt-1">
          {downloads.map((font) => (
            <Button
              key={font.id}
              variant="ghost"
              className="h-auto min-h-9 justify-start whitespace-normal px-2 py-2 text-left font-normal"
              onClick={() => void download(font.destination)}
            >
              <span>{labels.names[font.id]}</span>
              <span className="ml-auto text-xs text-muted-foreground">{labels.uses[font.id]}</span>
              <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
            </Button>
          ))}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
