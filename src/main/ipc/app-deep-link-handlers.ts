import type { AppDeepLinkController } from '@/main/app/external-deep-link';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { APP_DEEP_LINKS_TAKE_CHANNEL, appDeepLinkCommandListSchema } from '@/shared/contracts/app-deep-link';

export function registerAppDeepLinkIpc(ipc: Pick<IpcHandlerRegistrar, 'handle'>, deepLinks: AppDeepLinkController) {
  ipc.handle(APP_DEEP_LINKS_TAKE_CHANNEL, () => appDeepLinkCommandListSchema.parse(deepLinks.takePending()));
}
