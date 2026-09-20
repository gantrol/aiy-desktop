import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';

export const APP_CONTENT_LINK_EVENT = 'aiy:open-content-link';

/** Only an installed navigation host may consume a validated in-app link. */
export function openAppContentLink(href: string) {
  const command = parseAiyDeepLink(href);
  if (!command) return false;
  return !window.dispatchEvent(new CustomEvent(APP_CONTENT_LINK_EVENT, { detail: command, cancelable: true }));
}
