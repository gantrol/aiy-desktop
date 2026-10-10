import { ChevronRightIcon, InfoIcon, SettingsIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { UserProfile } from '@/renderer/features/me/UserProfile';
import { useI18n } from '@/renderer/i18n/useI18n';

export default function MeScreen({
  spaceName,
  onNavigate,
}: {
  spaceName: string;
  onNavigate(view: 'settings' | 'about'): void;
}) {
  const { messages } = useI18n();
  const destinations = [
    { view: 'settings', label: messages.app.navigation.settings, icon: SettingsIcon },
    { view: 'about', label: messages.app.navigation.about, icon: InfoIcon },
  ] as const;
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold">{messages.me.title}</h1>
          <span className="max-w-full truncate text-sm text-muted-foreground" title={spaceName}>
            {spaceName}
          </span>
        </header>
        <UserProfile />
        <nav aria-label={messages.app.title} className="grid gap-1 border-t border-border pt-2">
          {destinations.map(({ view, label, icon: Icon }) => (
            <Button
              key={view}
              type="button"
              variant="ghost"
              className="h-auto min-h-11 w-full justify-start gap-3 whitespace-normal px-2 py-3 text-left"
              onClick={() => onNavigate(view)}
            >
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">{label}</span>
              <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </Button>
          ))}
        </nav>
      </main>
    </div>
  );
}
