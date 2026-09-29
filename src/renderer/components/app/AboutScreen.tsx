import { useState } from 'react';
import { ExternalLinkIcon } from 'lucide-react';
import { AiyIdentity } from '@/renderer/components/brand/AiyIdentity';
import { Button } from '@/renderer/components/ui/button';
import { AppUpdateSection } from '@/renderer/features/app-update/AppUpdateSection';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AboutScreen({ active }: { active: boolean }) {
  const { messages } = useI18n();
  const [failed, setFailed] = useState(false);
  async function openPrivacy() {
    setFailed(false);
    try {
      await window.desktopApi.appSupportOpen('PRIVACY_POLICY');
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-xl space-y-6 px-6 py-8">
        <h1 className="text-xl font-semibold">{messages.app.navigation.about}</h1>
        <div className="flex items-center gap-3">
          <AiyIdentity avatar className="size-10" />
          <span className="text-lg font-medium">{messages.app.title}</span>
        </div>
        <AppUpdateSection active={active} />
        <Button variant="link" className="px-0" onClick={() => void openPrivacy()}>
          {messages.app.settings.privacyPolicy}
          <ExternalLinkIcon className="size-4" />
        </Button>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {messages.app.settings.supportOpenFailed}
          </p>
        )}
      </main>
    </div>
  );
}
