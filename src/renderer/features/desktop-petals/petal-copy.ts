import type { PetalQuota } from '@/shared/contracts/petal-hub';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';

const legacyState = {
  ready: 'remaining',
  unavailable: 'unavailable',
  'permission-required': 'permissionRequired',
  'select-limit': 'selectLimit',
} as const;
export function petalQuotaText(quota: PetalQuota | null, messages: DesktopPetalMessages) {
  if (!quota) return messages.quota.loading;
  return messages.quota[quota.messageCode ?? legacyState[quota.state]];
}
