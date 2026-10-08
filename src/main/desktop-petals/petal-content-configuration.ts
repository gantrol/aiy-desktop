import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalHubService } from '@/main/desktop-petals/petal-hub-service';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { CodexContentCommand } from '@/shared/contracts/codex-content';
import type { Locale } from '@/shared/contracts';
import { petalError } from '@/shared/petal-errors';

/** Configuration belongs to the main window; individual petals cannot reconfigure the provider. */
export async function executePetalContentConfiguration(
  request: CodexContentCommand,
  context: ActiveLibraryContext,
  entry: PetalWindow | undefined,
  hub: PetalHubService,
  locale: Locale,
  changed: () => void,
) {
  if (entry) throw petalError('hubOnly');
  switch (request.kind) {
    case 'settings':
      return context.codexContent.settings(locale);
    case 'select-album':
      return context.codexContent.selectAlbum(request.albumId, locale);
    case 'quota':
      return context.codexContent.quota.read(hub.layouts.hubSettings.codexLimitId);
    case 'configure-quota':
      await hub.configureQuota(request.limitId);
      changed();
      return;
  }
}
